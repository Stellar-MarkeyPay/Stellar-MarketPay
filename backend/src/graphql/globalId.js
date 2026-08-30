/**
 * src/graphql/globalId.js
 *
 * Global object identifiers for the `Node` interface.
 *
 * A `Job`'s `id` in the graph is not the same string as its database id. It is
 * `base64url("Job:123")`, so that `node(id:)` can refetch any object without
 * the client saying what kind of thing it is, and so that two entities with
 * colliding numeric ids are distinguishable in a normalised client cache.
 *
 * This is opacity, not security. A global id decodes to a type and a database
 * id in one line, and nothing here should be mistaken for making an id
 * unguessable — authorisation is what protects an object, on every field.
 */

"use strict";

const { GraphQLError } = require("graphql");

const SEPARATOR = ":";

/** The types that participate in `Node`. Anything else is a programming error. */
const NODE_TYPES = new Set([
  "Job",
  "Application",
  "Escrow",
  "EscrowEvent",
  "Profile",
  "Dispute",
  "Rating",
  "SkillEndorsement",
]);

function toGlobalId(typeName, localId) {
  if (!NODE_TYPES.has(typeName)) {
    throw new Error(`toGlobalId: "${typeName}" is not a Node type`);
  }
  return Buffer.from(`${typeName}${SEPARATOR}${localId}`, "utf8").toString("base64url");
}

/**
 * @returns {{type: string, id: string}}
 * @throws {GraphQLError} when the id is malformed — a client error, not a bug.
 */
function fromGlobalId(globalId) {
  let decoded;
  try {
    decoded = Buffer.from(String(globalId), "base64url").toString("utf8");
  } catch {
    throw new GraphQLError("Malformed id", { extensions: { code: "BAD_USER_INPUT" } });
  }

  const index = decoded.indexOf(SEPARATOR);
  if (index <= 0) {
    throw new GraphQLError("Malformed id", { extensions: { code: "BAD_USER_INPUT" } });
  }

  const type = decoded.slice(0, index);
  const id = decoded.slice(index + 1);
  if (!NODE_TYPES.has(type) || id === "") {
    throw new GraphQLError("Malformed id", { extensions: { code: "BAD_USER_INPUT" } });
  }

  return { type, id };
}

/**
 * Decode an id that the caller expects to be of a particular type.
 *
 * Returns null rather than throwing on a type mismatch, so a resolver can
 * answer `NotFoundError` — telling a caller "that is a Profile id, not a Job
 * id" confirms the Profile exists.
 */
function localIdOfType(globalId, expectedType) {
  const parsed = fromGlobalId(globalId);
  return parsed.type === expectedType ? parsed.id : null;
}

module.exports = { toGlobalId, fromGlobalId, localIdOfType, NODE_TYPES };
