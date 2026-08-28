/**
 * src/routes/turrets.js
 * Stellar Turrets routes for serverless contract execution
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  submitTransaction,
  getTurretStatus,
  estimateTurretFee,
  shouldUseTurret,
} = require("../services/turretsService");

// Rate limiting: 10 requests per minute for transaction submissions
const turretRateLimiter = createRateLimiter(10, 60);

/**
 * @swagger
 * /api/turrets/submit:
 *   post:
 *     summary: Submit a signed transaction via Stellar Turret
 *     description: >
 *       Submits the signed transaction XDR to the Stellar Turret
 *       serverless network. If Turret submission fails for any reason, it
 *       automatically falls back to direct submission via Horizon (the
 *       `turretUsed` field in the response indicates which path was used).
 *       Rate limited to 10 requests per 60 minutes per IP.
 *     tags: [Turrets]
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 60
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionXDR
 *             properties:
 *               transactionXDR:
 *                 type: string
 *                 description: Base64-encoded signed transaction envelope XDR
 *               useTurret:
 *                 type: boolean
 *                 description: Set to false to skip Turret and prefer direct submission behavior downstream
 *           example:
 *             transactionXDR: "AAAAAgAAAAB7...signed-transaction-envelope-xdr...=="
 *             useTurret: true
 *     responses:
 *       200:
 *         description: Transaction submitted successfully (via Turret or direct fallback)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     success: { type: boolean, example: true }
 *                     hash: { type: string }
 *                     ledger: { type: integer }
 *                     feeCharged: { type: string, example: "100" }
 *                     turretUsed: { type: boolean }
 *                     message: { type: string }
 *             example:
 *               success: true
 *               data:
 *                 success: true
 *                 hash: "a1b2c3d4e5f6..."
 *                 ledger: 48213012
 *                 feeCharged: "100"
 *                 turretUsed: true
 *                 message: "Transaction submitted via Stellar Turret"
 *       400:
 *         description: Transaction XDR is missing from the request body
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             example:
 *               success: false
 *               error: Transaction XDR is required
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Both Turret submission and the direct Horizon fallback failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Both Turret and direct submission failed: timeout"
 */
router.post("/submit", turretRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const { transactionXDR, useTurret } = req.body;

    if (!transactionXDR) {
      return res.status(400).json({
        success: false,
        error: "Transaction XDR is required",
      });
    }

    const options = { useTurret };
    const result = await submitTransaction(transactionXDR, options);

    res.json({
      success: true,
      data: result,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/turrets/status:
 *   get:
 *     summary: Get Stellar Turret service status
 *     description: >
 *       Reports whether a Turret URL is configured and, if so, pings the
 *       Turret's own status endpoint to check availability, network, and
 *       fee-sponsorship support. Not rate limited.
 *     tags: [Turrets]
 *     responses:
 *       200:
 *         description: Turret service status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     available: { type: boolean }
 *                     url: { type: string, nullable: true }
 *                     network: { type: string, example: testnet }
 *                     version: { type: string, example: "1.2.0" }
 *                     feeSponsorship: { type: boolean }
 *                     message: { type: string }
 *                     error: { type: string, nullable: true, description: "Present only when available is false due to an error" }
 *             examples:
 *               available:
 *                 value:
 *                   success: true
 *                   data:
 *                     available: true
 *                     url: "https://tss.stellar.org"
 *                     network: testnet
 *                     version: "1.2.0"
 *                     feeSponsorship: false
 *                     message: "Turret service available"
 *               unavailable:
 *                 value:
 *                   success: true
 *                   data:
 *                     available: false
 *                     url: "https://tss.stellar.org"
 *                     message: "Turret service unavailable"
 *                     error: "connect ECONNREFUSED"
 *               notConfigured:
 *                 value:
 *                   success: true
 *                   data:
 *                     available: false
 *                     message: "Turret not configured"
 */
router.get("/status", async (req: any, res: any, next: any) => {
  try {
    const status = await getTurretStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/turrets/estimate:
 *   post:
 *     summary: Estimate transaction fees via Stellar Turret
 *     description: >
 *       Asks the Turret service to estimate the base fee, Turret fee, and
 *       total fee for an unsigned transaction. If the Turret call fails,
 *       this endpoint does not error — it returns a default fee estimate
 *       (`success: false` inside `data`, base/total fee `"100"`) with a
 *       message explaining the fallback. Rate limited to 10 requests per
 *       60 minutes per IP.
 *     tags: [Turrets]
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 60
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionXDR
 *             properties:
 *               transactionXDR:
 *                 type: string
 *                 description: Base64-encoded unsigned transaction envelope XDR
 *           example:
 *             transactionXDR: "AAAAAgAAAAB7...unsigned-transaction-envelope-xdr...=="
 *     responses:
 *       200:
 *         description: Fee estimation (either from Turret or a default fallback estimate)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     success: { type: boolean }
 *                     baseFee: { type: string, example: "100" }
 *                     turretFee: { type: string, example: "50" }
 *                     totalFee: { type: string, example: "150" }
 *                     feeSponsored: { type: boolean }
 *                     message: { type: string, description: "Present only on the fallback default estimate" }
 *             examples:
 *               turretEstimate:
 *                 value:
 *                   success: true
 *                   data:
 *                     success: true
 *                     baseFee: "100"
 *                     turretFee: "50"
 *                     totalFee: "150"
 *                     feeSponsored: false
 *               fallbackDefault:
 *                 value:
 *                   success: true
 *                   data:
 *                     success: false
 *                     baseFee: "100"
 *                     turretFee: "0"
 *                     totalFee: "100"
 *                     feeSponsored: false
 *                     message: "Unable to estimate Turret fees, using default"
 *       400:
 *         description: Transaction XDR is missing from the request body
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             example:
 *               success: false
 *               error: Transaction XDR is required
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Turret URL is not configured on the server
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Turret URL not configured
 */
router.post("/estimate", turretRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const { transactionXDR } = req.body;

    if (!transactionXDR) {
      return res.status(400).json({
        success: false,
        error: "Transaction XDR is required",
      });
    }

    const estimation = await estimateTurretFee(transactionXDR);
    res.json({
      success: true,
      data: estimation,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/turrets/config:
 *   get:
 *     summary: Get Turret configuration
 *     description: >
 *       Returns whether a Turret URL and API key are configured on the
 *       server (the API key itself is never returned), the configured
 *       Turret URL (or null), and whether Turret should be used by
 *       default. Not rate limited.
 *     tags: [Turrets]
 *     responses:
 *       200:
 *         description: Turret configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     configured: { type: boolean }
 *                     url: { type: string, nullable: true }
 *                     hasApiKey: { type: boolean }
 *                     shouldUseByDefault: { type: boolean }
 *             example:
 *               success: true
 *               data:
 *                 configured: true
 *                 url: "https://tss.stellar.org"
 *                 hasApiKey: true
 *                 shouldUseByDefault: true
 */
router.get("/config", (req: any, res: any) => {
  const TURRET_URL = process.env.TURRET_URL;
  const TURRET_API_KEY = process.env.TURRET_API_KEY;

  res.json({
    success: true,
    data: {
      configured: !!TURRET_URL,
      url: TURRET_URL || null,
      hasApiKey: !!TURRET_API_KEY,
      shouldUseByDefault: shouldUseTurret(),
    },
  });
});

module.exports = router;

export {};
