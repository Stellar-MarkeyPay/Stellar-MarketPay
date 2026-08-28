"use strict";

/**
 * backend/src/services/didService.test.js
 *
 * Tests for the DID service using a mock database.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDID, publicKeyToMultibase, STELLAR_PUBLIC_KEY_REGEX } = require("../lib/did-stellar");

const TEST_KEY = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

/**
 * Create a mock database that tracks queries.
 */
function createMockDb(overrides = {}) {
  const queries = [];
  const rows = { ...overrides };

  const db = {
    queries,
    rows,
    query: async (sql, params) => {
      queries.push({ sql, params });
      // Return configured rows for the first matching pattern
      for (const [pattern, result] of Object.entries(rows)) {
        if (sql.includes(pattern)) {
          return { rows: typeof result === "function" ? result(sql, params) : result };
        }
      }
      return { rows: [] };
    },
  };

  return db;
}

test("DidService.create creates a DID document", async () => {
  // We need to require the service dynamically to avoid import issues
  const DidService = require("./didService");
  const db = createMockDb({
    "INSERT INTO did_documents": [{ id: "doc-uuid-1" }],
  });
  const service = new DidService(db);

  const result = await service.create(TEST_KEY);

  assert.ok(result.did);
  assert.ok(result.did.startsWith("did:stellarmarket:"));
  assert.equal(result.did, `did:stellarmarket:${TEST_KEY}`);
  assert.ok(result.document);
  assert.equal(result.document.id, result.did);
  assert.equal(result.document.controller, result.did);
  assert.ok(Array.isArray(result.document.verificationMethod));
  assert.equal(result.document.verificationMethod.length, 1);

  // Should have made 3 queries: check existing, insert doc, insert key
  assert.ok(db.queries.length >= 3, `Expected at least 3 queries, got ${db.queries.length}`);
  assert.ok(
    db.queries.some((q) => q.sql.includes("INSERT INTO did_documents")),
    "Should insert DID document"
  );
  assert.ok(
    db.queries.some((q) => q.sql.includes("INSERT INTO did_key_history")),
    "Should insert initial key"
  );
});

test("DidService.create rejects invalid public key", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  const service = new DidService(db);

  await assert.rejects(
    () => service.create("invalid-key"),
    /Invalid Stellar public key/
  );
});

test("DidService.create rejects duplicate DID", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  // Configure mock to return existing DID on first query
  db.rows["SELECT id FROM did_documents WHERE did"] = [{ id: "existing-id" }];
  const service = new DidService(db);

  await assert.rejects(
    () => service.create(TEST_KEY),
    /DID already exists/
  );
});

test("DidService.resolve returns DID document from cache", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  const did = createDID(TEST_KEY);
  const multibase = publicKeyToMultibase(TEST_KEY);

  const doc = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    controller: did,
    verificationMethod: [{ id: `${did}#key-1`, type: "Ed25519VerificationKey2020", controller: did, publicKeyMultibase: multibase }],
    authentication: ["#key-1"],
    assertionMethod: ["#key-1"],
  };

  // Mock returns document with recent timestamp (within TTL)
  db.rows["SELECT document, updated_at FROM did_documents WHERE did"] = [
    { document: doc, updated_at: new Date().toISOString() },
  ];

  const service = new DidService(db, { cacheTtlMs: 300000 });
  const result = await service.resolve(did);

  assert.ok(result);
  assert.equal(result.id, did);
  assert.ok(Array.isArray(result.verificationMethod));
});

test("DidService.resolve returns null for unknown DID", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  const service = new DidService(db);

  const result = await service.resolve("did:stellarmarket:GUNKNOWN12345678901234567890123456789012345678901234567890");
  assert.equal(result, null);
});

test("DidService.rotateKey updates the key and DID document", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  const did = createDID(TEST_KEY);
  const newKey = "GXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN";

  // Mock: existing DID document
  db.rows["SELECT id, document, version FROM did_documents WHERE did"] = [{ id: "doc-uuid-1", document: {}, version: 1 }];
  // Mock: current key
  db.rows["SELECT key_id FROM did_key_history WHERE did_id"] = [{ key_id: "#key-1" }];

  const service = new DidService(db);
  const result = await service.rotateKey(did, newKey, "security upgrade");

  assert.equal(result.did, did);
  assert.ok(result.document);
  assert.equal(result.previousKeyId, "#key-1");
  assert.ok(result.document.verificationMethod[0].id.includes("#key-2"));

  // Should have: deactivate old key, insert new key, update document
  const updates = db.queries.filter((q) => q.sql.includes("UPDATE"));
  assert.ok(updates.length >= 2, "Should deactivate old key and update document");
});

test("DidService.rotateKey rejects invalid new key", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  db.rows["SELECT id, document, version FROM did_documents WHERE did"] = [{ id: "doc-1", document: {}, version: 1 }];

  const service = new DidService(db);

  await assert.rejects(
    () => service.rotateKey(createDID(TEST_KEY), "bad-key"),
    /Invalid Stellar public key/
  );
});

test("DidService.rotateKey throws for non-existent DID", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  const service = new DidService(db);

  await assert.rejects(
    () => service.rotateKey("did:stellarmarket:GNOTEXIST12345678901234567890123456789012345678901234567", "GXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN"),
    /DID not found/
  );
});

test("DidService.deactivate marks DID as deactivated", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  db.rows["UPDATE did_documents SET deactivated"] = [{ id: "doc-1" }];

  const service = new DidService(db);
  await service.deactivate(createDID(TEST_KEY));

  const updates = db.queries.filter((q) => q.sql.includes("UPDATE"));
  assert.ok(updates.length >= 2, "Should deactivate DID and keys");
});

test("DidService.deactivate throws for non-existent DID", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  // Return no rows for the UPDATE
  db.rows["UPDATE did_documents SET deactivated"] = [];

  const service = new DidService(db);

  await assert.rejects(
    () => service.deactivate("did:stellarmarket:GNOTEXIST12345678901234567890123456789012345678901234567"),
    /DID not found or already deactivated/
  );
});

test("DidService.getKeyHistory returns key history entries", async () => {
  const DidService = require("./didService");
  const db = createMockDb();
  db.rows["SELECT kh.* FROM did_key_history kh"] = [
    { key_id: "#key-1", activated_at: "2026-01-01", deactivated_at: null },
    { key_id: "#key-2", activated_at: "2026-06-01", deactivated_at: null },
  ];

  const service = new DidService(db);
  const history = await service.getKeyHistory(createDID(TEST_KEY));

  assert.ok(Array.isArray(history));
  assert.equal(history.length, 2);
  assert.equal(history[0].key_id, "#key-1");
  assert.equal(history[1].key_id, "#key-2");
});
