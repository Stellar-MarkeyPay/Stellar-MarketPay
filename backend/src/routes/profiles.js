/**
 * src/routes/profiles.js
 */
"use strict";
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

/**
 * @swagger
 * /api/profiles:
 *   get:
 *     summary: List profiles
 *     description: >
 *       Returns user profiles (clients and/or freelancers), newest-updated first,
 *       optionally filtered by role, availability status, or a free-text search
 *       across display name, bio, public key, and skills.
 *     tags: [Profiles]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [client, freelancer, both]
 *         required: false
 *         description: Filter profiles by role
 *         example: freelancer
 *       - in: query
 *         name: availability
 *         schema:
 *           type: string
 *           enum: [available, busy, unavailable]
 *         required: false
 *         description: Filter profiles by availability status
 *         example: available
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Free-text search across display name, bio, public key, and skills
 *         example: Stellar SDK
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         required: false
 *         description: >
 *           Maximum number of profiles to return. Clamped to the 1-100 range;
 *           a non-numeric value silently falls back to the default of 50.
 *         example: 20
 *     responses:
 *       200:
 *         description: Profiles retrieved successfully
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
 *             example:
 *               success: true
 *               data:
 *                 - publicKey: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *                   displayName: Alice Developer
 *                   bio: Full-stack developer specializing in Stellar integrations.
 *                   skills: [React, Node.js, Stellar SDK]
 *                   portfolioItems: [{ title: My Project, type: live, url: "https://example.com" }]
 *                   portfolioFiles: []
 *                   availability: { status: available }
 *                   role: freelancer
 *                   completedJobs: 12
 *                   totalEarnedXLM: "1250.5000000"
 *                   rating: 4.8
 *                   referralCount: 3
 *                   reputationPoints: 5
 *                   blockedAddresses: []
 *                   email: alice@example.com
 *                   emailNotificationsEnabled: true
 *                   webhookUrl: null
 *                   webhookSecret: null
 *                   isKycVerified: null
 *                   didHash: null
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2026-08-01T09:00:00.000Z"
 *       400:
 *         description: role or availability was set to an unsupported value
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Role must be one of: client, freelancer, both"
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/", generalProfileRateLimiter, async (req, res, next) => {
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
    surrogateKeys: (req) => surrogateKeysForProfile(req.params.publicKey),
  }),
  async (req, res, next) => {
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

/**
 * @swagger
 * /api/profiles/{publicKey}/stats:
 *   get:
 *     summary: Get freelancer application statistics
 *     description: >
 *       Returns the total number of job applications submitted by this
 *       freelancer, how many were accepted, and the resulting success rate
 *       (accepted / total, as an integer percentage). Returns all zeros if the
 *       freelancer has no applications; the public key is not required to
 *       correspond to an existing profile.
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
 *         description: Stats retrieved successfully
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
 *                     totalApplications:
 *                       type: integer
 *                     acceptedApplications:
 *                       type: integer
 *                     successRate:
 *                       type: integer
 *                       description: Integer percentage (0-100)
 *             example:
 *               success: true
 *               data: { totalApplications: 20, acceptedApplications: 14, successRate: 70 }
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
router.get("/:publicKey/stats", generalProfileRateLimiter, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getProfileStats(req.params.publicKey) });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/response-time:
 *   get:
 *     summary: Get a freelancer's average escrow response time
 *     description: >
 *       Returns the average number of days between escrow creation and escrow
 *       release for jobs completed by this freelancer. `averageDays` is `null`
 *       when the freelancer has no released escrows.
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
 *         description: Response time retrieved successfully
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
 *                     averageDays:
 *                       type: number
 *                       nullable: true
 *             example:
 *               success: true
 *               data: { averageDays: 2.4 }
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
router.get("/:publicKey/response-time", generalProfileRateLimiter, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getResponseTime(req.params.publicKey) });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles:
 *   post:
 *     summary: Create or update a profile
 *     description: >
 *       Upserts a profile keyed by `publicKey`. Any field omitted from the
 *       request body leaves the existing stored value unchanged (fields are
 *       merged with `COALESCE`, not overwritten with empty values); the first
 *       call for a given `publicKey` creates the row. This endpoint does not
 *       require authentication.
 *     tags: [Profiles]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key (G-address); primary key of the profile
 *               displayName:
 *                 type: string
 *               bio:
 *                 type: string
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Truncated to the first 15 entries if longer
 *               portfolioItems:
 *                 type: array
 *                 maxItems: 10
 *                 items:
 *                   type: object
 *                   required: [title, type, url]
 *                   properties:
 *                     title:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum: [github, live, stellar_tx, file]
 *                     url:
 *                       type: string
 *                       description: Must be http(s) unless type is stellar_tx
 *               portfolioFiles:
 *                 type: array
 *                 maxItems: 5
 *                 items:
 *                   type: object
 *                   required: [cid, fileName, mimeType, uploadedAt]
 *                   properties:
 *                     cid:
 *                       type: string
 *                     fileName:
 *                       type: string
 *                     mimeType:
 *                       type: string
 *                     size:
 *                       type: integer
 *                     uploadedAt:
 *                       type: string
 *                       format: date-time
 *               availability:
 *                 type: object
 *                 required: [status]
 *                 properties:
 *                   status:
 *                     type: string
 *                     enum: [available, busy, unavailable]
 *                   availableFrom:
 *                     type: string
 *                     format: date-time
 *                   availableUntil:
 *                     type: string
 *                     format: date-time
 *               role:
 *                 type: string
 *                 enum: [client, freelancer, both]
 *                 default: both
 *               email:
 *                 type: string
 *               emailNotificationsEnabled:
 *                 type: boolean
 *               webhookUrl:
 *                 type: string
 *               webhookSecret:
 *                 type: string
 *           example:
 *             publicKey: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *             displayName: Alice Developer
 *             bio: Full-stack developer specializing in Stellar network integrations.
 *             skills: [React, Node.js, Stellar SDK]
 *             portfolioItems:
 *               - title: My Awesome Project
 *                 type: live
 *                 url: "https://example.com"
 *             availability:
 *               status: available
 *             role: freelancer
 *     responses:
 *       200:
 *         description: Profile created or updated successfully
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
 *                 bio: Full-stack developer specializing in Stellar network integrations.
 *                 skills: [React, Node.js, Stellar SDK]
 *                 portfolioItems: [{ title: My Awesome Project, type: live, url: "https://example.com" }]
 *                 portfolioFiles: []
 *                 availability: { status: available }
 *                 role: freelancer
 *                 completedJobs: 0
 *                 totalEarnedXLM: "0.0000000"
 *                 rating: null
 *                 referralCount: 0
 *                 reputationPoints: 0
 *                 blockedAddresses: []
 *                 email: null
 *                 emailNotificationsEnabled: null
 *                 webhookUrl: null
 *                 webhookSecret: null
 *                 isKycVerified: null
 *                 didHash: null
 *                 createdAt: "2026-08-21T09:00:00.000Z"
 *                 updatedAt: "2026-08-21T09:00:00.000Z"
 *       400:
 *         description: >
 *           Validation error - invalid public key, role, availability, or
 *           portfolio item/file shape.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/", profileUpdateRateLimiter, async (req, res, next) => {
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
router.get("/:publicKey/notifications", generalProfileRateLimiter, async (req, res, next) => {
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
});

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
router.post("/:publicKey/notifications", profileUpdateRateLimiter, async (req, res, next) => {
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
});

/**
 * @swagger
 * /api/profiles/{publicKey}/availability:
 *   post:
 *     summary: Update availability
 *     description: >
 *       Sets (or clears) the `availability` block on a profile, creating the
 *       profile row if it does not already exist. Any other profile fields are
 *       left untouched.
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [available, busy, unavailable]
 *               availableFrom:
 *                 type: string
 *                 format: date-time
 *                 description: Must be before availableUntil if both are set
 *               availableUntil:
 *                 type: string
 *                 format: date-time
 *           example:
 *             status: busy
 *             availableFrom: "2026-09-01T00:00:00.000Z"
 *             availableUntil: "2026-09-15T00:00:00.000Z"
 *     responses:
 *       200:
 *         description: Availability updated successfully
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
 *                 displayName: null
 *                 bio: null
 *                 skills: null
 *                 portfolioItems: []
 *                 portfolioFiles: []
 *                 availability: { status: busy, availableFrom: "2026-09-01T00:00:00.000Z", availableUntil: "2026-09-15T00:00:00.000Z" }
 *                 role: both
 *                 completedJobs: 0
 *                 totalEarnedXLM: "0.0000000"
 *                 rating: null
 *                 createdAt: "2026-08-21T09:00:00.000Z"
 *                 updatedAt: "2026-08-21T09:05:00.000Z"
 *       400:
 *         description: >
 *           Invalid public key, missing/invalid status, invalid date string, or
 *           availableFrom is after availableUntil
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Availability status must be one of: available, busy, unavailable"
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/:publicKey/availability", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await updateAvailability(req.params.publicKey, req.body),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/price-alerts:
 *   get:
 *     summary: Get XLM price alert preferences
 *     description: >
 *       Returns the freelancer's XLM/USD price-alert thresholds and email
 *       settings, or `null` if none have been configured.
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
 *         description: Price alert preference retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   nullable: true
 *             example:
 *               success: true
 *               data:
 *                 freelancer_address: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *                 min_xlm_price_usd: "0.09"
 *                 max_xlm_price_usd: "0.20"
 *                 email_notifications_enabled: true
 *                 email: alice@example.com
 *                 last_min_alert_at: null
 *                 last_max_alert_at: null
 *                 created_at: "2026-08-01T09:00:00.000Z"
 *                 updated_at: "2026-08-01T09:00:00.000Z"
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
router.get("/:publicKey/price-alerts", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const pref = await getPriceAlertPreference(req.params.publicKey);
    res.json({ success: true, data: pref });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/price-alerts:
 *   post:
 *     summary: Set XLM price alert preferences
 *     description: >
 *       Upserts the min/max XLM/USD price thresholds that trigger an alert
 *       (broadcast over the realtime channel and, if enabled, emailed) when
 *       the polled XLM price crosses them.
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
 *         description: Stellar public key (G-address) of the freelancer
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               minXlmPriceUsd:
 *                 type: number
 *                 nullable: true
 *                 description: Alert when the live XLM price drops below this value
 *               maxXlmPriceUsd:
 *                 type: number
 *                 nullable: true
 *                 description: Alert when the live XLM price rises above this value
 *               emailNotificationsEnabled:
 *                 type: boolean
 *               email:
 *                 type: string
 *           example:
 *             minXlmPriceUsd: 0.09
 *             maxXlmPriceUsd: 0.20
 *             emailNotificationsEnabled: true
 *             email: alice@example.com
 *     responses:
 *       200:
 *         description: Price alert preference saved successfully
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
 *                 freelancer_address: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *                 min_xlm_price_usd: "0.09"
 *                 max_xlm_price_usd: "0.20"
 *                 email_notifications_enabled: true
 *                 email: alice@example.com
 *                 last_min_alert_at: null
 *                 last_max_alert_at: null
 *                 created_at: "2026-08-01T09:00:00.000Z"
 *                 updated_at: "2026-08-01T09:00:00.000Z"
 *       400:
 *         description: >
 *           Invalid public key, non-numeric minXlmPriceUsd/maxXlmPriceUsd, or
 *           minXlmPriceUsd greater than maxXlmPriceUsd
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: minXlmPriceUsd must be less than maxXlmPriceUsd
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/:publicKey/price-alerts", profileUpdateRateLimiter, async (req, res, next) => {
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
});

/**
 * @swagger
 * /api/profiles/{publicKey}/endorsements:
 *   get:
 *     summary: Get skill endorsements
 *     description: >
 *       Returns the skills endorsed on this profile, grouped by skill, each
 *       with the number of endorsers and the list of endorser addresses
 *       (most recent first).
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
router.get("/:publicKey/endorsements", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const endorsements = await getSkillEndorsements(req.params.publicKey);
    res.json({ success: true, data: endorsements });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/endorse:
 *   post:
 *     summary: Endorse a skill (unauthenticated variant)
 *     description: >
 *       Records that `endorserAddress` endorses `skill` on the recipient's
 *       profile (idempotent - duplicate endorsements are ignored). This
 *       endpoint does not require authentication and does not verify that the
 *       endorser previously worked with the recipient.
 *
 *       Note: a second `POST /api/profiles/{publicKey}/endorse` handler with
 *       stricter validation (requires a JWT and a completed job history) is
 *       registered later in this file. Because Express dispatches to route
 *       handlers in registration order and this handler always resolves the
 *       request itself, this is the handler that actually executes.
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
 *         description: Stellar public key (G-address) of the freelancer being endorsed
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [skill, endorserAddress]
 *             properties:
 *               skill:
 *                 type: string
 *               endorserAddress:
 *                 type: string
 *                 description: Stellar public key (G-address) of the endorser
 *           example:
 *             skill: React
 *             endorserAddress: GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *     responses:
 *       200:
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
 *                   nullable: true
 *             example:
 *               success: true
 *               data: null
 *       400:
 *         description: >
 *           Invalid public key, missing skill, or endorserAddress is the same
 *           as the recipient
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Cannot endorse your own skill
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/:publicKey/endorse", profileUpdateRateLimiter, async (req, res, next) => {
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
});

/**
 * @swagger
 * /api/profiles/{publicKey}/spending:
 *   get:
 *     summary: Get a client's spending analytics
 *     description: >
 *       Returns aggregate spending analytics for a client: total XLM spent on
 *       released escrows, a breakdown of posted jobs by status, average
 *       budget/payout, and the top 5 freelancers by jobs paid.
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
 *         description: Stellar public key (G-address) of the client
 *         example: GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *     responses:
 *       200:
 *         description: Spending analytics retrieved successfully
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
 *                 totalSpentXlm: "3200.0000000"
 *                 jobsBreakdown: { posted: 10, completed: 7, cancelled: 1, inProgress: 2 }
 *                 averageBudgetXlm: "320.0000000"
 *                 averagePaidXlm: "457.1428571"
 *                 topFreelancers:
 *                   - freelancerAddress: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *                     jobsCount: 3
 *                     totalPaidXlm: "900.0000000"
 *                 hasCompletedJobs: true
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
router.get("/:publicKey/spending", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getClientSpendingAnalytics(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/client-reputation:
 *   get:
 *     summary: Get a client's reputation score
 *     description: >
 *       Computes a 0-5 reputation score for a client from on-time payment
 *       release rate, dispute rate, job completion rate, response time to
 *       applications, and payment release speed.
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
 *         description: Stellar public key (G-address) of the client
 *         example: GO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYFS7M
 *     responses:
 *       200:
 *         description: Client reputation retrieved successfully
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
 *                 score: 4.3
 *                 paymentReleaseRate: 92.5
 *                 disputeRate: 5.0
 *                 completionRate: 87.0
 *                 avgTimeToReleaseHours: 30.2
 *                 responseTimeToApplicationsHours: 12.4
 *                 totals: { totalJobs: 20, completedJobs: 17, disputedJobs: 1, totalReleased: 17, releasedOnTime: 15 }
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
router.get("/:publicKey/client-reputation", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getClientReputation(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

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
router.post("/:publicKey/block", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
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
});

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
  async (req, res, next) => {
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
router.get("/:publicKey/earnings", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    const { rows: payments } = await pool.query(
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

    const { rows: monthly } = await pool.query(
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
      const amt = parseFloat(p.amount_xlm || 0);
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
        payments: payments.map((p) => ({
          id: p.id,
          jobId: p.job_id,
          jobTitle: p.job_title,
          amountXlm: p.amount_xlm,
          currency: p.currency || "XLM",
          releasedAt: p.released_at,
          clientAddress: p.client_address,
        })),
        monthly: monthly.map((m) => ({
          month: m.month,
          totalXlm: parseFloat(m.total_xlm),
        })),
      },
    });
  } catch (e) {
    next(e);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

/**
 * @swagger
 * /api/profiles/{publicKey}/portfolio:
 *   post:
 *     summary: Upload a portfolio item file
 *     description: >
 *       Uploads a single file (image or PDF, up to 10MB) to IPFS via Pinata
 *       and appends it as a portfolio item on the profile. The authenticated
 *       caller must be the owner of `publicKey`. A profile may have at most
 *       10 portfolio items.
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
 *         description: Stellar public key (G-address) of the authenticated owner
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Image or PDF file, up to 10MB
 *               title:
 *                 type: string
 *                 description: Display title; defaults to the uploaded file's original name
 *                 example: Design portfolio 2026
 *     responses:
 *       200:
 *         description: File uploaded and portfolio item created successfully
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
 *                 id: 7c9e6679-7425-40de-944b-e07fc1f90ae7
 *                 title: Design portfolio 2026
 *                 type: image
 *                 cid: QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o
 *                 fileName: portfolio.png
 *                 mimeType: image/png
 *                 size: 204800
 *                 uploadedAt: "2026-08-21T09:15:00.000Z"
 *                 url: "https://gateway.pinata.cloud/ipfs/QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"
 *       400:
 *         description: No file was attached, or the profile already has 10 portfolio items
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Maximum 10 portfolio items allowed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The JWT's publicKey claim does not match the path parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       503:
 *         description: The IPFS/Pinata upload service is unavailable, unauthenticated, or rate-limited
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: IPFS upload service is temporarily unavailable. Please try again later.
 */
router.post("/:publicKey/portfolio", verifyJWT, upload.single("file"), async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized" });
    if (!req.file) return res.status(400).json({ error: "File is required" });

    const { rows } = await pool.query(
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
    await pool.query(
      "UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1",
      [publicKey, JSON.stringify(updated)]
    );

    res.json({ success: true, data: item });
  } catch (e) {
    next(e);
  }
});

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
router.get("/:publicKey/endorsements", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getSkillEndorsements(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

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
router.post("/:publicKey/endorse", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const { skill } = req.body;
    const endorserAddress = req.user.publicKey;

    if (!skill || typeof skill !== "string" || !skill.trim()) {
      return res.status(400).json({ error: "Skill name is required" });
    }

    // Validate skill exists in recipient's profile
    const { rows: profileRows } = await pool.query(
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
    const { rows: jobRows } = await pool.query(
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

/**
 * @swagger
 * /api/profiles/{publicKey}/portfolio/{itemId}:
 *   delete:
 *     summary: Delete a portfolio item
 *     description: >
 *       Removes a portfolio item from the profile's `portfolioItems` array by
 *       id. The authenticated caller must be the owner of `publicKey`. This
 *       only removes the item's entry in the profile record; it does not
 *       unpin the underlying file from IPFS.
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
 *         description: Stellar public key (G-address) of the authenticated owner
 *         example: GHUBO3IVCP4JWDQ5KXER6LYFS7MZGTAN2HUBO3IVCP4JWDQ5KXER6LYF
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *         description: id of the portfolio item to delete
 *         example: 7c9e6679-7425-40de-944b-e07fc1f90ae7
 *     responses:
 *       200:
 *         description: Portfolio item deleted successfully
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
 *                     deleted:
 *                       type: boolean
 *             example:
 *               success: true
 *               data: { deleted: true }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The JWT's publicKey claim does not match the path parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       404:
 *         description: No portfolio item with this id exists on the profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Portfolio item not found
 */
router.delete("/:publicKey/portfolio/:itemId", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey, itemId } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      "SELECT portfolio_items FROM profiles WHERE public_key = $1",
      [publicKey]
    );
    const current = rows[0]?.portfolio_items || [];
    const nextItems = current.filter((item) => item.id !== itemId);

    if (nextItems.length === current.length)
      return res.status(404).json({ error: "Portfolio item not found" });

    await pool.query(
      "UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1",
      [publicKey, JSON.stringify(nextItems)]
    );

    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    next(e);
  }
});
module.exports = router;

// GET /api/profiles/:publicKey/transactions - Aggregated on-chain activity
router.get("/:publicKey/transactions", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const { limit = 20, cursor = 0, type, startDate, endDate } = req.query;
    const limitNum = parseInt(limit, 10) || 20;
    const offsetNum = parseInt(cursor, 10) || 0;

    // Build the WHERE clause dynamically based on type
    let extraWhere = "";
    if (type && type !== "all") {
      if (type === "sent") {
        extraWhere = "WHERE from_address = $1 AND to_address != $1";
      } else if (type === "received") {
        extraWhere = "WHERE to_address = $1 AND from_address != $1";
      } else {
        extraWhere = "WHERE market_pay_type = $4";
      }
    } else {
      extraWhere = "WHERE 1=1";
    }

    const queryParams = [publicKey, limitNum + 1, offsetNum];
    let paramIndex = 4;
    
    if (type && type !== "all" && type !== "sent" && type !== "received") {
      queryParams.push(type);
      paramIndex++;
    }
    
    if (startDate) {
      extraWhere += ` AND created_at >= $${paramIndex}`;
      queryParams.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      extraWhere += ` AND created_at <= $${paramIndex}`;
      queryParams.push(endDate);
      paramIndex++;
    }

    const query = `
      SELECT * FROM (
        -- Escrow events
        SELECT
          ce.id::text as id,
          ce.tx_hash as hash,
          ce.ledger,
          ce.created_at,
          j.client_address as from_address,
          j.freelancer_address as to_address,
          COALESCE((ce.data->>'amount')::numeric, e.amount_xlm) as amount,
          j.currency as asset,
          ce.event_type as memo,
          'escrow' as market_pay_type
        FROM contract_events ce
        JOIN jobs j ON ce.job_id = j.id::text
        LEFT JOIN escrows e ON e.job_id = j.id
        WHERE j.client_address = $1 OR j.freelancer_address = $1
        
        UNION ALL
        
        -- Referral payouts
        SELECT
          rp.id::text as id,
          rp.contract_tx_hash as hash,
          0 as ledger,
          rp.created_at,
          'PLATFORM' as from_address,
          rp.referrer_address as to_address,
          rp.amount_xlm as amount,
          'XLM' as asset,
          'referral_payout' as memo,
          'payment' as market_pay_type
        FROM referral_payouts rp
        WHERE rp.referrer_address = $1
        
        UNION ALL
        
        -- Platform fee payouts
        SELECT
          pfp.id::text as id,
          pfp.contract_tx_hash as hash,
          0 as ledger,
          pfp.created_at,
          'PLATFORM' as from_address,
          pfp.recipient_address as to_address,
          pfp.amount_xlm as amount,
          'XLM' as asset,
          'fee_payout' as memo,
          'payment' as market_pay_type
        FROM platform_fee_payouts pfp
        WHERE pfp.recipient_address = $1
      ) t
      ${extraWhere}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await pool.query(query, queryParams);
    
    const hasMore = rows.length > limitNum;
    if (hasMore) {
      rows.pop();
    }

    const transactions = rows.map(r => ({
      id: r.id,
      hash: r.hash || '',
      ledger: r.ledger || 0,
      created_at: r.created_at,
      from: r.from_address || '',
      to: r.to_address || '',
      amount: r.amount ? String(r.amount) : "0",
      asset: r.asset || 'XLM',
      memo: r.memo || '',
      memo_type: 'text',
      successful: true,
      marketPayType: r.market_pay_type
    }));

    res.json({ success: true, data: { transactions, hasMore, nextCursor: hasMore ? offsetNum + limitNum : null } });
  } catch (e) {
    next(e);
  }
});

