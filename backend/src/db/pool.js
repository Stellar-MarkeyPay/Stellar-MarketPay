/**
 * src/db/pool.js
 * Shared PostgreSQL connection pool.
 * All services import this — never create a second Pool.
 */
"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");
const { createServiceLogger } = require("../utils/logger");

const DATABASE_URL = requireEnv("DATABASE_URL");
const dbLogger = createServiceLogger("postgres");

function parsePositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer in milliseconds`);
  }
  return value;
}

function parseRatio(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be a decimal greater than 0 and less than or equal to 1`);
  }
  return value;
}

const timeoutConfig = Object.freeze({
  // Defaults protect API request paths from tying up a pool connection indefinitely.
  statementTimeoutMs: parsePositiveInteger("POSTGRES_STATEMENT_TIMEOUT_MS", 5_000),
  lockTimeoutMs: parsePositiveInteger("POSTGRES_LOCK_TIMEOUT_MS", 1_000),
  // Longer budgets are opt-in only for bounded background analytics and migrations.
  analyticsStatementTimeoutMs: parsePositiveInteger("POSTGRES_ANALYTICS_STATEMENT_TIMEOUT_MS", 30_000),
  migrationStatementTimeoutMs: parsePositiveInteger("POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS", 120_000),
  migrationLockTimeoutMs: parsePositiveInteger("POSTGRES_MIGRATION_LOCK_TIMEOUT_MS", 5_000),
  nearTimeoutRatio: parseRatio("POSTGRES_NEAR_TIMEOUT_RATIO", 0.8),
});

function pgDuration(ms) {
  return `${ms}ms`;
}

function buildPgOptions(config = timeoutConfig) {
  return [
    "-c",
    `statement_timeout=${pgDuration(config.statementTimeoutMs)}`,
    "-c",
    `lock_timeout=${pgDuration(config.lockTimeoutMs)}`,
  ].join(" ");
}

function getQueryText(queryConfig) {
  if (typeof queryConfig === "string") return queryConfig;
  if (queryConfig && typeof queryConfig.text === "string") return queryConfig.text;
  return "";
}

function normalizeQueryForLog(queryText) {
  return queryText.replace(/\s+/g, " ").trim().slice(0, 500);
}

function isTransactionBoundary(queryText) {
  return /^(COMMIT|ROLLBACK)\b/i.test(queryText.trim());
}

function shouldSkipTimingLog(queryText) {
  return /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SELECT\s+set_config)\b/i.test(queryText.trim());
}

function getTimeoutContext(client) {
  return client.__marketpayTimeoutContext || {
    label: "api",
    statementTimeoutMs: timeoutConfig.statementTimeoutMs,
    lockTimeoutMs: timeoutConfig.lockTimeoutMs,
  };
}

function logQueryTiming(client, queryText, durationMs, err) {
  if (shouldSkipTimingLog(queryText)) return;

  const context = getTimeoutContext(client);
  const statementTimeoutMs = context.statementTimeoutMs || timeoutConfig.statementTimeoutMs;
  const nearTimeoutMs = Math.floor(statementTimeoutMs * timeoutConfig.nearTimeoutRatio);
  const payload = {
    durationMs,
    statementTimeoutMs,
    timeoutLabel: context.label,
    query: normalizeQueryForLog(queryText),
  };

  if (durationMs >= nearTimeoutMs) {
    dbLogger.warn({
      ...payload,
      alert: "db_query_near_statement_timeout",
      nearTimeoutMs,
      msg: "PostgreSQL query is approaching statement_timeout",
    });
  }

  if (err?.code === "57014" || /statement timeout/i.test(err?.message || "")) {
    dbLogger.error({
      ...payload,
      alert: "db_query_statement_timeout",
      error: { code: err.code, message: err.message },
      msg: "PostgreSQL statement_timeout terminated query",
    });
  } else if (err?.code === "55P03" || /lock timeout/i.test(err?.message || "")) {
    dbLogger.error({
      ...payload,
      lockTimeoutMs: context.lockTimeoutMs,
      alert: "db_query_lock_timeout",
      error: { code: err.code, message: err.message },
      msg: "PostgreSQL lock_timeout terminated query",
    });
  }
}

function attachQueryTimeoutLogger(client) {
  if (client.__marketpayQueryTimeoutLoggerAttached) return client;

  const originalQuery = client.query.bind(client);

  client.query = function monitoredQuery(...args) {
    const queryText = getQueryText(args[0]);
    const startedAt = Date.now();
    const callbackIndex = args.findIndex((arg) => typeof arg === "function");

    if (callbackIndex >= 0) {
      const originalCallback = args[callbackIndex];
      args[callbackIndex] = function monitoredCallback(err, result) {
        const durationMs = Date.now() - startedAt;
        logQueryTiming(client, queryText, durationMs, err);
        if (isTransactionBoundary(queryText)) {
          delete client.__marketpayTimeoutContext;
        }
        return originalCallback(err, result);
      };
      return originalQuery(...args);
    }

    const result = originalQuery(...args);
    if (!result || typeof result.then !== "function") return result;

    return result
      .then((value) => {
        const durationMs = Date.now() - startedAt;
        logQueryTiming(client, queryText, durationMs);
        if (isTransactionBoundary(queryText)) {
          delete client.__marketpayTimeoutContext;
        }
        return value;
      })
      .catch((err) => {
        const durationMs = Date.now() - startedAt;
        logQueryTiming(client, queryText, durationMs, err);
        if (isTransactionBoundary(queryText)) {
          delete client.__marketpayTimeoutContext;
        }
        throw err;
      });
  };

  client.__marketpayQueryTimeoutLoggerAttached = true;
  return client;
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  options: buildPgOptions(),
  // Keep a modest pool; tune per deployment.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Enforce SSL in production but allow plain-text in local Docker.
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false,
});

pool.on("connect", attachQueryTimeoutLogger);

pool.on("error", (err) => {
  dbLogger.error({
    err,
    msg: "Unexpected PostgreSQL pool error",
  });
});

async function setLocalTimeouts(
  client,
  {
    statementTimeoutMs = timeoutConfig.statementTimeoutMs,
    lockTimeoutMs = timeoutConfig.lockTimeoutMs,
    label = "custom",
  } = {},
) {
  client.__marketpayTimeoutContext = { statementTimeoutMs, lockTimeoutMs, label };
  await client.query("SELECT set_config('statement_timeout', $1, true)", [pgDuration(statementTimeoutMs)]);
  await client.query("SELECT set_config('lock_timeout', $1, true)", [pgDuration(lockTimeoutMs)]);
}

async function withTimeouts(options, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setLocalTimeouts(client, options);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      dbLogger.error({
        err: rollbackErr,
        msg: "Failed to rollback PostgreSQL timeout-scoped transaction",
      });
    }
    throw err;
  } finally {
    delete client.__marketpayTimeoutContext;
    client.release();
  }
}

async function queryWithTimeouts(queryText, values, options) {
  return withTimeouts(options, (client) => client.query(queryText, values));
}

async function analyticsQuery(queryText, values) {
  return queryWithTimeouts(queryText, values, {
    label: "analytics",
    statementTimeoutMs: timeoutConfig.analyticsStatementTimeoutMs,
    lockTimeoutMs: timeoutConfig.lockTimeoutMs,
  });
}

pool.timeoutConfig = timeoutConfig;
pool.buildPgOptions = buildPgOptions;
pool.attachQueryTimeoutLogger = attachQueryTimeoutLogger;
pool.setLocalTimeouts = setLocalTimeouts;
pool.withTimeouts = withTimeouts;
pool.queryWithTimeouts = queryWithTimeouts;
pool.analyticsQuery = analyticsQuery;
pool.pool = pool;

module.exports = pool;
