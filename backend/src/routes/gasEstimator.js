/**
 * src/routes/gasEstimator.js
 *
 * GET /api/gas-estimate
 *   Returns Slow / Medium / Fast fee tiers based on live Horizon fee_stats.
 *
 * GET /api/gas-estimate/refresh
 *   Bypasses the 15-second cache and forces a fresh Horizon fetch.
 *   Intended for use by admins / monitoring; same response shape.
 */
"use strict";

const express = require("express");
const { getGasEstimate } = require("../services/gasEstimatorService");

const router = express.Router();

/**
 * Serialise a GasEstimate response for the wire.
 * BigInt values must be converted to strings for JSON.
 */
function serialiseEstimate(estimate) {
  const tierToJson = (tier) => ({
    feeStroops: tier.feeStroops.toString(),
    feeXlm: tier.feeXlm,
    label: tier.label,
    description: tier.description,
    estimatedWaitLedgers: tier.estimatedWaitLedgers,
  });

  return {
    slow: tierToJson(estimate.slow),
    medium: tierToJson(estimate.medium),
    fast: tierToJson(estimate.fast),
    spikeDetected: estimate.spikeDetected,
    fetchedAt: estimate.fetchedAt,
    cached: estimate.cached,
  };
}

/**
 * @swagger
 * /api/gas-estimate:
 *   get:
 *     summary: Get Soroban fee tier estimates
 *     description: >
 *       Returns Slow, Medium, and Fast fee tiers computed from recent Stellar
 *       Horizon fee_stats.  Results are cached for 15 seconds.
 *     tags: [Gas Estimator]
 *     responses:
 *       200:
 *         description: Fee tier estimates
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GasEstimateResponse'
 *       502:
 *         description: Unable to reach Horizon
 */
router.get("/", async (req, res, next) => {
  try {
    const estimate = await getGasEstimate();
    res.json({ success: true, data: serialiseEstimate(estimate) });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/gas-estimate/refresh:
 *   get:
 *     summary: Force-refresh gas fee estimates (bypass cache)
 *     tags: [Gas Estimator]
 *     responses:
 *       200:
 *         description: Fresh fee tier estimates
 *       502:
 *         description: Unable to reach Horizon
 */
router.get("/refresh", async (req, res, next) => {
  try {
    const estimate = await getGasEstimate({ bustCache: true });
    res.json({ success: true, data: serialiseEstimate(estimate) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
