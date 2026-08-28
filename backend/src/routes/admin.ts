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
 * src/routes/admin.js
 * Admin-only moderation routes — protected by JWT role=admin check.
 */
("use strict");

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { verifyJWT, requireAdminRole, requireAdmin2FA } = require("../middleware/auth");
const { updateJobStatus } = require("../services/jobService");
const { logContractInteraction } = require("../services/contractAuditService");

// Helper: log admin action
async function logAdminAction({ action, adminAddress, targetId, targetType, details }: any) {
  try {
    await rawQuery<any>(
      `INSERT INTO audit_logs (actor_address, action, target, reason, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        adminAddress,
        action,
        targetId || null,
        details?.reason || null,
        JSON.stringify({ targetType, ...details }),
      ]
    );
  } catch {
    // Table may not exist yet — fail silently, action is still performed
  }
}

// ── GET /api/admin/metrics — platform analytics dashboard ─────────────────────
router.get(
  "/metrics",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { period = "30d" } = req.query;

      // Calculate date range based on period
      let daysBack = 30;
      if (period === "7d") daysBack = 7;
      else if (period === "90d") daysBack = 90;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      // Platform Health Metrics
      const platformHealth = await rawQuery<JobTable>(
        `
      SELECT
        COUNT(*) as total_jobs,
        COUNT(*) FILTER (WHERE status = 'open') as open_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'disputed') as disputed_jobs,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'completed')::numeric /
          NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'cancelled'))::numeric, 0) * 100, 2
        ) as completion_rate,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'disputed')::numeric /
          NULLIF(COUNT(*)::numeric, 0) * 100, 2
        ) as dispute_rate
      FROM jobs
      WHERE created_at >= $1
    `,
        [startDate]
      );

      // User Growth Metrics
      const userGrowth = await rawQuery<ProfileTable>(
        `
      SELECT
        COUNT(DISTINCT public_key) as total_users,
        COUNT(DISTINCT public_key) FILTER (WHERE role IN ('freelancer', 'both')) as freelancers,
        COUNT(DISTINCT public_key) FILTER (WHERE role IN ('client', 'both')) as clients,
        COUNT(DISTINCT public_key) FILTER (WHERE created_at >= $1) as new_users_period
      FROM profiles
    `,
        [startDate]
      );

      // Weekly new user growth
      const weeklyGrowth = await rawQuery<ProfileTable>(
        `
      SELECT
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as new_users
      FROM profiles
      WHERE created_at >= $1
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week
    `,
        [startDate]
      );

      // Financial Metrics
      const financialMetrics = await rawQuery<JobTable>(
        `
      SELECT
        COALESCE(SUM(budget) FILTER (WHERE status = 'funded'), 0) as total_xlm_escrow,
        COALESCE(SUM(budget) FILTER (WHERE status = 'released'), 0) as total_xlm_released,
        COALESCE(AVG(budget), 0) as avg_job_budget,
        COUNT(*) FILTER (WHERE status = 'funded') as active_escrows
      FROM jobs j
      LEFT JOIN escrows e ON j.id = e.job_id
      WHERE j.created_at >= $1
    `,
        [startDate]
      );

      // Quality Metrics
      const qualityMetrics = await rawQuery<JobTable>(
        `
      SELECT
        COALESCE(AVG(rating), 0) as avg_rating,
        COUNT(*) as total_ratings,
        COUNT(DISTINCT j.client_address) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM jobs j2
            WHERE j2.client_address = j.client_address
            AND j2.freelancer_address = j.freelancer_address
            AND j2.id != j.id
          )
        ) as repeat_hires
      FROM jobs j
      LEFT JOIN ratings r ON j.id = r.job_id
      WHERE j.created_at >= $1 AND j.status = 'completed'
    `,
        [startDate]
      );

      // Dispute Metrics
      const disputeMetrics = await rawQuery<JobTable>(
        `
      SELECT
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) FILTER (WHERE status = 'disputed') as disputes_opened,
        COUNT(*) FILTER (WHERE status = 'resolved') as disputes_resolved
      FROM jobs
      WHERE created_at >= $1
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week
    `,
        [startDate]
      );

      // Top Earners
      const topEarners = await rawQuery<ProfileTable>(`
      SELECT 
        p.public_key,
        p.display_name,
        p.total_earned_xlm,
        p.completed_jobs,
        p.rating
      FROM profiles p
      WHERE p.total_earned_xlm > 0
      ORDER BY p.total_earned_xlm DESC
      LIMIT 10
    `);

      // Job Volume Over Time
      const jobVolume = await rawQuery<JobTable>(
        `
      SELECT
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as jobs_created,
        COUNT(*) FILTER (WHERE status = 'completed') as jobs_completed
      FROM jobs
      WHERE created_at >= $1
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date
    `,
        [startDate]
      );

      res.json({
        success: true,
        data: {
          period,
          platformHealth: platformHealth.rows[0],
          userGrowth: userGrowth.rows[0],
          weeklyGrowth: weeklyGrowth.rows,
          financialMetrics: financialMetrics.rows[0],
          qualityMetrics: qualityMetrics.rows[0],
          disputeMetrics: disputeMetrics.rows,
          topEarners: topEarners.rows,
          jobVolume: jobVolume.rows,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/admin/reports/jobs — list all flagged/reported jobs ───────────────
/**
 * @swagger
 * /api/admin/reports/jobs:
 *   get:
 *     summary: List flagged/reported jobs
 *     description: >
 *       Returns the 100 most recently reported jobs, joined with job title/status/client info.
 *       Admin-only, and requires a verified 2FA claim when 2FA is enabled for the account.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Job reports retrieved successfully.
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
 *                       id: { type: string, format: uuid }
 *                       job_id: { type: string, format: uuid }
 *                       reporter_address: { type: string, example: "GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O" }
 *                       category: { type: string, example: "fraud" }
 *                       description: { type: string, example: "Client requested off-platform payment." }
 *                       created_at: { type: string, format: date-time }
 *                       job_title: { type: string, example: "Build a Soroban escrow contract" }
 *                       job_status: { type: string, example: "open" }
 *                       client_address: { type: string, example: "GB5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O" }
 *               example:
 *                 success: true
 *                 data:
 *                   - id: "3f2b6f2e-4b1a-4c9a-9d3b-1234567890ab"
 *                     job_id: "9c7f2b1e-5b1a-4c9a-9d3b-abcdef012345"
 *                     reporter_address: "GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O"
 *                     category: "fraud"
 *                     description: "Client requested off-platform payment."
 *                     created_at: "2026-08-15T10:00:00.000Z"
 *                     job_title: "Build a Soroban escrow contract"
 *                     job_status: "open"
 *                     client_address: "GB5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Forbidden. Either the caller is not an admin, or the admin account has 2FA enabled
 *           and the current JWT has not been through the 2FA-verify step.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 requires2FA:
 *                   type: boolean
 *             examples:
 *               notAdmin:
 *                 value: { error: "Forbidden: Admin access required" }
 *               requires2FA:
 *                 value: { error: "2FA required", requires2FA: true }
 */
router.get(
  "/reports/jobs",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { rows } = await rawQuery<any>(
        `SELECT jr.id, jr.job_id, jr.reporter_address, jr.category, jr.description,
              jr.created_at, j.title AS job_title, j.status AS job_status,
              j.client_address
       FROM job_reports jr
       LEFT JOIN jobs j ON jr.job_id = j.id
       ORDER BY jr.created_at DESC
       LIMIT 100`
      );
      res.json({ success: true, data: rows });
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/admin/disputes — list all open disputes ─────────────────────────
router.get(
  "/disputes",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { rows } = await rawQuery<EscrowTable>(
        `SELECT e.job_id, e.status AS escrow_status, e.created_at AS escrow_created_at,
              j.title AS job_title, j.client_address, j.freelancer_address,
              j.budget, j.currency, j.status AS job_status
       FROM escrows e
       LEFT JOIN jobs j ON e.job_id = j.id
       WHERE e.status = 'disputed' OR j.status = 'disputed'
       ORDER BY e.created_at DESC
       LIMIT 100`
      );
      res.json({ success: true, data: rows });
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/admin/reported-wallets — list reported user addresses ─────────────
/**
 * @swagger
 * /api/admin/reported-wallets:
 *   get:
 *     summary: List most-reported wallet addresses
 *     description: >
 *       Aggregates job_reports by reporter_address, returning up to 100 addresses ordered by
 *       report count descending. Admin-only, and requires a verified 2FA claim when 2FA is
 *       enabled for the account.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Reported wallets retrieved successfully.
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
 *                       reported_address: { type: string, example: "GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O" }
 *                       report_count: { type: integer, example: 4 }
 *                       last_reported_at: { type: string, format: date-time }
 *               example:
 *                 success: true
 *                 data:
 *                   - reported_address: "GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O"
 *                     report_count: 4
 *                     last_reported_at: "2026-08-18T09:30:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Forbidden. Either the caller is not an admin, or the admin account has 2FA enabled
 *           and the current JWT has not been through the 2FA-verify step.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 requires2FA:
 *                   type: boolean
 *             examples:
 *               notAdmin:
 *                 value: { error: "Forbidden: Admin access required" }
 *               requires2FA:
 *                 value: { error: "2FA required", requires2FA: true }
 */
router.get(
  "/reported-wallets",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { rows } = await rawQuery<any>(
        `SELECT reporter_address AS reported_address, COUNT(*) AS report_count,
              MAX(created_at) AS last_reported_at
       FROM job_reports
       GROUP BY reporter_address
       HAVING COUNT(*) > 0
       ORDER BY report_count DESC
       LIMIT 100`
      );
      res.json({ success: true, data: rows });
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/admin/logs — admin action audit log ───────────────────────────────
router.get("/logs", verifyJWT, requireAdminRole, requireAdmin2FA, async (req: any, res: any) => {
  try {
    const { rows } = await rawQuery<any>(
      `SELECT id, action, actor_address, target, reason, metadata, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT 200`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.json({ success: true, data: [] });
  }
});

// ── PATCH /api/admin/disputes/:jobId/resolve — mark dispute resolved ───────────
/**
 * @swagger
 * /api/admin/disputes/{jobId}/resolve:
 *   patch:
 *     summary: Resolve a disputed job
 *     description: >
 *       Marks the escrow for the given job as resolved, then sets the job status to
 *       `cancelled` (funds released to client) or `completed` (funds released to freelancer)
 *       depending on `releaseTo`, and records the action in the admin audit log and the
 *       on-chain contract audit log. Admin-only, and requires a verified 2FA claim when 2FA is
 *       enabled for the account.
 *     tags: [Admin]
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
 *         description: ID of the disputed job.
 *         example: "9c7f2b1e-5b1a-4c9a-9d3b-abcdef012345"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - resolution
 *             properties:
 *               resolution:
 *                 type: string
 *                 description: Admin's written resolution note, stored as the audit log reason.
 *                 example: "Freelancer delivered per spec; releasing funds."
 *               releaseTo:
 *                 type: string
 *                 enum: [client, freelancer]
 *                 description: Who the escrow funds are released to. `client` cancels the job; anything else marks it completed.
 *                 example: freelancer
 *           example:
 *             resolution: "Freelancer delivered per spec; releasing funds."
 *             releaseTo: freelancer
 *     responses:
 *       200:
 *         description: Dispute resolved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Dispute resolved. Job marked as completed." }
 *       400:
 *         description: Missing resolution note.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Resolution note is required"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Forbidden. Either the caller is not an admin, or the admin account has 2FA enabled
 *           and the current JWT has not been through the 2FA-verify step.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 requires2FA:
 *                   type: boolean
 *             examples:
 *               notAdmin:
 *                 value: { error: "Forbidden: Admin access required" }
 *               requires2FA:
 *                 value: { error: "2FA required", requires2FA: true }
 *       404:
 *         description: Job not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Job not found"
 */
router.patch(
  "/disputes/:jobId/resolve",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { jobId } = req.params;
      const { resolution, releaseTo } = req.body; // releaseTo: 'client' | 'freelancer'

      if (!resolution) {
        return res.status(400).json({ error: "Resolution note is required" });
      }

      // Update escrow status
      await rawQuery<EscrowTable>(
        `UPDATE escrows SET status = 'resolved', updated_at = NOW() WHERE job_id = $1`,
        [jobId]
      );

      // Update job status
      const newJobStatus = releaseTo === "client" ? "cancelled" : "completed";
      await updateJobStatus(jobId, newJobStatus);

      await logAdminAction({
        action: "resolve_dispute",
        adminAddress: req.user.publicKey,
        targetId: jobId,
        targetType: "job",
        details: { reason: resolution, resolution, releaseTo, newJobStatus },
      });

      await logContractInteraction({
        functionName: "admin_resolve_dispute",
        callerAddress: req.user.publicKey,
        jobId,
        txHash: `admin-${Date.now()}`,
      });

      res.json({
        success: true,
        message: `Dispute resolved. Job marked as ${newJobStatus}.`,
      });
    } catch (e) {
      next(e);
    }
  }
);

// ── PATCH /api/admin/jobs/:jobId/cancel — cancel a flagged job ─────────────────
/**
 * @swagger
 * /api/admin/jobs/{jobId}/cancel:
 *   patch:
 *     summary: Cancel a flagged job
 *     description: >
 *       Force-sets a job's status to `cancelled` and records the action (with the optional
 *       reason) in the admin audit log. Admin-only, and requires a verified 2FA claim when 2FA
 *       is enabled for the account.
 *     tags: [Admin]
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
 *         description: ID of the job to cancel.
 *         example: "9c7f2b1e-5b1a-4c9a-9d3b-abcdef012345"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Optional reason recorded in the audit log.
 *                 example: "Violates marketplace terms of service."
 *           example:
 *             reason: "Violates marketplace terms of service."
 *     responses:
 *       200:
 *         description: Job cancelled successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Job cancelled by admin." }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Forbidden. Either the caller is not an admin, or the admin account has 2FA enabled
 *           and the current JWT has not been through the 2FA-verify step.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 requires2FA:
 *                   type: boolean
 *             examples:
 *               notAdmin:
 *                 value: { error: "Forbidden: Admin access required" }
 *               requires2FA:
 *                 value: { error: "2FA required", requires2FA: true }
 *       404:
 *         description: Job not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Job not found"
 */
router.patch(
  "/jobs/:jobId/cancel",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { jobId } = req.params;
      const { reason } = req.body;

      await updateJobStatus(jobId, "cancelled");

      await logAdminAction({
        action: "cancel_job",
        adminAddress: req.user.publicKey,
        targetId: jobId,
        targetType: "job",
        details: { reason },
      });

      res.json({ success: true, message: "Job cancelled by admin." });
    } catch (e) {
      next(e);
    }
  }
);

// ── POST /api/admin/wallets/:address/freeze — freeze a wallet ─────────────────
/**
 * @swagger
 * /api/admin/wallets/{address}/freeze:
 *   post:
 *     summary: Freeze a Stellar wallet address
 *     description: >
 *       Upserts a row into `frozen_wallets` for the given address and records the action in the
 *       admin audit log. Admin-only, and requires a verified 2FA claim when 2FA is enabled for
 *       the account.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^G[A-Z0-9]{55}$"
 *         description: Stellar public key (G-address) to freeze.
 *         example: "GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O"
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for freezing the wallet. Defaults to "Admin action" if omitted.
 *                 example: "Multiple fraud reports from clients."
 *           example:
 *             reason: "Multiple fraud reports from clients."
 *     responses:
 *       200:
 *         description: Wallet frozen successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Wallet GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O frozen." }
 *       400:
 *         description: Address is not a valid Stellar G-address.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid Stellar address"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Forbidden. Either the caller is not an admin, or the admin account has 2FA enabled
 *           and the current JWT has not been through the 2FA-verify step.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 requires2FA:
 *                   type: boolean
 *             examples:
 *               notAdmin:
 *                 value: { error: "Forbidden: Admin access required" }
 *               requires2FA:
 *                 value: { error: "2FA required", requires2FA: true }
 */
router.post(
  "/wallets/:address/freeze",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { address } = req.params;
      const { reason } = req.body;

      if (!/^G[A-Z0-9]{55}$/.test(address)) {
        return res.status(400).json({ error: "Invalid Stellar address" });
      }

      await rawQuery<any>(
        `INSERT INTO frozen_wallets (address, reason, frozen_by, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (address) DO UPDATE SET reason = $2, frozen_by = $3, created_at = NOW()`,
        [address, reason || "Admin action", req.user.publicKey]
      );

      await logAdminAction({
        action: "freeze_wallet",
        adminAddress: req.user.publicKey,
        targetId: address,
        targetType: "wallet",
        details: { reason },
      });

      res.json({ success: true, message: `Wallet ${address} frozen.` });
    } catch (e) {
      next(e);
    }
  }
);

// ── DELETE /api/admin/wallets/:address/freeze — unfreeze a wallet ─────────────
/**
 * @swagger
 * /api/admin/wallets/{address}/freeze:
 *   delete:
 *     summary: Unfreeze a Stellar wallet address
 *     description: >
 *       Removes the address from `frozen_wallets` (if present) and records the action in the
 *       admin audit log. Responds successfully even if the address was not frozen. Admin-only,
 *       and requires a verified 2FA claim when 2FA is enabled for the account.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) to unfreeze.
 *         example: "GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O"
 *     responses:
 *       200:
 *         description: Wallet unfrozen successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Wallet GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O unfrozen." }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Forbidden. Either the caller is not an admin, or the admin account has 2FA enabled
 *           and the current JWT has not been through the 2FA-verify step.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 requires2FA:
 *                   type: boolean
 *             examples:
 *               notAdmin:
 *                 value: { error: "Forbidden: Admin access required" }
 *               requires2FA:
 *                 value: { error: "2FA required", requires2FA: true }
 */
router.delete(
  "/wallets/:address/freeze",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { address } = req.params;
      await rawQuery<any>("DELETE FROM frozen_wallets WHERE address = $1", [address]);

      await logAdminAction({
        action: "unfreeze_wallet",
        adminAddress: req.user.publicKey,
        targetId: address,
        targetType: "wallet",
        details: {},
      });

      res.json({ success: true, message: `Wallet ${address} unfrozen.` });
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/admin/wallets/frozen — list frozen wallets ───────────────────────
router.get(
  "/wallets/frozen",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any) => {
    try {
      const { rows } = await rawQuery<any>(
        "SELECT address, reason, frozen_by, created_at FROM frozen_wallets ORDER BY created_at DESC"
      );
      res.json({ success: true, data: rows });
    } catch (e) {
      res.json({ success: true, data: [] });
    }
  }
);

// ── GET /api/admin/jobs/expired — list expired jobs ───────────────────────────
router.get("/jobs/expired", verifyJWT, requireAdminRole, async (req: any, res: any, next: any) => {
  try {
    const { rows } = await rawQuery<JobTable>(
      `SELECT id, title, client_address, budget, currency, status, expires_at, created_at
       FROM jobs
       WHERE status = 'expired'
       ORDER BY expires_at DESC
       LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/admin/jobs/:jobId/reactivate — reactivate expired job ───────────
/**
 * @swagger
 * /api/admin/jobs/{jobId}/reactivate:
 *   post:
 *     summary: Reactivate an expired job
 *     description: >
 *       Sets an expired job's status back to `open` and pushes its expiry 30 days out, then
 *       records the action in the admin audit log. Only succeeds if the job currently has
 *       status `expired`. Admin-only, and requires a verified 2FA claim when 2FA is enabled for
 *       the account.
 *     tags: [Admin]
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
 *         description: ID of the expired job to reactivate.
 *         example: "9c7f2b1e-5b1a-4c9a-9d3b-abcdef012345"
 *     responses:
 *       200:
 *         description: Job reactivated successfully.
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
 *                     title: { type: string, example: "Build a Soroban escrow contract" }
 *                     status: { type: string, example: "open" }
 *                     expires_at: { type: string, format: date-time }
 *               example:
 *                 success: true
 *                 data:
 *                   id: "9c7f2b1e-5b1a-4c9a-9d3b-abcdef012345"
 *                   title: "Build a Soroban escrow contract"
 *                   status: "open"
 *                   expires_at: "2026-09-20T00:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Forbidden. Either the caller is not an admin, or the admin account has 2FA enabled
 *           and the current JWT has not been through the 2FA-verify step.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 requires2FA:
 *                   type: boolean
 *             examples:
 *               notAdmin:
 *                 value: { error: "Forbidden: Admin access required" }
 *               requires2FA:
 *                 value: { error: "2FA required", requires2FA: true }
 *       404:
 *         description: Job not found, or found but not currently expired.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Job not found or not expired"
 */
router.post(
  "/jobs/:jobId/reactivate",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req: any, res: any, next: any) => {
    try {
      const { jobId } = req.params;
      const { rows } = await rawQuery<JobTable>(
        `UPDATE jobs
       SET status = 'open',
           expires_at = NOW() + INTERVAL '30 days',
           updated_at = NOW()
       WHERE id = $1 AND status = 'expired'
       RETURNING id, title, status, expires_at`,
        [jobId]
      );

      if (!rows.length) {
        const e = new Error("Job not found or not expired");
        e.status = 404;
        throw e;
      }

      await logAdminAction({
        action: "job_reactivated",
        adminAddress: req.user.publicKey,
        targetId: jobId,
        targetType: "job",
        details: { reason: "Admin reactivation" },
      });

      res.json({ success: true, data: rows[0] });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
