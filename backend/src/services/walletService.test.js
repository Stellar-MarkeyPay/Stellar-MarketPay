"use strict";

/**
 * backend/src/services/walletService.test.js
 *
 * Tests for the wallet service using a mock database.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");

const SUBJECT_DID = "did:stellarmarket:GXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNTO";

function createMockDb() {
  const queries = [];
  const rows = {};
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

test("WalletService.listCredentials returns held credentials", async () => {
  const WalletService = require("./walletService");
  const db = createMockDb();
  const service = new WalletService(db);

  db.rows["SELECT * FROM verifiable_credentials WHERE subject_did"] = [
    {
      credential_id: "urn:uuid:1",
      type: ["VerifiableCredential", "SkillCredential"],
      issuer_did: "did:stellarmarket:GA5...",
      issued_at: "2026-08-28T00:00:00Z",
      expires_at: null,
      revoked: false,
      claims: '{"skillName":"Rust","verifiedAt":"2026-08-01T00:00:00Z"}',
    },
    {
      credential_id: "urn:uuid:2",
      type: ["VerifiableCredential", "EngagementCredential"],
      issuer_did: "did:stellarmarket:GA5...",
      issued_at: "2026-07-15T00:00:00Z",
      expires_at: null,
      revoked: false,
      claims: '{"engagementId":"job-001","engagementTitle":"Build escrow"}',
    },
  ];

  const result = await service.listCredentials(SUBJECT_DID);

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "urn:uuid:1");
  assert.equal(result[0].type[1], "SkillCredential");
  assert.ok(typeof result[0].claims === "object");
});

test("WalletService.listCredentials excludes revoked when not requested", async () => {
  const WalletService = require("./walletService");
  const db = createMockDb();
  const service = new WalletService(db);

  db.rows["SELECT * FROM verifiable_credentials WHERE subject_did"] = [
    {
      credential_id: "urn:uuid:1",
      type: ["VerifiableCredential"],
      issuer_did: "did:stellarmarket:GA5...",
      issued_at: "2026-08-28T00:00:00Z",
      expires_at: null,
      revoked: false,
      claims: '{"test":true}',
    },
  ];

  const result = await service.listCredentials(SUBJECT_DID, { includeRevoked: false });

  assert.ok(Array.isArray(result));
  // Verify the query includes "revoked = false"
  const selectQuery = db.queries.find((q) => q.sql.includes("revoked = false"));
  assert.ok(selectQuery, "Should filter out revoked credentials");
});

test("WalletService.importCredential stores an external credential", async () => {
  const WalletService = require("./walletService");
  const db = createMockDb();
  const service = new WalletService(db);

  db.rows["INSERT INTO credential_imports"] = [{ id: "import-uuid-1" }];

  const externalVC = {
    id: "urn:external:cred-123",
    type: ["VerifiableCredential"],
    issuer: "did:example:ext-issuer",
    issuanceDate: "2026-01-01T00:00:00Z",
    credentialSubject: { id: SUBJECT_DID },
  };

  const result = await service.importCredential({
    holderDid: SUBJECT_DID,
    credential: externalVC,
  });

  assert.ok(result.importId);
  assert.equal(result.credentialId, "urn:external:cred-123");
  assert.equal(result.verificationStatus, "unverified");
});

test("WalletService.importCredential rejects invalid credential", async () => {
  const WalletService = require("./walletService");
  const db = createMockDb();
  const service = new WalletService(db);

  await assert.rejects(
    () => service.importCredential({ holderDid: SUBJECT_DID, credential: {} }),
    /Invalid credential/
  );

  await assert.rejects(
    () =>
      service.importCredential({
        holderDid: SUBJECT_DID,
        credential: { id: "test" }, // missing issuer
      }),
    /Invalid credential/
  );
});

test("WalletService.createPresentation throws for non-owned credential", async () => {
  const WalletService = require("./walletService");
  const db = createMockDb();
  const service = new WalletService(db);

  // Mock: no credential found
  db.rows["SELECT * FROM verifiable_credentials WHERE credential_id"] = [];

  const keyPair = generateKeyPairSync("ed25519");

  await assert.rejects(
    () =>
      service.createPresentation({
        holderDid: SUBJECT_DID,
        holderPrivateKey: keyPair.privateKey,
        holderVerificationMethod: `${SUBJECT_DID}#key-1`,
        credentialIds: ["urn:uuid:nonexistent"],
      }),
    /Credential not found or not owned/
  );
});

test("WalletService.createPresentation throws for revoked credential", async () => {
  const WalletService = require("./walletService");
  const db = createMockDb();
  const service = new WalletService(db);

  db.rows["SELECT * FROM verifiable_credentials WHERE credential_id AND subject_did"] = [
    {
      credential_id: "urn:uuid:revoked",
      type: ["VerifiableCredential"],
      credential: '{"id":"urn:uuid:revoked","type":["VerifiableCredential"]}',
      revoked: true,
    },
  ];

  const keyPair = generateKeyPairSync("ed25519");

  await assert.rejects(
    () =>
      service.createPresentation({
        holderDid: SUBJECT_DID,
        holderPrivateKey: keyPair.privateKey,
        holderVerificationMethod: `${SUBJECT_DID}#key-1`,
        credentialIds: ["urn:uuid:revoked"],
      }),
    /revoked/
  );
});

test("WalletService.createBackup returns all credentials and imports", async () => {
  const WalletService = require("./walletService");
  const db = createMockDb();
  const service = new WalletService(db);

  db.rows["SELECT credential_id, type, issuer_did, credential, issued_at"] = [
    {
      credential_id: "urn:uuid:1",
      type: ["VerifiableCredential"],
      issuer_did: "did:stellarmarket:GA5...",
      credential: '{"id":"urn:uuid:1"}',
      issued_at: "2026-08-28T00:00:00Z",
    },
  ];

  db.rows["SELECT id, external_issuer_did, credential, verification_status, imported_at"] = [];

  const backup = await service.createBackup(SUBJECT_DID);

  assert.equal(backup.holderDid, SUBJECT_DID);
  assert.ok(backup.backupDate);
  assert.ok(Array.isArray(backup.credentials));
  assert.equal(backup.credentials.length, 1);
  assert.ok(Array.isArray(backup.imports));
  assert.equal(backup.imports.length, 0);
});
