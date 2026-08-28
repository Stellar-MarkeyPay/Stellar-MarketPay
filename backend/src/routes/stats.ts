/**
 * Platform statistics routes for Issue #232: analytics dashboard
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const statsService = require("../services/statsService");
const { getXlmUsd7dHistory, PRICE_HISTORY_TTL_SECONDS } = require("../services/xlmPriceService");

const statsRateLimiter = createRateLimiter(30, 1); // 30 requests per minute

/**
 * @swagger
 * /api/stats:
 *   get:
 *     summary: Get platform-wide metrics
 *     description: >
 *       Returns cached platform-wide statistics from the `platform_stats`
 *       table (total jobs posted, active users, escrow volume, average job
 *       budget, and completion rate). If no row exists yet, the statistics
 *       are computed on the fly from the underlying tables and persisted.
 *       Rate limited to 30 requests per minute per IP.
 *     tags: [Stats]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Platform-wide statistics
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
 *                     total_jobs_posted: { type: integer, example: 1523 }
 *                     total_escrow_xlm: { type: number, example: 48210.5 }
 *                     active_users_30d: { type: integer, example: 342 }
 *                     completion_rate: { type: number, example: 87.4 }
 *                     avg_job_budget: { type: number, example: 215.75 }
 *                     last_updated:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 total_jobs_posted: 1523
 *                 total_escrow_xlm: 48210.5
 *                 active_users_30d: 342
 *                 completion_rate: 87.4
 *                 avg_job_budget: 215.75
 *                 last_updated: "2026-08-20T12:00:00.000Z"
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/stats — get platform-wide metrics
router.get("/", statsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const stats = await statsService.getStats();
    res.json({ success: true, data: stats });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/stats/trends/jobs:
 *   get:
 *     summary: Get job posting trends over time
 *     description: >
 *       Returns daily job posting counts and average budget for the
 *       requested trailing window, newest day first. Rate limited to 30
 *       requests per minute per IP.
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: days
 *         required: false
 *         schema:
 *           type: integer
 *           default: 90
 *           maximum: 365
 *         description: Number of trailing days to include (capped at 365)
 *         example: 30
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Daily job posting trends
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
 *                       date: { type: string, format: date }
 *                       jobs_posted: { type: integer, example: 12 }
 *                       avg_budget: { type: number, example: 240.5 }
 *             example:
 *               success: true
 *               data:
 *                 - date: "2026-08-20"
 *                   jobs_posted: 12
 *                   avg_budget: 240.5
 *                 - date: "2026-08-19"
 *                   jobs_posted: 8
 *                   avg_budget: 190.0
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/stats/trends/jobs — job posting trends over time
router.get("/trends/jobs", statsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const trends = await statsService.getJobTrends(days);
    res.json({ success: true, data: trends });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/stats/trends/escrow:
 *   get:
 *     summary: Get escrow volume trends over time
 *     description: >
 *       Returns daily escrow creation counts and total escrowed XLM amount
 *       for the requested trailing window, newest day first. Rate limited
 *       to 30 requests per minute per IP.
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: days
 *         required: false
 *         schema:
 *           type: integer
 *           default: 90
 *           maximum: 365
 *         description: Number of trailing days to include (capped at 365)
 *         example: 30
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Daily escrow volume trends
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
 *                       date: { type: string, format: date }
 *                       escrow_count: { type: integer, example: 5 }
 *                       total_amount: { type: number, example: 1250.75 }
 *             example:
 *               success: true
 *               data:
 *                 - date: "2026-08-20"
 *                   escrow_count: 5
 *                   total_amount: 1250.75
 *                 - date: "2026-08-19"
 *                   escrow_count: 3
 *                   total_amount: 620.0
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/stats/trends/escrow — escrow volume trends
router.get("/trends/escrow", statsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const trends = await statsService.getEscrowTrends(days);
    res.json({ success: true, data: trends });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/stats/categories:
 *   get:
 *     summary: Get top job categories
 *     description: >
 *       Returns the most active job categories (by job count), including
 *       the average budget per category, ordered by job count descending.
 *       Only counts jobs with status open, assigned, in_progress, or
 *       completed. Rate limited to 30 requests per minute per IP.
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Maximum number of categories to return (capped at 50)
 *         example: 10
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Top job categories
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
 *                       category: { type: string, example: "Smart Contracts" }
 *                       job_count: { type: integer, example: 87 }
 *                       avg_budget: { type: number, example: 310.25 }
 *             example:
 *               success: true
 *               data:
 *                 - category: "Smart Contracts"
 *                   job_count: 87
 *                   avg_budget: 310.25
 *                 - category: "Web Development"
 *                   job_count: 64
 *                   avg_budget: 180.0
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/stats/categories — top job categories
router.get("/categories", statsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const categories = await statsService.getTopCategories(limit);
    res.json({ success: true, data: categories });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/stats/xlm-price-history:
 *   get:
 *     summary: Get 7-day XLM/USD price history
 *     description: >
 *       Returns a 7-day XLM/USD price series sourced from the CoinGecko
 *       market chart API, along with the current price and 24h percent
 *       change. Results are cached for 5 minutes server-side (reflected in
 *       the `cached` field and a `Cache-Control: public, max-age=300`
 *       response header). Rate limited to 30 requests per minute per IP.
 *     tags: [Stats]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: 7-day XLM/USD price history
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
 *                     points:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           timestamp: { type: number, example: 1755648000000 }
 *                           priceUsd: { type: number, example: 0.1123 }
 *                     currentPriceUsd:
 *                       type: number
 *                       nullable: true
 *                       example: 0.1123
 *                     change24hPercent:
 *                       type: number
 *                       nullable: true
 *                       example: 2.35
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                     cached:
 *                       type: boolean
 *                       description: Whether this response was served from the 5-minute cache
 *             example:
 *               success: true
 *               data:
 *                 points:
 *                   - timestamp: 1755561600000
 *                     priceUsd: 0.1098
 *                   - timestamp: 1755648000000
 *                     priceUsd: 0.1123
 *                 currentPriceUsd: 0.1123
 *                 change24hPercent: 2.35
 *                 updatedAt: "2026-08-20T00:00:00.000Z"
 *                 cached: false
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Failed to fetch price data from CoinGecko
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "CoinGecko request failed: 503"
 */
// GET /api/stats/xlm-price-history — 7-day XLM/USD history for dashboard widget
router.get("/xlm-price-history", statsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const data = await getXlmUsd7dHistory();
    res.set("Cache-Control", `public, max-age=${PRICE_HISTORY_TTL_SECONDS}`);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

export {};
