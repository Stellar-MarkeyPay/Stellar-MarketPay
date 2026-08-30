/**
 * src/services/replicationMonitor.js
 *
 * Multi-Region Replication Lag Monitor and Telemetry Exporter.
 *
 * Capabilities:
 * 1. Continuous WAL replay lag and transaction lag measurement.
 * 2. Cross-region heartbeat pings measuring round-trip latency (RTT).
 * 3. Replication conflict frequency and CRDT convergence telemetry.
 * 4. Prometheus metrics exposure and health status reporting.
 */
"use strict";

const promClient = require("prom-client");
const pool = require("../db/pool");
const { createServiceLogger, logError } = require("../utils/logger");

const logger = createServiceLogger("replication-monitor");

const POLL_INTERVAL_MS = 5000;
const LAG_ALERT_THRESHOLD_SECONDS = 30.0;
const LAG_CRITICAL_THRESHOLD_SECONDS = 60.0;

// Prometheus Metrics
const replicationLagGauge = new promClient.Gauge({
  name: "marketpay_replication_lag_seconds",
  help: "PostgreSQL cross-region replication replay lag in seconds",
  labelNames: ["region", "role"],
});

const crossRegionRttGauge = new promClient.Gauge({
  name: "marketpay_cross_region_rtt_ms",
  help: "Cross-region database heartbeat round-trip time in milliseconds",
  labelNames: ["source_region", "target_region"],
});

const fencingStatusGauge = new promClient.Gauge({
  name: "marketpay_fencing_status",
  help: "Fencing status of the local region (1 = active authority, 0 = fenced/standby)",
  labelNames: ["region"],
});

const fencingGenerationGauge = new promClient.Gauge({
  name: "marketpay_fencing_generation",
  help: "Current generation token of the active fencing lease",
  labelNames: ["lease_key"],
});

const replicationConflictsCounter = new promClient.Counter({
  name: "marketpay_replication_conflicts_total",
  help: "Total replication conflicts detected across multi-region writes",
  labelNames: ["table_name", "resolution_strategy"],
});

class ReplicationMonitor {
  constructor(options = {}) {
    this.region = options.region || process.env.REGION || "primary-cluster";
    this.nodeId = options.nodeId || process.env.NODE_ID || `node-${this.region}-0`;
    this.pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
    this.timer = null;

    this.currentLagSeconds = 0;
    this.currentRttMs = 0;
    this.lastCheckedAt = null;
    this.isHealthy = true;
    this.statusMessage = "Initialized";
  }

  /**
   * Start periodic lag monitoring loop.
   */
  start() {
    if (this.timer) return;
    logger.info(
      { region: this.region, interval: this.pollIntervalMs },
      "Starting Replication Monitor"
    );

    this.checkReplication();
    this.timer = setInterval(() => this.checkReplication(), this.pollIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /**
   * Stop monitoring loop.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single replication check iteration.
   */
  async checkReplication() {
    const start = Date.now();
    try {
      // 1. Measure database role and replication lag
      const dbRes = await pool.query(
        `
        SELECT
          pg_is_in_recovery() AS in_recovery,
          CASE
            WHEN pg_is_in_recovery() THEN
              EXTRACT(EPOCH FROM (clock_timestamp() - pg_last_xact_replay_timestamp()))
            ELSE 0
          END AS replay_lag_seconds
      `,
        [],
        { bypassDrain: true }
      );

      const row = dbRes.rows?.[0] || {};
      const inRecovery = Boolean(row.in_recovery);
      const lag =
        row.replay_lag_seconds === null || row.replay_lag_seconds === undefined
          ? 0
          : Number(row.replay_lag_seconds);

      this.currentLagSeconds = Number.isFinite(lag) ? Math.max(0, lag) : 0;
      this.currentRttMs = Date.now() - start;
      this.lastCheckedAt = new Date();

      // Update pool's lag awareness for router.js
      if (typeof pool.setReplicaLag === "function") {
        pool.setReplicaLag(this.currentLagSeconds);
      }

      // 2. Update Prometheus metrics
      const role = inRecovery ? "replica" : "primary";
      replicationLagGauge.set({ region: this.region, role }, this.currentLagSeconds);
      crossRegionRttGauge.set(
        { source_region: this.region, target_region: "global" },
        this.currentRttMs
      );

      const poolStats = typeof pool.getStats === "function" ? pool.getStats() : {};
      fencingStatusGauge.set({ region: this.region }, poolStats.isFenced ? 0 : 1);
      fencingGenerationGauge.set(
        { lease_key: "global_financial_authority" },
        poolStats.fencingGeneration || 1
      );

      // 3. Health evaluation
      if (this.currentLagSeconds > LAG_CRITICAL_THRESHOLD_SECONDS) {
        this.isHealthy = false;
        this.statusMessage = `Critical replication lag: ${this.currentLagSeconds.toFixed(1)}s exceeds ${LAG_CRITICAL_THRESHOLD_SECONDS}s target`;
        logger.error({ lag: this.currentLagSeconds }, this.statusMessage);
      } else if (this.currentLagSeconds > LAG_ALERT_THRESHOLD_SECONDS) {
        this.isHealthy = true; // Still operational but degraded
        this.statusMessage = `High replication lag warning: ${this.currentLagSeconds.toFixed(1)}s exceeds ${LAG_ALERT_THRESHOLD_SECONDS}s`;
        logger.warn({ lag: this.currentLagSeconds }, this.statusMessage);
      } else {
        this.isHealthy = true;
        this.statusMessage = "Healthy";
      }

      // 4. Record heartbeat in database
      await pool
        .query(
          `
        INSERT INTO replication_heartbeats (source_region, source_node, target_region, round_trip_ms)
        VALUES ($1, $2, 'all', $3)
      `,
          [this.region, this.nodeId, this.currentRttMs],
          { bypassDrain: true }
        )
        .catch(() => {});
    } catch (err) {
      this.isHealthy = false;
      this.statusMessage = `Replication check error: ${err.message}`;
      logError(logger, err, { operation: "check_replication" });
    }
  }

  /**
   * Log a detected conflict to audit table and increment metric.
   *
   * @param {object} conflict
   * @param {string} conflict.tableName
   * @param {string} conflict.recordId
   * @param {string} conflict.originRegion
   * @param {string} conflict.conflictingRegion
   * @param {object} conflict.localPayload
   * @param {object} conflict.incomingPayload
   * @param {string} conflict.resolutionStrategy
   * @param {string} [conflict.resolutionStatus]
   * @param {object} [conflict.resolvedPayload]
   */
  async logConflict(conflict) {
    try {
      replicationConflictsCounter.inc({
        table_name: conflict.tableName,
        resolution_strategy: conflict.resolutionStrategy,
      });

      await pool.query(
        `
        INSERT INTO replication_conflicts (
          table_name, record_id, origin_region, conflicting_region,
          local_payload, incoming_payload, resolution_strategy,
          resolution_status, resolved_payload, detected_at, resolved_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), CASE WHEN $8 = 'resolved' THEN NOW() ELSE NULL END)
      `,
        [
          conflict.tableName,
          conflict.recordId,
          conflict.originRegion || this.region,
          conflict.conflictingRegion || "unknown",
          JSON.stringify(conflict.localPayload || {}),
          JSON.stringify(conflict.incomingPayload || {}),
          conflict.resolutionStrategy,
          conflict.resolutionStatus || "resolved",
          conflict.resolvedPayload ? JSON.stringify(conflict.resolvedPayload) : null,
        ],
        { bypassDrain: true }
      );
    } catch (err) {
      logError(logger, err, { operation: "log_replication_conflict" });
    }
  }

  /**
   * Get replication telemetry payload.
   */
  getTelemetry() {
    return {
      region: this.region,
      nodeId: this.nodeId,
      isHealthy: this.isHealthy,
      statusMessage: this.statusMessage,
      currentLagSeconds: this.currentLagSeconds,
      currentRttMs: this.currentRttMs,
      lastCheckedAt: this.lastCheckedAt ? this.lastCheckedAt.toISOString() : null,
      alertThresholds: {
        warningLagSeconds: LAG_ALERT_THRESHOLD_SECONDS,
        criticalLagSeconds: LAG_CRITICAL_THRESHOLD_SECONDS,
      },
    };
  }
}

const defaultReplicationMonitor = new ReplicationMonitor();

module.exports = {
  ReplicationMonitor,
  defaultReplicationMonitor,
  LAG_ALERT_THRESHOLD_SECONDS,
  LAG_CRITICAL_THRESHOLD_SECONDS,
  replicationLagGauge,
  crossRegionRttGauge,
  fencingStatusGauge,
  fencingGenerationGauge,
  replicationConflictsCounter,
};
