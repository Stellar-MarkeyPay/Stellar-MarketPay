/**
 * src/routes/jobs.js
 */
"use strict";

const express = require("express");
const router = express.Router();

const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const jobService = require("../services/jobService");
const {
  createJob,
  getJob,
  listJobs,
  listJobsByClient,
  updateJobEscrowId,
  deleteJob,
  boostJob,
  incrementShareCount,
  raiseDispute,
  resolveDispute,
  getRecommendedJobs,
  incrementViewCount,
  extendJobExpiry,
  getSuggestions,
} = jobService.default || jobService;

const { logContractInteraction } = require("../services/contractAuditService");
const { getClientReputation } = require("../services/profileService");
const cache = require("../services/cacheService");
const jobDraftService = require("../services/jobDraftService");
const recommendationService = require("../services/recommendationService");
const { edgeCacheControl, CONTENT_TYPES } = require("../middleware/edgeCacheControl");
const { coalesce } = require("../middleware/requestCoalescer");
const { surrogateKeysForJob } = require("../services/cdn/cacheStrategy");

const jobCreationRateLimiter = createRateLimiter(10, 1); // 10 job creations per minute
const generalJobRateLimiter = createRateLimiter(100, 1); // 100 requests per minute
const reportJobRateLimiter = createRateLimiter(20, 1);
const suggestRateLimiter = createRateLimiter(20, 1);

const jobReports = new Map();

// Feed Helpers

function escapeXml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDateRss(date) {
  return date.toUTCString();
}

function formatDateAtom(date) {
  return date.toISOString();
}

function truncateDescription(description, maxLength = 200) {
  if (!description) return "";
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength - 3) + "...";
}

// Apply feed-only query filters (skills, budget range) to an already-fetched job list.
function filterFeedJobs(jobs, { skills, min_budget, max_budget } = {}) {
  let filtered = jobs;
  const wanted = String(skills || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length > 0) {
    filtered = filtered.filter((job) =>
      (job.skills || []).some((s) => wanted.includes(String(s).toLowerCase()))
    );
  }
  const min = parseFloat(min_budget);
  if (!isNaN(min)) filtered = filtered.filter((job) => parseFloat(job.budget) >= min);
  const max = parseFloat(max_budget);
  if (!isNaN(max)) filtered = filtered.filter((job) => parseFloat(job.budget) <= max);
  return filtered;
}

// Build a feed title suffix that reflects the active filters.
function feedTitleSuffix({ category, skills } = {}) {
  const parts = [];
  if (category) parts.push(`in ${category}`);
  const skillList = String(skills || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (skillList.length > 0) parts.push(`matching ${skillList.join(", ")}`);
  return parts.length ? ` — ${parts.join(" ")}` : "";
}

function normalizeAddress(address) {
  return typeof address === "string" ? address.trim() : "";
}

function isValidReportCategory(category) {
  return ["fraud", "suspicious", "spam", "inappropriate", "other"].includes(category);
}

async function enrichJobsWithClientReputation(jobs) {
  const scoreCache = new Map();
  return Promise.all(
    jobs.map(async (job) => {
      if (!job?.clientAddress) return job;
      if (!scoreCache.has(job.clientAddress)) {
        try {
          const rep = await getClientReputation(job.clientAddress);
          scoreCache.set(job.clientAddress, rep.score);
        } catch {
          scoreCache.set(job.clientAddress, null);
        }
      }
      return { ...job, clientReputationScore: scoreCache.get(job.clientAddress) };
    })
  );
}

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     summary: List jobs
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by job category
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, in_progress, completed, cancelled]
 *         description: Filter by job status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Maximum number of jobs to return
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for job titles and descriptions
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor for next page
 *       - in: query
 *         name: timezone
 *         schema:
 *           type: string
 *         description: Timezone for date formatting
 *       - in: query
 *         name: viewerAddress
 *         schema:
 *           type: string
 *         description: Viewer's Stellar address for permission checks
 *     responses:
 *       200:
 *         description: Jobs retrieved successfully
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
 *                     $ref: '#/components/schemas/Job'
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
 *                   description: Cursor for next page
 */
// GET /api/jobs — list jobs
router.get(
  "/",
  generalJobRateLimiter,
  edgeCacheControl(CONTENT_TYPES.SEMI_DYNAMIC, { surrogateKeys: ["jobs-list"] }),
  async (req, res, next) => {
    try {
      const {
        category,
        status,
        limit,
        search,
        cursor,
        timezone,
        viewerAddress,
        include_expired,
        page,
        min_budget,
        max_budget,
        skills,
        min_client_rating,
        duration,
        posted_since,
        max_applications,
      } = req.query;
      const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
      const includeExpired = include_expired === "true";

      // Deprecated offset-style `page` param — cursor pagination is canonical (#291).
      if (page !== undefined && cursor === undefined) {
        res.set("Deprecation", "true");
        res.set("Link", '</api/jobs>; rel="deprecation"');
        res.set("Sunset", "2025-12-31");
      }

      const cacheKey = cache.jobListKey({
        category,
        status,
        limit: String(safeLimit),
        search,
        cursor,
        timezone,
        viewerAddress,
        include_expired: String(includeExpired),
        min_budget,
        max_budget,
        skills,
        min_client_rating,
        duration,
        posted_since,
        max_applications,
      });
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return res.json({
          success: true,
          ...cached,
          ...(page !== undefined &&
            cursor === undefined && {
              _deprecation:
                "The `page` parameter is deprecated. Use cursor-based pagination via `nextCursor`.",
            }),
        });
      }

      // Stampede protection: concurrent cache misses for the same query
      // (e.g. right after an invalidation) share this single origin fetch
      // instead of each re-querying the DB.
      const { jobsWithRep, nextCursor } = await coalesce(cacheKey, async () => {
        const result = await listJobs({
          category,
          status,
          limit: safeLimit,
          search,
          cursor,
          timezone,
          viewerAddress,
          includeExpired,
          min_budget,
          max_budget,
          skills,
          min_client_rating,
          duration,
          posted_since,
          max_applications,
        });

        const jobsWithRep = await enrichJobsWithClientReputation(result.jobs);
        await cache.set(
          cacheKey,
          { data: jobsWithRep, nextCursor: result.nextCursor },
          cache.TTL.JOBS_LIST
        );
        return { jobsWithRep, nextCursor: result.nextCursor };
      });
      res.set("X-Cache", "MISS");
      res.json({
        success: true,
        data: jobsWithRep,
        nextCursor,
        ...(page !== undefined &&
          cursor === undefined && {
            _deprecation:
              "The `page` parameter is deprecated. Use cursor-based pagination via `nextCursor`.",
          }),
      });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/jobs/client/{publicKey}:
 *   get:
 *     summary: List jobs posted by a client
 *     description: >
 *       Returns every job created by the given Stellar client address, newest
 *       first, with each job enriched with `clientReputationScore` (the client's
 *       reputation score, or `null` if it could not be computed).
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the client
 *         example: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: Jobs retrieved successfully
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
 *                     allOf:
 *                       - $ref: '#/components/schemas/Job'
 *                       - type: object
 *                         properties:
 *                           clientReputationScore:
 *                             type: number
 *                             nullable: true
 *                             description: Client's reputation score, or null if it could not be computed
 *                             example: 87
 *       400:
 *         description: Invalid Stellar public key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/jobs/client/:publicKey — list jobs posted by a client
router.get("/client/:publicKey", generalJobRateLimiter, async (req, res, next) => {
  try {
    const jobs = await listJobsByClient(req.params.publicKey);
    const jobsWithRep = await enrichJobsWithClientReputation(jobs);
    res.json({ success: true, data: jobsWithRep });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/recommended/{publicKey}:
 *   get:
 *     summary: Get skill-matched job recommendations for a freelancer
 *     description: >
 *       Returns up to 5 open, public jobs matching the freelancer's profile skills
 *       (or, if the freelancer has no skills on file, the 5 most recent open public
 *       jobs), excluding any job the freelancer has already applied to. The
 *       `publicKey` is not validated as a Stellar address before use — an address
 *       with no matching profile simply falls back to the "no skills" branch.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the freelancer
 *         example: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: Up to 5 recommended jobs
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
 *                   maxItems: 5
 *                   items:
 *                     $ref: '#/components/schemas/Job'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/jobs/recommended/:publicKey — top 5 skill-matched open jobs for a freelancer
router.get("/recommended/:publicKey", generalJobRateLimiter, async (req, res, next) => {
  try {
    const jobs = await getRecommendedJobs(req.params.publicKey);
    res.json({ success: true, data: jobs });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}:
 *   get:
 *     summary: Get a single job by ID
 *     description: >
 *       Returns the job with `clientReputationScore` attached. Results are cached
 *       (`X-Cache: HIT`/`MISS` response header) and concurrent cache misses for the
 *       same id are coalesced into a single origin lookup.
 *
 *       **Route-ordering caveat:** this route is registered before
 *       `/feed.rss`, `/feed.atom`, `/drafts`, `/recommended` (no publicKey), and
 *       `/suggest` in this file. Because Express matches routes in registration
 *       order and all of those are single-segment GET paths, real requests to
 *       those five paths are actually handled by THIS handler with
 *       `req.params.id` set to the literal path segment (e.g. `"feed.rss"`,
 *       `"drafts"`, `"suggest"`). Since `jobs.id` is a PostgreSQL `UUID` column,
 *       looking up a non-UUID literal like `"feed.rss"` fails UUID parsing at the
 *       database and is returned as a `500` error (not the `404` used for a
 *       well-formed-but-missing id) — see the documentation on those paths for
 *       what actually happens when they're requested.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: Job retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/Job'
 *                     - type: object
 *                       properties:
 *                         clientReputationScore:
 *                           type: number
 *                           nullable: true
 *                           example: 87
 *       404:
 *         description: No job exists with a well-formed id matching this UUID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: >
 *           id is not a syntactically valid UUID (this is the real response for
 *           the shadowed /feed.rss, /feed.atom, /drafts, /recommended, /suggest paths)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: 'invalid input syntax for type uuid: "feed.rss"'
 */
// GET /api/jobs/:id — get single job
router.get(
  "/:id",
  generalJobRateLimiter,
  edgeCacheControl(CONTENT_TYPES.SEMI_DYNAMIC, {
    surrogateKeys: (req) => surrogateKeysForJob(req.params.id),
  }),
  async (req, res, next) => {
    try {
      const cacheKey = cache.jobDetailKey(req.params.id);
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return res.json({ success: true, data: cached });
      }

      // Stampede protection: a popular job page hit by many viewers at once
      // right after a purge shares one origin fetch instead of N.
      const jobWithRep = await coalesce(cacheKey, async () => {
        const job = await getJob(req.params.id);
        const [enriched] = await enrichJobsWithClientReputation([job]);
        await cache.set(cacheKey, enriched, cache.TTL.JOB_DETAIL);
        return enriched;
      });
      res.set("X-Cache", "MISS");
      res.json({ success: true, data: jobWithRep });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/jobs:
 *   post:
 *     summary: Create a new job
 *     description: Creates a new job posting in the marketplace
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - budget
 *               - clientId
 *             properties:
 *               title:
 *                 type: string
 *                 description: Detailed job description
 *               clientAddress:
 *                 type: string
 *                 description: Client's Stellar address
 *               budget:
 *                 type: number
 *                 description: Job budget in XLM
 *               clientId:
 *                 type: string
 *                 description: Client's Stellar address
 *               category:
 *                 type: string
 *                 description: Job category
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Required skills
 *               visibility:
 *                 type: string
 *                 enum: [public, private]
 *                 default: public
 *                 description: Job visibility
 *     responses:
 *       201:
 *         description: Job created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       400:
 *         description: Bad request - invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /api/jobs — create a new job
router.post("/", jobCreationRateLimiter, verifyJWT, async (req, res, next) => {
  try {
    const signedAddress = req.user?.publicKey;
    const payloadClientAddress =
      typeof req.body.clientAddress === "string" ? req.body.clientAddress.trim() : "";

    if (!signedAddress || !payloadClientAddress) {
      return res.status(401).json({
        error: "Unauthorized: clientAddress is required and must match the signed wallet address",
      });
    }

    if (payloadClientAddress !== signedAddress) {
      return res
        .status(401)
        .json({ error: "Unauthorized: clientAddress does not match signed wallet address" });
    }

    const job = await createJob({ ...req.body, clientAddress: signedAddress });
    res.status(201).json({ success: true, data: job });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/view:
 *   post:
 *     summary: Increment a job's view count
 *     description: Increments the job's `view_count` by 1 and returns the new count. No authentication required.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: View count incremented
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
 *                     viewCount:
 *                       type: integer
 *                       example: 43
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
// POST /api/jobs/:id/view — increment view count
router.post("/:id/view", generalJobRateLimiter, async (req, res, next) => {
  try {
    const viewCount = await incrementViewCount(req.params.id);
    res.json({ success: true, data: { viewCount } });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/invite:
 *   post:
 *     summary: Invite a freelancer to an invite-only job
 *     description: >
 *       Creates (or resets to pending) an invitation for a freelancer on a job whose
 *       `visibility` is `invite_only`. Only the job's client (the authenticated
 *       caller) may invite. Queues email, webhook, and in-app notifications to the
 *       freelancer and broadcasts a `job:invited` realtime event.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - freelancerAddress
 *             properties:
 *               freelancerAddress:
 *                 type: string
 *                 description: Stellar public key (G-address) of the freelancer to invite
 *           example:
 *             freelancerAddress: GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37
 *     responses:
 *       201:
 *         description: Invitation created or reset to pending
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
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     job_id:
 *                       type: string
 *                       format: uuid
 *                     client_address:
 *                       type: string
 *                     freelancer_address:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: pending
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid Stellar public key, or job is not invite-only
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invitations are only available for invite-only jobs
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the job client can invite freelancers
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
// POST /api/jobs/:id/invite — invite freelancer to invite-only job
router.post("/:id/invite", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { inviteFreelancerToJob } = require("../services/jobInvitationService");
    const invitation = await inviteFreelancerToJob({
      jobId: req.params.id,
      clientAddress: req.user.publicKey,
      freelancerAddress: req.body.freelancerAddress,
    });

    req.app.locals.broadcastRealtime?.("job:invited", {
      jobId: req.params.id,
      recipientAddress: invitation.freelancer_address,
      invitedAt: invitation.created_at,
    });

    res.status(201).json({ success: true, data: invitation });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/escrow:
 *   patch:
 *     summary: Store the escrow contract ID after an on-chain escrow lock
 *     description: >
 *       Records the Soroban escrow contract id on the job, upserts a row in the
 *       `escrows` table (amount and milestones snapshotted from the job), and logs
 *       a `create_escrow` contract-interaction audit entry. If `referrerAddress`
 *       is a syntactically valid Stellar G-address it is stored on the escrow row
 *       for the platform-fee referral split; an invalid or missing referrer is
 *       silently dropped, and a referrer whose profile does not yet exist is
 *       recorded as `null` (the escrow is still created).
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - escrowContractId
 *             properties:
 *               escrowContractId:
 *                 type: string
 *                 description: Soroban escrow contract ID
 *               referrerAddress:
 *                 type: string
 *                 nullable: true
 *                 description: Optional Stellar G-address of the referrer for the platform-fee split
 *           example:
 *             escrowContractId: CCESCROWCONTRACTID7QVMXTFHV6ZK4DVWSCXP3TQBHOKY3XV5G6ORLXK7Q
 *             referrerAddress: GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37
 *     responses:
 *       200:
 *         description: Job updated with the escrow contract ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       400:
 *         description: Missing or non-string escrowContractId
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid escrow contract ID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
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
// PATCH /api/jobs/:id/escrow — store escrow contract ID after on-chain lock
router.patch("/:id/escrow", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { escrowContractId, referrerAddress } = req.body;
    const job = await updateJobEscrowId(req.params.id, escrowContractId, referrerAddress);
    await logContractInteraction({
      functionName: "create_escrow",
      callerAddress: req.user.publicKey,
      jobId: req.params.id,
      txHash: escrowContractId,
    });
    res.json({ success: true, data: job });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/boost:
 *   patch:
 *     summary: Boost a job listing after an on-chain XLM payment
 *     description: >
 *       Marks the job as `boosted` so it sorts above non-boosted jobs in
 *       `GET /api/jobs`. Boost duration is derived from `amountXlm`: 15 XLM or
 *       more grants 30 days, anything less (including a missing/unparseable
 *       amount, which is treated as 0) grants 7 days. `txHash` is required but
 *       is not itself verified against the ledger by this endpoint.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHash
 *             properties:
 *               txHash:
 *                 type: string
 *                 description: Transaction hash of the boost payment
 *               amountXlm:
 *                 type: number
 *                 description: XLM amount paid; >=15 grants 30 days, otherwise 7 days
 *           example:
 *             txHash: 8b1b0e6f2a1c4d9e7f3a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e
 *             amountXlm: 15
 *     responses:
 *       200:
 *         description: Job boosted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       400:
 *         description: Missing or non-string txHash
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Transaction hash is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
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
// PATCH /api/jobs/:id/boost — boost a job listing for 7 days
router.patch("/:id/boost", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { txHash, amountXlm } = req.body;
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({ success: false, error: "Transaction hash is required" });
    }

    // Determine boost duration from payment amount
    // 5 XLM = 7 days, 15 XLM = 30 days
    const amount = parseFloat(amountXlm) || 0;
    const boostDays = amount >= 15 ? 30 : 7;

    const job = await boostJob(req.params.id, txHash, boostDays);
    res.json({ success: true, data: job });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/analytics:
 *   get:
 *     summary: Get performance analytics for a job
 *     description: >
 *       Returns application, view, and bid statistics for the job plus a
 *       predicted completion date generated by a simple linear-regression model
 *       (`prediction`). No authentication required.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: Job analytics
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
 *                     jobId:
 *                       type: string
 *                       format: uuid
 *                     title:
 *                       type: string
 *                     applicantCount:
 *                       type: integer
 *                       example: 12
 *                     totalApplications:
 *                       type: integer
 *                       example: 12
 *                     acceptedApplications:
 *                       type: integer
 *                       example: 1
 *                     averageBid:
 *                       type: string
 *                       example: "480.5000000"
 *                     avgBid:
 *                       type: string
 *                       example: "480.5000000"
 *                     minBid:
 *                       type: string
 *                       example: "300.0000000"
 *                     maxBid:
 *                       type: string
 *                       example: "650.0000000"
 *                     views:
 *                       type: integer
 *                       example: 210
 *                     totalViews:
 *                       type: integer
 *                       example: 210
 *                     uniqueViews:
 *                       type: integer
 *                       example: 150
 *                     applicationsPerDay:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           day:
 *                             type: string
 *                             example: "2026-08-15"
 *                           count:
 *                             type: integer
 *                             example: 3
 *                     averageBidAmount:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           currency:
 *                             type: string
 *                             example: XLM
 *                           avgBid:
 *                             type: number
 *                             example: 480.5
 *                           count:
 *                             type: integer
 *                             example: 8
 *                     applicationStatusCounts:
 *                       type: object
 *                       properties:
 *                         pending:
 *                           type: integer
 *                         accepted:
 *                           type: integer
 *                         rejected:
 *                           type: integer
 *                       example:
 *                         pending: 9
 *                         accepted: 1
 *                         rejected: 2
 *                     skillDistribution:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 *                       example:
 *                         Rust: 5
 *                         Soroban: 4
 *                     daysToHire:
 *                       type: number
 *                       nullable: true
 *                       example: 3.2
 *                     prediction:
 *                       type: object
 *                       properties:
 *                         estimatedDurationDays:
 *                           type: number
 *                           example: 6.5
 *                         estimatedCompletionDate:
 *                           type: string
 *                           format: date-time
 *                         confidenceScore:
 *                           type: integer
 *                           example: 82
 *                         freelancerStats:
 *                           type: object
 *                           properties:
 *                             completedJobs:
 *                               type: integer
 *                               example: 4
 *                             rating:
 *                               type: number
 *                               example: 4.5
 *                             onTimeRate:
 *                               type: integer
 *                               nullable: true
 *                               example: 75
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
// GET /api/jobs/:id/analytics — job performance analytics
router.get("/:id/analytics", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { getJobAnalytics } = require("../services/jobService");
    const analytics = await getJobAnalytics(req.params.id);
    res.json({ success: true, data: analytics });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/extend:
 *   patch:
 *     summary: Extend a job's expiry date
 *     description: >
 *       Extends `expiresAt` by 7, 14, or 30 days (any other value in `days`
 *       falls back to 30, then is re-validated against the same allow-list — so
 *       an invalid value such as `5` triggers the 400 below). Only the job's
 *       client may extend, and the cumulative extension since the job's original
 *       expiry (or creation date, if no expiry was ever set) cannot exceed 90
 *       days. A fee of 0.5 XLM per 7-day block is calculated and returned as
 *       `extensionFeeXlm` on the job, but is not itself charged/verified by this
 *       endpoint.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               days:
 *                 type: integer
 *                 enum: [7, 14, 30]
 *                 default: 30
 *                 description: Number of days to extend the expiry by
 *           example:
 *             days: 14
 *     responses:
 *       200:
 *         description: Job expiry extended
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/Job'
 *                     - type: object
 *                       properties:
 *                         extensionFeeXlm:
 *                           type: string
 *                           description: Fee owed for this extension (0.5 XLM per 7-day block), as a fixed-point string
 *                           example: "1.0000000"
 *       400:
 *         description: days is not 7, 14, or 30, or the 90-day cumulative extension cap was exceeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Extension days must be 7, 14, or 30
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the job owner can extend expiry
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
// PATCH /api/jobs/:id/extend — extend job expiry with XLM fee
// Validates: only job owner, max 90-day total extension, charges 0.5 XLM per 7-day block
router.patch("/:id/extend", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { days } = req.body;
    const validDays = [7, 14, 30];
    const daysNum = parseInt(days, 10) || 30;
    if (!validDays.includes(daysNum)) {
      return res.status(400).json({
        success: false,
        error: "Extension days must be 7, 14, or 30",
      });
    }
    const job = await extendJobExpiry(req.params.id, daysNum, req.user.publicKey);
    res.json({ success: true, data: job });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/referral:
 *   post:
 *     summary: Track a referral click on a job listing
 *     description: Increments the job's `share_count`. No authentication required.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - referrer
 *             properties:
 *               referrer:
 *                 type: string
 *                 description: Identifier/address of the referrer whose link was clicked
 *           example:
 *             referrer: GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37
 *     responses:
 *       200:
 *         description: Share count incremented
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *       400:
 *         description: Referrer address is missing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Referrer address is required
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
// POST /api/jobs/:id/referral — track a referral click
router.post("/:id/referral", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { referrer } = req.body;
    if (!referrer)
      return res.status(400).json({ success: false, error: "Referrer address is required" });
    await incrementShareCount(req.params.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}:
 *   delete:
 *     summary: Delete a job
 *     description: >
 *       Permanently deletes the job row. Intended for rolling back an orphaned
 *       job whose on-chain escrow lock failed after creation. There is no
 *       ownership check in this handler — any authenticated caller can delete
 *       any job by id.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: Job deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
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
// DELETE /api/jobs/:id — roll back an orphaned job (escrow failed after creation)
router.delete("/:id", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    await deleteJob(req.params.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/report:
 *   post:
 *     summary: Report a job listing
 *     description: >
 *       Records a report against a job for moderation. Reports are stored
 *       in-process in a `Map` (not persisted to the database, and lost on
 *       restart), keyed by `jobId:reporterAddress`, so the same reporter address
 *       can only report a given job once. There is no check that the job id
 *       actually exists. No authentication required.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 20
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reporterAddress
 *               - category
 *             properties:
 *               reporterAddress:
 *                 type: string
 *                 description: Stellar address of the reporting user
 *               category:
 *                 type: string
 *                 enum: [fraud, suspicious, spam, inappropriate, other]
 *               description:
 *                 type: string
 *                 description: Optional free-text details, truncated to 1000 characters
 *           example:
 *             reporterAddress: GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37
 *             category: spam
 *             description: This listing was posted multiple times with different titles.
 *     responses:
 *       201:
 *         description: Report recorded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Thank you for your report
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "1755000000000-a1b2c3"
 *                     jobId:
 *                       type: string
 *                       format: uuid
 *                     reporterAddress:
 *                       type: string
 *                     category:
 *                       type: string
 *                       example: spam
 *                     description:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Reporter address missing, or category is not a valid report category
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Valid report category is required
 *       409:
 *         description: This reporter has already reported this job
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: You have already reported this job
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/jobs/:id/report — report a job
router.post("/:id/report", reportJobRateLimiter, (req, res, next) => {
  try {
    const { reporterAddress, category, description } = req.body;
    const jobId = req.params.id;
    const normalizedReporterAddress = normalizeAddress(reporterAddress);

    if (!normalizedReporterAddress)
      return res.status(400).json({ success: false, error: "Reporter address is required" });
    if (!isValidReportCategory(category))
      return res.status(400).json({ success: false, error: "Valid report category is required" });

    const duplicateKey = `${jobId}:${normalizedReporterAddress}`;
    if (jobReports.has(duplicateKey))
      return res.status(409).json({ success: false, error: "You have already reported this job" });

    const report = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      jobId,
      reporterAddress: normalizedReporterAddress,
      category,
      description: typeof description === "string" ? description.trim().slice(0, 1000) : "",
      createdAt: new Date().toISOString(),
    };

    jobReports.set(duplicateKey, report);
    res.status(201).json({
      success: true,
      message: "Thank you for your report",
      data: report,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/dispute:
 *   post:
 *     summary: Raise a dispute for an in-progress job
 *     description: >
 *       Moves the job's status from `in_progress` to `disputed` and records
 *       `disputeReason`/`disputeDescription`/`disputedBy`/`disputedAt`. Only
 *       jobs currently `in_progress` can be disputed. Queues an in-app and
 *       decentralized notification to both the client and the freelancer.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *               - description
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Short reason for the dispute
 *               description:
 *                 type: string
 *                 description: Detailed description of the dispute
 *           example:
 *             reason: Milestone not delivered
 *             description: The freelancer stopped responding after receiving the first milestone payment.
 *     responses:
 *       200:
 *         description: Dispute raised
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       400:
 *         description: reason or description missing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Reason and description are required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Job not found, or job is not currently in_progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found or not in progress
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/jobs/:id/dispute — raise a dispute for an in-progress job
router.post("/:id/dispute", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { reason, description } = req.body;
    if (!reason || !description) {
      return res.status(400).json({
        success: false,
        error: "Reason and description are required",
      });
    }
    const job = await raiseDispute(req.params.id, {
      reason,
      description,
      raisedBy: req.user.publicKey,
    });
    res.json({ success: true, data: job });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/{id}/resolve:
 *   post:
 *     summary: Resolve a dispute (admin only)
 *     description: >
 *       Moves the job's status from `disputed` back to `in_progress` and
 *       clears the dispute fields. Admin gating here is a legacy ad-hoc check
 *       (not the `requireAdminRole` middleware / `role` JWT claim used
 *       elsewhere): if the `ADMIN_PUBLIC_KEY` environment variable is set, the
 *       caller's `publicKey` must equal it exactly, or a 403 is returned; if
 *       `ADMIN_PUBLIC_KEY` is unset, this check is skipped entirely and any
 *       authenticated caller can resolve any dispute.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: Dispute resolved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller's publicKey does not match ADMIN_PUBLIC_KEY
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Only admins can resolve disputes
 *       404:
 *         description: Job not found, or job is not currently disputed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found or not disputed
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/jobs/:id/resolve — resolve a dispute (Admin only)
router.post("/:id/resolve", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    // Basic admin check - in a real app this would be more robust
    const adminKey = process.env.ADMIN_PUBLIC_KEY;
    if (adminKey && req.user.publicKey !== adminKey) {
      return res.status(403).json({ success: false, error: "Only admins can resolve disputes" });
    }

    const job = await resolveDispute(req.params.id);
    res.json({ success: true, data: job });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/feed.rss:
 *   get:
 *     summary: RSS 2.0 feed of open jobs (UNREACHABLE — shadowed by GET /api/jobs/{id})
 *     description: >
 *       **This handler never actually runs.** `GET /api/jobs/:id` is registered
 *       earlier in this router and matches any single-segment GET path, so a
 *       real request to `/api/jobs/feed.rss` is routed to the `:id` handler with
 *       `id` set to the literal string `"feed.rss"`. Because `jobs.id` is a
 *       PostgreSQL `UUID` column, that value fails UUID parsing and the request
 *       actually receives a `500` error — not the RSS XML this code below would
 *       produce (an XML feed of the 20 most recent open jobs, optionally
 *       filtered by `category`, `skills`, `min_budget`, `max_budget`, with
 *       `Content-Type: application/rss+xml`). Documented here for the code as
 *       written; see `GET /api/jobs/{id}` for the response actually returned.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: (Unreachable) intended category filter — ignored in practice, see description
 *         example: Smart Contracts
 *       - in: query
 *         name: skills
 *         schema:
 *           type: string
 *         description: (Unreachable) intended comma-separated skills filter
 *         example: Rust,Soroban
 *       - in: query
 *         name: min_budget
 *         schema:
 *           type: number
 *         description: (Unreachable) intended minimum budget filter
 *         example: 100
 *       - in: query
 *         name: max_budget
 *         schema:
 *           type: number
 *         description: (Unreachable) intended maximum budget filter
 *         example: 5000
 *     responses:
 *       500:
 *         description: >
 *           Actual real-world response — the literal path segment "feed.rss" is
 *           passed to the /:id handler as a job id and fails UUID validation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: 'invalid input syntax for type uuid: "feed.rss"'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/jobs/feed.rss — RSS 2.0 feed
router.get("/feed.rss", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category, skills, min_budget, max_budget } = req.query;
    const result = await listJobs({ category, status: "open", limit: 50 });
    const jobs = filterFeedJobs(result.jobs, { skills, min_budget, max_budget }).slice(0, 20);
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const feedUrl = `${baseUrl}/api/jobs/feed.rss${category ? `?category=${encodeURIComponent(category)}` : ""}`;
    const lastBuildDate =
      jobs.length > 0 ? formatDateRss(new Date(jobs[0].createdAt)) : formatDateRss(new Date());

    let rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(`Stellar MarketPay — Job Listings${feedTitleSuffix({ category, skills })}`)}</title>
    <description>Latest freelance job opportunities on Stellar MarketPay</description>
    <link>${baseUrl}/jobs</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
`;

    jobs.forEach((job) => {
      const jobUrl = `${baseUrl}/jobs/${job.id}`;
      const pubDate = formatDateRss(new Date(job.createdAt));
      const description = escapeXml(truncateDescription(job.description, 200));
      rss += `    <item>
      <title>${escapeXml(job.title)}</title>
      <description>${description}</description>
      <link>${jobUrl}</link>
      <guid isPermaLink="true">${jobUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <category>${escapeXml(job.category)}</category>
      <dc:creator>${escapeXml(job.clientDisplayName || job.clientAddress || "Anonymous")}</dc:creator>
      <skills>${escapeXml((job.skills || []).join(", "))}</skills>
      <budget>${escapeXml(job.budget.toString())} XLM</budget>
    </item>
`;
    });

    rss += `  </channel>
</rss>`;

    res.set("Content-Type", "application/rss+xml; charset=utf-8");
    res.send(rss);
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/feed.atom:
 *   get:
 *     summary: Atom feed of open jobs (UNREACHABLE — shadowed by GET /api/jobs/{id})
 *     description: >
 *       **This handler never actually runs.** `GET /api/jobs/:id` is registered
 *       earlier in this router and matches any single-segment GET path, so a
 *       real request to `/api/jobs/feed.atom` is routed to the `:id` handler
 *       with `id` set to the literal string `"feed.atom"`, which fails UUID
 *       parsing and returns a `500` error — not the Atom XML feed this code
 *       below would produce (the same 20 most recent open jobs as feed.rss,
 *       serialized as an Atom 1.0 feed with `Content-Type: application/atom+xml`).
 *       Documented here for the code as written; see `GET /api/jobs/{id}` for
 *       the response actually returned.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: (Unreachable) intended category filter — ignored in practice, see description
 *         example: Smart Contracts
 *       - in: query
 *         name: skills
 *         schema:
 *           type: string
 *         description: (Unreachable) intended comma-separated skills filter
 *         example: Rust,Soroban
 *       - in: query
 *         name: min_budget
 *         schema:
 *           type: number
 *         description: (Unreachable) intended minimum budget filter
 *         example: 100
 *       - in: query
 *         name: max_budget
 *         schema:
 *           type: number
 *         description: (Unreachable) intended maximum budget filter
 *         example: 5000
 *     responses:
 *       500:
 *         description: >
 *           Actual real-world response — the literal path segment "feed.atom" is
 *           passed to the /:id handler as a job id and fails UUID validation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: 'invalid input syntax for type uuid: "feed.atom"'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/jobs/feed.atom
router.get("/feed.atom", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category, skills, min_budget, max_budget } = req.query;
    const result = await listJobs({ category, status: "open", limit: 50 });
    const jobs = filterFeedJobs(result.jobs, { skills, min_budget, max_budget }).slice(0, 20);
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const feedUrl = `${baseUrl}/api/jobs/feed.atom${category ? `?category=${encodeURIComponent(category)}` : ""}`;
    const updatedDate =
      jobs.length > 0 ? formatDateAtom(new Date(jobs[0].createdAt)) : formatDateAtom(new Date());

    let atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(`Stellar MarketPay — Job Listings${feedTitleSuffix({ category, skills })}`)}</title>
  <subtitle>Latest freelance job opportunities on Stellar MarketPay</subtitle>
  <link href="${baseUrl}/jobs" rel="alternate" type="text/html" />
  <link href="${feedUrl}" rel="self" type="application/atom+xml" />
  <updated>${updatedDate}</updated>
  <id>${feedUrl}</id>
`;

    jobs.forEach((job) => {
      const jobUrl = `${baseUrl}/jobs/${job.id}`;
      const published = formatDateAtom(new Date(job.createdAt));
      const summary = escapeXml(truncateDescription(job.description, 200));
      atom += `  <entry>
    <title>${escapeXml(job.title)}</title>
    <summary>${summary}</summary>
    <link href="${jobUrl}" rel="alternate" type="text/html" />
    <id>${jobUrl}</id>
    <published>${published}</published>
    <updated>${published}</updated>
    <author><name>${escapeXml(job.clientDisplayName || job.clientAddress || "Anonymous")}</name></author>
    <category term="${escapeXml(job.category)}" />
    <skills>${escapeXml((job.skills || []).join(", "))}</skills>
    <budget>${escapeXml(job.budget.toString())} XLM</budget>
  </entry>
`;
    });

    atom += `</feed>`;
    res.set("Content-Type", "application/atom+xml; charset=utf-8");
    res.send(atom);
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/drafts:
 *   get:
 *     summary: List the authenticated user's job drafts (UNREACHABLE — shadowed by GET /api/jobs/{id})
 *     description: >
 *       **This handler never actually runs, and its `verifyJWT` requirement is
 *       never enforced.** `GET /api/jobs/:id` is registered earlier in this
 *       router and matches any single-segment GET path — including this one —
 *       before Express ever reaches this route or its `verifyJWT` middleware.
 *       A real (even unauthenticated) request to `/api/jobs/drafts` is routed
 *       to the `:id` handler with `id` set to the literal string `"drafts"`,
 *       which fails UUID parsing and returns a `500` error — not the caller's
 *       5 most recently updated drafts this code below would return.
 *       Documented here for the code as written; see `GET /api/jobs/{id}` for
 *       the response actually returned.
 *     tags: [Jobs]
 *     responses:
 *       500:
 *         description: >
 *           Actual real-world response — the literal path segment "drafts" is
 *           passed to the /:id handler as a job id and fails UUID validation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: 'invalid input syntax for type uuid: "drafts"'
 */
// GET /api/jobs/drafts — list job drafts for authenticated user
router.get("/drafts", verifyJWT, async (req, res, next) => {
  try {
    const drafts = await jobDraftService.getDrafts(req.user.publicKey, 5);
    res.json({ success: true, data: drafts });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/drafts:
 *   post:
 *     summary: Save or update a job draft
 *     description: >
 *       Creates a new draft, or updates an existing one owned by the caller
 *       when `id` is included in the body. Returns the raw `job_drafts` row
 *       (snake_case column names, not the camelCased `Job` shape used
 *       elsewhere). Not shadowed by the `/:id` route-ordering bug since this
 *       is a POST, not a GET.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 format: uuid
 *                 description: Existing draft id to update; omit to create a new draft
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               budget:
 *                 type: number
 *               category:
 *                 type: string
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *               currency:
 *                 type: string
 *                 enum: [XLM, USDC]
 *               timezone:
 *                 type: string
 *               visibility:
 *                 type: string
 *                 enum: [public, private, invite_only]
 *               screeningQuestions:
 *                 type: array
 *                 items:
 *                   type: string
 *               deadline:
 *                 type: string
 *                 format: date-time
 *           example:
 *             title: Build a Soroban escrow contract
 *             description: Looking for an experienced Rust developer to build and audit a milestone-based escrow contract.
 *             budget: 750
 *             category: Smart Contracts
 *             skills: [Rust, Soroban]
 *             currency: XLM
 *             visibility: public
 *     responses:
 *       201:
 *         description: Draft saved
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
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     client_address:
 *                       type: string
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     budget:
 *                       type: string
 *                       example: "750.0000000"
 *                     category:
 *                       type: string
 *                     skills:
 *                       type: array
 *                       items:
 *                         type: string
 *                     currency:
 *                       type: string
 *                       example: XLM
 *                     timezone:
 *                       type: string
 *                       nullable: true
 *                     visibility:
 *                       type: string
 *                       example: public
 *                     screening_questions:
 *                       type: array
 *                       items:
 *                         type: string
 *                     deadline:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// POST /api/jobs/drafts — save or update a job draft
router.post("/drafts", verifyJWT, async (req, res, next) => {
  try {
    const draft = await jobDraftService.saveDraft(req.user.publicKey, req.body);
    res.status(201).json({ success: true, data: draft });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/drafts/{id}:
 *   get:
 *     summary: Get a specific job draft
 *     description: >
 *       Returns the caller's draft by id, scoped to `client_address` so a
 *       draft owned by another user is treated as not found. Not shadowed by
 *       the `/:id` route-ordering bug since this path has two segments.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Draft UUID
 *         example: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *     responses:
 *       200:
 *         description: Draft found
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
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     client_address:
 *                       type: string
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     budget:
 *                       type: string
 *                       example: "750.0000000"
 *                     category:
 *                       type: string
 *                     skills:
 *                       type: array
 *                       items:
 *                         type: string
 *                     currency:
 *                       type: string
 *                       example: XLM
 *                     visibility:
 *                       type: string
 *                       example: public
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Draft not found (or not owned by the caller)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Draft not found
 */
// GET /api/jobs/drafts/:id — get a specific draft
router.get("/drafts/:id", verifyJWT, async (req, res, next) => {
  try {
    const draft = await jobDraftService.getDraft(req.params.id, req.user.publicKey);
    if (!draft) return res.status(404).json({ success: false, error: "Draft not found" });
    res.json({ success: true, data: draft });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/drafts/{id}:
 *   delete:
 *     summary: Delete a job draft
 *     description: >
 *       Deletes the draft scoped to the caller's `client_address`. The
 *       handler always responds `{ success: true }` regardless of whether a
 *       matching row actually existed — deleting an id that doesn't exist, or
 *       one owned by another user, is not an error. Not shadowed by the
 *       `/:id` route-ordering bug since this path has two segments.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Draft UUID
 *         example: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *     responses:
 *       200:
 *         description: Draft deleted (or no matching draft existed)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// DELETE /api/jobs/drafts/:id — delete a draft
router.delete("/drafts/:id", verifyJWT, async (req, res, next) => {
  try {
    await jobDraftService.deleteDraft(req.params.id, req.user.publicKey);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/recommended:
 *   get:
 *     summary: Get personalized job recommendations (UNREACHABLE — shadowed by GET /api/jobs/{id})
 *     description: >
 *       **This handler never actually runs, and its `verifyJWT` requirement is
 *       never enforced.** `GET /api/jobs/:id` is registered earlier in this
 *       router and matches any single-segment GET path — including this one —
 *       before Express ever reaches this route. A real (even unauthenticated)
 *       request to `/api/jobs/recommended` is routed to the `:id` handler with
 *       `id` set to the literal string `"recommended"`, which fails UUID
 *       parsing and returns a `500` error — not the scored recommendations
 *       (skill match + budget alignment + reputation) this code below would
 *       produce. Note this is a different, more elaborate scoring algorithm
 *       than the one behind `GET /api/jobs/recommended/{publicKey}`, which
 *       IS reachable (two path segments, registered before `/:id`).
 *     tags: [Jobs]
 *     responses:
 *       500:
 *         description: >
 *           Actual real-world response — the literal path segment "recommended"
 *           is passed to the /:id handler as a job id and fails UUID validation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: 'invalid input syntax for type uuid: "recommended"'
 */
// GET /api/jobs/recommended — get personalized job recommendations
router.get("/recommended", verifyJWT, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const recommendations = await recommendationService.getRecommendations(
      req.user.publicKey,
      limit
    );
    res.json({ success: true, data: recommendations });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/suggest:
 *   get:
 *     summary: Get autocomplete suggestions for job search (UNREACHABLE — shadowed by GET /api/jobs/{id})
 *     description: >
 *       **This handler never actually runs, and its dedicated 20-per-minute
 *       rate limiter is never applied.** `GET /api/jobs/:id` is registered
 *       earlier in this router (with a 100-per-minute limiter) and matches any
 *       single-segment GET path — including this one — before Express ever
 *       reaches this route or its `suggestRateLimiter` middleware. A real
 *       request to `/api/jobs/suggest?q=...` is routed to the `:id` handler
 *       with `id` set to the literal string `"suggest"` (the `q` query string
 *       is ignored entirely, since the `:id` handler never reads `req.query`),
 *       which fails UUID parsing and returns a `500` error — not the
 *       `{ titles, skills, categories }` autocomplete payload this code below
 *       would produce.
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: (Unreachable) intended search prefix, minimum 2 characters
 *         example: sma
 *     responses:
 *       500:
 *         description: >
 *           Actual real-world response — the literal path segment "suggest" is
 *           passed to the /:id handler as a job id and fails UUID validation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: 'invalid input syntax for type uuid: "suggest"'
 */
// GET /api/jobs/suggest — get job suggestions for autocomplete
router.get("/suggest", suggestRateLimiter, async (req, res, next) => {
  try {
    const q = req.query.q || "";
    const suggestions = await getSuggestions(q);
    res.json({ success: true, data: suggestions });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/analytics/categories:
 *   get:
 *     summary: Get job statistics grouped by category
 *     description: >
 *       Returns per-category counts and averages across all jobs (not just
 *       open ones). Not shadowed by the `/:id` route-ordering bug since this
 *       path has two segments. No authentication required.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Per-category analytics
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
 *                       category:
 *                         type: string
 *                         example: Smart Contracts
 *                       jobCount:
 *                         type: integer
 *                         example: 42
 *                       avgBudgetXLM:
 *                         type: number
 *                         example: 612.5
 *                       filledCount:
 *                         type: integer
 *                         example: 30
 *                       avgDaysToFill:
 *                         type: number
 *                         nullable: true
 *                         example: 2.4
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/analytics/categories — stats per category
router.get("/analytics/categories", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { getCategoryAnalytics } = require("../services/jobService");
    const data = await getCategoryAnalytics();
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/analytics/overview:
 *   get:
 *     summary: Get platform-wide job totals
 *     description: >
 *       Returns aggregate counts and averages across all jobs on the platform.
 *       Not shadowed by the `/:id` route-ordering bug since this path has two
 *       segments. No authentication required.
 *     tags: [Jobs]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Platform-wide analytics
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
 *                     totalJobs:
 *                       type: integer
 *                       example: 512
 *                     openJobs:
 *                       type: integer
 *                       example: 120
 *                     inProgressJobs:
 *                       type: integer
 *                       example: 80
 *                     completedJobs:
 *                       type: integer
 *                       example: 290
 *                     avgBudgetXLM:
 *                       type: number
 *                       example: 580.25
 *                     totalFilled:
 *                       type: integer
 *                       example: 370
 *                     avgDaysToFill:
 *                       type: number
 *                       nullable: true
 *                       example: 3.1
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/analytics/overview — platform-wide totals
router.get("/analytics/overview", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { getAnalyticsOverview } = require("../services/jobService");
    const data = await getAnalyticsOverview();
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/bulk-cancel:
 *   post:
 *     summary: Cancel multiple open jobs owned by the caller
 *     description: >
 *       Attempts to cancel every job id in `jobIds`. Each job is only cancelled
 *       if it is currently `open` AND owned by the caller; any id that doesn't
 *       meet both conditions (wrong owner, wrong status, or non-existent id)
 *       is reported as `success: false` in `results` rather than causing the
 *       whole request to fail.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobIds
 *             properties:
 *               jobIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 minItems: 1
 *           example:
 *             jobIds:
 *               - 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *               - 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *     responses:
 *       200:
 *         description: Bulk cancel results
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
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           success:
 *                             type: boolean
 *                     succeeded:
 *                       type: integer
 *                       example: 1
 *                     failed:
 *                       type: integer
 *                       example: 1
 *             example:
 *               success: true
 *               data:
 *                 results:
 *                   - id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                     success: true
 *                   - id: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *                     success: false
 *                 succeeded: 1
 *                 failed: 1
 *       400:
 *         description: jobIds missing or empty
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: jobIds must be a non-empty array
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/jobs/bulk-cancel — cancel multiple open jobs at once
router.post("/bulk-cancel", verifyJWT, jobCreationRateLimiter, async (req, res, next) => {
  try {
    const { jobIds } = req.body;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ success: false, error: "jobIds must be a non-empty array" });
    }
    const { bulkCancelJobs } = require("../services/jobService");
    const results = await bulkCancelJobs(jobIds, req.user.publicKey);
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    res.json({
      success: true,
      data: { results, succeeded, failed },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/bulk-extend:
 *   post:
 *     summary: Extend expiry for multiple jobs owned by the caller
 *     description: >
 *       Calls the same per-job extension logic as `PATCH /api/jobs/{id}/extend`
 *       (owner check, 7/14/30-day allow-list, 90-day cumulative cap, 0.5 XLM
 *       per 7-day block) for every id in `jobIds`, defaulting `days` to 30 when
 *       omitted. Any id that fails its own validation (not owned by caller,
 *       invalid days, cap exceeded, or not found) is reported as
 *       `success: false` in `results` rather than failing the whole request.
 *       On success, the full updated job (camelCased, including
 *       `extensionFeeXlm`) is spread into that result entry alongside `id` and
 *       `success`.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobIds
 *             properties:
 *               jobIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 minItems: 1
 *               days:
 *                 type: integer
 *                 enum: [7, 14, 30]
 *                 default: 30
 *           example:
 *             jobIds:
 *               - 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *               - 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *             days: 14
 *     responses:
 *       200:
 *         description: Bulk extend results
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
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           success:
 *                             type: boolean
 *                     succeeded:
 *                       type: integer
 *                       example: 1
 *                     failed:
 *                       type: integer
 *                       example: 1
 *             example:
 *               success: true
 *               data:
 *                 results:
 *                   - id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                     success: true
 *                     status: open
 *                     extensionFeeXlm: "1.0000000"
 *                   - id: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *                     success: false
 *                 succeeded: 1
 *                 failed: 1
 *       400:
 *         description: jobIds missing or empty
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: jobIds must be a non-empty array
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/jobs/bulk-extend — extend expiry for multiple jobs at once
router.post("/bulk-extend", verifyJWT, jobCreationRateLimiter, async (req, res, next) => {
  try {
    const { jobIds, days } = req.body;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ success: false, error: "jobIds must be a non-empty array" });
    }
    const { bulkExtendJobs } = require("../services/jobService");
    const results = await bulkExtendJobs(jobIds, req.user.publicKey, days || 30);
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    res.json({
      success: true,
      data: { results, succeeded, failed },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs/bulk-boost:
 *   post:
 *     summary: Boost multiple jobs at once using a single payment
 *     description: >
 *       Boosts every job id in `jobIds` for 7 days each (this bulk path always
 *       calls the underlying boost with the default 7-day duration — it does
 *       not accept an `amountXlm` to opt into the 30-day tier the way
 *       `PATCH /api/jobs/{id}/boost` does). The same `txHash` is applied to
 *       every job. Unlike bulk-cancel/bulk-extend, there is no ownership check
 *       per job here — any authenticated caller can boost any existing job id.
 *       A non-existent job id is reported as `success: false`.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobIds
 *               - txHash
 *             properties:
 *               jobIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 minItems: 1
 *               txHash:
 *                 type: string
 *                 description: Transaction hash of the boost payment, applied to every job in jobIds
 *           example:
 *             jobIds:
 *               - 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *               - 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *             txHash: 8b1b0e6f2a1c4d9e7f3a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e
 *     responses:
 *       200:
 *         description: Bulk boost results
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
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           success:
 *                             type: boolean
 *                           boostedUntil:
 *                             type: string
 *                             format: date-time
 *                             nullable: true
 *                     succeeded:
 *                       type: integer
 *                       example: 1
 *                     failed:
 *                       type: integer
 *                       example: 1
 *             example:
 *               success: true
 *               data:
 *                 results:
 *                   - id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                     success: true
 *                     boostedUntil: "2026-08-28T00:00:00.000Z"
 *                   - id: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
 *                     success: false
 *                 succeeded: 1
 *                 failed: 1
 *       400:
 *         description: jobIds missing/empty, or txHash missing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: txHash is required for bulk boost
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/jobs/bulk-boost — boost multiple jobs at once
router.post("/bulk-boost", verifyJWT, jobCreationRateLimiter, async (req, res, next) => {
  try {
    const { jobIds, txHash } = req.body;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ success: false, error: "jobIds must be a non-empty array" });
    }
    if (!txHash) {
      return res.status(400).json({ success: false, error: "txHash is required for bulk boost" });
    }
    const { bulkBoostJobs } = require("../services/jobService");
    const results = await bulkBoostJobs(jobIds, req.user.publicKey, txHash);
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    res.json({
      success: true,
      data: { results, succeeded, failed },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
