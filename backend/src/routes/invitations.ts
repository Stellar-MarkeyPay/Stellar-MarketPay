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
 * src/routes/invitations.js
 * Issue #342 — Job invitation endpoints for freelancers.
 *
 * GET  /api/invitations              — list pending invitations for the authed freelancer
 * PATCH /api/invitations/:id/decline — decline an invitation
 * POST  /api/invitations/:id/accept  — accept (auto-creates application)
 */
("use strict");

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  getInvitationsForFreelancer,
  declineInvitation,
} = require("../services/jobInvitationService");
const { submitApplication } = require("../services/applicationService");

const readLimiter = createRateLimiter(60, 1);
const writeLimiter = createRateLimiter(20, 1);

/**
 * @swagger
 * /api/invitations:
 *   get:
 *     summary: List pending job invitations for the authenticated freelancer
 *     description: Returns all invitations with status "pending" addressed to the authenticated freelancer's Stellar address, newest first, enriched with the job's title/budget/currency and the inviting client's display name.
 *     tags: [Invitations]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Pending invitations retrieved successfully
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
 *                       jobId:
 *                         type: string
 *                         format: uuid
 *                       jobTitle:
 *                         type: string
 *                       jobBudget:
 *                         type: number
 *                       jobCurrency:
 *                         type: string
 *                       clientAddress:
 *                         type: string
 *                       clientName:
 *                         type: string
 *                         nullable: true
 *                       freelancerAddress:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [pending]
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *             example:
 *               success: true
 *               data:
 *                 - id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                   jobId: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                   jobTitle: Build a Soroban escrow contract
 *                   jobBudget: 450
 *                   jobCurrency: XLM
 *                   clientAddress: GCLIENT7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   clientName: Acme Studios
 *                   freelancerAddress: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   status: pending
 *                   createdAt: "2026-08-20T09:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
/**
 * GET /api/invitations
 * Returns all pending invitations for the authenticated freelancer.
 */
router.get("/", verifyJWT, readLimiter, async (req: any, res: any, next: any) => {
  try {
    const invitations = await getInvitationsForFreelancer(req.user.publicKey);
    res.json({ success: true, data: invitations });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/invitations/{id}/decline:
 *   patch:
 *     summary: Decline a job invitation
 *     description: Marks a pending invitation as declined. Only the invited freelancer may decline their own invitation.
 *     tags: [Invitations]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
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
 *         description: ID of the invitation to decline
 *         example: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *     responses:
 *       200:
 *         description: Invitation declined successfully
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
 *                       enum: [declined]
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                 job_id: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                 client_address: GCLIENT7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 freelancer_address: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 status: declined
 *                 created_at: "2026-08-20T09:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden - the caller is not the invited freelancer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the invited freelancer can decline
 *       404:
 *         description: Invitation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invitation not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
/**
 * PATCH /api/invitations/:id/decline
 * Freelancer declines an invitation.
 */
router.patch("/:id/decline", verifyJWT, writeLimiter, async (req: any, res: any, next: any) => {
  try {
    const invitation = await declineInvitation(req.params.id, req.user.publicKey);
    res.json({ success: true, data: invitation });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/invitations/{id}/accept:
 *   post:
 *     summary: Accept a job invitation
 *     description: >
 *       Accepts a pending invitation on behalf of the authenticated freelancer, which
 *       submits a pending application for the underlying job (proposal must be at
 *       least 50 characters, bid amount must be positive, the job must still be
 *       open, screening questions must be answered if the job has any, and the
 *       freelancer must not already have applied) and then marks the invitation's
 *       status as "accepted".
 *     tags: [Invitations]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
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
 *         description: ID of the invitation to accept
 *         example: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - proposal
 *               - bidAmount
 *             properties:
 *               proposal:
 *                 type: string
 *                 description: Cover letter / proposal text (minimum 50 characters)
 *               bidAmount:
 *                 type: number
 *                 description: Proposed bid amount, must be positive
 *           example:
 *             proposal: I have 5 years of experience building Soroban smart contracts and can deliver this within the timeline you outlined.
 *             bidAmount: 450
 *     responses:
 *       201:
 *         description: Invitation accepted and application created successfully
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
 *                     jobId:
 *                       type: string
 *                       format: uuid
 *                     freelancerAddress:
 *                       type: string
 *                     freelancerTier:
 *                       type: string
 *                     proposal:
 *                       type: string
 *                     bidAmount:
 *                       type: string
 *                       description: Fixed-point string, e.g. "450.0000000"
 *                     currency:
 *                       type: string
 *                       example: XLM
 *                     status:
 *                       type: string
 *                       enum: [pending, accepted, rejected]
 *                     screeningAnswers:
 *                       type: object
 *                       additionalProperties:
 *                         type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                 jobId: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                 freelancerAddress: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 freelancerTier: rising_talent
 *                 proposal: I have 5 years of experience building Soroban smart contracts and can deliver this within the timeline you outlined.
 *                 bidAmount: "450.0000000"
 *                 currency: XLM
 *                 status: pending
 *                 screeningAnswers: {}
 *                 createdAt: "2026-08-21T10:00:00.000Z"
 *       400:
 *         description: Bad request - proposal/bidAmount missing, proposal too short, bid not positive, job not open, or screening answers missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: proposal and bidAmount are required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden - caller is not the invited freelancer, or otherwise blocked from applying
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the invited freelancer can accept
 *       404:
 *         description: Invitation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invitation not found
 *       409:
 *         description: Conflict - freelancer has already applied to this job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: You have already applied to this job
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
/**
 * POST /api/invitations/:id/accept
 * Freelancer accepts an invitation — auto-creates a pending application.
 * Body: { proposal, bidAmount }
 */
router.post("/:id/accept", verifyJWT, writeLimiter, async (req: any, res: any, next: any) => {
  try {
    const pool = require("../db/pool");
    const { rows } = await rawQuery<JobInvitationTable>(
      "SELECT * FROM job_invitations WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) {
      const e = new Error("Invitation not found");
      e.status = 404;
      throw e;
    }
    const inv = rows[0];
    if (inv.freelancer_address !== req.user.publicKey) {
      const e = new Error("Only the invited freelancer can accept");
      e.status = 403;
      throw e;
    }

    const { proposal, bidAmount } = req.body;
    if (!proposal || !bidAmount) {
      const e = new Error("proposal and bidAmount are required");
      e.status = 400;
      throw e;
    }

    const application = await submitApplication({
      jobId: inv.job_id,
      freelancerAddress: req.user.publicKey,
      proposal,
      bidAmount,
    });

    // Mark invitation as accepted
    await rawQuery<JobInvitationTable>(
      "UPDATE job_invitations SET status = 'accepted' WHERE id = $1",
      [req.params.id]
    );

    res.status(201).json({ success: true, data: application });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
