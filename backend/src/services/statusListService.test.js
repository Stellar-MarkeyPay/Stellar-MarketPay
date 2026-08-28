"use strict";

/**
 * backend/src/services/statusListService.test.js
 *
 * Tests for the Bitstring Status List service.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

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

test("StatusListService.isRevoked returns false for unset bit", async () => {
  const StatusListService = require("./statusListService");
  const db = createMockDb();
  const service = new StatusListService(db);

  // All zeros = nothing revoked
  db.rows["SELECT bitstring FROM credential_status_lists WHERE id"] = [
    { bitstring: Buffer.alloc(16384, 0) },
  ];

  const result = await service.isRevoked("sl-1", 0);
  assert.equal(result, false);
});

test("StatusListService.isRevoked returns true for set bit", async () => {
  const StatusListService = require("./statusListService");
  const db = createMockDb();
  const service = new StatusListService(db);

  const bitstring = Buffer.alloc(16384, 0);
  bitstring[0] = 0b00000100; // bit 2 set

  db.rows["SELECT bitstring FROM credential_status_lists WHERE id"] = [
    { bitstring },
  ];

  const result = await service.isRevoked("sl-1", 2);
  assert.equal(result, true);
});

test("StatusListService.isRevoked handles different byte positions", async () => {
  const StatusListService = require("./statusListService");
  const db = createMockDb();
  const service = new StatusListService(db);

  const bitstring = Buffer.alloc(16384, 0);
  bitstring[10] = 0b00000001; // bit 80 set (byte 10, bit 0)

  db.rows["SELECT bitstring FROM credential_status_lists WHERE id"] = [
    { bitstring },
  ];

  const result = await service.isRevoked("sl-1", 80);
  assert.equal(result, true);

  // Adjacent bit should not be set
  const result2 = await service.isRevoked("sl-1", 81);
  assert.equal(result2, false);
});

test("StatusListService.isRevoked throws for unknown status list", async () => {
  const StatusListService = require("./statusListService");
  const db = createMockDb();
  const service = new StatusListService(db);

  await assert.rejects(
    () => service.isRevoked("sl-nonexistent", 0),
    /Status list not found/
  );
});

test("StatusListService.getStatusListCredential returns credential and version", async () => {
  const StatusListService = require("./statusListService");
  const db = createMockDb();
  const service = new StatusListService(db);

  db.rows["SELECT credential, version, updated_at FROM credential_status_lists WHERE id"] = [
    {
      credential: '{"type":"BitstringStatusListCredential"}',
      version: 3,
      updated_at: "2026-08-28T00:00:00Z",
    },
  ];

  const result = await service.getStatusListCredential("sl-1");
  assert.ok(result);
  assert.ok(typeof result.credential === "object");
  assert.equal(result.version, 3);
});

test("StatusListService.getStatusListCredential returns null for unknown ID", async () => {
  const StatusListService = require("./statusListService");
  const db = createMockDb();
  const service = new StatusListService(db);

  const result = await service.getStatusListCredential("sl-unknown");
  assert.equal(result, null);
});

test("StatusListService.listStatusLists returns all lists for an issuer", async () => {
  const StatusListService = require("./statusListService");
  const db = createMockDb();
  const service = new StatusListService(db);

  db.rows["SELECT id, issuer_did, list_index, version, created_at, updated_at"] = [
    { id: "sl-1", issuer_did: "did:1", list_index: 0, version: 1 },
    { id: "sl-2", issuer_did: "did:1", list_index: 1, version: 3 },
  ];

  const result = await service.listStatusLists("did:1");
  assert.equal(result.length, 2);
  assert.equal(result[0].list_index, 0);
  assert.equal(result[1].list_index, 1);
});
