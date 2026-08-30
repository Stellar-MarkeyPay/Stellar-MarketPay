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
 *     description: Public endpoint describing the multi-level referral bonus structure.
 *     tags: [Referrals]
 *     responses:
 *       200:
 *         description: Bonus tier details
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
 *                     bonusBps: { type: integer }
 *                     bonusPercent: { type: string }
 *                     levelBps:
 *                       type: array
 *                       items: { type: integer }
 *                     levels:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           level: { type: integer }
 *                           bps: { type: integer }
 *                           percent: { type: string }
 *                           description: { type: string }
 *                     description: { type: string }
 *                     platformFeeBps: { type: integer }
 *                     platformFeePercent: { type: string }
 *             example:
 *               success: true
 *               data:
 *                 bonusBps: 500
 *                 bonusPercent: "5"
 *                 levelBps: [500, 200, 100]
 *                 levels:
 *                   - { level: 1, bps: 500, percent: "5.00", description: Direct referral }
 *                   - { level: 2, bps: 200, percent: "2.00", description: Referral of your referral }
 *                   - { level: 3, bps: 100, percent: "1.00", description: 3rd-degree referral }
 *                 description: Earn up to 8% in multi-level referral bonuses
 *                 platformFeeBps: 100
 *                 platformFeePercent: "1"
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
        description:
          i === 0
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
 *     description: >
 *       Returns referral stats for the given Stellar public key. The
 *       authenticated caller may only fetch their own stats.
 *     tags: [Referrals]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key to fetch referral stats for
 *         example: GREFERRER123456789012345678901234567890123456789012345
 *     responses:
 *       200:
 *         description: Referral stats retrieved successfully
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
 *                   description: Referral stats as returned by getReferralStats
 *             example:
 *               success: true
 *               data: { totalReferrals: 3, totalBonusEarnedBps: 150 }
 *       400:
 *         description: Invalid public key format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             example:
 *               success: false
 *               error: Invalid public key
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden - caller does not match the requested publicKey
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string, example: Forbidden }
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/:publicKey", verifyJWT, generalRateLimiter, async (req, res, next) => {
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
});

/**
 * @swagger
 * /api/referrals/{publicKey}/tree:
 *   get:
 *     summary: Get the full referral tree rooted at publicKey (for visualization)
 *     description: >
 *       Returns the full multi-level referral tree for the given Stellar
 *       public key. The authenticated caller may only fetch their own tree.
 *     tags: [Referrals]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key to fetch the referral tree for
 *         example: GREFERRER123456789012345678901234567890123456789012345
 *     responses:
 *       200:
 *         description: Referral tree retrieved successfully
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
 *                   description: Referral tree as returned by getReferralTree
 *             example:
 *               success: true
 *               data: { publicKey: "GREFERRER123456789012345678901234567890123456789012345", children: [] }
 *       400:
 *         description: Invalid public key format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             example:
 *               success: false
 *               error: Invalid public key
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden - caller does not match the requested publicKey
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string, example: Forbidden }
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/:publicKey/tree", verifyJWT, generalRateLimiter, async (req, res, next) => {
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
});

/**
 * @swagger
 * /api/referrals/register:
 *   post:
 *     summary: Record a new referral relationship
 *     description: Registers that refereeAddress was referred by referrerAddress, idempotently.
 *     tags: [Referrals]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [referrerAddress, refereeAddress]
 *             properties:
 *               referrerAddress:
 *                 type: string
 *                 description: Stellar address of the referrer
 *               refereeAddress:
 *                 type: string
 *                 description: Stellar address of the newly-referred user
 *           example:
 *             referrerAddress: GREFERRER123456789012345678901234567890123456789012345
 *             refereeAddress: GREFEREE1234567890123456789012345678901234567890123456
 *     responses:
 *       200:
 *         description: Referral registered (or already existed)
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
 *                   nullable: true
 *                   description: The created referral record, or null if it already existed
 *                 message:
 *                   type: string
 *             example:
 *               success: true
 *               data: { referrerAddress: "GREFERRER123456789012345678901234567890123456789012345", refereeAddress: "GREFEREE1234567890123456789012345678901234567890123456" }
 *               message: Referral registered
 *       400:
 *         description: Missing referrerAddress or refereeAddress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string, example: referrerAddress and refereeAddress are required }
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
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
