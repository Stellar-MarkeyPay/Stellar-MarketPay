/**
 * src/graphql/pagination.js
 *
 * One pagination convention, applied to every collection.
 *
 * The value of a convention is entirely in its uniformity: a client that can
 * page one connection can page all of them, and a generated type for one
 * connection has the same shape as every other. So there are no exceptions
 * here, including for collections whose service layer only offers offset
 * paging.
 *
 * Those get an offset encoded inside an opaque cursor. The client cannot tell
 * the difference, which is the point — when `applicationService` grows keyset
 * paging, the cursor encoding changes and the schema does not.
 */

"use strict";

const { GraphQLError } = require("graphql");

const CURSOR_PREFIX = "mp1:";
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Encode a cursor.
 *
 * base64url of a prefixed JSON payload. The prefix is a version marker: if
 * the encoding ever changes, an old cursor is recognisably old and can be
 * rejected with a useful message instead of decoding into nonsense.
 */
function encodeCursor(payload) {
  return Buffer.from(`${CURSOR_PREFIX}${JSON.stringify(payload)}`, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (cursor === null || cursor === undefined) return null;
  let decoded;
  try {
    decoded = Buffer.from(String(cursor), "base64url").toString("utf8");
  } catch {
    throw new GraphQLError("Malformed cursor", { extensions: { code: "BAD_USER_INPUT" } });
  }
  if (!decoded.startsWith(CURSOR_PREFIX)) {
    throw new GraphQLError("Unrecognised cursor. Restart pagination from the first page.", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  try {
    return JSON.parse(decoded.slice(CURSOR_PREFIX.length));
  } catch {
    throw new GraphQLError("Malformed cursor", { extensions: { code: "BAD_USER_INPUT" } });
  }
}

function offsetCursor(offset) {
  return encodeCursor({ o: offset });
}

/**
 * Read `first`/`after` into a bounded limit and offset.
 *
 * `MAX_PAGE_SIZE` is a hard ceiling rather than a default, and it is enforced
 * here as well as by the complexity limiter. The limiter prices the request;
 * this stops a single connection from loading ten thousand rows even when the
 * overall budget would have allowed it.
 */
function readPageArgs({ first, after } = {}) {
  const requested = first === null || first === undefined ? DEFAULT_PAGE_SIZE : Number(first);
  if (!Number.isInteger(requested) || requested < 0) {
    throw new GraphQLError("`first` must be a non-negative integer", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (requested > MAX_PAGE_SIZE) {
    throw new GraphQLError(`\`first\` may not exceed ${MAX_PAGE_SIZE} (requested ${requested})`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const cursor = decodeCursor(after);
  if (
    cursor !== null &&
    (typeof cursor !== "object" ||
      Array.isArray(cursor) ||
      !Number.isSafeInteger(cursor.o) ||
      cursor.o < 0)
  ) {
    throw new GraphQLError("Malformed cursor", { extensions: { code: "BAD_USER_INPUT" } });
  }
  const offset = cursor === null ? 0 : cursor.o;

  return { limit: requested, offset, cursor };
}

/**
 * Build a connection from a fully-materialised array.
 *
 * For collections whose service returns everything and expects the caller to
 * slice. Honest about what it is: this does not save the database any work,
 * it only gives the client a consistent shape. Connections built this way are
 * the ones to migrate first when a collection grows.
 *
 * @param {Array} items the whole collection
 * @param {{first?: number, after?: string}} args
 * @param {(item: any, index: number) => object} [cursorFor]
 */
function connectionFromArray(items, args, cursorFor) {
  const all = Array.isArray(items) ? items : [];
  const { limit, offset } = readPageArgs(args);

  const slice = all.slice(offset, offset + limit);
  const edges = slice.map((node, index) => ({
    node,
    cursor: cursorFor
      ? encodeCursor(cursorFor(node, offset + index))
      : offsetCursor(offset + index + 1),
  }));

  return {
    edges,
    totalCount: all.length,
    pageInfo: {
      hasNextPage: offset + limit < all.length,
      hasPreviousPage: offset > 0,
      startCursor: edges.length > 0 ? edges[0].cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
    },
  };
}

/**
 * Build a connection from a page the service already sliced.
 *
 * The service is told to fetch `limit + 1` rows; the extra row can prove
 * `hasNextPage`. The schema promises an exact, non-null `totalCount` on every
 * connection, so callers must also supply that exact count rather than a
 * lower-bound estimate whose meaning would vary between collections.
 */
function connectionFromPage({ nodes, totalCount, offset, limit, hasMore, cursorFor }) {
  const items = Array.isArray(nodes) ? nodes : [];
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new TypeError("connectionFromPage requires an exact non-negative integer totalCount");
  }
  const edges = items.map((node, index) => ({
    node,
    cursor: cursorFor
      ? encodeCursor(cursorFor(node, offset + index))
      : offsetCursor(offset + index + 1),
  }));

  return {
    edges,
    totalCount,
    pageInfo: {
      hasNextPage: hasMore === undefined ? offset + limit < totalCount : Boolean(hasMore),
      hasPreviousPage: offset > 0,
      startCursor: edges.length > 0 ? edges[0].cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
    },
  };
}

/** An empty connection, for an edge the viewer may not traverse. */
function emptyConnection() {
  return {
    edges: [],
    totalCount: 0,
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
  };
}

module.exports = {
  encodeCursor,
  decodeCursor,
  offsetCursor,
  readPageArgs,
  connectionFromArray,
  connectionFromPage,
  emptyConnection,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
};
