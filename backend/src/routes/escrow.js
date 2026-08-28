/**
 * src/routes/escrow.js
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");

const escrowActionRateLimiter = createRateLimiter(30, 1);

const router = express.Router();
const pool = require("../db/pool");
const { getJob, updateJobStatus } = require("../services/jobService");
const { logContractInteraction } = require("../services/contractAuditService");
const { notifyEscrowEvent, EVENT_TYPES } = require("../services/notificationService");
const { processReferralPayout } = require("../services/referralService");
const {
  releaseMilestone,
  disputeMilestone,
  verifyMilestoneViaOracle,
} = require("../services/escrowService");

/**
 * @swagger
 * /api/escrow/{jobId}/release:
 *   post:
 *     summary: Release escrow and complete the job
 *     description: >
 *       Validates that `clientAddress` is a well-formed Stellar address and
 *       matches the job's client, and that the job is `in_progress`. Assumes
 *       the client has already submitted `release_escrow()` to the Soroban
 *       escrow contract (the actual on-chain transfer happens there, not in
 *       this handler); this endpoint records the off-chain side effects —
 *       processing a 2% referral bonus payout on the freelancer's first
 *       completed job, and marking the job `completed` in the database. The
 *       escrow's own DB row status is updated asynchronously by a separate
 *       indexer once it observes the on-chain event, so it is not touched
 *       here. This route has no rate limiter and no `verifyJWT` middleware —
 *       authorization relies solely on `clientAddress` matching the job's
 *       stored client address in the request body.
 *     tags: [Escrow]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientAddress
 *             properties:
 *               clientAddress:
 *                 type: string
 *                 description: Job client's Stellar address (must match the job record)
 *               contractTxHash:
 *                 type: string
 *                 nullable: true
 *                 description: >
 *                   Transaction hash of the on-chain release_escrow() call.
 *                   If omitted, an offchain-<timestamp> placeholder is
 *                   recorded instead.
 *           example:
 *             clientAddress: "GCLIENT2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *             contractTxHash: "a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f"
 *     responses:
 *       200:
 *         description: Escrow released and job marked completed
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
 *                   example: Escrow released and job completed
 *                 referralBonus:
 *                   type: object
 *                   nullable: true
 *                   description: Present only if the freelancer was referred and this is their first completed job
 *                   properties:
 *                     referrer:
 *                       type: string
 *                       description: Stellar address of the referrer
 *                     bonusXlm:
 *                       type: string
 *                       description: Referral bonus amount in XLM
 *             example:
 *               success: true
 *               message: Escrow released and job completed
 *               referralBonus:
 *                 referrer: "GREFRR2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *                 bonusXlm: "10.0000000"
 *       400:
 *         description: Invalid client address, or job is not in progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job is not in progress
 *       403:
 *         description: clientAddress does not match the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the job client can release escrow
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/:jobId/release", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash } = req.body;

    if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
      const e = new Error("Invalid client address");
      e.status = 400;
      throw e;
    }

    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can release escrow");
      e.status = 403;
      throw e;
    }

    if (job.status !== "in_progress") {
      const e = new Error("Job is not in progress");
      e.status = 400;
      throw e;
    }

    // Fetch escrow amount for referral bonus calculation.
    // DB status is updated asynchronously by the indexer when it processes the on-chain event.
    const { rows: escrowRows } = await pool.query(
      `SELECT amount_xlm FROM escrows WHERE job_id = $1`,
      [jobId]
    );

    // Process referral bonus payout (2% of earnings to referrer on referee's first job).
    // The on-chain transfer is handled by the Soroban contract's release_escrow();
    // this records the payout in the DB and updates referral status.
    const amountXlm = escrowRows.length ? escrowRows[0].amount_xlm : "0";
    const referralResult = await processReferralPayout(
      jobId,
      job.freelancerAddress,
      amountXlm,
      contractTxHash || null
    );
    await updateJobStatus(jobId, "completed");

    res.json({
      success: true,
      message: "Escrow released and job completed",
      ...(referralResult && {
        referralBonus: {
          referrer: referralResult.referrer,
          bonusXlm: referralResult.bonusXlm,
        },
      }),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/escrow/{jobId}/partial_release:
 *   post:
 *     summary: Release escrow for the job (legacy alias)
 *     description: >
 *       Validates `clientAddress` matches the job's client, then logs the
 *       `partial_release` contract interaction for audit purposes (recording
 *       `contractTxHash`, or an `offchain-<timestamp>` placeholder if none is
 *       given) and sends an escrow-released notification to both parties.
 *       Despite the name, this handler does not touch milestones or the
 *       escrow/job DB rows itself — it assumes the on-chain contract call and
 *       any DB status update (via the indexer) happen independently.
 *     tags: [Escrow]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientAddress
 *             properties:
 *               clientAddress:
 *                 type: string
 *                 description: Job client's Stellar address (must match the job record)
 *               contractTxHash:
 *                 type: string
 *                 nullable: true
 *                 description: On-chain transaction hash for the release, if available
 *           example:
 *             clientAddress: "GCLIENT2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *             contractTxHash: "a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f"
 *     responses:
 *       200:
 *         description: Escrow release logged and notification sent
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
 *                   example: Escrow released and job completed
 *             example:
 *               success: true
 *               message: Escrow released and job completed
 *       400:
 *         description: Invalid client address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid client address
 *       403:
 *         description: clientAddress does not match the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the job client can release milestones
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/:jobId/partial_release", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash } = req.body;

    if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
      const e = new Error("Invalid client address");
      e.status = 400;
      throw e;
    }

    const job = await getJob(jobId);

    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can release milestones");
      e.status = 403;
      throw e;
    }

    await logContractInteraction({
      functionName: "partial_release",
      callerAddress: clientAddress,
      jobId,
      txHash: contractTxHash || `offchain-${Date.now()}`,
    });

    // Notify users about escrow release
    await notifyEscrowEvent({
      eventType: EVENT_TYPES.ESCROW_RELEASED,
      jobId,
      clientAddress: job.clientAddress,
      freelancerAddress: job.freelancerAddress,
      data: {
        jobTitle: job.title,
        jobId,
        amount: job.budget,
        currency: job.currency,
      },
    });

    res.json({ success: true, message: "Escrow released and job completed" });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/escrow/{jobId}/release-milestone:
 *   post:
 *     summary: Release a single escrow milestone
 *     description: >
 *       Releases one milestone (by index) of a job's milestone-based escrow.
 *       Requires the job to be `in_progress` and the milestone to be neither
 *       already `released` nor `disputed`. Persists the milestone status
 *       change to both the `escrows` and `jobs` tables, logs the
 *       `release_milestone` contract interaction, and sends an
 *       escrow-released notification. If this was the last unreleased
 *       milestone, also triggers the freelancer's referral bonus payout for
 *       the full milestone total. The actual Soroban milestone-release
 *       transaction is assumed to have already been submitted on-chain;
 *       `contractTxHash` is recorded for audit purposes only.
 *     tags: [Escrow]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientAddress
 *               - milestoneIndex
 *             properties:
 *               clientAddress:
 *                 type: string
 *                 description: Job client's Stellar address (must match the job record)
 *               milestoneIndex:
 *                 type: integer
 *                 minimum: 0
 *                 description: Zero-based index into the job's milestones array
 *               contractTxHash:
 *                 type: string
 *                 nullable: true
 *                 description: On-chain transaction hash for the milestone release, if available
 *           example:
 *             clientAddress: "GCLIENT2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *             milestoneIndex: 0
 *             contractTxHash: "a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f"
 *     responses:
 *       200:
 *         description: Milestone released successfully
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
 *                     success:
 *                       type: boolean
 *                       example: true
 *                     message:
 *                       type: string
 *                       example: "Milestone 1 released"
 *                     milestone:
 *                       type: object
 *                       properties:
 *                         description:
 *                           type: string
 *                         amount:
 *                           type: string
 *                         status:
 *                           type: string
 *                           enum: [pending, released, disputed]
 *                         releasedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                         disputedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                     milestones:
 *                       type: array
 *                       items:
 *                         type: object
 *                     allReleased:
 *                       type: boolean
 *                       description: Whether every milestone on the job is now released
 *             example:
 *               success: true
 *               data:
 *                 success: true
 *                 message: "Milestone 1 released"
 *                 milestone:
 *                   description: "Design mockups"
 *                   amount: "250.0000000"
 *                   status: released
 *                   releasedAt: "2026-08-21T00:00:00.000Z"
 *                   disputedAt: null
 *                 milestones:
 *                   - description: "Design mockups"
 *                     amount: "250.0000000"
 *                     status: released
 *                     releasedAt: "2026-08-21T00:00:00.000Z"
 *                     disputedAt: null
 *                 allReleased: false
 *       400:
 *         description: Invalid client address, invalid milestone index, job not in progress, milestone already released, or milestone disputed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid milestone index
 *       403:
 *         description: clientAddress does not match the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the job client can release milestones
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/:jobId/release-milestone", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash, milestoneIndex } = req.body;

    if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
      const e = new Error("Invalid client address");
      e.status = 400;
      throw e;
    }

    const result = await releaseMilestone(jobId, milestoneIndex, clientAddress, contractTxHash);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/escrow/{jobId}/dispute-milestone:
 *   post:
 *     summary: Dispute a single escrow milestone
 *     description: >
 *       Marks one milestone (by index) as `disputed`, blocking it from being
 *       released, and creates an `open` row in the `disputes` table for the
 *       job (fails if a dispute already exists for the job). Only the job's
 *       client or freelancer may raise the dispute. This is purely a
 *       database-side state change; it does not itself call the Soroban
 *       escrow contract.
 *     tags: [Escrow]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - raisedBy
 *               - milestoneIndex
 *             properties:
 *               raisedBy:
 *                 type: string
 *                 description: Stellar address of the client or freelancer raising the dispute
 *               milestoneIndex:
 *                 type: integer
 *                 minimum: 0
 *                 description: Zero-based index into the job's milestones array
 *           example:
 *             raisedBy: "GFREEL2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *             milestoneIndex: 1
 *     responses:
 *       200:
 *         description: Milestone disputed successfully
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
 *                     success:
 *                       type: boolean
 *                       example: true
 *                     dispute:
 *                       type: object
 *                       description: The newly created disputes row
 *                     milestone:
 *                       type: object
 *                       properties:
 *                         description:
 *                           type: string
 *                         amount:
 *                           type: string
 *                         status:
 *                           type: string
 *                           example: disputed
 *                         disputedAt:
 *                           type: string
 *                           format: date-time
 *                     milestones:
 *                       type: array
 *                       items:
 *                         type: object
 *             example:
 *               success: true
 *               data:
 *                 success: true
 *                 dispute:
 *                   id: "1b2c3d4e-5f60-4718-9293-a4b5c6d7e8f9"
 *                   job_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *                   raised_by: "GFREEL2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *                   status: open
 *                   created_at: "2026-08-21T00:00:00.000Z"
 *                 milestone:
 *                   description: "Development phase 2"
 *                   amount: "500.0000000"
 *                   status: disputed
 *                   disputedAt: "2026-08-21T00:00:00.000Z"
 *                 milestones:
 *                   - description: "Development phase 2"
 *                     amount: "500.0000000"
 *                     status: disputed
 *                     disputedAt: "2026-08-21T00:00:00.000Z"
 *       400:
 *         description: Invalid wallet address, invalid milestone index, milestone already released, already disputed, or a dispute already exists for the job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Milestone already disputed
 *       403:
 *         description: raisedBy is neither the job's client nor freelancer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the client or freelancer can dispute milestones
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/:jobId/dispute-milestone", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { raisedBy, milestoneIndex } = req.body;

    if (!raisedBy || !/^G[A-Z0-9]{55}$/.test(raisedBy)) {
      const e = new Error("Invalid wallet address");
      e.status = 400;
      throw e;
    }

    const result = await disputeMilestone(jobId, milestoneIndex, raisedBy);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/escrow/{jobId}/verify-milestone-oracle:
 *   post:
 *     summary: Auto-verify and release a milestone via an oracle
 *     description: >
 *       Auto-releases a milestone once its configured oracle condition is
 *       satisfied, without requiring the client to manually release it. The
 *       milestone must have `autoVerify: true` and both `oracleType`
 *       (`github`, `website`, or `aws`) and `oracleQuery` set. Dispatches to
 *       `github_oracle.verifyOracleQuery`, which for `github` queries
 *       (format `github:<owner>:<repo>:commit:<40-char-sha>`) calls the
 *       GitHub Commits API, and for `website`/`aws` queries (format
 *       `website:<url>:status:<code>`) makes an HTTP GET and compares the
 *       response status code. On success, computes a SHA-256 proof hash
 *       (matching the on-chain contract's verification hash), marks the
 *       milestone released, persists it, logs the `verify_milestone_oracle`
 *       contract interaction, sends an escrow-released notification, and —
 *       if this was the last milestone — triggers the referral bonus payout.
 *       This route has no `verifyJWT` or address-ownership check; any
 *       caller who knows the jobId can trigger verification.
 *     tags: [Escrow]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - milestoneIndex
 *             properties:
 *               milestoneIndex:
 *                 type: integer
 *                 minimum: 0
 *                 description: Zero-based index into the job's milestones array
 *               contractTxHash:
 *                 type: string
 *                 nullable: true
 *                 description: >
 *                   On-chain transaction hash to record. If omitted, an
 *                   oracle-<timestamp> placeholder is recorded instead.
 *           example:
 *             milestoneIndex: 2
 *             contractTxHash: "a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f"
 *     responses:
 *       200:
 *         description: Milestone auto-verified and released
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
 *                     success:
 *                       type: boolean
 *                       example: true
 *                     message:
 *                       type: string
 *                       example: "Milestone 3 auto-verified by oracle"
 *                     proof:
 *                       type: string
 *                       description: Hex-encoded SHA-256 verification proof matching the on-chain contract hash
 *                     milestone:
 *                       type: object
 *                     milestones:
 *                       type: array
 *                       items:
 *                         type: object
 *                     allReleased:
 *                       type: boolean
 *             example:
 *               success: true
 *               data:
 *                 success: true
 *                 message: "Milestone 3 auto-verified by oracle"
 *                 proof: "5f4dcc3b5aa765d61d8327deb882cf992d4ea1a1c1e3f6b6a4f8a2b3c4d5e6f7"
 *                 milestone:
 *                   description: "Deploy to production"
 *                   amount: "300.0000000"
 *                   status: released
 *                   releasedAt: "2026-08-21T00:00:00.000Z"
 *                   oracleProof: "5f4dcc3b5aa765d61d8327deb882cf992d4ea1a1c1e3f6b6a4f8a2b3c4d5e6f7"
 *                 milestones: []
 *                 allReleased: true
 *       400:
 *         description: >
 *           Job not in progress, invalid milestone index, milestone not
 *           configured for auto-verification, incomplete oracle
 *           configuration, or milestone already released
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Milestone is not configured for auto-verification
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: The oracle query could not be verified (malformed query, GitHub commit/status mismatch, or website status mismatch)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Website status 503 does not match expected 200"
 */
router.post("/:jobId/verify-milestone-oracle", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { contractTxHash, milestoneIndex } = req.body;

    const result = await verifyMilestoneViaOracle(jobId, milestoneIndex, contractTxHash);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/escrow/{jobId}/refund:
 *   post:
 *     summary: Refund escrow to the client
 *     description: >
 *       Client-initiated refund to close out escrow (e.g. the freelancer
 *       never delivered). Only the job's client may call this. Logs the
 *       `refund_escrow` contract interaction (recording `contractTxHash`, or
 *       an `offchain-<timestamp>` placeholder if omitted) and sends a
 *       refund-issued notification to both parties. Assumes the client has
 *       already submitted the on-chain `refund_escrow()` call to the Soroban
 *       contract; the escrow's own DB row status is updated asynchronously
 *       by a separate indexer, not by this handler. This route has no rate
 *       limiter and no `verifyJWT` middleware — authorization relies solely
 *       on `clientAddress` matching the job's stored client address.
 *     tags: [Escrow]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientAddress
 *             properties:
 *               clientAddress:
 *                 type: string
 *                 description: Job client's Stellar address (must match the job record)
 *               contractTxHash:
 *                 type: string
 *                 nullable: true
 *                 description: On-chain transaction hash for the refund, if available
 *           example:
 *             clientAddress: "GCLIENT2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *             contractTxHash: "a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f"
 *     responses:
 *       200:
 *         description: Escrow refunded successfully
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
 *                   example: Escrow refunded
 *             example:
 *               success: true
 *               message: Escrow refunded
 *       403:
 *         description: clientAddress does not match the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the job client can refund escrow
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/:jobId/refund", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash } = req.body;
    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can refund escrow");
      e.status = 403;
      throw e;
    }

    // DB status is updated asynchronously by the indexer when it processes the on-chain event.

    await logContractInteraction({
      functionName: "refund_escrow",
      callerAddress: clientAddress,
      jobId,
      txHash: contractTxHash || `offchain-${Date.now()}`,
    });

    // Notify users about refund
    await notifyEscrowEvent({
      eventType: EVENT_TYPES.REFUND_ISSUED,
      jobId,
      clientAddress: job.clientAddress,
      freelancerAddress: job.freelancerAddress,
      data: {
        jobTitle: job.title,
        jobId,
        amount: job.budget,
        currency: job.currency,
      },
    });

    res.json({ success: true, message: "Escrow refunded" });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/escrow/{jobId}/timeout-refund:
 *   post:
 *     summary: Refund escrow after an inactivity timeout (Issue #175)
 *     description: >
 *       Client-initiated refund after freelancer inactivity. Only the job's
 *       client may call this; unlike POST /refund, this handler does not
 *       itself enforce the 7-day timeout window (that check lives in
 *       `escrowService.timeoutRefund`, which this route does not call — it
 *       always proceeds directly to logging the refund). Logs the
 *       `timeout_refund` contract interaction (recording `contractTxHash`,
 *       or an `offchain-<timestamp>` placeholder if omitted). Assumes the
 *       corresponding on-chain `timeout_refund()` call to the Soroban
 *       contract has already been submitted; the escrow's own DB row status
 *       is updated asynchronously by a separate indexer. This route has no
 *       rate limiter and no `verifyJWT` middleware.
 *     tags: [Escrow]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientAddress
 *             properties:
 *               clientAddress:
 *                 type: string
 *                 description: Job client's Stellar address (must match the job record)
 *               contractTxHash:
 *                 type: string
 *                 nullable: true
 *                 description: On-chain transaction hash for the timeout refund, if available
 *           example:
 *             clientAddress: "GCLIENT2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *             contractTxHash: "a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f"
 *     responses:
 *       200:
 *         description: Escrow refunded due to inactivity timeout
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
 *                   example: Escrow refunded due to inactivity timeout
 *             example:
 *               success: true
 *               message: Escrow refunded due to inactivity timeout
 *       403:
 *         description: clientAddress does not match the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the job client can request a timeout refund
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/:jobId/timeout-refund", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash } = req.body;
    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can request a timeout refund");
      e.status = 403;
      throw e;
    }

    // DB status is updated asynchronously by the indexer when it processes the on-chain event.

    await logContractInteraction({
      functionName: "timeout_refund",
      callerAddress: clientAddress,
      jobId,
      txHash: contractTxHash || `offchain-${Date.now()}`,
    });

    res.json({
      success: true,
      message: "Escrow refunded due to inactivity timeout",
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/escrow/{jobId}:
 *   get:
 *     summary: Get the escrow record for a job
 *     description: >
 *       Returns the raw `escrows` table row for a job, including the
 *       on-chain Soroban contract ID, funded amount, per-milestone status,
 *       and any multi-sig guardian fields. This is a direct DB read; it
 *       does not query the Stellar network.
 *     tags: [Escrow]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     responses:
 *       200:
 *         description: Escrow record found
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
 *                     contract_id:
 *                       type: string
 *                       description: Soroban escrow contract ID
 *                     amount_xlm:
 *                       type: string
 *                       description: Funded escrow amount in XLM
 *                     milestones:
 *                       type: array
 *                       items:
 *                         type: object
 *                     status:
 *                       type: string
 *                       enum: [funded, released, refunded, timeout_refunded]
 *                     released_at:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     timeout_at:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     guardian_address:
 *                       type: string
 *                       nullable: true
 *                       description: Optional multi-sig guardian address for high-value releases
 *                     high_value_threshold:
 *                       type: string
 *                       nullable: true
 *                     guardian_approved:
 *                       type: boolean
 *                     guardian_approved_at:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     release_timeout_at:
 *                       type: string
 *                       format: date-time
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
 *                 id: "1b2c3d4e-5f60-4718-9293-a4b5c6d7e8f9"
 *                 job_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *                 contract_id: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQTIYQDVXNGVUFZBGLQ4G7O5"
 *                 amount_xlm: "500.0000000"
 *                 milestones: []
 *                 status: funded
 *                 released_at: null
 *                 timeout_at: null
 *                 guardian_address: null
 *                 high_value_threshold: null
 *                 guardian_approved: false
 *                 guardian_approved_at: null
 *                 release_timeout_at: null
 *                 created_at: "2026-08-14T00:00:00.000Z"
 *                 updated_at: "2026-08-14T00:00:00.000Z"
 *       404:
 *         description: No escrow record found for this job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: No escrow record found for this job
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/:jobId", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM escrows WHERE job_id = $1", [
      req.params.jobId,
    ]);

    if (!rows.length) {
      const e = new Error("No escrow record found for this job");
      e.status = 404;
      throw e;
    }

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (e) {
    next(e);
  }
});

router.post("/:jobId/bridge-deposit", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const {
      clientAddress,
      amount,
      sourceChainId,
      evmTxHash,
      logIndex,
      proof,
      recipient,
    } = req.body;

    if (!jobId) {
      const e = new Error("Missing jobId");
      e.status = 400;
      throw e;
    }

    if (!amount || Number(amount) <= 0) {
      const e = new Error("Invalid deposit amount");
      e.status = 400;
      throw e;
    }

    if (!evmTxHash) {
      const e = new Error("Missing EVM transaction hash");
      e.status = 400;
      throw e;
    }

    if (!recipient) {
      const e = new Error("Missing recipient address");
      e.status = 400;
      throw e;
    }

    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can create a bridge deposit escrow");
      e.status = 403;
      throw e;
    }

    const { rows: existing } = await pool.query(
      `SELECT id FROM bridge_transfers WHERE nonce = $1`,
      [`${evmTxHash}:${logIndex ?? 0}`]
    );
    if (existing.length > 0) {
      return res.json({
        success: true,
        message: "Bridge deposit already recorded",
        transferId: existing[0].id,
      });
    }

    const client = getEscrowContractClient();
    const tx = await client.invoke("register_bridge_deposit", {
      user: recipient,
      amount: String(amount),
      nonce: `${evmTxHash}:${logIndex ?? 0}`,
      evm_tx_hash: evmTxHash,
      proof: proof ?? "",
    });

    const simulation = await tx.simulate();
    const result = simulation.result?.decoded ?? simulation.result;

    const { rows: insertRows } = await pool.query(
      `INSERT INTO bridge_transfers
         (source_chain, target_chain, transfer_type, nonce, amount, sender, recipient, status, tx_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING id`,
      [
        sourceChainId ?? "evm",
        "stellar",
        "evm_to_soroban",
        `${evmTxHash}:${logIndex ?? 0}`,
        String(amount),
        clientAddress,
        recipient,
        "completed",
        result?.txHash ?? evmTxHash,
      ]
    );

    await logContractInteraction({
      functionName: "bridge_deposit",
      callerAddress: clientAddress,
      jobId,
      txHash: evmTxHash,
    });

    res.json({
      success: true,
      message: "Bridge deposit escrow created",
      transferId: insertRows[0].id,
      result,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
