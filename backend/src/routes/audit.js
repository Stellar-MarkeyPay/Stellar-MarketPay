"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { getJob } = require("../services/jobService");
const { getAuditLogsForJob } = require("../services/contractAuditService");

const adminList = (process.env.ADMIN_PUBLIC_KEYS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

/**
 * @swagger
 * /api/audit/{jobId}:
 *   get:
 *     summary: Get contract audit log entries for a job
 *     description: >
 *       Returns the on-chain contract interaction audit trail (create_escrow, start_work,
 *       release_escrow, release_with_conversion, refund_escrow) recorded for the given job,
 *       most recent first. Only the job's client, the job's freelancer, or an address listed in
 *       the `ADMIN_PUBLIC_KEYS` environment variable may view the log.
 *     tags: [Audit]
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
 *         description: ID of the job whose audit log is being requested.
 *         example: "9c7f2b1e-5b1a-4c9a-9d3b-abcdef012345"
 *     responses:
 *       200:
 *         description: Audit log entries retrieved successfully.
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
 *                       function_name:
 *                         type: string
 *                         enum: [create_escrow, start_work, release_escrow, release_with_conversion, refund_escrow]
 *                       caller_address:
 *                         type: string
 *                         example: "GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O"
 *                       job_id:
 *                         type: string
 *                         format: uuid
 *                       tx_hash:
 *                         type: string
 *                         example: "a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef"
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *             example:
 *               success: true
 *               data:
 *                 - id: "3f2b6f2e-4b1a-4c9a-9d3b-1234567890ab"
 *                   function_name: "release_escrow"
 *                   caller_address: "GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O"
 *                   job_id: "9c7f2b1e-5b1a-4c9a-9d3b-abcdef012345"
 *                   tx_hash: "a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef"
 *                   created_at: "2026-08-15T10:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is neither the job's client/freelancer nor a listed admin address.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden"
 *       404:
 *         description: No job exists with the given ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Job not found"
 */
router.get("/:jobId", verifyJWT, async (req, res, next) => {
  try {
    const job = await getJob(req.params.jobId);
    const caller = req.user.publicKey;
    const isParticipant = caller === job.clientAddress || caller === job.freelancerAddress;
    const isAdmin = adminList.includes(caller);
    if (!isParticipant && !isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await getAuditLogsForJob(req.params.jobId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
