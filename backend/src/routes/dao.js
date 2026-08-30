"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const daoService = require("../services/daoService");

const daoRateLimiter = createRateLimiter(60, 1);

/**
 * @swagger
 * /api/dao/proposals:
 *   get:
 *     summary: List DAO proposals
 *     description: >
 *       Finalizes any proposals whose voting period has expired (marking them
 *       `passed` or `rejected` based on vote weight), then returns all DAO
 *       proposals sorted by creation date descending. Vote tallies are computed
 *       from the `dao_votes` table on read.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [active, passed, rejected, executed]
 *         description: Filter proposals by status
 *         example: active
 *     responses:
 *       200:
 *         description: Proposals retrieved successfully
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
 *                       type:
 *                         type: string
 *                         enum: [treasury, platform, parameter, arbitration]
 *                       proposer:
 *                         type: string
 *                         description: Stellar public key of the proposer
 *                       amount:
 *                         type: string
 *                         nullable: true
 *                         description: Requested amount in XLM (stringified)
 *                       recipient:
 *                         type: string
 *                         nullable: true
 *                       status:
 *                         type: string
 *                         enum: [active, passed, rejected, executed]
 *                       votesFor:
 *                         type: number
 *                       votesAgainst:
 *                         type: number
 *                       votingEndsAt:
 *                         type: string
 *                         format: date-time
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       executedAt:
 *                         type: string
 *                         nullable: true
 *                       quorumPercent:
 *                         type: number
 *                         example: 10
 *                       quorumReached:
 *                         type: boolean
 *             example:
 *               success: true
 *               data:
 *                 - id: "8f14e45f-ceea-467e-bd7a-2b1a3c4d5e6f"
 *                   title: "Fund community grants pool"
 *                   description: "Allocate 5000 XLM to the Q3 community grants pool"
 *                   type: treasury
 *                   proposer: "GABCD2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *                   amount: "5000.0000000"
 *                   recipient: null
 *                   status: active
 *                   votesFor: 120
 *                   votesAgainst: 30
 *                   votingEndsAt: "2026-08-28T00:00:00.000Z"
 *                   createdAt: "2026-08-21T00:00:00.000Z"
 *                   executedAt: null
 *                   quorumPercent: 10
 *                   quorumReached: true
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/proposals", daoRateLimiter, async (req, res, next) => {
  try {
    await daoService.finalizeExpiredProposals();
    const proposals = await daoService.listProposals({
      status: req.query.status,
    });
    res.json({ success: true, data: proposals });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/proposals/{id}:
 *   get:
 *     summary: Get a single DAO proposal
 *     description: >
 *       Returns one DAO proposal by ID with its current vote tally. Note: if
 *       the proposal does not exist, daoService throws an error with
 *       `statusCode: 404`, but the global error handler only reads
 *       `err.status` — so this actually resolves to a 500 response rather
 *       than 404.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Proposal ID
 *         example: "8f14e45f-ceea-467e-bd7a-2b1a3c4d5e6f"
 *     responses:
 *       200:
 *         description: Proposal retrieved successfully
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
 *                     type:
 *                       type: string
 *                       enum: [treasury, platform, parameter, arbitration]
 *                     proposer:
 *                       type: string
 *                     amount:
 *                       type: string
 *                       nullable: true
 *                     recipient:
 *                       type: string
 *                       nullable: true
 *                     status:
 *                       type: string
 *                       enum: [active, passed, rejected, executed]
 *                     votesFor:
 *                       type: number
 *                     votesAgainst:
 *                       type: number
 *                     votingEndsAt:
 *                       type: string
 *                       format: date-time
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     quorumPercent:
 *                       type: number
 *                     quorumReached:
 *                       type: boolean
 *             example:
 *               success: true
 *               data:
 *                 id: "8f14e45f-ceea-467e-bd7a-2b1a3c4d5e6f"
 *                 title: "Fund community grants pool"
 *                 description: "Allocate 5000 XLM to the Q3 community grants pool"
 *                 type: treasury
 *                 proposer: "GABCD2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *                 amount: "5000.0000000"
 *                 recipient: null
 *                 status: active
 *                 votesFor: 120
 *                 votesAgainst: 30
 *                 votingEndsAt: "2026-08-28T00:00:00.000Z"
 *                 createdAt: "2026-08-21T00:00:00.000Z"
 *                 quorumPercent: 10
 *                 quorumReached: true
 *       500:
 *         description: >
 *           Proposal not found, or another daoService error. Returned as 500
 *           (not 404) because the thrown error's `statusCode` property is not
 *           read by the global error handler.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Proposal not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/proposals/:id", daoRateLimiter, async (req, res, next) => {
  try {
    const proposal = await daoService.getProposal(req.params.id);
    res.json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/proposals:
 *   post:
 *     summary: Create a DAO proposal
 *     description: >
 *       Creates a new off-chain DAO proposal record (treasury spend, platform
 *       change, parameter change, or arbitration action) with `proposer` set
 *       to the authenticated user's Stellar address. The proposal starts in
 *       `active` status with a voting window of `votingDays` (1-30, default
 *       7). Note: validation errors thrown by daoService (missing title,
 *       invalid type, etc.) set `statusCode` rather than `status` on the
 *       error object, so the global error handler returns them as 500
 *       instead of 400.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
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
 *               - type
 *             properties:
 *               title:
 *                 type: string
 *                 description: Proposal title
 *               description:
 *                 type: string
 *                 description: Proposal description
 *               type:
 *                 type: string
 *                 enum: [treasury, platform, parameter, arbitration]
 *                 description: Proposal category
 *               amount:
 *                 type: number
 *                 nullable: true
 *                 description: Requested amount in XLM (for treasury proposals)
 *               recipient:
 *                 type: string
 *                 nullable: true
 *                 description: Stellar address to receive funds if the proposal passes
 *               votingDays:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 30
 *                 default: 7
 *                 description: Length of the voting period in days
 *           example:
 *             title: "Fund community grants pool"
 *             description: "Allocate 5000 XLM to the Q3 community grants pool"
 *             type: treasury
 *             amount: 5000
 *             recipient: "GRCPT2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CD"
 *             votingDays: 7
 *     responses:
 *       201:
 *         description: Proposal created successfully
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
 *                   description: The created proposal (same shape as GET /api/dao/proposals/{id})
 *             example:
 *               success: true
 *               data:
 *                 id: "8f14e45f-ceea-467e-bd7a-2b1a3c4d5e6f"
 *                 title: "Fund community grants pool"
 *                 description: "Allocate 5000 XLM to the Q3 community grants pool"
 *                 type: treasury
 *                 proposer: "GABCD2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *                 amount: "5000.0000000"
 *                 recipient: "GRCPT2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CD"
 *                 status: active
 *                 votesFor: 0
 *                 votesAgainst: 0
 *                 votingEndsAt: "2026-08-28T00:00:00.000Z"
 *                 createdAt: "2026-08-21T00:00:00.000Z"
 *                 quorumPercent: 10
 *                 quorumReached: false
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: >
 *           Validation failure (e.g. missing title/description, invalid
 *           proposer address, or invalid type). Returned as 500 rather than
 *           400 because daoService sets `statusCode`, which the global error
 *           handler does not read.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Title and description are required
 */
router.post("/proposals", verifyJWT, daoRateLimiter, async (req, res, next) => {
  try {
    const { title, description, type, amount, recipient, votingDays } = req.body;
    const proposal = await daoService.createProposal({
      title,
      description,
      type,
      proposer: req.user.publicKey,
      amount,
      recipient,
      votingDays,
    });
    res.status(201).json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/proposals/{id}/vote:
 *   post:
 *     summary: Cast a vote on a DAO proposal
 *     description: >
 *       Casts (or updates, via upsert) the authenticated user's vote on an
 *       active proposal. Rejected if the proposal is not `active` or its
 *       voting period has ended. `txHash` is an optional on-chain reference
 *       (e.g. a governance-token lock transaction) recorded alongside the
 *       vote but not itself verified against the ledger. Note: all
 *       daoService validation errors here (invalid voter address, proposal
 *       not found, voting closed/ended) are thrown with `statusCode`, which
 *       the global error handler does not read — they resolve to 500, not
 *       400/404.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
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
 *         description: Proposal ID
 *         example: "8f14e45f-ceea-467e-bd7a-2b1a3c4d5e6f"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - support
 *             properties:
 *               support:
 *                 type: boolean
 *                 description: true to vote for, false to vote against
 *               weight:
 *                 type: number
 *                 description: Vote weight (defaults to 1 if omitted or non-positive)
 *               txHash:
 *                 type: string
 *                 nullable: true
 *                 description: Optional on-chain transaction hash backing this vote
 *           example:
 *             support: true
 *             weight: 25
 *             txHash: "3f8a1c2b9d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8"
 *     responses:
 *       200:
 *         description: Vote recorded; returns the updated proposal with new vote tallies
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
 *             example:
 *               success: true
 *               data:
 *                 id: "8f14e45f-ceea-467e-bd7a-2b1a3c4d5e6f"
 *                 title: "Fund community grants pool"
 *                 status: active
 *                 votesFor: 145
 *                 votesAgainst: 30
 *                 votingEndsAt: "2026-08-28T00:00:00.000Z"
 *                 quorumPercent: 10
 *                 quorumReached: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: >
 *           Invalid voter address, proposal not found, or voting closed/ended.
 *           Returned as 500 rather than 400/404 due to the statusCode/status
 *           mismatch described above.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Voting period has ended
 */
router.post("/proposals/:id/vote", verifyJWT, daoRateLimiter, async (req, res, next) => {
  try {
    const { support, weight, txHash } = req.body;
    const proposal = await daoService.castVote({
      proposalId: req.params.id,
      voter: req.user.publicKey,
      support: Boolean(support),
      weight,
      txHash,
    });
    res.json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/treasury:
 *   get:
 *     summary: Get DAO treasury summary
 *     description: >
 *       Returns the total XLM allocated by passed/executed treasury-type
 *       proposals, the count of currently active proposals, and the
 *       fixed quorum percentage required for a proposal to pass.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Treasury summary retrieved successfully
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
 *                     allocatedXlm:
 *                       type: string
 *                       description: Total XLM allocated by passed/executed treasury proposals (stringified)
 *                     activeProposals:
 *                       type: integer
 *                     quorumPercent:
 *                       type: number
 *                       example: 10
 *             example:
 *               success: true
 *               data:
 *                 allocatedXlm: "12500"
 *                 activeProposals: 3
 *                 quorumPercent: 10
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/treasury", daoRateLimiter, async (req, res, next) => {
  try {
    const summary = await daoService.getTreasurySummary();
    res.json({ success: true, data: summary });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/arbitrators:
 *   get:
 *     summary: List active arbitrators and top dispute panel
 *     description: >
 *       Returns all active dao_arbitrators (sorted by votes received then
 *       election date), plus a `disputePanel` of the top 3 arbitrators by
 *       votes — the panel a new dispute would be assigned to.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Arbitrators retrieved successfully
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
 *                     arbitrators:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           publicKey:
 *                             type: string
 *                           displayName:
 *                             type: string
 *                             nullable: true
 *                           bio:
 *                             type: string
 *                             nullable: true
 *                           votesReceived:
 *                             type: integer
 *                           disputesResolved:
 *                             type: integer
 *                           electedAt:
 *                             type: string
 *                             format: date-time
 *                             nullable: true
 *                     disputePanel:
 *                       type: array
 *                       description: Top 3 arbitrators by votes received
 *                       items:
 *                         type: object
 *             example:
 *               success: true
 *               data:
 *                 arbitrators:
 *                   - publicKey: "GARB1234EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *                     displayName: "Alice Arbitrator"
 *                     bio: "5 years resolving marketplace disputes"
 *                     votesReceived: 42
 *                     disputesResolved: 7
 *                     electedAt: "2026-01-15T00:00:00.000Z"
 *                 disputePanel:
 *                   - publicKey: "GARB1234EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *                     displayName: "Alice Arbitrator"
 *                     votesReceived: 42
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/arbitrators", daoRateLimiter, async (req, res, next) => {
  try {
    const arbitrators = await daoService.listArbitrators();
    const panel = await daoService.getTopArbitratorPanel(3);
    res.json({ success: true, data: { arbitrators, disputePanel: panel } });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/arbitrators/{publicKey}:
 *   get:
 *     summary: Get a single active arbitrator
 *     description: >
 *       Looks up one active arbitrator by Stellar public key from the full
 *       active-arbitrator list. Unlike other daoService-backed routes, the
 *       404 here is set directly with `res.status(404)` in the route
 *       handler (not thrown from daoService), so it is returned correctly.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the arbitrator
 *         example: "GARB1234EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *     responses:
 *       200:
 *         description: Arbitrator found
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
 *                     publicKey:
 *                       type: string
 *                     displayName:
 *                       type: string
 *                       nullable: true
 *                     bio:
 *                       type: string
 *                       nullable: true
 *                     votesReceived:
 *                       type: integer
 *                     disputesResolved:
 *                       type: integer
 *                     electedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *             example:
 *               success: true
 *               data:
 *                 publicKey: "GARB1234EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *                 displayName: "Alice Arbitrator"
 *                 bio: "5 years resolving marketplace disputes"
 *                 votesReceived: 42
 *                 disputesResolved: 7
 *                 electedAt: "2026-01-15T00:00:00.000Z"
 *       404:
 *         description: No active arbitrator with this public key
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
 *               error: Arbitrator not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/arbitrators/:publicKey", daoRateLimiter, async (req, res, next) => {
  try {
    const arbitrators = await daoService.listArbitrators();
    const found = arbitrators.find((a) => a.publicKey === req.params.publicKey);
    if (!found) {
      return res.status(404).json({ success: false, error: "Arbitrator not found" });
    }
    res.json({ success: true, data: found });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/arbitrators:
 *   post:
 *     summary: Register or update an arbitrator profile
 *     description: >
 *       Upserts an arbitrator profile for the authenticated user's Stellar
 *       address (creates it if new, otherwise updates displayName/bio while
 *       preserving votesReceived/disputesResolved). Note: the address
 *       validation error thrown by daoService uses `statusCode` rather than
 *       `status`, so an invalid address actually resolves to a 500 response,
 *       not 400 — though in practice `req.user.publicKey` comes from a
 *       verified JWT and should already be a valid address.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *                 nullable: true
 *               bio:
 *                 type: string
 *                 nullable: true
 *           example:
 *             displayName: "Alice Arbitrator"
 *             bio: "5 years resolving marketplace disputes"
 *     responses:
 *       201:
 *         description: Arbitrator profile created/updated successfully
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
 *                     publicKey:
 *                       type: string
 *                     displayName:
 *                       type: string
 *                       nullable: true
 *                     bio:
 *                       type: string
 *                       nullable: true
 *                     votesReceived:
 *                       type: integer
 *                     disputesResolved:
 *                       type: integer
 *                     electedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *             example:
 *               success: true
 *               data:
 *                 publicKey: "GABCD2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *                 displayName: "Alice Arbitrator"
 *                 bio: "5 years resolving marketplace disputes"
 *                 votesReceived: 0
 *                 disputesResolved: 0
 *                 electedAt: null
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/arbitrators", verifyJWT, daoRateLimiter, async (req, res, next) => {
  try {
    const { displayName, bio } = req.body;
    const profile = await daoService.upsertArbitrator({
      publicKey: req.user.publicKey,
      displayName,
      bio,
    });
    res.status(201).json({ success: true, data: profile });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/arbitrators/{publicKey}/vote:
 *   post:
 *     summary: Vote for an arbitrator
 *     description: >
 *       Adds `weight` (default 1, minimum 1) votes to the target
 *       arbitrator's `votesReceived` on behalf of the authenticated voter,
 *       auto-creating the arbitrator profile via upsert if it does not yet
 *       exist. Returns the full updated arbitrator list. Note: invalid
 *       voter/arbitrator address errors are thrown by daoService with
 *       `statusCode`, which the global error handler does not read — they
 *       resolve to 500, not 400.
 *     tags: [DAO]
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the arbitrator being voted for
 *         example: "GARB1234EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               weight:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *                 description: Number of votes to add (defaults to 1 if omitted or non-positive)
 *           example:
 *             weight: 5
 *     responses:
 *       200:
 *         description: Vote recorded; returns the updated list of active arbitrators
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
 *             example:
 *               success: true
 *               data:
 *                 - publicKey: "GARB1234EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789CDEF"
 *                   displayName: "Alice Arbitrator"
 *                   bio: "5 years resolving marketplace disputes"
 *                   votesReceived: 47
 *                   disputesResolved: 7
 *                   electedAt: "2026-01-15T00:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: >
 *           Invalid voter or arbitrator Stellar address. Returned as 500
 *           rather than 400 due to the statusCode/status mismatch described
 *           above.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 */
router.post("/arbitrators/:publicKey/vote", verifyJWT, daoRateLimiter, async (req, res, next) => {
  try {
    const { weight } = req.body;
    const arbitrators = await daoService.voteForArbitrator({
      voter: req.user.publicKey,
      arbitratorKey: req.params.publicKey,
      weight,
    });
    res.json({ success: true, data: arbitrators });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
