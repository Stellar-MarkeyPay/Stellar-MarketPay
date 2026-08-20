/**
 * src/routes/health.js
 *
 * Enhanced health check endpoint for readiness probes (Kubernetes / Docker).
 *
 * GET /health
 *   - Verifies database connectivity and whether the endpoint is writable
 *   - Pings Stellar Horizon /ledgers?limit=1 (timeout: 2 s)
 *   - Returns 200 when all dependencies are healthy
 *   - Returns 503 when any critical dependency is down
 *
 * Response shape:
 *   {
 *     "status": "healthy" | "degraded",
 *     "database": { "status": "ok", "latency_ms": 12 }
 *                | { "status": "error", "message": "..." },
 *     "stellar":  { "status": "ok", "network": "testnet", "ledger": 12345678 }
 *                | { "status": "error", "message": "..." },
 *     "uptime_seconds": 3600,
 *     "version": "1.0.0"
 *   }
 */
"use strict";

const express = require("express");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
// Generous limit — probes hit this frequently
const healthRateLimiter = createRateLimiter(120, 1);

const SERVER_START = Date.now();
const VERSION = process.env.npm_package_version || "1.0.0";
const CHECK_TIMEOUT_MS = 2000;

/**
 * Run a SELECT 1 against the pool with a hard timeout.
 * @returns {{ status: "ok", latency_ms: number } | { status: "error", message: string }}
 */
async function checkDatabase() {
  const start = Date.now();
  let timeout;
  try {
    const result = await Promise.race([
      pool.query(`
        SELECT
          pg_is_in_recovery() AS in_recovery,
          CASE
            WHEN pg_is_in_recovery() THEN
              EXTRACT(EPOCH FROM (clock_timestamp() - pg_last_xact_replay_timestamp()))
            ELSE 0
          END AS replay_lag_seconds
      `),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Database check timed out")), CHECK_TIMEOUT_MS);
      }),
    ]);
    const row = result.rows?.[0] || {};
    const inRecovery = row.in_recovery === true;
    const replayLag =
      row.replay_lag_seconds === null || row.replay_lag_seconds === undefined
        ? Number.NaN
        : Number(row.replay_lag_seconds);
    return {
      status: "ok",
      latency_ms: Date.now() - start,
      role: inRecovery ? "replica" : "primary",
      writable: !inRecovery,
      replay_lag_seconds: Number.isFinite(replayLag) ? replayLag : null,
    };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ping Stellar Horizon /ledgers?limit=1 with a hard timeout.
 * @returns {{ status: "ok", network: string, ledger: number } | { status: "error", message: string }}
 */
async function checkStellar() {
  const horizonUrl = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  const network = process.env.STELLAR_NETWORK || "testnet";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(`${horizonUrl}/ledgers?limit=1&order=desc`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      return {
        status: "error",
        message: `Horizon returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const ledger = data?._embedded?.records?.[0]?.sequence ?? null;
    return { status: "ok", network, ledger };
  } catch (err) {
    const message = err.name === "AbortError" ? "Stellar Horizon check timed out" : err.message;
    return { status: "error", message };
  }
}

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Enhanced health check
 *     description: >
 *       Checks database connectivity (SELECT 1) and Stellar Horizon reachability.
 *       Returns 200 when healthy, 503 when any critical dependency is down.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: All dependencies healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 database:
 *                   type: object
 *                   properties:
 *                     status: { type: string, example: ok }
 *                     latency_ms: { type: number, example: 12 }
 *                 stellar:
 *                   type: object
 *                   properties:
 *                     status: { type: string, example: ok }
 *                     network: { type: string, example: testnet }
 *                     ledger: { type: number, example: 12345678 }
 *                 uptime_seconds: { type: number, example: 3600 }
 *                 version: { type: string, example: "1.0.0" }
 *       503:
 *         description: One or more dependencies are down
 */
function liveHandler(req, res) {
  res
    .set("Cache-Control", "no-store")
    .status(200)
    .json({
      status: "alive",
      region: process.env.REGION || "unknown",
      cluster_role: process.env.CLUSTER_ROLE || "unknown",
      uptime_seconds: Math.floor((Date.now() - SERVER_START) / 1000),
      version: VERSION,
    });
}

async function dependencyHealthHandler(req, res, requireWritable) {
  const [database, stellar] = await Promise.all([checkDatabase(), checkStellar()]);

  const databaseReady =
    database.status === "ok" && (!requireWritable || database.writable === true);
  const healthy = databaseReady && stellar.status === "ok";

  const body = {
    status: healthy ? "healthy" : "degraded",
    region: process.env.REGION || "unknown",
    cluster_role: process.env.CLUSTER_ROLE || "unknown",
    database,
    stellar,
    uptime_seconds: Math.floor((Date.now() - SERVER_START) / 1000),
    version: VERSION,
    // Keep the indexer field for backwards compatibility
    indexer: req.app.locals.indexerService ? req.app.locals.indexerService.getHealth() : null,
  };

  res
    .set("Cache-Control", "no-store")
    .status(healthy ? 200 : 503)
    .json(body);
}

router.get("/live", liveHandler);
router.get("/standby", healthRateLimiter, (req, res) => dependencyHealthHandler(req, res, false));
router.get("/ready", healthRateLimiter, (req, res) =>
  dependencyHealthHandler(req, res, process.env.REQUIRE_WRITABLE_DB === "true")
);
// Preserve the existing endpoint for clients and older manifests.
router.get("/", healthRateLimiter, (req, res) =>
  dependencyHealthHandler(req, res, process.env.REQUIRE_WRITABLE_DB === "true")
);

module.exports = router;
