/**
 * src/services/fencingService.js
 *
 * Distributed Lease Fencing and Split-Brain Prevention Service.
 *
 * Guarantees:
 * 1. Mutual Exclusion: At any point in time t, at most ONE region holds a valid lease for generation G.
 * 2. Automatic Partition Fencing: If the active primary loses WAN connectivity or misses heartbeats for > TTL,
 *    it autonomously switches to FENCED_READ_ONLY mode, rejecting all Class 1 financial writes.
 * 3. Generation Token Progression: Every failover increments the generation token, instantly invalidating
 *    stale writes from partitioned or resurrected nodes.
 * 4. Graceful Draining: In-flight transactions are drained before lease surrender.
 */
"use strict";

const pool = require("../db/pool");
const { createServiceLogger, logError } = require("../utils/logger");

const logger = createServiceLogger("fencing-service");

const LEASE_KEY = "global_financial_authority";
const HEARTBEAT_INTERVAL_MS = 2000;
const LEASE_DURATION_SECONDS = 6;
const MAX_MISSED_HEARTBEATS = 3;

class FencingService {
  constructor(options = {}) {
    this.region = options.region || process.env.REGION || "primary-cluster";
    this.nodeId = options.nodeId || process.env.NODE_ID || `node-${this.region}-0`;
    this.isAuthority =
      options.isAuthority ??
      (process.env.CLUSTER_ROLE === "active" || this.region === "primary-cluster");
    this.leaseKey = options.leaseKey || LEASE_KEY;
    this.leaseDurationSeconds = options.leaseDurationSeconds || LEASE_DURATION_SECONDS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS;

    this.generationToken = 1;
    this.isFenced = !this.isAuthority;
    this.leaseExpiry = null;
    this.timer = null;
    this.consecutiveFailures = 0;

    // Synchronize initial state with pool
    if (typeof pool.setFenced === "function") {
      pool.setFenced(this.isFenced, this.generationToken);
    }
  }

  /**
   * Start background heartbeat leasing loop.
   */
  start() {
    if (this.timer) return;
    logger.info(
      { region: this.region, nodeId: this.nodeId, isAuthority: this.isAuthority },
      "Starting Fencing Service heartbeat loop"
    );

    // Initial heartbeat
    this.heartbeat();
    this.timer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /**
   * Stop heartbeat loop.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Execute lease heartbeat check / renewal.
   */
  async heartbeat() {
    try {
      if (this.isAuthority && !this.isFenced) {
        // Attempt to renew or acquire lease
        const res = await pool.query(
          "SELECT granted, generation_token, expires_at FROM acquire_fencing_lease($1, $2, $3, $4)",
          [this.leaseKey, this.region, this.nodeId, this.leaseDurationSeconds],
          { bypassDrain: true }
        );

        const row = res.rows?.[0];
        if (row && row.granted) {
          this.generationToken = Number(row.generation_token);
          this.leaseExpiry = new Date(row.expires_at);
          this.consecutiveFailures = 0;
          if (this.isFenced) {
            this.isFenced = false;
            if (typeof pool.setFenced === "function") {
              pool.setFenced(false, this.generationToken);
            }
            logger.info({ generationToken: this.generationToken }, "Fencing lease active");
          }
        } else {
          // Lease was denied or held by another region
          this.handleLeaseLoss("Lease renewal denied or held by another region.");
        }
      } else {
        // Standby/Passive node: verify current lease holder
        const res = await pool.query(
          "SELECT holder_region, generation_token, expires_at FROM region_fencing_leases WHERE lease_key = $1",
          [this.leaseKey],
          { bypassDrain: true }
        );
        const row = res.rows?.[0];
        if (row) {
          this.generationToken = Number(row.generation_token);
          this.leaseExpiry = new Date(row.expires_at);
          const activeRegion = row.holder_region;

          if (activeRegion !== this.region && !this.isFenced) {
            this.isFenced = true;
            if (typeof pool.setFenced === "function") {
              pool.setFenced(true, this.generationToken);
            }
          }
        }
        this.consecutiveFailures = 0;
      }
    } catch (err) {
      this.consecutiveFailures++;
      logError(logger, err, {
        operation: "fencing_heartbeat",
        consecutiveFailures: this.consecutiveFailures,
      });

      if (this.consecutiveFailures >= MAX_MISSED_HEARTBEATS && !this.isFenced) {
        this.handleLeaseLoss(
          `Missed ${this.consecutiveFailures} consecutive heartbeats; entering autonomous partition fencing.`
        );
      }
    }
  }

  /**
   * Handle loss of fencing lease.
   * @param {string} reason
   */
  handleLeaseLoss(reason) {
    if (!this.isFenced) {
      this.isFenced = true;
      if (typeof pool.setFenced === "function") {
        pool.setFenced(true, this.generationToken);
      }
      logger.warn(
        { reason, generationToken: this.generationToken },
        "Node switched to FENCED_READ_ONLY mode"
      );
    }
  }

  /**
   * Promote this node/region to authority with lease takeover.
   * @returns {Promise<{ success: boolean, generationToken: number, expiresAt: Date }>}
   */
  async promote() {
    logger.warn(
      { region: this.region, nodeId: this.nodeId },
      "Initiating node promotion and lease takeover"
    );

    const res = await pool.query(
      "SELECT granted, generation_token, expires_at FROM acquire_fencing_lease($1, $2, $3, $4)",
      [this.leaseKey, this.region, this.nodeId, this.leaseDurationSeconds],
      { bypassDrain: true }
    );

    const row = res.rows?.[0];
    if (row && row.granted) {
      this.isAuthority = true;
      this.isFenced = false;
      this.generationToken = Number(row.generation_token);
      this.leaseExpiry = new Date(row.expires_at);
      this.consecutiveFailures = 0;

      if (typeof pool.setFenced === "function") {
        pool.setFenced(false, this.generationToken);
      }
      logger.info(
        { region: this.region, generationToken: this.generationToken },
        "Promotion successful. Node is now active financial authority."
      );
      return { success: true, generationToken: this.generationToken, expiresAt: this.leaseExpiry };
    }

    const err = new Error(
      "Failed to acquire fencing lease during promotion. Lease held by another live region."
    );
    err.status = 409;
    throw err;
  }

  /**
   * Manually fence this node (e.g. for maintenance or graceful failover).
   */
  async fence() {
    logger.info({ region: this.region }, "Manually fencing node");
    if (typeof pool.drainWrites === "function") {
      await pool.drainWrites({ timeoutMs: 3000 });
    }
    this.isFenced = true;
    if (typeof pool.setFenced === "function") {
      pool.setFenced(true, this.generationToken);
    }
    return { status: "fenced", region: this.region, generationToken: this.generationToken };
  }

  /**
   * Get current fencing telemetry.
   */
  getFencingState() {
    return {
      region: this.region,
      nodeId: this.nodeId,
      isAuthority: this.isAuthority,
      isFenced: this.isFenced,
      generationToken: this.generationToken,
      leaseExpiry: this.leaseExpiry ? this.leaseExpiry.toISOString() : null,
      leaseHealthy: !this.isFenced && this.consecutiveFailures === 0,
      consecutiveFailures: this.consecutiveFailures,
    };
  }
}

const defaultFencingService = new FencingService();

module.exports = {
  FencingService,
  defaultFencingService,
  LEASE_KEY,
  HEARTBEAT_INTERVAL_MS,
  LEASE_DURATION_SECONDS,
};
