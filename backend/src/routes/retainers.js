/**
 * src/routes/retainers.js
 * Recurring retainers and subscription billing (Issue #321).
 * See docs/ADR-012-recurring-retainers.md for the full design.
 *
 *   POST   /api/retainers/proposals                          — propose a retainer (commercial surface)
 *   GET    /api/retainers/proposals                          — list proposals sent/received by the caller
 *   GET    /api/retainers/proposals/:proposalId               — get one proposal
 *   POST   /api/retainers/proposals/:proposalId/respond        — counterparty accepts/declines
 *   POST   /api/retainers/proposals/:proposalId/withdraw        — proposer withdraws
 *
 *   GET    /api/retainers                                     — list the caller's retainers
 *   GET    /api/retainers/:retainerId                          — get one retainer
 *   GET    /api/retainers/:retainerId/periods                   — billing history
 *   GET    /api/retainers/:retainerId/forecast                  — projected next charge
 *   POST   /api/retainers/:retainerId/fund                      — client tops up the funded balance
 *   POST   /api/retainers/:retainerId/amendments                — propose price/terms/pause/resume change
 *   POST   /api/retainers/amendments/:amendmentId/respond         — counterparty accepts/rejects
 *   POST   /api/retainers/:retainerId/cancel                    — request cancellation (starts notice period)
 *
 *   GET    /api/retainers/:retainerId/time-entries               — logged time for the retainer
 *   POST   /api/retainers/:retainerId/time-entries               — freelancer logs time
 *   PATCH  /api/retainers/time-entries/:entryId/review            — client approves/rejects
 *   POST   /api/retainers/time-entries/:entryId/dispute            — either party disputes
 *   PATCH  /api/retainers/time-entries/:entryId/resolve-dispute    — resolve a dispute
 *
 *   GET    /api/retainers/reports/freelancer-revenue              — self: recurring revenue + run rate
 *   GET    /api/retainers/reports/client-spend                    — self: committed monthly spend
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const retainerService = require("../services/retainerService");

const readLimiter = createRateLimiter(60, 1);
const writeLimiter = createRateLimiter(30, 1);

function forbidden(res, message) {
  return res.status(403).json({ error: message });
}

function assertParticipantOr403(resource, address, res) {
  if (resource.clientAddress === address || resource.freelancerAddress === address) return true;
  forbidden(res, "You are not a participant in this retainer");
  return false;
}

// ─── Proposals ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/retainers/proposals:
 *   post:
 *     summary: Propose a recurring retainer
 *     description: >
 *       The commercial surface for retainers, distinct from job applications.
 *       Either a client or a freelancer can propose terms (period type,
 *       billing model, amount, cap hours for a capped_hourly retainer,
 *       auto-renew, notice period, rollover policy) to a counterparty, who
 *       then accepts or declines. Rate limited to 30/min per IP.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       201: { description: Proposal created }
 *       400: { description: Invalid terms }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/proposals", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const proposal = await retainerService.createProposal({
      ...req.body,
      proposerAddress: req.user.publicKey,
    });
    res.status(201).json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/proposals:
 *   get:
 *     summary: List retainer proposals sent to or by the caller
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: direction
 *         schema: { type: string, enum: [incoming, outgoing, all] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, accepted, declined, withdrawn] }
 *     responses:
 *       200: { description: Proposals }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/proposals", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const proposals = await retainerService.listProposalsForUser(req.user.publicKey, {
      direction: req.query.direction,
      status: req.query.status,
    });
    res.json({ success: true, data: proposals });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/proposals/{proposalId}:
 *   get:
 *     summary: Get a retainer proposal
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Proposal }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not party to this proposal }
 *       404: { description: Proposal not found }
 */
router.get("/proposals/:proposalId", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const proposal = await retainerService.getProposal(req.params.proposalId);
    if (
      proposal.proposerAddress !== req.user.publicKey &&
      proposal.counterpartyAddress !== req.user.publicKey
    ) {
      return forbidden(res, "You are not party to this proposal");
    }
    res.json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/proposals/{proposalId}/respond:
 *   post:
 *     summary: Accept or decline a retainer proposal
 *     description: >
 *       Only the proposal's counterparty may respond. Accepting atomically
 *       creates the retainer and its first billing period. Rate limited to
 *       30/min per IP.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Proposal decided }
 *       400: { description: Invalid decision or proposal already decided }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not the proposal's counterparty }
 *       404: { description: Proposal not found }
 */
router.post("/proposals/:proposalId/respond", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const result = await retainerService.respondToProposal({
      proposalId: req.params.proposalId,
      responderAddress: req.user.publicKey,
      decision: req.body.decision,
      declineReason: req.body.declineReason,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/proposals/{proposalId}/withdraw:
 *   post:
 *     summary: Withdraw a pending retainer proposal
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Proposal withdrawn }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not the proposer }
 *       404: { description: Proposal not found }
 */
router.post("/proposals/:proposalId/withdraw", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const proposal = await retainerService.withdrawProposal({
      proposalId: req.params.proposalId,
      requesterAddress: req.user.publicKey,
    });
    res.json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

// ─── Reports (declared before the /:retainerId catch-alls) ────────────────────

/**
 * @swagger
 * /api/retainers/reports/freelancer-revenue:
 *   get:
 *     summary: Recurring revenue for the authenticated freelancer
 *     description: Monthly released totals plus the current monthly run-rate across active retainers.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Revenue report }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/reports/freelancer-revenue", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const report = await retainerService.getFreelancerRecurringRevenue(req.user.publicKey, {
      months: req.query.months,
    });
    res.json({ success: true, data: report });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/reports/client-spend:
 *   get:
 *     summary: Committed recurring spend for the authenticated client
 *     description: Sum of the monthly-equivalent ceiling across the client's active retainers.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Committed spend report }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/reports/client-spend", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const report = await retainerService.getClientCommittedSpend(req.user.publicKey);
    res.json({ success: true, data: report });
  } catch (e) {
    next(e);
  }
});

// ─── Time entries (declared before /:retainerId so "time-entries" doesn't match as an id) ──

/**
 * @swagger
 * /api/retainers/time-entries/{entryId}/review:
 *   patch:
 *     summary: Client approves or rejects a pending retainer time entry
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Entry reviewed }
 *       400: { description: Entry not pending approval }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not the retainer's client }
 *       404: { description: Entry not found }
 */
router.patch("/time-entries/:entryId/review", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const entry = await retainerService.approveRetainerTimeEntry({
      entryId: req.params.entryId,
      clientAddress: req.user.publicKey,
      decision: req.body.decision,
    });
    res.json({ success: true, data: entry });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/time-entries/{entryId}/dispute:
 *   post:
 *     summary: Dispute a logged retainer time entry
 *     description: >
 *       Either party may dispute a pending or approved entry. This removes
 *       only that entry from the period's approved-hours tally — it never
 *       blocks the rest of the period from releasing on schedule.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Entry disputed }
 *       400: { description: Entry cannot be disputed in its current state }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not a participant in this retainer }
 *       404: { description: Entry not found }
 */
router.post("/time-entries/:entryId/dispute", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const entry = await retainerService.disputeRetainerTimeEntry({
      entryId: req.params.entryId,
      disputedBy: req.user.publicKey,
      reason: req.body.reason,
    });
    res.json({ success: true, data: entry });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/time-entries/{entryId}/resolve-dispute:
 *   patch:
 *     summary: Resolve a disputed retainer time entry
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Dispute resolved }
 *       400: { description: Entry is not under dispute }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not a participant in this retainer }
 *       404: { description: Entry not found }
 */
router.patch(
  "/time-entries/:entryId/resolve-dispute",
  verifyJWT,
  writeLimiter,
  async (req, res, next) => {
    try {
      const entry = await retainerService.resolveRetainerTimeEntryDispute({
        entryId: req.params.entryId,
        resolvedBy: req.user.publicKey,
        decision: req.body.decision,
      });
      res.json({ success: true, data: entry });
    } catch (e) {
      next(e);
    }
  }
);

// ─── Amendments (respond, declared before /:retainerId) ───────────────────────

/**
 * @swagger
 * /api/retainers/amendments/{amendmentId}/respond:
 *   post:
 *     summary: Accept or reject a proposed retainer amendment
 *     description: >
 *       Applies renewal, price-change, terms-change, pause and resume
 *       amendments only on acceptance — a price change or other term never
 *       applies silently. Only the retainer's other party (not the proposer)
 *       may respond.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: amendmentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Amendment decided }
 *       400: { description: Invalid decision or amendment already decided }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not the retainer's other party }
 *       404: { description: Amendment not found }
 */
router.post("/amendments/:amendmentId/respond", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const result = await retainerService.respondToAmendment({
      amendmentId: req.params.amendmentId,
      responderAddress: req.user.publicKey,
      decision: req.body.decision,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

// ─── Retainers ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/retainers:
 *   get:
 *     summary: List the authenticated user's retainers
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, paused, pending_cancellation, cancelled] }
 *     responses:
 *       200: { description: Retainers }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const retainers = await retainerService.listRetainersForUser(req.user.publicKey, {
      status: req.query.status,
    });
    res.json({ success: true, data: retainers });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/{retainerId}:
 *   get:
 *     summary: Get a retainer
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: retainerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Retainer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not a participant in this retainer }
 *       404: { description: Retainer not found }
 */
router.get("/:retainerId", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const retainer = await retainerService.getRetainer(req.params.retainerId);
    if (!assertParticipantOr403(retainer, req.user.publicKey, res)) return;
    res.json({ success: true, data: retainer });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/{retainerId}/periods:
 *   get:
 *     summary: Billing period history for a retainer
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: retainerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Periods }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not a participant in this retainer }
 *       404: { description: Retainer not found }
 */
router.get("/:retainerId/periods", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const retainer = await retainerService.getRetainer(req.params.retainerId);
    if (!assertParticipantOr403(retainer, req.user.publicKey, res)) return;
    const periods = await retainerService.listPeriodsForRetainer(req.params.retainerId);
    res.json({ success: true, data: periods });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/{retainerId}/forecast:
 *   get:
 *     summary: Forecast the retainer's next charge
 *     description: Projected amount due for the current open period, current funded balance, and whether it will cover the release in full.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: retainerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Forecast }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not a participant in this retainer }
 *       404: { description: Retainer not found }
 */
router.get("/:retainerId/forecast", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const forecast = await retainerService.getForecast(req.params.retainerId, req.user.publicKey);
    res.json({ success: true, data: forecast });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/{retainerId}/fund:
 *   post:
 *     summary: Top up a retainer's funded balance
 *     description: >
 *       Records a client top-up (and its on-chain tx hash, if supplied) the
 *       same way time_invoices.contract_tx_hash records an escrow release —
 *       this endpoint records the decision, it does not submit a Soroban
 *       transaction itself. Rate limited to 30/min per IP.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: retainerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Retainer funded }
 *       400: { description: Invalid amount or retainer is cancelled }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not the retainer's client }
 *       404: { description: Retainer not found }
 */
router.post("/:retainerId/fund", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const retainer = await retainerService.fundRetainer({
      retainerId: req.params.retainerId,
      clientAddress: req.user.publicKey,
      amountXlm: req.body.amountXlm,
      contractTxHash: req.body.contractTxHash,
    });
    res.json({ success: true, data: retainer });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/{retainerId}/amendments:
 *   post:
 *     summary: Propose a change to a live retainer
 *     description: >
 *       type is one of price_change, terms_change, pause, resume,
 *       renewal_terms. Requires the counterparty's explicit accept before
 *       anything changes — see POST /api/retainers/amendments/{id}/respond.
 *       Only one amendment may be pending per retainer at a time. Rate
 *       limited to 30/min per IP.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: retainerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Amendment proposed }
 *       400: { description: Invalid type/payload or an amendment is already pending }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not a participant in this retainer }
 *       404: { description: Retainer not found }
 */
router.post("/:retainerId/amendments", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const amendment = await retainerService.proposeAmendment({
      retainerId: req.params.retainerId,
      proposedBy: req.user.publicKey,
      type: req.body.type,
      payload: req.body.payload,
    });
    res.status(201).json({ success: true, data: amendment });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/{retainerId}/cancel:
 *   post:
 *     summary: Request cancellation of a retainer
 *     description: >
 *       Starts the agreed notice period rather than cancelling immediately —
 *       the retainer keeps billing normally until cancel_effective_at, at
 *       which point the scheduler settles the open period pro-rata. Either
 *       party may request cancellation. Rate limited to 30/min per IP.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: retainerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "Cancellation requested, with a pro-rata settlement preview" }
 *       400: { description: Retainer is not in a cancellable state }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not a participant in this retainer }
 *       404: { description: Retainer not found }
 */
router.post("/:retainerId/cancel", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const result = await retainerService.requestCancellation({
      retainerId: req.params.retainerId,
      requestedBy: req.user.publicKey,
      reason: req.body.reason,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/{retainerId}/time-entries:
 *   get:
 *     summary: List logged time entries for a retainer
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: retainerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: periodId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Time entries }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not a participant in this retainer }
 *       404: { description: Retainer not found }
 */
router.get("/:retainerId/time-entries", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const retainer = await retainerService.getRetainer(req.params.retainerId);
    if (!assertParticipantOr403(retainer, req.user.publicKey, res)) return;
    const entries = await retainerService.listRetainerTimeEntries(req.params.retainerId, {
      periodId: req.query.periodId,
    });
    res.json({ success: true, data: entries });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/retainers/{retainerId}/time-entries:
 *   post:
 *     summary: Log time against a retainer
 *     description: >
 *       Only the retainer's freelancer may log time, and only while it has
 *       an open billing period. The entry starts pending client approval —
 *       see PATCH /api/retainers/time-entries/{entryId}/review. Rate limited
 *       to 30/min per IP.
 *     tags: [Retainers]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: retainerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Time entry logged }
 *       400: { description: Invalid duration or no open billing period }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Caller is not the retainer's freelancer }
 *       404: { description: Retainer not found }
 */
router.post("/:retainerId/time-entries", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const entry = await retainerService.logRetainerTime({
      retainerId: req.params.retainerId,
      freelancerAddress: req.user.publicKey,
      durationMinutes: req.body.durationMinutes,
      description: req.body.description,
      startedAt: req.body.startedAt,
    });
    res.status(201).json({ success: true, data: entry });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
