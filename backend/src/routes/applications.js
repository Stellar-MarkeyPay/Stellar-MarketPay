/**
 * src/routes/applications.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const reputationRequirementService = require("../services/reputationRequirementService");

const applicationRateLimiter = createRateLimiter(5, 1); // 100 requests per 15 minutes
const generalApplicationRateLimiter = createRateLimiter(30, 1); // 100 requests per minute for listing/getting applications

const {
  submitApplication,
  getApplicationsForJob,
  getApplicationsForFreelancer,
  acceptApplication,
  withdrawApplication,
  closeBiddingForJob,
  revealApplicationBid,
} = require("../services/applicationService");
const { FREELANCER_TIERS } = require("../services/profileService");
const { logContractInteraction } = require("../services/contractAuditService");
const { notifyEscrowEvent, EVENT_TYPES } = require("../services/notificationService");
const { getJob } = require("../services/jobService");
const { analyzeBidEvent } = require("../services/fraudDetectionService");
const { createServiceLogger } = require("../utils/logger");

const applicationLogger = createServiceLogger("applications");

/**
 * @swagger
 * /api/applications/job/{jobId}:
 *   get:
 *     summary: Get applications for a job
 *     description: Returns all applications submitted for a specific job
 *     tags: [Applications]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Applications retrieved successfully
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
 *                     $ref: '#/components/schemas/Application'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// GET /api/applications/job/:jobId
router.get("/job/:jobId", generalApplicationRateLimiter, async (req, res, next) => {
  try {
    const tier = typeof req.query.tier === "string" ? req.query.tier : null;
    if (tier && !Object.values(FREELANCER_TIERS).includes(tier)) {
      const e = new Error("Invalid freelancer tier filter");
      e.status = 400;
      throw e;
    }

    const applications = await getApplicationsForJob(req.params.jobId, { tier });

    // Add prediction details for each application!
    const { predictJobCompletion } = require("../services/analytics");
    const job = await getJob(req.params.jobId);

    // ZK reputation (Issue #319): attach each applicant's verified proof
    // statuses so a client can filter by proof without ever seeing the
    // underlying ratings — only the statement kind, its public parameters,
    // and whether it verified.
    const proofsByApplication = await reputationRequirementService.getApplicationProofs(
      applications.map((app) => app.id)
    );

    const applicationsWithPredictions = await Promise.all(
      applications.map(async (app) => {
        const prediction = await predictJobCompletion(job, app.freelancerAddress);
        return {
          ...app,
          prediction,
          reputationProofs: proofsByApplication.get(app.id) || [],
        };
      })
    );

    res.json({ success: true, data: applicationsWithPredictions });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/applications/freelancer/{publicKey}:
 *   get:
 *     summary: List applications submitted by a freelancer
 *     description: Returns every application the given freelancer has submitted, across all jobs, ordered by most recently created first.
 *     tags: [Applications]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Freelancer's Stellar public key (G-address)
 *         example: GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI
 *     responses:
 *       200:
 *         description: Applications retrieved successfully
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
 *                       freelancerAddress:
 *                         type: string
 *                       freelancerTier:
 *                         type: string
 *                         enum: [Newcomer, Rising Talent, Top Rated, Expert]
 *                       proposal:
 *                         type: string
 *                       bidAmount:
 *                         type: string
 *                       currency:
 *                         type: string
 *                         enum: [XLM, USDC]
 *                       status:
 *                         type: string
 *                         enum: [pending, accepted, rejected]
 *                       screeningAnswers:
 *                         type: object
 *                       bidCommitment:
 *                         type: string
 *                         nullable: true
 *                       bidRevealed:
 *                         type: boolean
 *                       revealedBidAmount:
 *                         type: string
 *                         nullable: true
 *                       revealedAt:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       acceptedAt:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *             example:
 *               success: true
 *               data:
 *                 - id: 8f14e45f-ceea-4e5a-9c9a-3f9b8a2f7d11
 *                   jobId: 3b2f5c8a-1234-4a5b-8c9d-0e1f2a3b4c5d
 *                   freelancerAddress: GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI
 *                   freelancerTier: Rising Talent
 *                   proposal: I have 5 years of experience building similar applications and can deliver within 2 weeks.
 *                   bidAmount: "450.0000000"
 *                   currency: XLM
 *                   status: pending
 *                   screeningAnswers: {}
 *                   bidCommitment: null
 *                   bidRevealed: false
 *                   revealedBidAmount: null
 *                   revealedAt: null
 *                   createdAt: "2026-01-15T10:30:00.000Z"
 *                   acceptedAt: null
 *       400:
 *         description: Bad request - publicKey is not a valid Stellar G-address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// GET /api/applications/freelancer/:publicKey
router.get("/freelancer/:publicKey", generalApplicationRateLimiter, async (req, res, next) => {
  try {
    const applications = await getApplicationsForFreelancer(req.params.publicKey);
    res.json({ success: true, data: applications });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/applications:
 *   post:
 *     summary: Submit a job application
 *     description: Submit a proposal/application for a job
 *     tags: [Applications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - freelancerId
 *               - proposal
 *               - bidAmount
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *                 description: Job ID
 *               freelancerId:
 *                 type: string
 *                 description: Freelancer's Stellar address
 *               proposal:
 *                 type: string
 *                 description: Application proposal
 *               bidAmount:
 *                 type: number
 *                 description: Bid amount in XLM
 *               estimatedDuration:
 *                 type: string
 *                 description: Estimated completion time
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Application'
 *       400:
 *         description: Bad request - invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Conflict - already applied to this job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /api/applications — submit a proposal
router.post("/", applicationRateLimiter, async (req, res, next) => {
  try {
    const app = await submitApplication(req.body);
    const job = await getJob(app.jobId);
    let fraudAlert = null;

    try {
      const fraudResult = await analyzeBidEvent({
        jobId: app.jobId,
        applicationId: app.id,
        freelancerAddress: app.freelancerAddress,
        bidAmount: app.bidAmount,
        currency: app.currency,
        jobBudget: job.budget,
        sourceIp: req.ip,
        userAgent: req.get("User-Agent"),
      });
      fraudAlert = fraudResult.alert;
    } catch (error) {
      applicationLogger.warn(
        { error: error.message, applicationId: app.id },
        "Fraud analysis failed"
      );
    }

    // Emit WebSocket event for real-time bid updates
    const broadcastRealtime = req.app.locals.broadcastRealtime;
    if (broadcastRealtime) {
      broadcastRealtime(`job:${app.jobId}:bids`, {
        type: "new_bid",
        application: {
          id: app.id,
          freelancerAddress: app.freelancerAddress,
          bidAmount: app.bidAmount,
          proposal: app.proposal,
          estimatedDuration: app.estimatedDuration,
          createdAt: app.createdAt,
          status: app.status,
        },
        jobTitle: job.title,
      });

      if (fraudAlert) {
        broadcastRealtime(`job:${app.jobId}:fraud`, {
          type: "bid_alert",
          alert: fraudAlert,
          application: {
            id: app.id,
            freelancerAddress: app.freelancerAddress,
            bidAmount: app.bidAmount,
            status: app.status,
          },
        });
      }
    }

    res.status(201).json({ success: true, data: app });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/applications/job/{jobId}/close-bidding:
 *   post:
 *     summary: Close the bidding round for a job
 *     description: Allows the job's client to close the open-bidding window so sealed bids can start being revealed. Only valid while the job status is "open" and bidding has not already been closed.
 *     tags: [Applications]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: 3b2f5c8a-1234-4a5b-8c9d-0e1f2a3b4c5d
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
 *                 description: Stellar public key of the job's client (must match the job's clientAddress)
 *           example:
 *             clientAddress: GCLIENT7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMA
 *     responses:
 *       200:
 *         description: Bidding closed successfully
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
 *                     biddingClosedAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 jobId: 3b2f5c8a-1234-4a5b-8c9d-0e1f2a3b4c5d
 *                 biddingClosedAt: "2026-01-15T10:30:00.000Z"
 *       400:
 *         description: Bad request - invalid clientAddress, or job is not currently open
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Bidding can only be closed while job is open
 *       403:
 *         description: Forbidden - caller is not the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the client can close bidding
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found
 *       409:
 *         description: Conflict - bidding is already closed for this job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Bidding is already closed
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/applications/job/:jobId/close-bidding — client closes bidding round
router.post("/job/:jobId/close-bidding", applicationRateLimiter, async (req, res, next) => {
  try {
    const result = await closeBiddingForJob(req.params.jobId, req.body.clientAddress);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/applications/{id}/reveal:
 *   post:
 *     summary: Reveal a sealed bid
 *     description: Freelancer reveals the real bid amount behind a previously-submitted sealed commitment, once bidding has closed. The revealed amount and nonce are hashed and checked against the stored commitment hash before being accepted; reveal must happen within 24 hours of bidding closing.
 *     tags: [Applications]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Application ID
 *         example: 8f14e45f-ceea-4e5a-9c9a-3f9b8a2f7d11
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - freelancerAddress
 *               - bidAmount
 *               - nonce
 *             properties:
 *               freelancerAddress:
 *                 type: string
 *                 description: Stellar public key of the freelancer who submitted the application (must match the application)
 *               bidAmount:
 *                 type: number
 *                 description: The real bid amount, must hash (with nonce) to the stored bidCommitment
 *               nonce:
 *                 type: string
 *                 description: The secret nonce used when the sealed bid commitment was originally created
 *           example:
 *             freelancerAddress: GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI
 *             bidAmount: 450
 *             nonce: a1b2c3d4e5f6
 *     responses:
 *       200:
 *         description: Bid revealed successfully
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
 *                     bidRevealed:
 *                       type: boolean
 *                       example: true
 *                     revealedBidAmount:
 *                       type: string
 *                     revealedAt:
 *                       type: string
 *                       format: date-time
 *                     status:
 *                       type: string
 *                       enum: [pending, accepted, rejected]
 *             example:
 *               success: true
 *               data:
 *                 id: 8f14e45f-ceea-4e5a-9c9a-3f9b8a2f7d11
 *                 jobId: 3b2f5c8a-1234-4a5b-8c9d-0e1f2a3b4c5d
 *                 freelancerAddress: GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI
 *                 bidRevealed: true
 *                 revealedBidAmount: "450.0000000"
 *                 revealedAt: "2026-01-16T09:00:00.000Z"
 *                 status: pending
 *       400:
 *         description: Bad request - missing/invalid nonce or bidAmount, no sealed commitment exists, bidding not yet closed, reveal deadline passed, or commitment verification failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Commitment verification failed
 *       403:
 *         description: Forbidden - caller is not the freelancer who submitted this application
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the freelancer can reveal this bid
 *       404:
 *         description: Application not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Application not found
 *       409:
 *         description: Conflict - bid has already been revealed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Bid already revealed
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/applications/:id/reveal — freelancer reveals sealed bid
router.post("/:id/reveal", applicationRateLimiter, async (req, res, next) => {
  try {
    const app = await revealApplicationBid(
      req.params.id,
      req.body.freelancerAddress,
      req.body.bidAmount,
      req.body.nonce
    );
    res.json({ success: true, data: app });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/applications/{id}/accept:
 *   post:
 *     summary: Accept a job application
 *     description: The job's client accepts one pending application. All other pending applications for the same job are automatically rejected and the freelancer is assigned to the job. Also logs a "start_work" contract interaction and notifies the freelancer.
 *     tags: [Applications]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Application ID
 *         example: 8f14e45f-ceea-4e5a-9c9a-3f9b8a2f7d11
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
 *                 description: Stellar public key of the job's client (must match the job's clientAddress)
 *               contractTxHash:
 *                 type: string
 *                 description: On-chain transaction hash for the start_work call. If omitted, an off-chain placeholder hash is logged instead.
 *           example:
 *             clientAddress: GCLIENT7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMA
 *             contractTxHash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
 *     responses:
 *       200:
 *         description: Application accepted successfully
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
 *                     status:
 *                       type: string
 *                       example: accepted
 *                     acceptedAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 8f14e45f-ceea-4e5a-9c9a-3f9b8a2f7d11
 *                 jobId: 3b2f5c8a-1234-4a5b-8c9d-0e1f2a3b4c5d
 *                 freelancerAddress: GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI
 *                 status: accepted
 *                 acceptedAt: "2026-01-16T09:00:00.000Z"
 *       400:
 *         description: Bad request - invalid clientAddress, or job is no longer accepting applications
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job is no longer accepting applications
 *       403:
 *         description: Forbidden - caller is not the job's client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the job client can accept applications
 *       404:
 *         description: Application not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Application not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// POST /api/applications/:id/accept — client accepts a proposal
router.post("/:id/accept", applicationRateLimiter, async (req, res, next) => {
  try {
    const app = await acceptApplication(req.params.id, req.body.clientAddress);
    await logContractInteraction({
      functionName: "start_work",
      callerAddress: req.body.clientAddress,
      jobId: app.jobId,
      txHash: req.body.contractTxHash || `offchain-${Date.now()}`,
    });

    // Notify freelancer about accepted application
    const job = await getJob(app.jobId);
    await notifyEscrowEvent({
      eventType: EVENT_TYPES.APPLICATION_ACCEPTED,
      jobId: app.jobId,
      clientAddress: job.clientAddress,
      freelancerAddress: app.freelancerAddress,
      data: {
        jobTitle: job.title,
        jobId: app.jobId,
        amount: job.budget,
        currency: job.currency,
      },
    });

    res.json({ success: true, data: app });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/applications/{id}:
 *   delete:
 *     summary: Withdraw a job application
 *     description: The freelancer who submitted the application withdraws it. Only allowed while the application has not been accepted, and cannot be withdrawn twice. Decrements the parent job's applicant count.
 *     tags: [Applications]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Application ID
 *         example: 8f14e45f-ceea-4e5a-9c9a-3f9b8a2f7d11
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
 *                 description: Stellar public key of the freelancer who submitted the application
 *           example:
 *             freelancerAddress: GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI
 *     responses:
 *       200:
 *         description: Application withdrawn successfully
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
 *                     status:
 *                       type: string
 *                       example: pending
 *             example:
 *               success: true
 *               data:
 *                 id: 8f14e45f-ceea-4e5a-9c9a-3f9b8a2f7d11
 *                 jobId: 3b2f5c8a-1234-4a5b-8c9d-0e1f2a3b4c5d
 *                 freelancerAddress: GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI
 *                 status: pending
 *       400:
 *         description: Bad request - invalid freelancerAddress, or application is already accepted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Cannot withdraw an already-accepted application
 *       403:
 *         description: Forbidden - caller did not submit this application
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the freelancer who submitted can withdraw this application
 *       404:
 *         description: Application not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Application not found
 *       409:
 *         description: Conflict - application has already been withdrawn
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Application has already been withdrawn
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// DELETE /api/applications/:id — freelancer withdraws their application
router.delete("/:id", applicationRateLimiter, async (req, res, next) => {
  try {
    const app = await withdrawApplication(req.params.id, req.body.freelancerAddress);
    res.json({ success: true, data: app });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/applications/{id}/reputation-proof:
 *   post:
 *     summary: Attach a zero-knowledge reputation proof to your application
 *     description: >
 *       Zero-knowledge reputation with selective disclosure (Issue #319): a
 *       freelancer proves a claim about their history — e.g. average rating
 *       >= 4.5 — without exposing individual ratings, amounts or disputes.
 *       The proof must have been built with context.audience set to the
 *       job's client and context.purpose set to `job-application:{jobId}`;
 *       this endpoint verifies that binding itself rather than trusting the
 *       caller, so a proof cannot be lifted from one application and
 *       replayed on another. Build the proof via POST
 *       /api/reputation/{publicKey}/prove (hosted) or client-side using the
 *       same statement/circuit modules against your own openings (GET
 *       /api/reputation/{publicKey}/openings).
 *     tags: [Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [proof]
 *             properties:
 *               proof:
 *                 type: object
 *     responses:
 *       201: { description: Proof recorded (verified may be false — the response says why) }
 *       400: { description: Bad request }
 *       403: { description: Forbidden — not this application's freelancer }
 *       404: { description: Application not found }
 */
router.post("/:id/reputation-proof", applicationRateLimiter, verifyJWT, async (req, res, next) => {
  try {
    const { proof } = req.body || {};
    if (!proof || typeof proof !== "object") {
      return res.status(400).json({ success: false, error: "proof is required" });
    }
    const record = await reputationRequirementService.attachApplicationProof({
      applicationId: req.params.id,
      freelancerAddress: req.user.publicKey,
      proof,
    });
    res.status(201).json({ success: true, data: record });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
