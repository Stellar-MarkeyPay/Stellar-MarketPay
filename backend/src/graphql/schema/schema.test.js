"use strict";

const { getNamedType, isObjectType, isUnionType, validateSchema } = require("graphql");

const { buildSchema, printCanonicalSchema, readSdl } = require(".");

describe("GraphQL domain schema", () => {
  const schema = buildSchema();

  test("is valid and built from deterministic SDL input", () => {
    expect(validateSchema(schema)).toEqual([]);
    expect(readSdl().map(({ file }) => file)).toEqual([
      "application.graphql",
      "common.graphql",
      "dispute.graphql",
      "escrow.graphql",
      "job.graphql",
      "profile.graphql",
      "rating.graphql",
      "root.graphql",
      "subscription.graphql",
    ]);
    expect(printCanonicalSchema()).toBe(printCanonicalSchema());
  });

  test("models domain relationships instead of REST route names", () => {
    const job = schema.getType("Job");
    expect(Object.keys(job.getFields())).toEqual(
      expect.arrayContaining([
        "client",
        "freelancer",
        "applications",
        "escrow",
        "dispute",
        "ratings",
      ])
    );

    const queryFields = Object.keys(schema.getQueryType().getFields());
    expect(queryFields).toEqual(
      expect.arrayContaining(["node", "job", "jobs", "profile", "profiles", "viewer"])
    );
    expect(queryFields.some((name) => /^(get|list|fetch)/i.test(name))).toBe(false);
  });

  test("uses one connection contract for every entity collection", () => {
    const connections = Object.values(schema.getTypeMap()).filter(
      (type) => isObjectType(type) && type.name.endsWith("Connection")
    );
    expect(connections.length).toBeGreaterThanOrEqual(6);

    for (const connection of connections) {
      expect(Object.keys(connection.getFields())).toEqual(
        expect.arrayContaining(["edges", "pageInfo", "totalCount"])
      );
      expect(String(connection.getFields().edges.type)).toMatch(/^\[.+Edge!\]!$/);
      expect(String(connection.getFields().pageInfo.type)).toBe("PageInfo!");
      expect(String(connection.getFields().totalCount.type)).toBe("Int!");
    }

    for (const fieldName of ["jobs", "profiles"]) {
      const field = schema.getQueryType().getFields()[fieldName];
      expect(getNamedType(field.type).name.endsWith("Connection")).toBe(true);
      expect(field.args.map(({ name }) => name)).toEqual(
        expect.arrayContaining(["first", "after"])
      );
    }
  });

  test("represents expected lookup and mutation failures in the schema", () => {
    for (const unionName of [
      "JobResult",
      "ProfileResult",
      "ApplicationResult",
      "EscrowResult",
      "DisputeResult",
    ]) {
      expect(isUnionType(schema.getType(unionName))).toBe(true);
      expect(
        schema
          .getType(unionName)
          .getTypes()
          .map(({ name }) => name)
      ).toContain("NotFoundError");
    }

    for (const unionName of ["ApplicationResult", "EscrowResult", "DisputeResult"]) {
      expect(
        schema
          .getType(unionName)
          .getTypes()
          .map(({ name }) => name)
      ).toEqual(expect.arrayContaining(["ForbiddenError", "UnauthorizedError"]));
    }

    const payloads = [
      "SubmitApplicationPayload",
      "AcceptApplicationPayload",
      "WithdrawApplicationPayload",
      "ReleaseEscrowPayload",
      "RaiseDisputePayload",
      "CreateRatingPayload",
    ];
    for (const payloadName of payloads) {
      expect(String(schema.getType(payloadName).getFields().errors.type)).toBe("[MutationError!]!");
    }
  });

  test("uses additive evolution and a documented field deprecation", () => {
    const legacyField = schema.getType("Job").getFields().escrowContractId;
    expect(legacyField.deprecationReason).toMatch(/Use `escrow\.contractId`/);
    expect(legacyField.deprecationReason).toMatch(/2027-02-01/);
  });

  test("declares security and cost metadata next to sensitive fields", () => {
    const email = schema.getType("Profile").getFields().email;
    const directiveNames = email.astNode.directives.map(({ name }) => name.value);
    expect(directiveNames).toEqual(expect.arrayContaining(["auth", "cacheControl"]));

    const applications = schema.getType("Job").getFields().applications;
    expect(applications.astNode.directives.map(({ name }) => name.value)).toEqual(
      expect.arrayContaining(["auth", "cost", "cacheControl"])
    );
  });
});
