"use strict";

const express = require("express");
const router = express.Router();
const { createApiKeyRateLimiter, requireApiKey } = require("../middleware/apiKey");
const {
  listPublicJobs,
  getPublicJob,
  getPublicFreelancerProfile,
} = require("../services/developerService");

const publicApiLimiter = createApiKeyRateLimiter(100, 60);

router.use(requireApiKey, publicApiLimiter);

/**
 * @swagger
 * /api/public/jobs:
 *   get:
 *     summary: List publicly visible open jobs
 *     description: >
 *       Developer API endpoint. Returns open jobs with `visibility: public`,
 *       newest first. Requires a valid developer API key sent via the
 *       `x-api-key` header. Rows are returned as raw database records
 *       (snake_case column names), not the internal camelCase Job shape
 *       used by the authenticated `/api/jobs` endpoints.
 *     tags: [Public]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 60
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         required: true
 *         schema:
 *           type: string
 *         description: Developer API key issued via POST /api/developer/keys
 *         example: "sk_live_<your-api-key>"
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Maximum number of jobs to return (clamped between 1 and 50)
 *         example: 20
 *     responses:
 *       200:
 *         description: Public jobs retrieved successfully
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
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       budget:
 *                         type: number
 *                       currency:
 *                         type: string
 *                       category:
 *                         type: string
 *                       skills:
 *                         type: array
 *                         items:
 *                           type: string
 *                       status:
 *                         type: string
 *                       client_address:
 *                         type: string
 *                       freelancer_address:
 *                         type: string
 *                         nullable: true
 *                       deadline:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       timezone:
 *                         type: string
 *                         nullable: true
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       updated_at:
 *                         type: string
 *                         format: date-time
 *             example:
 *               success: true
 *               data:
 *                 - id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                   title: Build a Stellar wallet dashboard
 *                   description: Need a React dashboard for tracking Stellar wallet balances
 *                   budget: 500
 *                   currency: USD
 *                   category: Web Development
 *                   skills: [react, stellar-sdk]
 *                   status: open
 *                   client_address: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   freelancer_address: null
 *                   deadline: "2026-09-15T00:00:00.000Z"
 *                   timezone: UTC
 *                   created_at: "2026-08-01T10:00:00.000Z"
 *                   updated_at: "2026-08-01T10:00:00.000Z"
 *       401:
 *         description: Missing or invalid developer API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missingKey:
 *                 summary: No x-api-key header sent
 *                 value:
 *                   error: Missing API key
 *               invalidKey:
 *                 summary: Key not found or revoked
 *                 value:
 *                   error: Invalid API key
 *       429:
 *         description: Developer API rate limit exceeded (100 requests / 60 minutes per key)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Too many requests for this API key. Please try again later.
 */
router.get("/jobs", async (req, res, next) => {
  try {
    const jobs = await listPublicJobs(req.query.limit);
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/public/jobs/{id}:
 *   get:
 *     summary: Get a single publicly visible open job
 *     description: >
 *       Developer API endpoint. Returns a single job by ID, only if it is
 *       `visibility: public` and `status: open`; otherwise responds 404.
 *       Requires a valid developer API key sent via the `x-api-key` header.
 *       The row is returned with raw database column names (snake_case).
 *     tags: [Public]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 60
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         required: true
 *         schema:
 *           type: string
 *         description: Developer API key issued via POST /api/developer/keys
 *         example: "sk_live_<your-api-key>"
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
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
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     budget:
 *                       type: number
 *                     currency:
 *                       type: string
 *                     category:
 *                       type: string
 *                     skills:
 *                       type: array
 *                       items:
 *                         type: string
 *                     status:
 *                       type: string
 *                     client_address:
 *                       type: string
 *                     freelancer_address:
 *                       type: string
 *                       nullable: true
 *                     deadline:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     timezone:
 *                       type: string
 *                       nullable: true
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                 title: Build a Stellar wallet dashboard
 *                 description: Need a React dashboard for tracking Stellar wallet balances
 *                 budget: 500
 *                 currency: USD
 *                 category: Web Development
 *                 skills: [react, stellar-sdk]
 *                 status: open
 *                 client_address: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 freelancer_address: null
 *                 deadline: "2026-09-15T00:00:00.000Z"
 *                 timezone: UTC
 *                 created_at: "2026-08-01T10:00:00.000Z"
 *                 updated_at: "2026-08-01T10:00:00.000Z"
 *       401:
 *         description: Missing or invalid developer API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missingKey:
 *                 summary: No x-api-key header sent
 *                 value:
 *                   error: Missing API key
 *               invalidKey:
 *                 summary: Key not found or revoked
 *                 value:
 *                   error: Invalid API key
 *       404:
 *         description: Job not found, not public, or not open
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found
 *       429:
 *         description: Developer API rate limit exceeded (100 requests / 60 minutes per key)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Too many requests for this API key. Please try again later.
 */
router.get("/jobs/:id", async (req, res, next) => {
  try {
    const job = await getPublicJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/public/freelancers/{publicKey}:
 *   get:
 *     summary: Get a freelancer's public profile
 *     description: >
 *       Developer API endpoint. Returns the public profile for the given
 *       Stellar public key. Requires a valid developer API key sent via
 *       the `x-api-key` header. The row is returned with raw database
 *       column names (snake_case).
 *     tags: [Public]
 *     x-rate-limit:
 *       limit: 100
 *       windowMinutes: 60
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         required: true
 *         schema:
 *           type: string
 *         description: Developer API key issued via POST /api/developer/keys
 *         example: "sk_live_<your-api-key>"
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Freelancer's Stellar public key
 *         example: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: Freelancer profile retrieved successfully
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
 *                     public_key:
 *                       type: string
 *                     display_name:
 *                       type: string
 *                       nullable: true
 *                     bio:
 *                       type: string
 *                       nullable: true
 *                     skills:
 *                       type: array
 *                       items:
 *                         type: string
 *                     portfolio_items:
 *                       type: array
 *                       items:
 *                         type: object
 *                     availability:
 *                       type: string
 *                       nullable: true
 *                     completed_jobs:
 *                       type: integer
 *                     total_earned_xlm:
 *                       type: number
 *                     rating:
 *                       type: number
 *                       nullable: true
 *                     reputation_points:
 *                       type: integer
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 public_key: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                 display_name: Jane Freelancer
 *                 bio: Full-stack developer specializing in Stellar dApps
 *                 skills: [react, stellar-sdk, node]
 *                 portfolio_items: []
 *                 availability: full_time
 *                 completed_jobs: 12
 *                 total_earned_xlm: 4200.5
 *                 rating: 4.8
 *                 reputation_points: 930
 *                 created_at: "2025-11-01T09:00:00.000Z"
 *                 updated_at: "2026-08-10T14:30:00.000Z"
 *       401:
 *         description: Missing or invalid developer API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missingKey:
 *                 summary: No x-api-key header sent
 *                 value:
 *                   error: Missing API key
 *               invalidKey:
 *                 summary: Key not found or revoked
 *                 value:
 *                   error: Invalid API key
 *       404:
 *         description: No profile found for this public key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Profile not found
 *       429:
 *         description: Developer API rate limit exceeded (100 requests / 60 minutes per key)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Too many requests for this API key. Please try again later.
 */
router.get("/freelancers/:publicKey", async (req, res, next) => {
  try {
    const profile = await getPublicFreelancerProfile(req.params.publicKey);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
