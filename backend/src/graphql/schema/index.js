/**
 * src/graphql/schema/index.js
 *
 * Assembles the SDL files into an executable schema.
 *
 * The schema is built from `.graphql` files rather than from JavaScript
 * template literals for one reason that matters: the SDL is the artefact the
 * registry snapshots, the codegen reads and the breaking-change detector
 * compares. Keeping it in its own files means the thing under review and the
 * thing being executed cannot drift.
 *
 * This first slice deliberately builds the contract only. Resolver attachment
 * and directive enforcement land in the following independently mergeable
 * slices, before the endpoint is enabled. Keeping the shape builder free of
 * runtime imports also lets CI validate and compare the schema without a
 * database or an application bootstrap.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { buildASTSchema, parse, concatAST, print, validateSchema } = require("graphql");

const scalars = require("./scalars");

const SDL_DIR = path.join(__dirname, "sdl");

/** Read every SDL file, in a stable order so the printed schema is stable. */
function readSdl() {
  return fs
    .readdirSync(SDL_DIR)
    .filter((file) => file.endsWith(".graphql"))
    .sort()
    .map((file) => ({ file, source: fs.readFileSync(path.join(SDL_DIR, file), "utf8") }));
}

function buildSchemaAst() {
  const documents = readSdl().map(({ file, source }) => {
    try {
      return parse(source, { noLocation: false });
    } catch (error) {
      throw new Error(`GraphQL SDL parse error in ${file}: ${error.message}`);
    }
  });
  return concatAST(documents);
}

/** Replace the SDL's scalar placeholders with the real implementations. */
function attachScalars(schema) {
  for (const [name, scalar] of Object.entries(scalars)) {
    const declared = schema.getType(name);
    if (!declared) throw new Error(`Scalar "${name}" is implemented but not declared in the SDL`);
    declared.serialize = scalar.serialize;
    declared.parseValue = scalar.parseValue;
    declared.parseLiteral = scalar.parseLiteral;
    declared.description = declared.description || scalar.description;
  }
  return schema;
}

/**
 * Build and validate the executable schema shape.
 */
function buildSchema() {
  const schema = buildASTSchema(buildSchemaAst(), { assumeValidSDL: false });
  attachScalars(schema);
  const errors = validateSchema(schema);
  if (errors.length > 0) {
    throw new Error(
      `Invalid GraphQL schema:\n${errors.map((error) => `- ${error.message}`).join("\n")}`
    );
  }
  return schema;
}

/** The schema shape, with no resolvers. Safe to call from a script. */
function buildSchemaShape() {
  return buildSchema();
}

/** The canonical printed form, for the registry snapshot. */
function printCanonicalSchema() {
  // `printSchema(schema)` intentionally omits applied custom directives.
  // Printing the validated source AST keeps @auth, @cost and @cacheControl in
  // the registry artefact, where their removal remains visible in review.
  buildSchemaShape();
  return print(buildSchemaAst()).replace(/[ \t]+$/gm, "");
}

module.exports = { buildSchema, buildSchemaShape, printCanonicalSchema, readSdl, SDL_DIR };
