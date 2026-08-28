"use strict";

const express = require("express");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { analyzeBidEvent, getJobFraudStats } = require("../services/fraudDetectionService");

const router = express.Router();
const fraudRateLimiter = createRateLimiter(60, 1);

router.post(
  "/bids",
  fraudRateLimiter,
  verifyJWT,
  requireAdminRole,
  async (req: any, res: any, next: any) => {
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
  }
);

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
  async (req: any, res: any, next: any) => {
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

export {};
