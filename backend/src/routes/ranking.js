/**
 * ML ranking API routes — predictive match recommendations for jobs and freelancers.
 *
 * Issue #265 — Productionise the ML pipeline
 * Added: drift monitoring, model registry, rollback, deterministic fallback endpoints.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  getRankedJobsForFreelancer,
  getRankedFreelancersForJob,
  getShadowModeStats,
  runFairnessAudit,
  getDriftStatus,
  getModelRegistryInfo,
  rollbackModel,
  CONFIG,
} = require("../services/mlRankingService");

const rankingRateLimiter = createRateLimiter(60, 1);

/**
 * @openapi
 * /api/ranking/jobs/{publicKey}:
 *   get:
 *     summary: ML-ranked job recommendations for a freelancer
 *     tags: [Ranking]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Ranked open jobs with match scores and cold-start fallback metadata
 */
router.get("/jobs/:publicKey", rankingRateLimiter, async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = await getRankedJobsForFreelancer(req.params.publicKey, limit);
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/ranking/freelancers/{jobId}:
 *   get:
 *     summary: ML-ranked freelancer recommendations for a job
 *     tags: [Ranking]
 */
router.get("/freelancers/:jobId", rankingRateLimiter, async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = await getRankedFreelancersForJob(req.params.jobId, limit);
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (e) {
    next(e);
  }
});

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      enabled: CONFIG.enabled,
      shadowMode: CONFIG.shadowMode,
      latencyBudgetMs: CONFIG.latencyBudgetMs,
      coldStartMinHistory: CONFIG.coldStartMinHistory,
      explorationBudget: CONFIG.explorationBudget,
    },
  });
});

router.get("/shadow-stats", rankingRateLimiter, async (_req, res, next) => {
  try {
    const stats = await getShadowModeStats();
    res.json({ success: true, data: stats });
  } catch (e) {
    next(e);
  }
});

router.get("/fairness-audit", rankingRateLimiter, async (_req, res, next) => {
  try {
    const audit = await runFairnessAudit();
    res.json({ success: true, data: audit });
  } catch (e) {
    next(e);
  }
});

// ── New endpoints (Issue #265) ────────────────────────────────────

/**
 * @openapi
 * /api/ranking/drift:
 *   get:
 *     summary: Feature and prediction drift monitoring status
 *     tags: [Ranking]
 *     responses:
 *       200:
 *         description: Drift check results with PSI scores and alerts
 */
router.get("/drift", rankingRateLimiter, async (_req, res, next) => {
  try {
    const status = await getDriftStatus();
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/ranking/model-registry:
 *   get:
 *     summary: Model registry status and version history
 *     tags: [Ranking]
 */
router.get("/model-registry", rankingRateLimiter, async (_req, res, next) => {
  try {
    const info = await getModelRegistryInfo();
    res.json({ success: true, data: info });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/ranking/rollback/{version}:
 *   post:
 *     summary: Roll back to a previous model version
 *     tags: [Ranking]
 */
router.post("/rollback/:version", rankingRateLimiter, async (req, res, next) => {
  try {
    const result = await rollbackModel(req.params.version);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
