"use strict";

/**
 * backend/src/lib/credentialSchema.test.js
 *
 * Tests for credential JSON Schema definitions and validation.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { CREDENTIAL_SCHEMAS, validateClaims, getSchema, listTypes } = require("./credentialSchema");

test("listTypes returns all three credential types", () => {
  const types = listTypes();
  assert.ok(types.includes("EngagementCredential"));
  assert.ok(types.includes("SkillCredential"));
  assert.ok(types.includes("CertificationCredential"));
  assert.equal(types.length, 3);
});

test("getSchema returns the EngagementCredential schema", () => {
  const schema = getSchema("EngagementCredential");
  assert.ok(schema);
  assert.ok(schema.properties.engagementId);
  assert.ok(schema.properties.engagementTitle);
  assert.ok(schema.properties.completedAt);
  assert.ok(schema.required.includes("engagementId"));
  assert.ok(schema.required.includes("engagementTitle"));
  assert.ok(schema.required.includes("completedAt"));
});

test("getSchema returns the SkillCredential schema", () => {
  const schema = getSchema("SkillCredential");
  assert.ok(schema);
  assert.ok(schema.properties.skillName);
  assert.ok(schema.properties.verifiedAt);
  assert.ok(schema.properties.proficiencyLevel);
});

test("getSchema returns the CertificationCredential schema", () => {
  const schema = getSchema("CertificationCredential");
  assert.ok(schema);
  assert.ok(schema.properties.certificationName);
  assert.ok(schema.properties.certificationId);
  assert.ok(schema.properties.issuedAt);
});

test("getSchema returns null for unknown type", () => {
  assert.equal(getSchema("UnknownType"), null);
});

test("validateClaims accepts valid EngagementCredential claims", () => {
  const result = validateClaims("EngagementCredential", {
    engagementId: "job-123",
    engagementTitle: "Build Soroban escrow",
    completedAt: "2026-08-28T00:00:00Z",
  });
  assert.ok(result.valid);
});

test("validateClaims rejects EngagementCredential without required fields", () => {
  const result = validateClaims("EngagementCredential", {
    engagementId: "job-123",
    // missing engagementTitle and completedAt
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.length >= 2);
});

test("validateClaims rejects unknown credential type", () => {
  const result = validateClaims("NonExistentType", {});
  assert.ok(!result.valid);
  assert.ok(result.errors[0].includes("Unknown credential type"));
});

test("validateClaims accepts valid SkillCredential claims", () => {
  const result = validateClaims("SkillCredential", {
    skillName: "Rust",
    verifiedAt: "2026-08-28T00:00:00Z",
  });
  assert.ok(result.valid);
});

test("validateClaims accepts SkillCredential with optional fields", () => {
  const result = validateClaims("SkillCredential", {
    skillName: "Rust",
    verifiedAt: "2026-08-28T00:00:00Z",
    evidenceCount: 5,
    proficiencyLevel: "advanced",
  });
  assert.ok(result.valid);
});

test("validateClaims accepts valid CertificationCredential claims", () => {
  const result = validateClaims("CertificationCredential", {
    certificationName: "Stellar Developer",
    certificationId: "CERT-001",
    issuedAt: "2026-08-28T00:00:00Z",
  });
  assert.ok(result.valid);
});

test("CREDENTIAL_SCHEMAS are valid JSON Schema objects", () => {
  for (const [name, schema] of Object.entries(CREDENTIAL_SCHEMAS)) {
    assert.ok(schema.$schema, `${name} should have $schema`);
    assert.ok(schema.title, `${name} should have title`);
    assert.ok(schema.type === "object", `${name} should have type: object`);
    assert.ok(Array.isArray(schema.required), `${name} should have required array`);
    assert.ok(schema.properties, `${name} should have properties`);
  }
});
