/**
 * src/routes/timeEntries.js
 * Time tracking and billing endpoints — Issue #346
 *
 * POST /api/time-entries                    — log a time entry
 * GET  /api/time-entries/job/:jobId         — get all entries for a job
 * GET  /api/time-entries/job/:jobId/invoices — get all invoices for a job
 * POST /api/time-entries/invoice            — generate invoice from entries
 * PATCH /api/time-entries/invoice/:invoiceId/review — client approves/rejects
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  logTimeEntry,
  getTimeEntriesForJob,
  generateInvoice,
  getInvoicesForJob,
  reviewInvoice,
} = require("../services/timeTrackingService");

const readLimiter = createRateLimiter(60, 1);
const writeLimiter = createRateLimiter(30, 1);

/**
 * @swagger
 * /api/time-entries:
 *   post:
 *     summary: Log a time entry for a job
 *     description: >
 *       Records a block of tracked work for the job. The freelancer
 *       address is taken from the authenticated JWT, not the request body.
 *       The job must exist, the caller must be the job's assigned
 *       freelancer, and the job must be `in_progress` or `completed`.
 *       `durationMinutes` must be a positive integer no greater than 1440
 *       (24 hours). Rate limited to 30 requests per minute per IP.
 *     tags: [TimeEntries]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - durationMinutes
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the job being worked on
 *               durationMinutes:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 1440
 *                 description: Minutes worked in this entry (max 1440 / 24h)
 *               description:
 *                 type: string
 *                 description: Optional description of the work done (truncated to 500 chars)
 *               startedAt:
 *                 type: string
 *                 format: date-time
 *                 description: Optional ISO timestamp when the work started (defaults to now)
 *           example:
 *             jobId: "3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d"
 *             durationMinutes: 120
 *             description: "Implemented the escrow release endpoint"
 *             startedAt: "2026-08-20T09:00:00.000Z"
 *     responses:
 *       201:
 *         description: Time entry created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     jobId: { type: string, format: uuid }
 *                     freelancerAddress: { type: string }
 *                     durationMinutes: { type: integer, example: 120 }
 *                     description: { type: string, nullable: true }
 *                     startedAt: { type: string, format: date-time, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 id: "6f1a2b3c-4444-4a2b-8c3d-4e5f6a7b8c9d"
 *                 jobId: "3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d"
 *                 freelancerAddress: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                 durationMinutes: 120
 *                 description: "Implemented the escrow release endpoint"
 *                 startedAt: "2026-08-20T09:00:00.000Z"
 *                 createdAt: "2026-08-20T11:00:00.000Z"
 *       400:
 *         description: Invalid Stellar address, missing jobId, invalid durationMinutes, or job not in a loggable status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "durationMinutes must be a positive integer no greater than 1440 (24 h)"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not the job's assigned freelancer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Only the assigned freelancer can log time for this job"
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
router.post("/", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const { jobId, durationMinutes, description, startedAt } = req.body;
    const freelancerAddress = req.user.publicKey;

    const entry = await logTimeEntry({
      jobId,
      freelancerAddress,
      durationMinutes,
      description,
      startedAt,
    });

    res.status(201).json({ success: true, data: entry });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/time-entries/job/{jobId}:
 *   get:
 *     summary: Get all time entries for a job
 *     description: >
 *       Returns every logged time entry for the given job, ordered
 *       oldest-first. JWT required; the handler does not currently
 *       restrict access to the job's client or freelancer. Rate limited
 *       to 60 requests per minute per IP.
 *     tags: [TimeEntries]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the job
 *         example: 3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Time entries for the job
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       jobId: { type: string, format: uuid }
 *                       freelancerAddress: { type: string }
 *                       durationMinutes: { type: integer, example: 120 }
 *                       description: { type: string, nullable: true }
 *                       startedAt: { type: string, format: date-time, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 - id: "6f1a2b3c-4444-4a2b-8c3d-4e5f6a7b8c9d"
 *                   jobId: "3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d"
 *                   freelancerAddress: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                   durationMinutes: 120
 *                   description: "Implemented the escrow release endpoint"
 *                   startedAt: "2026-08-20T09:00:00.000Z"
 *                   createdAt: "2026-08-20T11:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/job/:jobId", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const entries = await getTimeEntriesForJob(req.params.jobId);
    res.json({ success: true, data: entries });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/time-entries/job/{jobId}/invoices:
 *   get:
 *     summary: Get all invoices for a job
 *     description: >
 *       Returns every time-tracking invoice generated for the given job,
 *       newest first. Rate limited to 60 requests per minute per IP.
 *     tags: [TimeEntries]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the job
 *         example: 3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Invoices for the job
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       jobId: { type: string, format: uuid }
 *                       freelancerAddress: { type: string }
 *                       clientAddress: { type: string }
 *                       totalMinutes: { type: integer, example: 240 }
 *                       hourlyRateXlm: { type: string, example: "25.0000000" }
 *                       totalAmountXlm: { type: string, example: "100.0000000" }
 *                       status:
 *                         type: string
 *                         enum: [pending, approved, rejected]
 *                       entryIds:
 *                         type: array
 *                         items: { type: string, format: uuid }
 *                       contractTxHash: { type: string, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                       updatedAt: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 - id: "9a8b7c6d-5555-4a2b-8c3d-4e5f6a7b8c9d"
 *                   jobId: "3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d"
 *                   freelancerAddress: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                   clientAddress: GDCLIENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                   totalMinutes: 240
 *                   hourlyRateXlm: "25.0000000"
 *                   totalAmountXlm: "100.0000000"
 *                   status: pending
 *                   entryIds: ["6f1a2b3c-4444-4a2b-8c3d-4e5f6a7b8c9d"]
 *                   contractTxHash: null
 *                   createdAt: "2026-08-20T12:00:00.000Z"
 *                   updatedAt: "2026-08-20T12:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/job/:jobId/invoices", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const invoices = await getInvoicesForJob(req.params.jobId);
    res.json({ success: true, data: invoices });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/time-entries/invoice:
 *   post:
 *     summary: Generate an invoice from logged time entries
 *     description: >
 *       Creates a `pending` invoice for the job, computed from either the
 *       specific `entryIds` provided or, if omitted, all of the caller's
 *       time entries for the job that are not already part of a pending
 *       or approved invoice. The freelancer address is taken from the
 *       authenticated JWT. The caller must be the job's assigned
 *       freelancer. Rate limited to 30 requests per minute per IP.
 *     tags: [TimeEntries]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - hourlyRateXlm
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *                 description: UUID of the job to invoice
 *               hourlyRateXlm:
 *                 type: number
 *                 description: Agreed hourly rate in XLM (must be positive)
 *               entryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 description: Specific time entry UUIDs to include (defaults to all un-invoiced entries)
 *           example:
 *             jobId: "3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d"
 *             hourlyRateXlm: 25
 *             entryIds: ["6f1a2b3c-4444-4a2b-8c3d-4e5f6a7b8c9d"]
 *     responses:
 *       201:
 *         description: Invoice created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     jobId: { type: string, format: uuid }
 *                     freelancerAddress: { type: string }
 *                     clientAddress: { type: string }
 *                     totalMinutes: { type: integer, example: 120 }
 *                     hourlyRateXlm: { type: string, example: "25.0000000" }
 *                     totalAmountXlm: { type: string, example: "50.0000000" }
 *                     status: { type: string, example: pending }
 *                     entryIds:
 *                       type: array
 *                       items: { type: string, format: uuid }
 *                     contractTxHash: { type: string, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *                     updatedAt: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 id: "9a8b7c6d-5555-4a2b-8c3d-4e5f6a7b8c9d"
 *                 jobId: "3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d"
 *                 freelancerAddress: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                 clientAddress: GDCLIENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                 totalMinutes: 120
 *                 hourlyRateXlm: "25.0000000"
 *                 totalAmountXlm: "50.0000000"
 *                 status: pending
 *                 entryIds: ["6f1a2b3c-4444-4a2b-8c3d-4e5f6a7b8c9d"]
 *                 contractTxHash: null
 *                 createdAt: "2026-08-20T12:00:00.000Z"
 *                 updatedAt: "2026-08-20T12:00:00.000Z"
 *       400:
 *         description: Invalid Stellar address, missing jobId, invalid hourlyRateXlm, or no matching/un-invoiced time entries
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "No un-invoiced time entries found for this job"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not the job's assigned freelancer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Only the assigned freelancer can generate an invoice for this job"
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
router.post("/invoice", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const { jobId, hourlyRateXlm, entryIds } = req.body;
    const freelancerAddress = req.user.publicKey;

    const invoice = await generateInvoice({
      jobId,
      freelancerAddress,
      hourlyRateXlm,
      entryIds,
    });

    res.status(201).json({ success: true, data: invoice });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/time-entries/invoice/{invoiceId}/review:
 *   patch:
 *     summary: Approve or reject a time-tracking invoice
 *     description: >
 *       Lets the job's client approve or reject a `pending` invoice. The
 *       client address is taken from the authenticated JWT. Fails if the
 *       invoice is not found, the caller is not the invoice's client, or
 *       the invoice has already been decided. `contractTxHash` should be
 *       supplied when approving to record the on-chain escrow release;
 *       this endpoint only records the decision, it does not perform the
 *       on-chain release itself. Rate limited to 30 requests per minute
 *       per IP.
 *     tags: [TimeEntries]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the invoice to review
 *         example: 9a8b7c6d-5555-4a2b-8c3d-4e5f6a7b8c9d
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - decision
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [approved, rejected]
 *                 description: The client's decision on the invoice
 *               contractTxHash:
 *                 type: string
 *                 description: On-chain transaction hash for the escrow release (typically supplied when approving)
 *           example:
 *             decision: approved
 *             contractTxHash: "a1b2c3d4e5f6...stellar-tx-hash"
 *     responses:
 *       200:
 *         description: Invoice reviewed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     jobId: { type: string, format: uuid }
 *                     freelancerAddress: { type: string }
 *                     clientAddress: { type: string }
 *                     totalMinutes: { type: integer, example: 120 }
 *                     hourlyRateXlm: { type: string, example: "25.0000000" }
 *                     totalAmountXlm: { type: string, example: "50.0000000" }
 *                     status: { type: string, example: approved }
 *                     entryIds:
 *                       type: array
 *                       items: { type: string, format: uuid }
 *                     contractTxHash: { type: string, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *                     updatedAt: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 id: "9a8b7c6d-5555-4a2b-8c3d-4e5f6a7b8c9d"
 *                 jobId: "3d9f2b1a-1111-4a2b-8c3d-4e5f6a7b8c9d"
 *                 freelancerAddress: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                 clientAddress: GDCLIENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                 totalMinutes: 120
 *                 hourlyRateXlm: "25.0000000"
 *                 totalAmountXlm: "50.0000000"
 *                 status: approved
 *                 entryIds: ["6f1a2b3c-4444-4a2b-8c3d-4e5f6a7b8c9d"]
 *                 contractTxHash: "a1b2c3d4e5f6...stellar-tx-hash"
 *                 createdAt: "2026-08-20T12:00:00.000Z"
 *                 updatedAt: "2026-08-20T13:00:00.000Z"
 *       400:
 *         description: Invalid Stellar address, invalid decision value, or invoice already decided
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "decision must be 'approved' or 'rejected'"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not the job client for this invoice
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Only the job client can review this invoice"
 *       404:
 *         description: Invoice not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invoice not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.patch("/invoice/:invoiceId/review", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const { invoiceId } = req.params;
    const { decision, contractTxHash } = req.body;
    const clientAddress = req.user.publicKey;

    const invoice = await reviewInvoice({
      invoiceId,
      clientAddress,
      decision,
      contractTxHash,
    });

    res.json({ success: true, data: invoice });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
