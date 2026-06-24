/**
 * src/routes/referrals.js
 *
 * GET  /api/referrals/info                   — public: bonus tiers info
 * GET  /api/referrals/:publicKey             — flat stats + history (auth)
 * GET  /api/referrals/:publicKey/tree        — full referral tree (auth)
 * POST /api/referrals/register               — record a new referral on signup
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const {
  registerReferral,
  getReferralStats,
  getReferralTree,
  REFERRAL_BONUS_BPS,
  LEVEL_BPS,
  PLATFORM_FEE_BPS,
} = require("../services/referralService");

const router = express.Router();
const generalRateLimiter = createRateLimiter(60, 1);

/**
 * @swagger
 * /api/referrals/info:
 *   get:
 *     summary: Get referral bonus tier information
 *     tags: [Referrals]
 *     responses:
 *       200:
 *         description: Bonus tier details
 */
router.get("/info", (req, res) => {
  res.json({
    success: true,
    data: {
      bonusBps: REFERRAL_BONUS_BPS,
      bonusPercent: (REFERRAL_BONUS_BPS / 100).toFixed(0),
      levelBps: LEVEL_BPS,
      levels: LEVEL_BPS.map((bps, i) => ({
        level: i + 1,
        bps,
        percent: (bps / 100).toFixed(2),
        description: i === 0
          ? "Direct referral"
          : i === 1
          ? "Referral of your referral"
          : "3rd-degree referral",
      })),
      description: `Earn up to ${LEVEL_BPS.reduce((a, b) => a + b, 0) / 100}% in multi-level referral bonuses`,
      // ISSUE-17: platform fee split — applies to escrows whose freelancer has
      // no multi-level tree registration. Routed to the escrow's referrer if
      // one was set when the job was posted, otherwise to the platform.
      platformFeeBps: PLATFORM_FEE_BPS,
      platformFeePercent: (PLATFORM_FEE_BPS / 100).toFixed(0),
    },
  });
});

/**
 * @swagger
 * /api/referrals/{publicKey}:
 *   get:
 *     summary: Get flat referral stats and history for a user
 *     tags: [Referrals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema: { type: string }
 */
router.get(
  "/:publicKey",
  verifyJWT,
  generalRateLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.params;

      if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
        return res.status(400).json({ success: false, error: "Invalid public key" });
      }
      if (req.user?.publicKey && req.user.publicKey !== publicKey) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }

      const stats = await getReferralStats(publicKey);
      res.json({ success: true, data: stats });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @swagger
 * /api/referrals/{publicKey}/tree:
 *   get:
 *     summary: Get the full referral tree rooted at publicKey (for visualization)
 *     tags: [Referrals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema: { type: string }
 */
router.get(
  "/:publicKey/tree",
  verifyJWT,
  generalRateLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.params;

      if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
        return res.status(400).json({ success: false, error: "Invalid public key" });
      }
      if (req.user?.publicKey && req.user.publicKey !== publicKey) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }

      const tree = await getReferralTree(publicKey);
      res.json({ success: true, data: tree });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @swagger
 * /api/referrals/register:
 *   post:
 *     summary: Record a new referral relationship
 *     tags: [Referrals]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [referrerAddress, refereeAddress]
 *             properties:
 *               referrerAddress: { type: string }
 *               refereeAddress:  { type: string }
 */
router.post("/register", generalRateLimiter, async (req, res, next) => {
  try {
    const { referrerAddress, refereeAddress } = req.body;

    if (!referrerAddress || !refereeAddress) {
      return res.status(400).json({
        success: false,
        error: "referrerAddress and refereeAddress are required",
      });
    }

    const referral = await registerReferral(referrerAddress, refereeAddress);
    res.json({
      success: true,
      data: referral,
      message: referral ? "Referral registered" : "Referral already exists",
    });
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({ success: false, error: e.message });
    }
    next(e);
  }
});

module.exports = router;
