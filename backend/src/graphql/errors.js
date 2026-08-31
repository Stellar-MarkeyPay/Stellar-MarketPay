/**
 * src/graphql/errors.js
 *
 * Expected failures, as data.
 *
 * The distinction this file draws is the important one: a *domain* failure —
 * not found, forbidden, already released — is a value the client is expected
 * to handle, and belongs in the response body at the position it happened. A
 * *system* failure — a dropped connection, a bug — belongs in the top-level
 * `errors` array with a request id and nothing else, because there is nothing
 * useful a client can do with it and quite a lot a stack trace can leak.
 *
 * Services throw plain `Error`s with human messages. `fromServiceError`
 * translates those into schema types, and it does so by matching on message
 * text, which is fragile and known to be: see the note there.
 */

"use strict";

const { GraphQLError } = require("graphql");

const CODES = {
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  VALIDATION: "VALIDATION",
  CONFLICT: "CONFLICT",
  INTERNAL: "INTERNAL",
};

const notFound = (message, id = null) => ({
  __typename: "NotFoundError",
  code: CODES.NOT_FOUND,
  message: message || "Not found",
  id,
});

const forbidden = (message, requiredScope = null) => ({
  __typename: "ForbiddenError",
  code: CODES.FORBIDDEN,
  message: message || "You do not have access to this resource",
  requiredScope,
});

const unauthorized = (message) => ({
  __typename: "UnauthorizedError",
  code: CODES.UNAUTHORIZED,
  message: message || "Authentication required",
});

const validation = (message, field = null) => ({
  __typename: "ValidationError",
  code: CODES.VALIDATION,
  message: message || "Invalid input",
  field,
});

const conflict = (message, currentState = null) => ({
  __typename: "ConflictError",
  code: CODES.CONFLICT,
  message: message || "The resource is not in a state that allows this",
  currentState,
});

/**
 * Message fragments that identify a domain failure thrown by a service.
 *
 * This is string matching against error messages, which is fragile: renaming
 * a message in a service silently reclassifies its failure as INTERNAL. It is
 * the deliberate cost of leaving the services untouched — the alternative is
 * editing 40 service modules to throw typed errors, which is a far larger and
 * riskier change than adding a gateway.
 *
 * The mitigation is that misclassification fails *safe*: an unmatched error
 * becomes a generic internal error with no detail leaked, and the service's
 * own REST route keeps its existing behaviour either way. When a service is
 * next touched for other reasons, it should grow a `code` property, and
 * `fromServiceError` prefers that over the text as soon as one exists.
 */
const PATTERNS = [
  { code: CODES.NOT_FOUND, test: /not found|does not exist|no such/i },
  {
    code: CODES.FORBIDDEN,
    test: /forbidden|not authori[sz]ed|not permitted|only the (client|freelancer)|cannot access/i,
  },
  { code: CODES.UNAUTHORIZED, test: /unauthenticated|missing token|invalid token/i },
  {
    code: CODES.CONFLICT,
    test: /already |cannot be |must be (open|funded|in_progress)|closed|expired|invalid (status|state|transition)/i,
  },
  {
    code: CODES.VALIDATION,
    test: /invalid|required|must be|too (long|short|large|many)|at least|at most/i,
  },
];

/**
 * Translate a thrown service error into a schema error value.
 *
 * @param {Error} error
 * @returns {object} one of the `MutationError` members
 */
function fromServiceError(error) {
  const message = error && error.message ? String(error.message) : "";

  // A service that has been taught to carry a code wins over the text.
  const explicit = error && (error.code || error.graphqlCode);
  const code =
    (typeof explicit === "string" && CODES[explicit] && explicit) ||
    (PATTERNS.find((pattern) => pattern.test.test(message)) || {}).code ||
    CODES.INTERNAL;

  switch (code) {
    case CODES.NOT_FOUND:
      return notFound(message);
    case CODES.FORBIDDEN:
      return forbidden(message);
    case CODES.UNAUTHORIZED:
      return unauthorized(message);
    case CODES.CONFLICT:
      return conflict(message, error && error.currentState);
    case CODES.VALIDATION:
      return validation(message, error && error.field);
    default:
      // Unknown failures are not expected domain values. Preserve them for
      // the gateway's top-level formatter/logger rather than mislabelling a
      // database outage as a validation error a client could fix.
      throw error;
  }
}

/**
 * Is this a failure the client should be told about verbatim?
 *
 * Used by the top-level error formatter to decide between passing a message
 * through and replacing it with a request id.
 */
function isClientFacing(error) {
  if (error instanceof GraphQLError) {
    const code = error.extensions && error.extensions.code;
    return (
      code === "BAD_USER_INPUT" ||
      code === "GRAPHQL_VALIDATION_FAILED" ||
      code === "GRAPHQL_PARSE_FAILED" ||
      code === "PERSISTED_QUERY_NOT_FOUND" ||
      code === "QUERY_TOO_DEEP" ||
      code === "QUERY_TOO_COMPLEX" ||
      code === "UNAUTHENTICATED" ||
      code === "FORBIDDEN"
    );
  }
  return false;
}

/** A GraphQLError for a failure that must abort the field rather than be data. */
function fatal(message, code, extra = {}) {
  return new GraphQLError(message, { extensions: { code, ...extra } });
}

module.exports = {
  CODES,
  notFound,
  forbidden,
  unauthorized,
  validation,
  conflict,
  fromServiceError,
  isClientFacing,
  fatal,
};
