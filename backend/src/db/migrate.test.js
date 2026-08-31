"use strict";

const mockQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock("./pool", () => ({
  connect: jest.fn().mockResolvedValue({ query: mockQuery, release: mockRelease }),
  setLocalTimeouts: jest.fn().mockResolvedValue(undefined),
  timeoutConfig: {
    migrationStatementTimeoutMs: 120_000,
    migrationLockTimeoutMs: 5_000,
  },
}));

const { migrate, rollbackLastMigration } = require("./migrate");

describe("named migration journal", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
  });

  it("applies every named migration even when files share a numeric version", async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT name FROM schema_migrations/.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    await migrate();

    const insertedNames = mockQuery.mock.calls
      .filter(([sql]) => /INSERT INTO schema_migrations/.test(sql))
      .map(([, params]) => params[1]);
    expect(insertedNames).toEqual(
      expect.arrayContaining(["V19__indexer_reliability", "V19__time_entries_backfill"])
    );
    expect(insertedNames).toEqual(
      expect.arrayContaining([
        "V12__decentralized_storage_insurance",
        "V12__fraud_detection_alerts",
        "V22__enterprise_federation_foundation",
      ])
    );
    expect(new Set(insertedNames).size).toBe(insertedNames.length);
    expect(mockRelease).toHaveBeenCalled();
  });

  it("rolls back and deletes the exact name/version pair", async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT version, name/.test(sql)) {
        return { rows: [{ version: 21, name: "V21__compliance_core" }] };
      }
      return { rows: [] };
    });

    await expect(rollbackLastMigration()).resolves.toBe(21);
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM schema_migrations WHERE version = $1 AND name = $2",
      [21, "V21__compliance_core"]
    );
  });

  it("executes the enterprise federation rollback before removing its journal entry", async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT version, name/.test(sql)) {
        return { rows: [{ version: 22, name: "V22__enterprise_federation_foundation" }] };
      }
      return { rows: [] };
    });

    await expect(rollbackLastMigration()).resolves.toBe(22);
    const rollbackSqlCall = mockQuery.mock.calls.find(([sql]) =>
      /DROP TABLE IF EXISTS organisation_authentication_events/.test(sql)
    );
    expect(rollbackSqlCall).toBeDefined();
    expect(rollbackSqlCall[0]).toMatch(/DROP TABLE IF EXISTS organisations/);
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM schema_migrations WHERE version = $1 AND name = $2",
      [22, "V22__enterprise_federation_foundation"]
    );
  });

  it("executes the multi-region active-active rollback before removing its journal entry", async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT version, name/.test(sql)) {
        return { rows: [{ version: 19, name: "V19__multi_region_active_active_replication" }] };
      }
      return { rows: [] };
    });

    await expect(rollbackLastMigration()).resolves.toBe(19);
    const rollbackSqlCall = mockQuery.mock.calls.find(([sql]) =>
      /DROP TABLE IF EXISTS crdt_pn_counters/.test(sql)
    );
    expect(rollbackSqlCall).toBeDefined();
    expect(rollbackSqlCall[0]).toMatch(/DROP TABLE IF EXISTS replication_nodes/);
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM schema_migrations WHERE version = $1 AND name = $2",
      [19, "V19__multi_region_active_active_replication"]
    );
  });
});
