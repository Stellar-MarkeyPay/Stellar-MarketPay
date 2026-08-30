/**
 * src/graphql/schema/scalars.js
 *
 * Custom scalars.
 *
 * Each one exists because the alternative loses information. `DateTime` as a
 * `String` means every client re-invents parsing; `Decimal` as a `Float` means
 * a 7-decimal-place stroop amount silently rounds; `PublicKey` as a `String`
 * means a malformed address becomes a database round trip that finds nothing
 * instead of a validation error at the edge.
 *
 * Scalars validate on the way *in* (parseValue / parseLiteral) as well as on
 * the way out. A scalar that only serialises is documentation, not a type.
 */

"use strict";

const { GraphQLScalarType, Kind, GraphQLError } = require("graphql");
const { StrKey } = require("@stellar/stellar-sdk");

function invalid(message) {
  // GraphQLError rather than Error: this is a client mistake, and the
  // difference decides whether it is reported as a 400 with a useful message
  // or as a 500 with a stack trace in the logs.
  throw new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

// Require a full timestamp and an explicit timezone. `new Date("2026-01-01")`
// is valid JavaScript, but it is not the RFC 3339 instant promised by this
// scalar and its interpretation has caused client/server timezone drift.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseDateTime(value) {
  if (typeof value !== "string" || !RFC3339.test(value)) {
    invalid("DateTime must be an RFC 3339 timestamp with an explicit timezone");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(`Invalid DateTime: ${value}`);
  return date;
}

const DateTime = new GraphQLScalarType({
  name: "DateTime",
  description: "An RFC 3339 timestamp in UTC.",
  serialize(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) invalid(`DateTime cannot serialize ${JSON.stringify(value)}`);
    return date.toISOString();
  },
  parseValue(value) {
    return parseDateTime(value);
  },
  parseLiteral(node) {
    if (node.kind !== Kind.STRING) invalid("DateTime must be a string");
    return parseDateTime(node.value);
  },
});

// Stellar ed25519 account: 'G' + 55 base32 characters.
const PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

function isPublicKey(value) {
  return PUBLIC_KEY.test(value) && StrKey.isValidEd25519PublicKey(value);
}

const PublicKey = new GraphQLScalarType({
  name: "PublicKey",
  description: "A Stellar ed25519 public key.",
  serialize(value) {
    if (value === null || value === undefined) return null;
    const text = String(value);
    if (!isPublicKey(text)) {
      invalid("PublicKey cannot serialize a malformed Stellar account");
    }
    return text;
  },
  parseValue(value) {
    if (typeof value !== "string" || !isPublicKey(value)) {
      invalid("PublicKey must be a checksummed Stellar ed25519 account starting with G");
    }
    return value;
  },
  parseLiteral(node) {
    if (node.kind !== Kind.STRING || !isPublicKey(node.value)) {
      invalid("PublicKey must be a checksummed Stellar ed25519 account starting with G");
    }
    return node.value;
  },
});

const Cursor = new GraphQLScalarType({
  name: "Cursor",
  description: "An opaque pagination cursor.",
  serialize(value) {
    return value === null || value === undefined ? null : String(value);
  },
  parseValue(value) {
    if (typeof value !== "string") invalid("Cursor must be a string");
    return value;
  },
  parseLiteral(node) {
    if (node.kind !== Kind.STRING) invalid("Cursor must be a string");
    return node.value;
  },
});

// Optional sign, digits, optional fractional part. No exponent: money is not
// written in scientific notation, and accepting it invites a rounding bug.
const DECIMAL = /^-?\d+(\.\d+)?$/;

const Decimal = new GraphQLScalarType({
  name: "Decimal",
  description: "An arbitrary-precision decimal, serialised as a string.",
  serialize(value) {
    if (value === null || value === undefined) return null;
    // Numbers arriving from `pg` for a NUMERIC column are already strings;
    // anything genuinely numeric is converted here rather than trusted.
    const text = typeof value === "number" ? String(value) : String(value).trim();
    if (!DECIMAL.test(text)) invalid(`Decimal cannot serialize ${JSON.stringify(value)}`);
    return text;
  },
  parseValue(value) {
    // JSON numbers have already passed through IEEE-754 before a scalar sees
    // them. Requiring a string for variables is what makes the precision
    // guarantee real rather than documentation only.
    if (typeof value !== "string" || !DECIMAL.test(value)) invalid(`Invalid Decimal: ${value}`);
    return value;
  },
  parseLiteral(node) {
    if (node.kind !== Kind.STRING || !DECIMAL.test(node.value)) {
      invalid("Decimal must be a numeric string");
    }
    return node.value;
  },
});

function parseJsonLiteral(node, variables) {
  switch (node.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return node.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(node.value);
    case Kind.OBJECT:
      return Object.fromEntries(
        node.fields.map((field) => [field.name.value, parseJsonLiteral(field.value, variables)])
      );
    case Kind.LIST:
      return node.values.map((value) => parseJsonLiteral(value, variables));
    case Kind.NULL:
      return null;
    case Kind.VARIABLE:
      return variables ? variables[node.name.value] : undefined;
    default:
      return undefined;
  }
}

const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description: "An arbitrary JSON value.",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: parseJsonLiteral,
});

module.exports = { DateTime, PublicKey, Cursor, Decimal, JSON: JSONScalar };
