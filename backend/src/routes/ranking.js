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
 * @swagger
 * /api/ranking/jobs/{publicKey}:
 *   get:
 *     summary: Get ML-ranked job recommendations for a freelancer
 *     description: >
 *       Returns open jobs ranked by predicted fit for the given freelancer.
 *       Falls back to the baseline recommendation algorithm (and marks
 *       `meta.source` as "baseline") when ML ranking is disabled via
 *       `ML_RANKING_ENABLED` or the freelancer is a cold-start case (fewer
 *       completed jobs than `ML_RANKING_COLD_START_MIN_HISTORY`). Rate
 *       limited to 60 requests per minute per IP.
 *     tags: [Ranking]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Freelancer's Stellar public key (G-address)
 *         example: GAQZ2FBK2QT4C7GNTVJXQY4V6V32SHZ2JQVGZ2X5X5KY3XKPZ5N6HXFO
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *         description: Maximum number of jobs to return (clamped between 1 and 50)
 *         example: 10
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Ranked open jobs with match scores and ranking metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       title: { type: string }
 *                       description: { type: string }
 *                       budget: { type: number }
 *                       currency: { type: string, example: XLM }
 *                       category: { type: string }
 *                       skills:
 *                         type: array
 *                         items: { type: string }
 *                       status: { type: string, example: open }
 *                       clientAddress: { type: string }
 *                       matchScore: { type: number, example: 87 }
 *                       rankingSource: { type: string, enum: [ml, baseline] }
 *                       predictions:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           completionProb: { type: number, example: 0.82 }
 *                           expectedRating: { type: number, example: 4.6 }
 *                           estimatedDays: { type: number, example: 5 }
 *                       isExploration: { type: boolean }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     source: { type: string, enum: [ml, baseline] }
 *                     reason: { type: string, example: cold_start }
 *                     latencyMs: { type: number }
 *                     withinBudget: { type: boolean }
 *                     shadowMode: { type: boolean }
 *             example:
 *               success: true
 *               data:
 *                 - id: "3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d"
 *                   title: "Build a Soroban NFT marketplace"
 *                   description: "Need a smart contract dev to build a Soroban-based NFT auction."
 *                   budget: 500
 *                   currency: XLM
 *                   category: "Smart Contracts"
 *                   skills: ["rust", "soroban"]
 *                   status: open
 *                   clientAddress: GDCLIENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                   matchScore: 87
 *                   rankingSource: ml
 *                   predictions:
 *                     completionProb: 0.82
 *                     expectedRating: 4.6
 *                     estimatedDays: 5
 *                   isExploration: false
 *               meta:
 *                 source: ml
 *                 latencyMs: 42
 *                 withinBudget: true
 *                 shadowMode: false
 *       400:
 *         description: publicKey is not a valid Stellar address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
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
 * @swagger
 * /api/ranking/freelancers/{jobId}:
 *   get:
 *     summary: Get ML-ranked freelancer recommendations for a job
 *     description: >
 *       Returns candidate freelancers ranked by predicted fit for the given
 *       job. Falls back to a baseline ranking (most completed jobs / most
 *       recently active) when ML ranking is disabled via
 *       `ML_RANKING_ENABLED`. Rate limited to 60 requests per minute per IP.
 *     tags: [Ranking]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the job to find candidate freelancers for
 *         example: 3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *         description: Maximum number of freelancers to return (clamped between 1 and 50)
 *         example: 10
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Ranked freelancer profiles with match scores and ranking metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       publicKey: { type: string }
 *                       displayName: { type: string }
 *                       bio: { type: string }
 *                       skills:
 *                         type: array
 *                         items: { type: string }
 *                       completedJobs: { type: integer }
 *                       rating: { type: number }
 *                       role: { type: string }
 *                       matchScore: { type: number, example: 91 }
 *                       rankingSource: { type: string, enum: [ml, baseline] }
 *                       predictions:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           completionProb: { type: number, example: 0.88 }
 *                           expectedRating: { type: number, example: 4.8 }
 *                           estimatedDays: { type: number, example: 4 }
 *                       isExploration: { type: boolean }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     source: { type: string, enum: [ml, baseline] }
 *                     reason: { type: string, example: model_disabled }
 *                     latencyMs: { type: number }
 *                     withinBudget: { type: boolean }
 *                     shadowMode: { type: boolean }
 *             example:
 *               success: true
 *               data:
 *                 - publicKey: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                   displayName: "Jane Dev"
 *                   bio: "Rust and Soroban contract engineer"
 *                   skills: ["rust", "soroban"]
 *                   completedJobs: 12
 *                   rating: 4.8
 *                   role: freelancer
 *                   matchScore: 91
 *                   rankingSource: ml
 *                   predictions:
 *                     completionProb: 0.88
 *                     expectedRating: 4.8
 *                     estimatedDays: 4
 *                   isExploration: false
 *               meta:
 *                 source: ml
 *                 latencyMs: 37
 *                 withinBudget: true
 *                 shadowMode: false
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
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

/**
 * @swagger
 * /api/ranking/health:
 *   get:
 *     summary: Get ML ranking service configuration/health
 *     description: >
 *       Returns the current ML ranking configuration flags read from
 *       environment variables. Not rate limited and requires no
 *       authentication.
 *     tags: [Ranking]
 *     responses:
 *       200:
 *         description: Current ML ranking configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     enabled: { type: boolean }
 *                     shadowMode: { type: boolean }
 *                     latencyBudgetMs: { type: number }
 *                     coldStartMinHistory: { type: number }
 *                     explorationBudget: { type: number }
 *             example:
 *               success: true
 *               data:
 *                 enabled: true
 *                 shadowMode: false
 *                 latencyBudgetMs: 200
 *                 coldStartMinHistory: 2
 *                 explorationBudget: 0.15
 */
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

/**
 * @swagger
 * /api/ranking/shadow-stats:
 *   get:
 *     summary: Get shadow-mode ML ranking statistics
 *     description: >
 *       Returns aggregated statistics (over the last 7 days) comparing ML
 *       ranking against the baseline fallback, grouped by ranking mode
 *       (`jobs_for_freelancer` or `freelancers_for_job`). Used to evaluate
 *       ML ranking performance in shadow mode before fully enabling it.
 *       Rate limited to 60 requests per minute per IP.
 *     tags: [Ranking]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Shadow-mode statistics grouped by ranking mode
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       mode:
 *                         type: string
 *                         enum: [jobs_for_freelancer, freelancers_for_job]
 *                       total: { type: integer, example: 1420 }
 *                       avg_latency_ms: { type: number, example: 38.5 }
 *                       fallback_count: { type: integer, example: 120 }
 *                       ml_count: { type: integer, example: 1300 }
 *             example:
 *               success: true
 *               data:
 *                 - mode: freelancers_for_job
 *                   total: 1420
 *                   avg_latency_ms: 38.5
 *                   fallback_count: 120
 *                   ml_count: 1300
 *                 - mode: jobs_for_freelancer
 *                   total: 980
 *                   avg_latency_ms: 41.2
 *                   fallback_count: 60
 *                   ml_count: 920
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/shadow-stats", rankingRateLimiter, async (_req, res, next) => {
  try {
    const stats = await getShadowModeStats();
    res.json({ success: true, data: stats });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/ranking/fairness-audit:
 *   get:
 *     summary: Get fairness audit for ML-ranked freelancer exposure
 *     description: >
 *       Computes, from the last 30 days of non-fallback
 *       `freelancers_for_job` shadow events, the share of ranking
 *       impressions received by "new" freelancers (fewer completed jobs
 *       than `ML_RANKING_COLD_START_MIN_HISTORY` + 1) versus "established"
 *       freelancers, to detect whether the ML model is starving newcomers
 *       of exposure. Rate limited to 60 requests per minute per IP.
 *     tags: [Ranking]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Fairness audit result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     newFreelancerShare:
 *                       type: number
 *                       example: 0.22
 *                     establishedFreelancerShare:
 *                       type: number
 *                       example: 0.78
 *                     explorationBudget:
 *                       type: number
 *                       example: 0.15
 *                     mitigation:
 *                       type: string
 *                       example: exploration_boost_and_reserved_slots
 *             example:
 *               success: true
 *               data:
 *                 newFreelancerShare: 0.22
 *                 establishedFreelancerShare: 0.78
 *                 explorationBudget: 0.15
 *                 mitigation: exploration_boost_and_reserved_slots
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
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
 * @swagger
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
 * @swagger
 * /api/ranking/model-registry:
 *   get:
 *     summary: Model registry status and version history
 *     tags: [Ranking]
 *     responses:
 *       200:
 *         description: Model registry status and version history
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
 * @swagger
 * /api/ranking/rollback/{version}:
 *   post:
 *     summary: Roll back to a previous model version
 *     tags: [Ranking]
 *     parameters:
 *       - in: path
 *         name: version
 *         required: true
 *         schema:
 *           type: string
 *         description: Model version identifier to roll back to
 *     responses:
 *       200:
 *         description: Rollback succeeded
 *       400:
 *         description: Rollback failed
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
