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
});
