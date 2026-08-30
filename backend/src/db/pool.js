/**
 * src/db/pool.js
 *
 * Multi-Region Active-Active PostgreSQL Connection Pool & Router.
 *
 * Features:
 * - Multi-tier pool management: Primary Authority, Regional Local, and Read Replica.
 * - Automatic query classification and routing via router.js.
 * - Fencing assertion on Class 1 financial writes to prevent split-brain.
 * - In-flight transaction tracking and graceful connection draining for zero-data-loss failover.
 * - 100% backwards-compatible drop-in replacement for standard pg.Pool.
 */
"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");
const { routeQuery, PoolTarget } = require("./router");
const { ConflictResolver } = require("./crdt");

const DATABASE_URL = requireEnv("DATABASE_URL");
const PRIMARY_DATABASE_URL = process.env.PRIMARY_DATABASE_URL || DATABASE_URL;
const REGIONAL_DATABASE_URL = process.env.REGIONAL_DATABASE_URL || DATABASE_URL;
const READ_REPLICA_DATABASE_URL = process.env.READ_REPLICA_DATABASE_URL || REGIONAL_DATABASE_URL;

const REGION = process.env.REGION || "primary-cluster";
const CLUSTER_ROLE = process.env.CLUSTER_ROLE || "active";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function createSubPool(connectionString, label) {
  const p = new Pool({
    connectionString,
    max: parseInt(process.env.PG_POOL_MAX || "10", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: IS_PRODUCTION ? { rejectUnauthorized: true } : false,
  });

  p.on("error", (err) => {
    console.error(`[pg:${label}] Unexpected pool error:`, err.message);
  });

  return p;
}

class MultiRegionPool {
  constructor() {
    this.primaryPool = createSubPool(PRIMARY_DATABASE_URL, "authority-primary");
    this.regionalPool =
      REGIONAL_DATABASE_URL === PRIMARY_DATABASE_URL
        ? this.primaryPool
        : createSubPool(REGIONAL_DATABASE_URL, "regional-local");
    this.replicaPool =
      READ_REPLICA_DATABASE_URL === REGIONAL_DATABASE_URL
        ? this.regionalPool
        : createSubPool(READ_REPLICA_DATABASE_URL, "read-replica");

    this.region = REGION;
    this.clusterRole = CLUSTER_ROLE;
    this.isAuthority = CLUSTER_ROLE === "active" || REGION === "primary-cluster";
    this.isFenced = false;
    this.fencingGeneration = 1;
    this.replicaLagSeconds = 0;

    this.inFlightWrites = 0;
    this.isDraining = false;
    this.listeners = new Map();
  }

  /**
   * Set fencing state for this node.
   * @param {boolean} fenced
   * @param {number} [generation]
   */
  setFenced(fenced, generation) {
    this.isFenced = Boolean(fenced);
    if (typeof generation === "number") {
      this.fencingGeneration = generation;
    }
  }

  /**
   * Update current measured replica lag.
   * @param {number} lagSeconds
   */
  setReplicaLag(lagSeconds) {
    this.replicaLagSeconds = Number.isFinite(lagSeconds) ? Math.max(0, lagSeconds) : 0;
  }

  /**
   * Select the appropriate underlying Pool for a target.
   * @param {"AUTHORITY_WRITER"|"REGIONAL_LOCAL"|"READ_REPLICA"} target
   * @returns {Pool}
   */
  getUnderlyingPool(target) {
    switch (target) {
      case PoolTarget.AUTHORITY_WRITER:
        return this.primaryPool;
      case PoolTarget.READ_REPLICA:
        return this.replicaPool;
      case PoolTarget.REGIONAL_LOCAL:
      default:
        return this.regionalPool;
    }
  }

  /**
   * Execute a query with automatic multi-region routing.
   *
   * @param {string|object} queryTextOrConfig
   * @param {any[]} [values]
   * @param {object} [options]
   * @returns {Promise<import("pg").QueryResult>}
   */
  async query(queryTextOrConfig, values, options = {}) {
    const text =
      typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig?.text || "";
    const params = Array.isArray(values) ? values : queryTextOrConfig?.values || [];
    const queryOptions = typeof values === "object" && !Array.isArray(values) ? values : options;

    if (this.isDraining && !queryOptions.bypassDrain) {
      const err = new Error("Database pool is draining for failover switchover. Write rejected.");
      err.code = "57P03"; // Cannot connect now
      err.status = 503;
      throw err;
    }

    const route = routeQuery(text, {
      ...queryOptions,
      replicaLagSeconds: this.replicaLagSeconds,
      isFenced: this.isFenced,
    });

    // Enforce fencing guard on Class 1 financial writes
    if (route.isFinancial) {
      const evaluation = ConflictResolver.evaluateWrite(
        route.tableName,
        this.region,
        this.isAuthority,
        { fenced: this.isFenced }
      );
      if (!evaluation.allowed) {
        const err = new Error(evaluation.reason || "Financial write blocked by fencing guard.");
        err.code = "55000"; // Object not in prerequisite state
        err.status = 409;
        throw err;
      }
    }

    const poolToUse = this.getUnderlyingPool(route.target);
    const isWrite = route.target !== PoolTarget.READ_REPLICA;

    if (isWrite) this.inFlightWrites++;
    try {
      return await poolToUse.query(queryTextOrConfig, params);
    } catch (err) {
      // Fallback: If regional replica failed or is read-only for writes, fallback to primary pool
      if (
        poolToUse !== this.primaryPool &&
        (err.code === "25006" || err.message?.includes("read-only") || err.code === "ECONNREFUSED")
      ) {
        return await this.primaryPool.query(queryTextOrConfig, params);
      }
      throw err;
    } finally {
      if (isWrite) this.inFlightWrites = Math.max(0, this.inFlightWrites - 1);
    }
  }

  /**
   * Acquire a client from the pool.
   * @param {object} [options]
   * @returns {Promise<import("pg").PoolClient>}
   */
  async connect(options = {}) {
    const target = options.target || PoolTarget.AUTHORITY_WRITER;
    const poolToUse = this.getUnderlyingPool(target);
    const client = await poolToUse.connect();

    // Wrap client to track in-flight lifecycle
    this.inFlightWrites++;
    const originalRelease = client.release.bind(client);
    let released = false;

    client.release = (err) => {
      if (!released) {
        released = true;
        this.inFlightWrites = Math.max(0, this.inFlightWrites - 1);
      }
      return originalRelease(err);
    };

    return client;
  }

  /**
   * Execute an atomic transaction with automatic retries on serialization anomalies.
   *
   * @param {(client: import("pg").PoolClient) => Promise<any>} callback
   * @param {object} [options]
   * @param {number} [options.maxRetries=3]
   * @param {string} [options.isolationLevel="READ COMMITTED"]
   * @returns {Promise<any>}
   */
  async transaction(callback, options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    const isolationLevel = options.isolationLevel || "READ COMMITTED";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const client = await this.connect({ target: PoolTarget.AUTHORITY_WRITER });
      try {
        await client.query(`BEGIN TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        // Retry on serialization failure (40001) or deadlock detected (40P01)
        if ((err.code === "40001" || err.code === "40P01") && attempt < maxRetries) {
          const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  }

  /**
   * Gracefully drain write connections during a regional failover switchover.
   * @param {object} [options]
   * @param {number} [options.timeoutMs=5000]
   * @returns {Promise<void>}
   */
  async drainWrites(options = {}) {
    const timeoutMs = options.timeoutMs || 5000;
    this.isDraining = true;

    const start = Date.now();
    while (this.inFlightWrites > 0 && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Reset draining state after switchover.
   */
  resumeWrites() {
    this.isDraining = false;
  }

  /**
   * Get telemetry and connection statistics.
   */
  getStats() {
    return {
      region: this.region,
      clusterRole: this.clusterRole,
      isAuthority: this.isAuthority,
      isFenced: this.isFenced,
      fencingGeneration: this.fencingGeneration,
      replicaLagSeconds: this.replicaLagSeconds,
      inFlightWrites: this.inFlightWrites,
      isDraining: this.isDraining,
      primaryPool: {
        total: this.primaryPool.totalCount,
        idle: this.primaryPool.idleCount,
        waiting: this.primaryPool.waitingCount,
      },
      regionalPool: {
        total: this.regionalPool.totalCount,
        idle: this.regionalPool.idleCount,
        waiting: this.regionalPool.waitingCount,
      },
      replicaPool: {
        total: this.replicaPool.totalCount,
        idle: this.replicaPool.idleCount,
        waiting: this.replicaPool.waitingCount,
      },
    };
  }

  // Backwards compatibility pg.Pool getters
  get totalCount() {
    return this.primaryPool.totalCount;
  }

  get idleCount() {
    return this.primaryPool.idleCount;
  }

  get waitingCount() {
    return this.primaryPool.waitingCount;
  }

  on(event, handler) {
    this.primaryPool.on(event, handler);
    if (this.regionalPool !== this.primaryPool) this.regionalPool.on(event, handler);
    if (this.replicaPool !== this.regionalPool) this.replicaPool.on(event, handler);
    return this;
  }

  async end() {
    const ends = [this.primaryPool.end()];
    if (this.regionalPool !== this.primaryPool) ends.push(this.regionalPool.end());
    if (this.replicaPool !== this.regionalPool && this.replicaPool !== this.primaryPool) {
      ends.push(this.replicaPool.end());
    }
    await Promise.all(ends);
  }
}

const sharedPool = new MultiRegionPool();
sharedPool.pool = sharedPool;

module.exports = sharedPool;
