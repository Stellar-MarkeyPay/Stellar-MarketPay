"use strict";

const express = require("express");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { analyzeBidEvent, getJobFraudStats } = require("../services/fraudDetectionService");

const router = express.Router();
const fraudRateLimiter = createRateLimiter(60, 1);

/**
 * @swagger
 * /api/fraud/bids:
 *   post:
 *     summary: Analyze a bid/application event for fraud signals (admin only)
 *     description: >
 *       Runs a bid through the in-memory fraud-detection rule engine (bid-spam per freelancer,
 *       bid-spam per job, extreme bid-to-budget ratio, and statistical amount-outlier
 *       detection). When one or more rules trigger, an alert is created, persisted to
 *       `fraud_alerts` (best-effort — persistence failures are logged and swallowed), and the
 *       response status is 201 instead of 200. Admin-only: requires a JWT with `role: admin`.
 *     tags: [Fraud]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - freelancerAddress
 *               - bidAmount
 *             properties:
 *               jobId:
 *                 type: string
 *                 example: "3f1b2c4d-5678-90ab-cdef-1234567890ab"
 *               applicationId:
 *                 type: string
 *                 nullable: true
 *                 example: "9a8b7c6d-5432-10fe-dcba-0987654321fe"
 *               freelancerAddress:
 *                 type: string
 *                 example: GFREELANCERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *               bidAmount:
 *                 type: number
 *                 description: Must be a positive number
 *                 example: 150
 *               currency:
 *                 type: string
 *                 default: XLM
 *                 example: XLM
 *               jobBudget:
 *                 type: number
 *                 description: Optional; if provided, must be a positive number
 *                 example: 500
 *               sourceIp:
 *                 type: string
 *                 description: Hashed (SHA-256) before persistence; never stored in plaintext
 *                 example: "203.0.113.42"
 *               userAgent:
 *                 type: string
 *                 example: "Mozilla/5.0"
 *     responses:
 *       200:
 *         description: Bid analyzed, no fraud rules triggered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     flagged: { type: boolean, example: false }
 *                     riskScore: { type: number, example: 0 }
 *                     rules: { type: array, items: { type: object }, example: [] }
 *                     alert: { nullable: true, example: null }
 *                     job:
 *                       type: object
 *                       properties:
 *                         recentBidCount: { type: integer, example: 1 }
 *                         count: { type: integer, example: 1 }
 *                         mean: { type: number, nullable: true, example: 150 }
 *                         min: { type: string, nullable: true, example: "150.0000000" }
 *                         max: { type: string, nullable: true, example: "150.0000000" }
 *                         stdDev: { type: number, nullable: true, example: 0 }
 *                     freelancer:
 *                       type: object
 *                       properties:
 *                         recentBidCount: { type: integer, example: 1 }
 *       201:
 *         description: Bid analyzed and flagged by one or more fraud rules; an alert was created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     flagged: { type: boolean, example: true }
 *                     riskScore: { type: number, example: 90 }
 *                     rules:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           ruleCode: { type: string, example: EXTREME_HIGH_BID }
 *                           severity: { type: string, example: high }
 *                           reason: { type: string, example: "Bid is 3.50x the job budget" }
 *                           riskScore: { type: number, example: 90 }
 *                           context: { type: object }
 *                     alert:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         jobId: { type: string }
 *                         applicationId: { type: string, nullable: true }
 *                         freelancerAddress: { type: string }
 *                         bidAmount: { type: string, example: "1750.0000000" }
 *                         currency: { type: string, example: XLM }
 *                         ruleCode: { type: string, example: EXTREME_HIGH_BID }
 *                         severity: { type: string, example: high }
 *                         reason: { type: string }
 *                         riskScore: { type: number, example: 90 }
 *                         rules: { type: array, items: { type: object } }
 *                         context: { type: object }
 *                         sourceIpHash: { type: string, nullable: true }
 *                         userAgent: { type: string, nullable: true }
 *                         createdAt: { type: string, format: date-time }
 *                     job:
 *                       type: object
 *                       properties:
 *                         recentBidCount: { type: integer, example: 1 }
 *                         count: { type: integer, example: 1 }
 *                         mean: { type: number, nullable: true, example: 1750 }
 *                         min: { type: string, nullable: true, example: "1750.0000000" }
 *                         max: { type: string, nullable: true, example: "1750.0000000" }
 *                         stdDev: { type: number, nullable: true, example: 0 }
 *                     freelancer:
 *                       type: object
 *                       properties:
 *                         recentBidCount: { type: integer, example: 1 }
 *       400:
 *         description: Missing `jobId`/`freelancerAddress`, or `bidAmount`/`jobBudget` is not a positive number
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: bidAmount must be a positive number
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Unexpected error while analyzing the bid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/bids", fraudRateLimiter, verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const result = await analyzeBidEvent({
      jobId: req.body.jobId,
      applicationId: req.body.applicationId,
      freelancerAddress: req.body.freelancerAddress,
      bidAmount: req.body.bidAmount,
      currency: req.body.currency,
      jobBudget: req.body.jobBudget,
      sourceIp: req.body.sourceIp,
      userAgent: req.body.userAgent,
    });

    res.status(result.flagged ? 201 : 200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/fraud/jobs/{jobId}/stats:
 *   get:
 *     summary: Get fraud-detection statistics for a job (admin only)
 *     description: >
 *       Returns the in-memory bid-window statistics tracked by the fraud-detection rule engine
 *       for a job (recent bid count, amount stats, the configured rule thresholds, and any
 *       freelancers currently exceeding the per-freelancer bid-spam limit). State is
 *       process-local and resets on server restart. Admin-only: requires a JWT with
 *       `role: admin`.
 *     tags: [Fraud]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID to fetch fraud statistics for
 *         example: "3f1b2c4d-5678-90ab-cdef-1234567890ab"
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId: { type: string, example: "3f1b2c4d-5678-90ab-cdef-1234567890ab" }
 *                     windowMs: { type: number, example: 300000 }
 *                     recentBidCount: { type: integer, example: 4 }
 *                     count: { type: integer, example: 4 }
 *                     mean: { type: number, nullable: true, example: 320.5 }
 *                     min: { type: string, nullable: true, example: "100.0000000" }
 *                     max: { type: string, nullable: true, example: "500.0000000" }
 *                     stdDev: { type: number, nullable: true, example: 45.2 }
 *                     rules:
 *                       type: object
 *                       description: The fraud-detection rule thresholds currently configured on the server (not the rules that fired)
 *                       properties:
 *                         windowMs: { type: number, example: 300000 }
 *                         maxFreelancerBidsPerWindow: { type: number, example: 5 }
 *                         maxJobBidsPerWindow: { type: number, example: 20 }
 *                         maxBidToBudgetRatio: { type: number, example: 3 }
 *                         minBidToBudgetRatio: { type: number, example: 0.05 }
 *                         maxAmountZScore: { type: number, example: 3.5 }
 *                         minJobBidsForAmountStats: { type: number, example: 3 }
 *                     flaggedFreelancers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           freelancerAddress: { type: string, example: GFREELANCERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX }
 *                           recentBidCount: { type: integer, example: 6 }
 *       400:
 *         description: Missing `jobId` path parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: jobId is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get(
  "/jobs/:jobId/stats",
  fraudRateLimiter,
  verifyJWT,
  requireAdminRole,
  async (req, res, next) => {
    try {
      const stats = getJobFraudStats(req.params.jobId);
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
