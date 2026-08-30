/**
 * src/db/router.js
 *
 * Multi-Region SQL Query Router.
 * Classifies SQL queries by consistency class, target table, and read/write intent.
 * Directs traffic to the appropriate regional connection pool:
 * - Primary/Authority Pool for Class 1 (Financial/Strict Linearizable).
 * - Regional Local Pool for Class 2 (Causal Marketplace Writes) and Class 3 (Eventual CRDTs).
 * - Local Read Replica Pool for SELECT queries (with lag-aware fallback to Writer if replica lag > threshold).
 */
"use strict";

const { FINANCIAL_TABLES, CONSISTENCY_CLASSES } = require("./crdt");

const ConsistencyLevel = {
  STRICT: "STRICT",
  CAUSAL: "CAUSAL",
  EVENTUAL: "EVENTUAL",
  LOCAL: "LOCAL",
};

const PoolTarget = {
  AUTHORITY_WRITER: "AUTHORITY_WRITER",
  REGIONAL_LOCAL: "REGIONAL_LOCAL",
  READ_REPLICA: "READ_REPLICA",
};

// Maximum allowed replica lag in seconds before SELECT queries fail over to writer
const MAX_ALLOWED_REPLICA_LAG_SECONDS = 2.0;

/**
 * Extract target table name from SQL string.
 * @param {string} sql
 * @returns {string|null}
 */
function extractTableName(sql) {
  if (typeof sql !== "string") return null;
  const clean = sql
    .trim()
    .replace(/\/\*.*?\*\//gs, "")
    .replace(/--.*$/gm, "")
    .trim();

  const insertMatch = clean.match(/INSERT\s+INTO\s+([a-zA-Z0-9_"]+)/i);
  if (insertMatch) return insertMatch[1].replace(/"/g, "").toLowerCase();

  const updateMatch = clean.match(/UPDATE\s+([a-zA-Z0-9_"]+)/i);
  if (updateMatch) return updateMatch[1].replace(/"/g, "").toLowerCase();

  const deleteMatch = clean.match(/DELETE\s+FROM\s+([a-zA-Z0-9_"]+)/i);
  if (deleteMatch) return deleteMatch[1].replace(/"/g, "").toLowerCase();

  const fromMatch = clean.match(/FROM\s+([a-zA-Z0-9_"]+)/i);
  if (fromMatch) return fromMatch[1].replace(/"/g, "").toLowerCase();

  return null;
}

/**
 * Check whether a SQL string is a read-only query.
 * @param {string} sql
 * @returns {boolean}
 */
function isReadOnlyQuery(sql) {
  if (typeof sql !== "string") return false;
  const clean = sql
    .trim()
    .replace(/\/\*.*?\*\//gs, "")
    .replace(/--.*$/gm, "")
    .trim()
    .toUpperCase();

  return (
    clean.startsWith("SELECT") ||
    clean.startsWith("WITH") ||
    clean.startsWith("SHOW") ||
    clean.startsWith("EXPLAIN")
  );
}

/**
 * Route a SQL query to the optimal connection pool.
 *
 * @param {string} sql - The SQL statement
 * @param {object} [options]
 * @param {string} [options.consistency] - Explicit consistency override
 * @param {boolean} [options.readYourWrites] - Require fresh writer connection
 * @param {number} [options.replicaLagSeconds] - Current measured replica lag
 * @param {boolean} [options.isFenced] - Whether this node is fenced
 * @returns {{ target: "AUTHORITY_WRITER"|"REGIONAL_LOCAL"|"READ_REPLICA", consistencyClass: string, isFinancial: boolean, reason: string }}
 */
function routeQuery(sql, options = {}) {
  const tableName = extractTableName(sql);
  const isRead = isReadOnlyQuery(sql);
  const isFinancial = Boolean(tableName && FINANCIAL_TABLES.has(tableName));

  // Explicit consistency override
  if (options.consistency === ConsistencyLevel.STRICT || isFinancial) {
    return {
      target: PoolTarget.AUTHORITY_WRITER,
      consistencyClass: CONSISTENCY_CLASSES.STRICT_CP,
      isFinancial: true,
      tableName,
      reason: `Class 1 financial entity '${tableName || "query"}' requires Authority Writer pool with active fencing token.`,
    };
  }

  if (isRead) {
    // If readYourWrites requested or replica lag is high, route reads to writer
    const replicaLag =
      typeof options.replicaLagSeconds === "number" ? options.replicaLagSeconds : 0;
    if (options.readYourWrites || replicaLag > MAX_ALLOWED_REPLICA_LAG_SECONDS) {
      return {
        target: PoolTarget.AUTHORITY_WRITER,
        consistencyClass: CONSISTENCY_CLASSES.CAUSAL_RYW,
        isFinancial: false,
        tableName,
        reason: options.readYourWrites
          ? "Read-Your-Writes consistency requested."
          : `Replica lag (${replicaLag}s) exceeds threshold (${MAX_ALLOWED_REPLICA_LAG_SECONDS}s); falling back to writer.`,
      };
    }

    return {
      target: PoolTarget.READ_REPLICA,
      consistencyClass: CONSISTENCY_CLASSES.CAUSAL_RYW,
      isFinancial: false,
      tableName,
      reason: "Read-only query routed to local Read Replica pool for sub-millisecond latency.",
    };
  }

  // Write queries for non-financial tables
  if (options.consistency === ConsistencyLevel.EVENTUAL) {
    return {
      target: PoolTarget.REGIONAL_LOCAL,
      consistencyClass: CONSISTENCY_CLASSES.EVENTUAL_CRDT,
      isFinancial: false,
      tableName,
      reason: "Eventual consistency write routed to Regional Local pool.",
    };
  }

  return {
    target: PoolTarget.REGIONAL_LOCAL,
    consistencyClass: CONSISTENCY_CLASSES.CAUSAL_RYW,
    isFinancial: false,
    tableName,
    reason: "Causal marketplace write routed to Regional Local pool with version vector tracking.",
  };
}

module.exports = {
  ConsistencyLevel,
  PoolTarget,
  MAX_ALLOWED_REPLICA_LAG_SECONDS,
  extractTableName,
  isReadOnlyQuery,
  routeQuery,
};
