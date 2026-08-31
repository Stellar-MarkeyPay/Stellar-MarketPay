"use strict";

const {
  encodeCursor,
  decodeCursor,
  readPageArgs,
  connectionFromArray,
  connectionFromPage,
  MAX_PAGE_SIZE,
} = require("./pagination");

describe("GraphQL pagination convention", () => {
  test("uses opaque, versioned cursors", () => {
    const cursor = encodeCursor({ o: 12 });
    expect(cursor).not.toContain("12");
    expect(decodeCursor(cursor)).toEqual({ o: 12 });
    expect(readPageArgs({ after: cursor, first: 5 })).toEqual({
      limit: 5,
      offset: 12,
      cursor: { o: 12 },
    });
  });

  test("rejects malformed, unknown, and oversized paging input", () => {
    expect(() => readPageArgs({ after: "not-a-cursor" })).toThrow(/cursor/i);
    expect(() => readPageArgs({ after: encodeCursor({ unknown: 1 }) })).toThrow(/cursor/i);
    expect(() => readPageArgs({ first: MAX_PAGE_SIZE + 1 })).toThrow(/may not exceed/);
  });

  test("builds the same connection shape from arrays and service pages", () => {
    const fromArray = connectionFromArray(["a", "b", "c"], { first: 2 });
    expect(fromArray).toMatchObject({
      totalCount: 3,
      pageInfo: { hasNextPage: true, hasPreviousPage: false },
    });
    expect(fromArray.edges.map(({ node }) => node)).toEqual(["a", "b"]);

    const fromPage = connectionFromPage({
      nodes: ["b", "c"],
      totalCount: 3,
      offset: 1,
      limit: 2,
    });
    expect(fromPage).toMatchObject({
      totalCount: 3,
      pageInfo: { hasNextPage: false, hasPreviousPage: true },
    });
  });

  test("never invents a totalCount when a service omitted it", () => {
    expect(() =>
      connectionFromPage({ nodes: ["a"], offset: 0, limit: 1, totalCount: null })
    ).toThrow(/exact non-negative integer totalCount/);
  });
});
