/**
 * src/routes/replication.js
 *
 * Multi-Region Active-Active Replication Management & Telemetry Endpoints:
 *   GET  /api/replication/status      Replication lag, fencing lease, peer latency
 *   GET  /api/replication/conflicts   Audit log of multi-region write conflicts
 *   POST /api/replication/reconcile   On-chain Soroban escrow reconciliation post-failover
 *   POST /api/replication/fence       Manually fence a region
 *   POST /api/replication/promote     Promote a region to active authority with lease takeover
 */
"use strict";

const express = require("express");
const pool = require("../db/pool");
const { defaultFencingService } = require("../services/fencingService");
const { defaultReplicationMonitor } = require("../services/replicationMonitor");
const { defaultChainReconciliationService } = require("../services/chainReconciliationService");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
const replicationRateLimiter = createRateLimiter(60, 1);

/**
 * @swagger
 * /api/replication/status:
 *   get:
 *     summary: Multi-region replication telemetry and fencing state
 *     description: >
 *       Returns comprehensive multi-region active-active status:
 *       measured WAL replay lag, peer RTT, fencing lease holder, generation token, and pool states.
 *     tags: [Replication]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Multi-region replication status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 region: { type: string, example: primary-cluster }
 *                 clusterRole: { type: string, example: active }
 *                 isAuthority: { type: boolean, example: true }
 *                 fencing:
 *                   type: object
 *                   properties:
 *                     isFenced: { type: boolean, example: false }
 *                     generationToken: { type: number, example: 1 }
 *                     leaseHealthy: { type: boolean, example: true }
 *                 replication:
 *                   type: object
 *                   properties:
 *                     currentLagSeconds: { type: number, example: 0.2 }
 *                     currentRttMs: { type: number, example: 15 }
 *                     isHealthy: { type: boolean, example: true }
 *                 poolStats: { type: object }
 */
router.get("/status", replicationRateLimiter, async (req, res) => {
  const fencingState = defaultFencingService.getFencingState();
  const telemetry = defaultReplicationMonitor.getTelemetry();
  const poolStats = pool.getStats();

  res.json({
    success: true,
    region: poolStats.region,
    clusterRole: poolStats.clusterRole,
    isAuthority: poolStats.isAuthority,
    fencing: fencingState,
    replication: telemetry,
    poolStats,
  });
});

/**
 * @swagger
 * /api/replication/conflicts:
 *   get:
 *     summary: Audit log of multi-region replication conflicts
 *     description: >
 *       Returns recorded conflicts across multi-region writes, resolution policies applied,
 *       and resolution status.
 *     tags: [Replication]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Conflict audit trail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 conflicts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       tableName: { type: string, example: jobs }
 *                       recordId: { type: string }
 *                       resolutionStrategy: { type: string, example: STATE_MACHINE_PROGRESSION }
 *                       resolutionStatus: { type: string, example: resolved }
 */
router.get("/conflicts", replicationRateLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, table_name, record_id, origin_region, conflicting_region,
             resolution_strategy, resolution_status, detected_at, resolved_at
      FROM replication_conflicts
      ORDER BY detected_at DESC
      LIMIT 100
    `,
      [],
      { bypassDrain: true }
    );

    res.json({
      success: true,
      conflicts: rows.map((r) => ({
        id: r.id,
        tableName: r.table_name,
        recordId: r.record_id,
        originRegion: r.origin_region,
        conflictingRegion: r.conflicting_region,
        resolutionStrategy: r.resolution_strategy,
        resolutionStatus: r.resolution_status,
        detectedAt: r.detected_at,
        resolvedAt: r.resolved_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replication/reconcile:
 *   post:
 *     summary: Trigger on-chain Soroban escrow reconciliation
 *     description: >
 *       Audits and reconciles off-chain PostgreSQL escrow state with on-chain Soroban contract state
 *       following a regional failover or network partition recovery.
 *     tags: [Replication]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dryRun: { type: boolean, default: false }
 *               jobIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Reconciliation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 report:
 *                   type: object
 *                   properties:
 *                     totalChecked: { type: number, example: 42 }
 *                     reconciled: { type: number, example: 0 }
 *                     discrepancies: { type: array, items: { type: object } }
 *                     durationMs: { type: number, example: 120 }
 */
router.post("/reconcile", verifyJWT, requireAdminRole, async (req, res) => {
  try {
    const { dryRun, jobIds } = req.body || {};
    const report = await defaultChainReconciliationService.reconcileEscrows({ dryRun, jobIds });
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replication/fence:
 *   post:
 *     summary: Manually fence a node or region
 *     description: >
 *       Switches local region into FENCED_READ_ONLY mode, draining in-flight write connections
 *       and rejecting Class 1 financial writes to prepare for maintenance or disaster recovery.
 *     tags: [Replication]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Node successfully fenced
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 status: { type: string, example: fenced }
 */
router.post("/fence", verifyJWT, requireAdminRole, async (req, res) => {
  try {
    const result = await defaultFencingService.fence();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replication/promote:
 *   post:
 *     summary: Promote region to active financial authority
 *     description: >
 *       Acquires the global financial authority fencing lease with an incremented generation token,
 *       enabling Class 1 financial writes on this region.
 *     tags: [Replication]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Region successfully promoted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 generationToken: { type: number, example: 2 }
 *                 expiresAt: { type: string, format: date-time }
 */
router.post("/promote", verifyJWT, requireAdminRole, async (req, res) => {
  try {
    const result = await defaultFencingService.promote();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
