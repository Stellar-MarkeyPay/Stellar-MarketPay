"use strict";

/**
 * backend/src/services/credentialService.test.js
 *
 * Tests for the credential service using a mock database.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");

const { publicKeyToMultibase } = require("../lib/did-stellar");

const ISSUER_DID = "did:stellarmarket:GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
const SUBJECT_DID = "did:stellarmarket:GXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN";

function createMockDb(overrides = {}) {
  const queries = [];
  const rows = { ...overrides };
  return {
    queries,
    rows,
    query: async (sql, params) => {
      queries.push({ sql, params });
      for (const [pattern, result] of Object.entries(rows)) {
        if (sql.includes(pattern)) {
          return { rows: typeof result === "function" ? result(sql, params) : result };
        }
      }
      return { rows: [] };
    },
  };
}

function createIssuerKeys() {
  const keyPair = generateKeyPairSync("ed25519");
  return {
    privateKey: keyPair.privateKey,
    publicKeyMultibase: publicKeyToMultibase(
      "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW"
    ),
    verificationMethod: `${ISSUER_DID}#key-1`,
    issuerDid: ISSUER_DID,
  };
}

test("CredentialService.issue creates a signed VC", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb();
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  // Mock: no existing status list → create new one
  db.rows["SELECT id, list_index FROM credential_status_lists"] = [];
  db.rows["INSERT INTO credential_status_lists"] = [{ id: "sl-uuid-1" }];
  db.rows["SELECT COUNT(*) as cnt FROM verifiable_credentials"] = [{ cnt: "0" }];

  const credential = await service.issue({
    subjectDid: SUBJECT_DID,
    types: ["EngagementCredential"],
    claims: {
      engagementId: "job-001",
      engagementTitle: "Build Soroban escrow",
      completedAt: "2026-08-28T00:00:00Z",
    },
  });

  assert.ok(credential, "Should return a credential");
  assert.ok(credential.id, "Should have an id");
  assert.ok(credential.id.startsWith("urn:uuid:"), "ID should be a UUID URN");
  assert.ok(credential.type.includes("VerifiableCredential"));
  assert.ok(credential.type.includes("EngagementCredential"));
  assert.equal(credential.issuer, ISSUER_DID);
  assert.equal(credential.credentialSubject.id, SUBJECT_DID);
  assert.equal(credential.credentialSubject.engagementTitle, "Build Soroban escrow");
  assert.ok(credential.credentialStatus, "Should have credential status");
  assert.ok(credential.proof, "Should have a proof");
  assert.equal(credential.proof.type, "DataIntegrityProof");
  assert.equal(credential.proof.cryptosuite, "eddsa-jcs-2022");
});

test("CredentialService.issue rejects invalid claims", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb();
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  await assert.rejects(
    () =>
      service.issue({
        subjectDid: SUBJECT_DID,
        types: ["EngagementCredential"],
        claims: { engagementId: "job-001" }, // missing required fields
      }),
    /Invalid claims/
  );
});

test("CredentialService.issue rejects unknown credential type", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb();
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  await assert.rejects(
    () =>
      service.issue({
        subjectDid: SUBJECT_DID,
        types: ["UnknownCredential"],
        claims: { anything: "goes" },
      }),
    /No schema found/
  );
});

test("CredentialService.revoke marks a credential as revoked", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb({
    "SET revoked = true": [
      { status_list_id: "sl-1", status_list_index: 42 },
    ],
    "SELECT bitstring FROM credential_status_lists": [
      { bitstring: Buffer.alloc(16384, 0) },
    ],
  });
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  await service.revoke("urn:uuid:test-credential", "No longer valid");

  const updates = db.queries.filter((q) => q.sql.includes("UPDATE"));
  assert.ok(updates.length >= 1, "Should update credential and status list");
});

test("CredentialService.revoke throws for non-existent credential", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb();
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  db.rows["SET revoked = true"] = [];

  await assert.rejects(
    () => service.revoke("urn:uuid:nonexistent"),
    /Credential not found or already revoked/
  );
});

test("CredentialService.listCredentials returns credential list", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb();
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  db.rows["SELECT * FROM verifiable_credentials WHERE subject_did"] = [
    {
      credential_id: "urn:uuid:1",
      type: ["VerifiableCredential", "SkillCredential"],
      claims: '{"skillName":"Rust"}',
      credential: '{"id":"urn:uuid:1","type":["VerifiableCredential","SkillCredential"]}',
      issuer_did: ISSUER_DID,
      subject_did: SUBJECT_DID,
      issued_at: "2026-08-28T00:00:00Z",
      revoked: false,
    },
  ];

  const result = await service.listCredentials(SUBJECT_DID);

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0].credential_id, "urn:uuid:1");
  assert.ok(typeof result[0].credential === "object", "credential should be parsed JSON");
});

test("CredentialService.getCredential returns parsed credential", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb();
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  db.rows["SELECT * FROM verifiable_credentials WHERE credential_id"] = [
    {
      credential_id: "urn:uuid:test",
      type: ["VerifiableCredential"],
      claims: '{"engagementId":"job-1"}',
      credential: '{"id":"urn:uuid:test","type":["VerifiableCredential"]}',
    },
  ];

  const result = await service.getCredential("urn:uuid:test");
  assert.ok(result);
  assert.equal(result.credential_id, "urn:uuid:test");
  assert.ok(typeof result.credential === "object");
  assert.ok(typeof result.claims === "object");
});

test("CredentialService.getCredential returns null for unknown ID", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb();
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  const result = await service.getCredential("urn:uuid:unknown");
  assert.equal(result, null);
});

test("CredentialService.getStatusList returns status list", async () => {
  const CredentialService = require("./credentialService");
  const db = createMockDb();
  const issuerKeys = createIssuerKeys();
  const service = new CredentialService(db, issuerKeys);

  db.rows["SELECT * FROM credential_status_lists WHERE id"] = [
    {
      id: "sl-1",
      credential: '{"type":"BitstringStatusListCredential"}',
      version: 1,
    },
  ];

  const result = await service.getStatusList("sl-1");
  assert.ok(result);
  assert.equal(result.id, "sl-1");
  assert.ok(typeof result.credential === "object");
});
