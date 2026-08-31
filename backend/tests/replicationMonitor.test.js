"use strict";

const { ReplicationMonitor } = require("../src/services/replicationMonitor");
const pool = require("../src/db/pool");

describe("ReplicationMonitor", () => {
  let monitor;

  beforeEach(() => {
    monitor = new ReplicationMonitor({
      region: "primary-cluster",
      nodeId: "node-primary-0",
      pollIntervalMs: 200,
    });
  });

  afterEach(() => {
    monitor.stop();
  });

  it("measures low replication lag as healthy", async () => {
    jest.spyOn(pool, "query").mockImplementation(async (sql) => {
      if (typeof sql === "string" && sql.includes("pg_is_in_recovery")) {
        return { rows: [{ in_recovery: true, replay_lag_seconds: "0.25" }] };
      }
      return { rows: [] };
    });

    await monitor.checkReplication();

    const telemetry = monitor.getTelemetry();
    expect(telemetry.isHealthy).toBe(true);
    expect(telemetry.currentLagSeconds).toBeCloseTo(0.25);
    expect(telemetry.statusMessage).toBe("Healthy");
  });

  it("detects critical replication lag breaches (> 60s)", async () => {
    jest.spyOn(pool, "query").mockImplementation(async (sql) => {
      if (typeof sql === "string" && sql.includes("pg_is_in_recovery")) {
        return { rows: [{ in_recovery: true, replay_lag_seconds: "75.0" }] };
      }
      return { rows: [] };
    });

    await monitor.checkReplication();

    const telemetry = monitor.getTelemetry();
    expect(telemetry.isHealthy).toBe(false);
    expect(telemetry.currentLagSeconds).toBe(75.0);
    expect(telemetry.statusMessage).toContain("Critical replication lag");
  });

  it("logs replication conflicts to the audit table", async () => {
    const querySpy = jest.spyOn(pool, "query").mockResolvedValue({ rows: [] });

    await monitor.logConflict({
      tableName: "jobs",
      recordId: "job-123",
      originRegion: "primary-cluster",
      conflictingRegion: "secondary-cluster",
      localPayload: { status: "open" },
      incomingPayload: { status: "in_progress" },
      resolutionStrategy: "STATE_MACHINE_PROGRESSION",
      resolutionStatus: "resolved",
      resolvedPayload: { status: "in_progress" },
    });

    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO replication_conflicts"),
      expect.any(Array),
      expect.any(Object)
    );
  });
});
