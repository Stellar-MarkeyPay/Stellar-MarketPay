#!/usr/bin/env node

/**
 * Keep the committed GraphQL contract reproducible and additive.
 *
 * Examples:
 *   npm run graphql:schema:write
 *   npm run graphql:schema:check
 *   npm run graphql:schema:breaking -- --base upstream/main
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  buildSchema: buildSchemaFromSdl,
  findBreakingChanges,
  findDangerousChanges,
} = require("graphql");

const { printCanonicalSchema } = require("../src/graphql/schema");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_ROOT = path.resolve(BACKEND_ROOT, "..");
const SNAPSHOT_PATH = path.join(BACKEND_ROOT, "src", "graphql", "schema", "schema.graphql");
const SNAPSHOT_REPOSITORY_PATH = path
  .relative(REPOSITORY_ROOT, SNAPSHOT_PATH)
  .split(path.sep)
  .join("/");

function canonicalSchema() {
  return `${printCanonicalSchema().trimEnd()}\n`;
}

function writeSnapshot() {
  fs.writeFileSync(SNAPSHOT_PATH, canonicalSchema(), "utf8");
  return SNAPSHOT_PATH;
}

function checkSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(`GraphQL schema snapshot is missing: ${SNAPSHOT_REPOSITORY_PATH}`);
  }

  const committed = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const generated = canonicalSchema();
  if (committed !== generated) {
    throw new Error(
      `GraphQL schema snapshot is stale. Run \`npm run graphql:schema:write\` in backend/ and commit ${SNAPSHOT_REPOSITORY_PATH}.`
    );
  }
  return SNAPSHOT_PATH;
}

function compareSchemas(previousSdl, currentSdl = canonicalSchema()) {
  const previous = buildSchemaFromSdl(previousSdl);
  const current = buildSchemaFromSdl(currentSdl);
  return {
    breaking: findBreakingChanges(previous, current),
    dangerous: findDangerousChanges(previous, current),
  };
}

function assertGitRef(base) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], {
      cwd: REPOSITORY_ROOT,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`GraphQL schema baseline is not a commit: ${base}`);
  }
}

function snapshotAt(base) {
  assertGitRef(base);
  try {
    return execFileSync("git", ["show", `${base}:${SNAPSHOT_REPOSITORY_PATH}`], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // This is the initial registry PR. A real commit exists, but it predates
    // the snapshot, so there is no contract against which to break.
    return null;
  }
}

function formatChanges(changes) {
  return changes.map((change) => `- [${change.type}] ${change.description}`).join("\n");
}

function checkBreakingChanges(base) {
  const previous = snapshotAt(base);
  if (previous === null) return { initial: true, breaking: [], dangerous: [] };

  const changes = compareSchemas(previous);
  if (changes.breaking.length > 0) {
    throw new Error(
      `Breaking GraphQL schema changes compared with ${base}:\n${formatChanges(changes.breaking)}`
    );
  }
  return { initial: false, ...changes };
}

function parseArguments(argv) {
  const options = { write: false, check: false, breaking: false, base: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") options.write = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--breaking") options.breaking = true;
    else if (argument === "--base") options.base = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (!options.write && !options.check && !options.breaking) {
    throw new Error("Choose one of --write, --check, or --breaking");
  }

  if (options.write) {
    console.log(`Wrote ${path.relative(REPOSITORY_ROOT, writeSnapshot())}`);
  }
  if (options.check) {
    checkSnapshot();
    console.log(`GraphQL schema snapshot is current: ${SNAPSHOT_REPOSITORY_PATH}`);
  }
  if (options.breaking) {
    const base = options.base || process.env.GRAPHQL_SCHEMA_BASE_SHA;
    if (!base) throw new Error("--breaking requires --base <git-ref> or GRAPHQL_SCHEMA_BASE_SHA");
    const result = checkBreakingChanges(base);
    if (result.initial) {
      console.log(`No GraphQL schema exists at ${base}; accepting the initial registry snapshot.`);
    } else {
      console.log(`No breaking GraphQL schema changes compared with ${base}.`);
      if (result.dangerous.length > 0) {
        console.warn(
          `Dangerous GraphQL schema changes require review:\n${formatChanges(result.dangerous)}`
        );
      }
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  SNAPSHOT_PATH,
  canonicalSchema,
  writeSnapshot,
  checkSnapshot,
  compareSchemas,
  checkBreakingChanges,
  parseArguments,
};
