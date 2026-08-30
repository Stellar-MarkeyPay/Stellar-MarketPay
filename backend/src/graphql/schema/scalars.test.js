"use strict";

const { Kind } = require("graphql");

const { DateTime, PublicKey, Cursor, Decimal, JSON: JSONScalar } = require("./scalars");

const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("GraphQL custom scalars", () => {
  test("DateTime requires a complete timestamp with an explicit timezone", () => {
    expect(DateTime.parseValue("2026-08-28T12:30:45+01:00").toISOString()).toBe(
      "2026-08-28T11:30:45.000Z"
    );
    expect(() => DateTime.parseValue("2026-08-28")).toThrow(/RFC 3339/);
    expect(() => DateTime.parseValue("not-a-date")).toThrow(/RFC 3339/);
  });

  test("PublicKey validates both input and output", () => {
    expect(PublicKey.parseValue(PUBLIC_KEY)).toBe(PUBLIC_KEY);
    expect(PublicKey.serialize(PUBLIC_KEY)).toBe(PUBLIC_KEY);
    expect(() => PublicKey.parseValue("GBAD")).toThrow(/checksummed/);
    expect(() => PublicKey.parseValue(`G${"A".repeat(55)}`)).toThrow(/checksummed/);
    expect(() => PublicKey.serialize("GBAD")).toThrow(/malformed/);
  });

  test("Decimal preserves precision by accepting string variables only", () => {
    expect(Decimal.parseValue("12345678901234567890.1234567")).toBe("12345678901234567890.1234567");
    expect(() => Decimal.parseValue(0.1)).toThrow(/Invalid Decimal/);
    expect(() => Decimal.parseLiteral({ kind: Kind.FLOAT, value: "1e3" })).toThrow(
      /numeric string/
    );
  });

  test("Cursor remains opaque and JSON preserves structured literals", () => {
    expect(Cursor.parseValue("opaque-token")).toBe("opaque-token");
    expect(
      JSONScalar.parseLiteral({
        kind: Kind.OBJECT,
        fields: [
          { name: { value: "enabled" }, value: { kind: Kind.BOOLEAN, value: true } },
          { name: { value: "count" }, value: { kind: Kind.INT, value: "2" } },
        ],
      })
    ).toEqual({ enabled: true, count: 2 });
  });
});
