import type {
  Database,
  ProfileTable,
  JobTable,
  ApplicationTable,
  JobViewTable,
  PrivateMessageTable,
  EscrowTable,
  ProgressUpdateTable,
  RatingTable,
  MessageTable,
  ReferralTable,
  ReferralPayoutTable,
  ScopeSessionTable,
  WebauthnCredentialTable,
  DisputeEvidenceTable,
  TimeEntryTable,
  TimeInvoiceTable,
  JobInvitationTable,
} from "../db/types";
import { db, rawQuery } from "../db/kysely";
/**
 * src/routes/profiles.js
 */
("use strict");
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const multer = require("multer");
const { uploadFile, getGatewayUrl, MAX_FILE_SIZE } = require("../services/ipfsService");

const profileUpdateRateLimiter = createRateLimiter(5, 1); // 5 profile updates per minute
const generalProfileRateLimiter = createRateLimiter(30, 1); // 100 requests per minute for getting profiles
const cache = require("../services/cacheService");
const { edgeCacheControl, CONTENT_TYPES } = require("../middleware/edgeCacheControl");
const { coalesce } = require("../middleware/requestCoalescer");
const { surrogateKeysForProfile } = require("../services/cdn/cacheStrategy");

const {
  getProfile,
  upsertProfile,
  updateAvailability,
  getSkillEndorsements,
  endorseSkill,
  getClientSpendingAnalytics,
  listProfiles,
  getClientReputation,
  getProfileStats,
  getResponseTime,
  blockFreelancer,
  unblockFreelancer,
} = require("../services/profileService");
const {
  upsertPriceAlertPreference,
  getPriceAlertPreference,
} = require("../services/priceAlertService");

router.get("/", generalProfileRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const { role, availability, search, limit } = req.query;
    const profiles = await listProfiles({
      role: typeof role === "string" && role.trim() ? role : undefined,
      availability:
        typeof availability === "string" && availability.trim() ? availability : undefined,
      search: typeof search === "string" && search.trim() ? search : undefined,
      limit: typeof limit === "string" ? Number(limit) : undefined,
    });
    res.json({ success: true, data: profiles });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}:
 *   get:
 *     summary: Get a single profile
 *     description: >
 *       Returns the full profile for the given Stellar public key, including
 *       aggregate rating, computed freelancer tier, and a derived reputation
 *       score/metrics. Responses are served from a short-lived cache when
 *       available (see the `X-Cache: HIT|MISS` response header) and concurrent
 *       cache misses for the same key are coalesced into a single DB fetch.
 *     tags: [Profiles]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the profile owner
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *             example:
 *               success: true
 *               data:
 *                 publicKey: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *                 displayName: Alice Developer
 *                 bio: Full-stack developer specializing in Stellar integrations.
 *                 skills: [React, Node.js, Stellar SDK]
 *                 portfolioItems: [{ title: My Project, type: live, url: "https://example.com" }]
 *                 portfolioFiles: []
 *                 availability: { status: available }
 *                 role: freelancer
 *                 completedJobs: 12
 *                 totalEarnedXLM: "1250.5000000"
 *                 rating: 4.8
 *                 ratingCount: 8
 *                 referralCount: 3
 *                 reputationPoints: 5
 *                 blockedAddresses: []
 *                 email: alice@example.com
 *                 emailNotificationsEnabled: true
 *                 webhookUrl: null
 *                 webhookSecret: null
 *                 isKycVerified: null
 *                 didHash: null
 *                 tier: Top Rated
 *                 reputationScore: 87
 *                 reputationMetrics: { avgAcceptHours: 5.2, avgReleaseHours: 20.1 }
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2026-08-01T09:00:00.000Z"
 *       400:
 *         description: publicKey is not a valid Stellar G-address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       404:
 *         description: No profile exists for this public key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Profile not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get(
  "/:publicKey",
  generalProfileRateLimiter,
  edgeCacheControl(CONTENT_TYPES.SEMI_DYNAMIC, {
    surrogateKeys: (req: any) => surrogateKeysForProfile(req.params.publicKey),
  }),
  async (req: any, res: any, next: any) => {
    try {
      const key = cache.profileKey(req.params.publicKey);
      const cached = await cache.get(key);
      if (cached) {
        res.set("X-Cache", "HIT");
        return res.json({ success: true, data: cached });
      }
      // Stampede protection: concurrent misses for the same profile (e.g.
      // right after an invalidation) share one origin fetch.
      const data = await coalesce(key, async () => {
        const fetched = await getProfile(req.params.publicKey);
        await cache.set(key, fetched, cache.TTL.PROFILE);
        return fetched;
      });
      res.set("X-Cache", "MISS");
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/:publicKey/stats",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      res.json({ success: true, data: await getProfileStats(req.params.publicKey) });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/:publicKey/response-time",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      res.json({ success: true, data: await getResponseTime(req.params.publicKey) });
    } catch (e) {
      next(e);
    }
  }
);

router.post("/", profileUpdateRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const data = await upsertProfile(req.body);
    if (req.body.publicKey) await cache.del(cache.profileKey(req.body.publicKey));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/notifications:
 *   get:
 *     summary: Get notification preferences
 *     description: >
 *       Returns the email/webhook notification preferences stored on the
 *       profile. `webhookSecret` is masked to `"***"` when set, or `null` when
 *       not set - the real secret is never returned by this endpoint.
 *     tags: [Profiles]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the profile owner
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     responses:
 *       200:
 *         description: Notification preferences retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     email:
 *                       type: string
 *                       nullable: true
 *                     emailNotificationsEnabled:
 *                       type: boolean
 *                       nullable: true
 *                     webhookUrl:
 *                       type: string
 *                       nullable: true
 *                     webhookSecret:
 *                       type: string
 *                       nullable: true
 *                       description: "\"***\" if a secret is set, otherwise null"
 *             example:
 *               success: true
 *               data:
 *                 email: alice@example.com
 *                 emailNotificationsEnabled: true
 *                 webhookUrl: "https://example.com/webhooks/marketpay"
 *                 webhookSecret: "***"
 *       404:
 *         description: No profile row exists for this public key
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Profile not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/profiles/:publicKey/notifications - Get notification preferences
router.get(
  "/:publicKey/notifications",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const { getUserPreferences } = require("../services/notificationService");
      const prefs = await getUserPreferences(req.params.publicKey);

      if (!prefs) {
        return res.status(404).json({ success: false, error: "Profile not found" });
      }

      res.json({
        success: true,
        data: {
          email: prefs.email,
          emailNotificationsEnabled: prefs.email_notifications_enabled,
          webhookUrl: prefs.webhook_url,
          webhookSecret: prefs.webhook_secret ? "***" : null, // Hide secret
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/profiles/{publicKey}/notifications:
 *   post:
 *     summary: Update notification preferences
 *     description: >
 *       Upserts the email/webhook notification fields on the profile via the
 *       same merge-on-conflict logic as `POST /api/profiles`. Fields omitted
 *       from the body leave the stored value unchanged. `webhookSecret` in the
 *       response is masked to `"***"` when set, or `null` when not set.
 *     tags: [Profiles]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the profile owner
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               emailNotificationsEnabled:
 *                 type: boolean
 *               webhookUrl:
 *                 type: string
 *               webhookSecret:
 *                 type: string
 *           example:
 *             email: alice@example.com
 *             emailNotificationsEnabled: true
 *             webhookUrl: "https://example.com/webhooks/marketpay"
 *             webhookSecret: "whsec_51f2c9"
 *     responses:
 *       200:
 *         description: Notification preferences updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     email:
 *                       type: string
 *                       nullable: true
 *                     emailNotificationsEnabled:
 *                       type: boolean
 *                       nullable: true
 *                     webhookUrl:
 *                       type: string
 *                       nullable: true
 *                     webhookSecret:
 *                       type: string
 *                       nullable: true
 *             example:
 *               success: true
 *               data:
 *                 email: alice@example.com
 *                 emailNotificationsEnabled: true
 *                 webhookUrl: "https://example.com/webhooks/marketpay"
 *                 webhookSecret: "***"
 *       400:
 *         description: publicKey is not a valid Stellar G-address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/profiles/:publicKey/notifications - Update notification preferences
router.post(
  "/:publicKey/notifications",
  profileUpdateRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const { publicKey } = req.params;
      const { email, emailNotificationsEnabled, webhookUrl, webhookSecret } = req.body;

      // Update profile with notification preferences
      const updated = await upsertProfile({
        publicKey,
        email,
        emailNotificationsEnabled,
        webhookUrl,
        webhookSecret,
      });

      res.json({
        success: true,
        data: {
          email: updated.email,
          emailNotificationsEnabled: updated.emailNotificationsEnabled,
          webhookUrl: updated.webhookUrl,
          webhookSecret: updated.webhookSecret ? "***" : null,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/:publicKey/availability",
  profileUpdateRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      res.json({
        success: true,
        data: await updateAvailability(req.params.publicKey, req.body),
      });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/:publicKey/price-alerts",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const pref = await getPriceAlertPreference(req.params.publicKey);
      res.json({ success: true, data: pref });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/:publicKey/price-alerts",
  profileUpdateRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const pref = await upsertPriceAlertPreference({
        freelancerAddress: req.params.publicKey,
        minXlmPriceUsd: req.body.minXlmPriceUsd,
        maxXlmPriceUsd: req.body.maxXlmPriceUsd,
        emailNotificationsEnabled: req.body.emailNotificationsEnabled,
        email: req.body.email,
      });
      res.json({ success: true, data: pref });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/:publicKey/endorsements",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const endorsements = await getSkillEndorsements(req.params.publicKey);
      res.json({ success: true, data: endorsements });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/:publicKey/endorse",
  profileUpdateRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const { skill, endorserAddress } = req.body;
      await endorseSkill({
        skill,
        endorserAddress,
        recipientAddress: req.params.publicKey,
      });
      res.json({ success: true, data: null });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/:publicKey/spending",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const data = await getClientSpendingAnalytics(req.params.publicKey);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/:publicKey/client-reputation",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const data = await getClientReputation(req.params.publicKey);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/profiles/{publicKey}/block:
 *   post:
 *     summary: Block a freelancer
 *     description: >
 *       Adds `address` to the caller's `blockedAddresses` list. The
 *       authenticated caller must be the owner of `publicKey` (their JWT
 *       `publicKey` claim must match the path parameter).
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the authenticated client
 *         example: GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address]
 *             properties:
 *               address:
 *                 type: string
 *                 description: Stellar public key (G-address) of the freelancer to block
 *           example:
 *             address: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     responses:
 *       200:
 *         description: Freelancer blocked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *             example:
 *               success: true
 *               data:
 *                 publicKey: GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *                 blockedAddresses: [GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF]
 *                 role: client
 *                 createdAt: "2026-01-15T10:30:00.000Z"
 *                 updatedAt: "2026-08-21T09:05:00.000Z"
 *       400:
 *         description: Invalid public key/address, or attempting to block yourself
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: You cannot block yourself
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The JWT's publicKey claim does not match the path parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: You can only manage your own block list
 *       409:
 *         description: The freelancer is already on the caller's block list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Freelancer is already blocked
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/profiles/:publicKey/block — block a freelancer
router.post(
  "/:publicKey/block",
  verifyJWT,
  profileUpdateRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      if (req.user.publicKey !== req.params.publicKey) {
        return res.status(403).json({ error: "You can only manage your own block list" });
      }
      const { address } = req.body;
      const profile = await blockFreelancer(req.params.publicKey, address);
      res.json({ success: true, data: profile });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/profiles/{publicKey}/block/{address}:
 *   delete:
 *     summary: Unblock a freelancer
 *     description: >
 *       Removes `address` from the caller's `blockedAddresses` list. The
 *       authenticated caller must be the owner of `publicKey` (their JWT
 *       `publicKey` claim must match the path parameter). Removing an address
 *       that was never blocked succeeds silently.
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the authenticated client
 *         example: GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the freelancer to unblock
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     responses:
 *       200:
 *         description: Freelancer unblocked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *             example:
 *               success: true
 *               data:
 *                 publicKey: GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *                 blockedAddresses: []
 *                 role: client
 *                 createdAt: "2026-01-15T10:30:00.000Z"
 *                 updatedAt: "2026-08-21T09:10:00.000Z"
 *       400:
 *         description: publicKey or address is not a valid Stellar G-address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The JWT's publicKey claim does not match the path parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: You can only manage your own block list
 *       404:
 *         description: No profile exists for this public key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Profile not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// DELETE /api/profiles/:publicKey/block/:address — unblock a freelancer
router.delete(
  "/:publicKey/block/:address",
  verifyJWT,
  profileUpdateRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      if (req.user.publicKey !== req.params.publicKey) {
        return res.status(403).json({ error: "You can only manage your own block list" });
      }
      const profile = await unblockFreelancer(req.params.publicKey, req.params.address);
      res.json({ success: true, data: profile });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/profiles/{publicKey}/earnings:
 *   get:
 *     summary: Get a freelancer's earnings history
 *     description: >
 *       Returns every released escrow payment made to this freelancer (newest
 *       first), the running total in XLM and USDC, and a 6-month rollup of
 *       total XLM earned per month. The public key is not validated against
 *       the Stellar G-address format and does not need to correspond to an
 *       existing profile - an unknown address simply returns empty totals.
 *     tags: [Profiles]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the freelancer
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     responses:
 *       200:
 *         description: Earnings history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalXlm:
 *                       type: string
 *                     totalUsdc:
 *                       type: string
 *                     payments:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           jobId:
 *                             type: string
 *                             format: uuid
 *                           jobTitle:
 *                             type: string
 *                           amountXlm:
 *                             type: string
 *                           currency:
 *                             type: string
 *                           releasedAt:
 *                             type: string
 *                             format: date-time
 *                           clientAddress:
 *                             type: string
 *                     monthly:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           month:
 *                             type: string
 *                             example: "2026-07"
 *                           totalXlm:
 *                             type: number
 *             example:
 *               success: true
 *               data:
 *                 totalXlm: "875.0000000"
 *                 totalUsdc: "0.0000000"
 *                 payments:
 *                   - id: 42
 *                     jobId: 9f8c9e2e-5b3a-4b2d-8b76-1a2b3c4d5e6f
 *                     jobTitle: Build a Stellar wallet integration
 *                     amountXlm: "500.0000000"
 *                     currency: XLM
 *                     releasedAt: "2026-08-10T14:00:00.000Z"
 *                     clientAddress: GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *                 monthly:
 *                   - month: "2026-08"
 *                     totalXlm: 500
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/profiles/:publicKey/earnings — freelancer earnings history (Issue #181)
router.get(
  "/:publicKey/earnings",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const { publicKey } = req.params;

      const { rows: payments } = await rawQuery<EscrowTable>(
        `SELECT
         e.id,
         e.job_id,
         e.amount_xlm,
         e.released_at,
         j.title  AS job_title,
         j.client_address,
         j.currency
       FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE j.freelancer_address = $1
         AND e.status = 'released'
       ORDER BY e.released_at DESC`,
        [publicKey]
      );

      const { rows: monthly } = await rawQuery<EscrowTable>(
        `SELECT
         TO_CHAR(DATE_TRUNC('month', e.released_at), 'YYYY-MM') AS month,
         SUM(e.amount_xlm)::numeric                             AS total_xlm
       FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE j.freelancer_address = $1
         AND e.status = 'released'
         AND e.released_at >= NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', e.released_at)
       ORDER BY DATE_TRUNC('month', e.released_at)`,
        [publicKey]
      );

      let totalXlm = 0;
      let totalUsdc = 0;
      for (const p of payments) {
        const amt = parseFloat(String(p.amount_xlm || 0));
        if ((p.currency || "XLM").toUpperCase() === "USDC") {
          totalUsdc += amt;
        } else {
          totalXlm += amt;
        }
      }

      res.json({
        success: true,
        data: {
          totalXlm: totalXlm.toFixed(7),
          totalUsdc: totalUsdc.toFixed(7),
          payments: payments.map((p: any) => ({
            id: p.id,
            jobId: p.job_id,
            jobTitle: p.job_title,
            amountXlm: p.amount_xlm,
            currency: p.currency || "XLM",
            releasedAt: p.released_at,
            clientAddress: p.client_address,
          })),
          monthly: monthly.map((m: any) => ({
            month: m.month,
            totalXlm: parseFloat(m.total_xlm),
          })),
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

router.post(
  "/:publicKey/portfolio",
  verifyJWT,
  upload.single("file"),
  async (req: any, res: any, next: any) => {
    try {
      const { publicKey } = req.params;
      if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized" });
      if (!req.file) return res.status(400).json({ error: "File is required" });

      const { rows } = await rawQuery<ProfileTable>(
        "SELECT portfolio_items FROM profiles WHERE public_key = $1",
        [publicKey]
      );
      const current = rows[0]?.portfolio_items || [];
      if (current.length >= 10)
        return res.status(400).json({ error: "Maximum 10 portfolio items allowed" });

      const uploaded = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      const item = {
        id: require("crypto").randomUUID(),
        title: req.body.title?.trim() || req.file.originalname,
        type: uploaded.mimeType.startsWith("image/") ? "image" : "pdf",
        cid: uploaded.cid,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        size: uploaded.size,
        uploadedAt: uploaded.uploadedAt,
        url: getGatewayUrl(uploaded.cid),
      };

      const updated = [...current, item];
      await rawQuery<ProfileTable>(
        "UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1",
        [publicKey, JSON.stringify(updated)]
      );

      res.json({ success: true, data: item });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/profiles/{publicKey}/endorsements:
 *   get:
 *     summary: Get skill endorsements (duplicate route)
 *     description: >
 *       Functionally identical to the earlier `GET /api/profiles/{publicKey}/endorsements`
 *       handler defined above in this file (same query, same response shape).
 *       Because Express dispatches to the first registered matching handler,
 *       this second registration is unreachable in practice, but is documented
 *       here for completeness.
 *     tags: [Profiles]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the endorsed freelancer
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     responses:
 *       200:
 *         description: Endorsements retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       skill:
 *                         type: string
 *                       count:
 *                         type: integer
 *                       endorsers:
 *                         type: array
 *                         items:
 *                           type: string
 *             example:
 *               success: true
 *               data:
 *                 - skill: React
 *                   count: 2
 *                   endorsers:
 *                     - GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *                     - GVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7MZGT
 *       400:
 *         description: publicKey is not a valid Stellar G-address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/profiles/:publicKey/endorsements — get skill endorsements
router.get(
  "/:publicKey/endorsements",
  generalProfileRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const data = await getSkillEndorsements(req.params.publicKey);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/profiles/{publicKey}/endorse:
 *   post:
 *     summary: Endorse a skill (authenticated, past-client-only variant)
 *     description: >
 *       Endorses `skill` on the recipient's profile as the authenticated
 *       caller. Requires that the skill already appears in the recipient's
 *       `skills` list and that the caller has at least one `completed` job
 *       with the recipient as freelancer (i.e. only a past client who hired
 *       this freelancer may endorse them).
 *
 *       Note: this handler is registered after an earlier, unauthenticated
 *       `POST /api/profiles/{publicKey}/endorse` route in this file (see
 *       above). Because Express dispatches to the first registered matching
 *       handler and that earlier handler always resolves the request itself,
 *       this stricter handler is currently unreachable in practice.
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the freelancer being endorsed
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [skill]
 *             properties:
 *               skill:
 *                 type: string
 *           example:
 *             skill: React
 *     responses:
 *       201:
 *         description: Skill endorsed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     skill:
 *                       type: string
 *                     endorsed:
 *                       type: boolean
 *             example:
 *               success: true
 *               data: { skill: React, endorsed: true }
 *       400:
 *         description: Missing skill, or the skill is not listed on the recipient's profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Skill not found in freelancer's profile
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The caller has no completed job with this freelancer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only past clients with completed jobs can endorse
 *       404:
 *         description: No profile exists for this public key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Profile not found
 */
// POST /api/profiles/:publicKey/endorse — endorse a skill
router.post("/:publicKey/endorse", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    const { publicKey } = req.params;
    const { skill } = req.body;
    const endorserAddress = req.user.publicKey;

    if (!skill || typeof skill !== "string" || !skill.trim()) {
      return res.status(400).json({ error: "Skill name is required" });
    }

    // Validate skill exists in recipient's profile
    const { rows: profileRows } = await rawQuery<ProfileTable>(
      "SELECT skills FROM profiles WHERE public_key = $1",
      [publicKey]
    );
    if (!profileRows.length) {
      return res.status(404).json({ error: "Profile not found" });
    }
    if (!profileRows[0].skills || !profileRows[0].skills.includes(skill.trim())) {
      return res.status(400).json({ error: "Skill not found in freelancer's profile" });
    }

    // Only past clients who completed a job can endorse
    const { rows: jobRows } = await rawQuery<JobTable>(
      `SELECT 1 FROM jobs
       WHERE client_address = $1
         AND freelancer_address = $2
         AND status = 'completed'
       LIMIT 1`,
      [endorserAddress, publicKey]
    );
    if (!jobRows.length) {
      return res.status(403).json({ error: "Only past clients with completed jobs can endorse" });
    }

    await endorseSkill({ skill: skill.trim(), endorserAddress, recipientAddress: publicKey });

    res.status(201).json({ success: true, data: { skill: skill.trim(), endorsed: true } });
  } catch (e) {
    next(e);
  }
});

router.delete("/:publicKey/portfolio/:itemId", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    const { publicKey, itemId } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized" });

    const { rows } = await rawQuery<ProfileTable>(
      "SELECT portfolio_items FROM profiles WHERE public_key = $1",
      [publicKey]
    );
    const current = rows[0]?.portfolio_items || [];
    const nextItems = current.filter((item: any) => item.id !== itemId);

    if (nextItems.length === current.length)
      return res.status(404).json({ error: "Portfolio item not found" });

    await rawQuery<ProfileTable>(
      "UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1",
      [publicKey, JSON.stringify(nextItems)]
    );

    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    next(e);
  }
});
module.exports = router;
