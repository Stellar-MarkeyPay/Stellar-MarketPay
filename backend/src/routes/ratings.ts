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
 * src/routes/ratings.js
 */
("use strict");

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRating, getRatingsForUser } = require("../services/ratingService");
const { verifyJWT } = require("../middleware/auth");

/**
 * @swagger
 * /api/ratings:
 *   post:
 *     summary: Submit a rating for a completed job
 *     description: >
 *       Records a 1-5 star rating (with optional review text) from the authenticated
 *       caller about the other party on a completed job, and refreshes the rated
 *       user's freelancer tier. The job must be "completed", the caller must be
 *       the client or freelancer on that job, the caller cannot rate themselves,
 *       and each (job, rater) pair may only submit one rating.
 *     tags: [Ratings]
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
 *               - jobId
 *               - ratedAddress
 *               - stars
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *               ratedAddress:
 *                 type: string
 *                 description: Stellar public key of the user being rated
 *               stars:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               review:
 *                 type: string
 *                 maxLength: 200
 *                 description: Optional review text (200 characters max)
 *           example:
 *             jobId: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *             ratedAddress: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *             stars: 5
 *             review: Delivered on time with great communication throughout.
 *     responses:
 *       201:
 *         description: Rating submitted successfully
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
 *                     rater_address:
 *                       type: string
 *                     rated_address:
 *                       type: string
 *                     stars:
 *                       type: integer
 *                     review:
 *                       type: string
 *                       nullable: true
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     freelancer_tier:
 *                       type: string
 *                       description: The rated user's freelancer tier, recomputed after this rating
 *             example:
 *               success: true
 *               data:
 *                 id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                 job_id: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                 rater_address: GCLIENT7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 rated_address: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 stars: 5
 *                 review: Delivered on time with great communication throughout.
 *                 created_at: "2026-08-21T10:00:00.000Z"
 *                 freelancer_tier: rising_talent
 *       400:
 *         description: Bad request - missing fields, stars not between 1 and 5, review over 200 characters, rater rating themselves, or job not yet completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: jobId, ratedAddress and stars are required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden - caller is not a participant (client or freelancer) on this job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only job participants can submit a rating
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found
 *       409:
 *         description: Conflict - this rater has already submitted a rating for this job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Rating already submitted for this job
 */
// POST /api/ratings — submit a rating (must be authenticated)
router.post("/", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    const { jobId, ratedAddress, stars, review } = req.body;
    const raterAddress = req.user.publicKey;

    if (!jobId || !ratedAddress || stars == null) {
      return res.status(400).json({ error: "jobId, ratedAddress and stars are required" });
    }

    const parsedStars = parseInt(stars, 10);
    if (isNaN(parsedStars) || parsedStars < 1 || parsedStars > 5) {
      return res.status(400).json({ error: "stars must be an integer between 1 and 5" });
    }

    if (review && review.length > 200) {
      return res.status(400).json({ error: "review must be 200 characters or fewer" });
    }

    if (raterAddress === ratedAddress) {
      return res.status(400).json({ error: "Cannot rate yourself" });
    }

    // Verify the job is completed and rater is a party to it
    const { rows: jobRows } = await rawQuery<JobTable>(
      "SELECT status, client_address, freelancer_address FROM jobs WHERE id = $1",
      [jobId]
    );
    if (!jobRows.length) return res.status(404).json({ error: "Job not found" });
    const job = jobRows[0];

    if (job.status !== "completed") {
      return res.status(400).json({ error: "Job must be completed before rating" });
    }

    const isParty = raterAddress === job.client_address || raterAddress === job.freelancer_address;
    if (!isParty) {
      return res.status(403).json({ error: "Only job participants can submit a rating" });
    }

    const rating = await createRating({
      jobId,
      raterAddress,
      ratedAddress,
      stars: parsedStars,
      review,
    });
    res.status(201).json({ success: true, data: rating });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/ratings/{publicKey}:
 *   get:
 *     summary: List ratings received by a user
 *     description: Returns every rating where the given Stellar public key is the rated party, newest first. Public endpoint — no authentication required.
 *     tags: [Ratings]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the rated user
 *         example: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *     responses:
 *       200:
 *         description: Ratings retrieved successfully (empty array if none exist)
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
 *                       job_id:
 *                         type: string
 *                         format: uuid
 *                       rater_address:
 *                         type: string
 *                       rated_address:
 *                         type: string
 *                       stars:
 *                         type: integer
 *                       review:
 *                         type: string
 *                         nullable: true
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *             example:
 *               success: true
 *               data:
 *                 - id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                   job_id: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                   rater_address: GCLIENT7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   rated_address: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   stars: 5
 *                   review: Delivered on time with great communication throughout.
 *                   created_at: "2026-08-21T10:00:00.000Z"
 */
// GET /api/ratings/:publicKey — list all ratings for a user
router.get("/:publicKey", async (req: any, res: any, next: any) => {
  try {
    const ratings = await getRatingsForUser(req.params.publicKey);
    res.json({ success: true, data: ratings });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
