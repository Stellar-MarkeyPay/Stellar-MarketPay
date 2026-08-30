"use strict";

const { buildSchema: buildSchemaFromSdl } = require("graphql");

const { toGlobalId, fromGlobalId, localIdOfType } = require("./globalId");
const {
  notFound,
  forbidden,
  unauthorized,
  validation,
  conflict,
  fromServiceError,
} = require("./errors");
const { canonicalSchema, compareSchemas } = require("../../scripts/graphql-schema-registry");

describe("GraphQL identifiers", () => {
  test("round-trips a typed opaque id", () => {
    const globalId = toGlobalId("Job", "11111111-1111-1111-1111-111111111111");
    expect(globalId).not.toContain("Job");
    expect(fromGlobalId(globalId)).toEqual({
      type: "Job",
      id: "11111111-1111-1111-1111-111111111111",
    });
    expect(localIdOfType(globalId, "Job")).toBe("11111111-1111-1111-1111-111111111111");
    expect(localIdOfType(globalId, "Profile")).toBeNull();
  });

  test("rejects unregistered and malformed ids", () => {
    expect(() => toGlobalId("Unknown", "1")).toThrow(/not a Node type/);
    expect(() => fromGlobalId("not-an-id")).toThrow(/Malformed id/);
  });
});

describe("GraphQL expected errors", () => {
  test("constructors return stable schema values", () => {
    expect(notFound("missing", "id-1")).toMatchObject({
      __typename: "NotFoundError",
      code: "NOT_FOUND",
    });
    expect(forbidden()).toMatchObject({ __typename: "ForbiddenError", code: "FORBIDDEN" });
    expect(unauthorized()).toMatchObject({ __typename: "UnauthorizedError", code: "UNAUTHORIZED" });
    expect(validation("bad", "input.score")).toMatchObject({
      code: "VALIDATION",
      field: "input.score",
    });
    expect(conflict("closed", "COMPLETED")).toMatchObject({
      code: "CONFLICT",
      currentState: "COMPLETED",
    });
  });

  test("known service failures become values and unknown failures remain system errors", () => {
    expect(fromServiceError(new Error("Job not found"))).toMatchObject({
      __typename: "NotFoundError",
    });
    const outage = new Error("database socket disappeared");
    expect(() => fromServiceError(outage)).toThrow(outage);
  });
});

describe("GraphQL schema registry comparison", () => {
  test("the canonical snapshot is valid SDL", () => {
    expect(() => buildSchemaFromSdl(canonicalSchema())).not.toThrow();
  });

  test("reports removed fields as breaking changes", () => {
    const previous = "type Query { greeting: String, legacy: String }";
    const current = "type Query { greeting: String }";
    expect(compareSchemas(previous, current).breaking).toEqual([
      expect.objectContaining({ description: "Query.legacy was removed." }),
    ]);
  });

  test("accepts an additive optional field", () => {
    const previous = "type Query { greeting: String }";
    const current = "type Query { greeting: String, optional: String }";
    expect(compareSchemas(previous, current).breaking).toEqual([]);
  });
});
