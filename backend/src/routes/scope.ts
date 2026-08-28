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
 * src/routes/scope.js
 * Scope session management routes
 */
("use strict");

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const renewRateLimiter = createRateLimiter(5, 1);

/**
 * @swagger
 * /api/scope/{sessionId}/renew:
 *   post:
 *     summary: Renew a scope session
 *     description: >
 *       Extends an active (not-yet-expired) scope session's expiry by 24 hours from now. No
 *       request body is read; the session is identified purely by the `sessionId` path
 *       parameter, and no authentication is required.
 *     tags: [Scope]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Scope session identifier
 *         example: "3f1b2c4d-5678-90ab-cdef-1234567890ab"
 *     responses:
 *       200:
 *         description: Session renewed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 sessionId: { type: string, example: "3f1b2c4d-5678-90ab-cdef-1234567890ab" }
 *                 expiresAt: { type: string, format: date-time, example: "2026-08-22T12:00:00.000Z" }
 *       404:
 *         description: Session does not exist or has already expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Session not found or already expired
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Unexpected error while renewing the session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/:sessionId/renew", renewRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const { sessionId } = req.params;

    const { rows } = await rawQuery<ScopeSessionTable>(
      `UPDATE scope_sessions
       SET expires_at = NOW() + INTERVAL '24 hours',
           updated_at = NOW()
       WHERE session_id = $1 AND expires_at > NOW()
       RETURNING session_id, expires_at`,
      [sessionId]
    );

    if (!rows.length) {
      const e = new Error("Session not found or already expired");
      e.status = 404;
      throw e;
    }

    res.json({
      success: true,
      sessionId: rows[0].session_id,
      expiresAt: rows[0].expires_at,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
