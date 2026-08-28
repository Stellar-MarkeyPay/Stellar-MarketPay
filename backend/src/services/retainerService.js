/**
 * src/services/retainerService.js
 * Recurring retainers and subscription billing (Issue #321).
 *
 * See docs/ADR-012-recurring-retainers.md for the full design. In short:
 *
 *   retainer_proposals   → accept/decline →  retainers ──1:N──▶ retainer_periods
 *                                                │  ▲                  │
 *                                                │  │ pending amendment │ 1:N
 *                                                ▼  │                   ▼
 *                                       retainer_amendments       time_entries
 *                                                │
 *                                                ▼
 *                                       retainer_funding_events
 *
 * `runBillingCycle()` is the single entry point the scheduler (wired in
 * server.js, following the existing weekly-digest / notification-poller
 * pattern) calls on an interval. Every other export is used either by the
 * routes in routes/retainers.js or directly by runBillingCycle.
 */
"use strict";

const pool = require("../db/pool");
const { createInAppNotification } = require("./notificationService");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("retainer-service");

const UNDERFUNDING_LOOKAHEAD_DAYS = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validatePublicKey(key, label = "address") {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error(`Invalid Stellar public key (${label})`);
    e.status = 400;
    throw e;
  }
}

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

function notFound(message) {
  const e = new Error(message);
  e.status = 404;
  return e;
}

function forbidden(message) {
  const e = new Error(message);
  e.status = 403;
  return e;
}

function toNum(value, fallback = 0) {
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function money(n) {
  return toNum(n).toFixed(7);
}

/** Add one billing period's length to a date, in UTC. */
function addPeriod(date, periodType) {
  const d = new Date(date);
  if (periodType === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
  } else {
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d;
}

function minutesToHours(minutes) {
  return round2(minutes / 60);
}

/**
 * Amount due for a period given its snapshotted terms and this period's
 * approved hours. `effectiveCapHours` already includes any rollover-in.
 */
function computeAmountDue(
  { billingModel, amountXlm, hourlyRateXlm },
  approvedHours,
  effectiveCapHours
) {
  if (billingModel === "fixed") return toNum(amountXlm);
  const billableHours = Math.min(toNum(approvedHours), toNum(effectiveCapHours));
  return round2(billableHours) * toNum(hourlyRateXlm);
}

function assertParticipant(retainer, address, label = "a participant in this retainer") {
  if (retainer.client_address !== address && retainer.freelancer_address !== address) {
    throw forbidden(`Only ${label} can perform this action`);
  }
}

function counterpartyOf(retainer, address) {
  return address === retainer.client_address
    ? retainer.freelancer_address
    : retainer.client_address;
}

async function notify({ userAddress, type, title, body, linkPath }) {
  try {
    await createInAppNotification({ userAddress, type, title, body, linkPath });
  } catch (err) {
    // Notification failures must never roll back or block billing logic.
    logger.warn({ err: err.message, userAddress, type }, "Failed to create retainer notification");
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToProposal(row) {
  return {
    id: row.id,
    proposerAddress: row.proposer_address,
    counterpartyAddress: row.counterparty_address,
    proposerRole: row.proposer_role,
    title: row.title,
    description: row.description,
    periodType: row.period_type,
    billingModel: row.billing_model,
    amountXlm: row.amount_xlm,
    hourlyRateXlm: row.hourly_rate_xlm,
    capHours: row.cap_hours,
    autoRenew: row.auto_renew,
    noticePeriodDays: row.notice_period_days,
    rolloverPolicy: row.rollover_policy,
    proposedStartDate: row.proposed_start_date,
    status: row.status,
    declineReason: row.decline_reason,
    retainerId: row.retainer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
  };
}

function rowToRetainer(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    clientAddress: row.client_address,
    freelancerAddress: row.freelancer_address,
    title: row.title,
    description: row.description,
    periodType: row.period_type,
    billingModel: row.billing_model,
    amountXlm: row.amount_xlm,
    hourlyRateXlm: row.hourly_rate_xlm,
    capHours: row.cap_hours,
    autoRenew: row.auto_renew,
    noticePeriodDays: row.notice_period_days,
    rolloverPolicy: row.rollover_policy,
    status: row.status,
    balanceXlm: row.balance_xlm,
    pendingAmendmentId: row.pending_amendment_id,
    cancelRequestedBy: row.cancel_requested_by,
    cancelReason: row.cancel_reason,
    cancelEffectiveAt: row.cancel_effective_at,
    cancelledAt: row.cancelled_at,
    pausedAt: row.paused_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPeriod(row) {
  return {
    id: row.id,
    retainerId: row.retainer_id,
    periodIndex: row.period_index,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    billingModel: row.billing_model,
    amountXlm: row.amount_xlm,
    hourlyRateXlm: row.hourly_rate_xlm,
    capHours: row.cap_hours != null ? toNum(row.cap_hours) : null,
    rolloverHoursIn: toNum(row.rollover_hours_in),
    rolloverHoursOut: toNum(row.rollover_hours_out),
    forfeitedHours: toNum(row.forfeited_hours),
    loggedHours: toNum(row.logged_hours),
    approvedHours: toNum(row.approved_hours),
    disputedHours: toNum(row.disputed_hours),
    amountDueXlm: row.amount_due_xlm,
    amountReleasedXlm: row.amount_released_xlm,
    shortfallXlm: row.shortfall_xlm,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAmendment(row) {
  return {
    id: row.id,
    retainerId: row.retainer_id,
    type: row.type,
    proposedBy: row.proposed_by,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function rowToStatement(row) {
  return {
    id: row.id,
    retainerId: row.retainer_id,
    periodId: row.period_id,
    invoiceNumber: row.invoice_number,
    freelancerAddress: row.freelancer_address,
    clientAddress: row.client_address,
    loggedHours: toNum(row.logged_hours),
    approvedHours: toNum(row.approved_hours),
    disputedHours: toNum(row.disputed_hours),
    forfeitedHours: toNum(row.forfeited_hours),
    rolloverHours: toNum(row.rollover_hours),
    amountDueXlm: row.amount_due_xlm,
    amountReleasedXlm: row.amount_released_xlm,
    shortfallXlm: row.shortfall_xlm,
    status: row.status,
    createdAt: row.created_at,
  };
}

function rowToRetainerTimeEntry(row) {
  return {
    id: row.id,
    retainerId: row.retainer_id,
    retainerPeriodId: row.retainer_period_id,
    freelancerAddress: row.freelancer_address,
    durationMinutes: row.duration_minutes,
    description: row.description,
    startedAt: row.started_at,
    approvalStatus: row.approval_status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    disputeReason: row.dispute_reason,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

// ─── Proposals (commercial surface) ────────────────────────────────────────────

const PERIOD_TYPES = new Set(["weekly", "monthly"]);
const BILLING_MODELS = new Set(["fixed", "capped_hourly"]);
const ROLLOVER_POLICIES = new Set(["forfeit", "rollover"]);

function validateTerms({
  periodType,
  billingModel,
  amountXlm,
  hourlyRateXlm,
  capHours,
  rolloverPolicy,
}) {
  if (!PERIOD_TYPES.has(periodType)) throw badRequest("periodType must be 'weekly' or 'monthly'");
  if (!BILLING_MODELS.has(billingModel))
    throw badRequest("billingModel must be 'fixed' or 'capped_hourly'");
  if (!(toNum(amountXlm) > 0)) throw badRequest("amountXlm must be a positive number");
  if (rolloverPolicy != null && !ROLLOVER_POLICIES.has(rolloverPolicy))
    throw badRequest("rolloverPolicy must be 'forfeit' or 'rollover'");
  if (billingModel === "capped_hourly") {
    if (!(toNum(hourlyRateXlm) > 0))
      throw badRequest("hourlyRateXlm must be positive for a capped_hourly retainer");
    if (!(toNum(capHours) > 0))
      throw badRequest("capHours must be positive for a capped_hourly retainer");
  }
}

async function createProposal({
  proposerAddress,
  counterpartyAddress,
  proposerRole,
  title,
  description,
  periodType,
  billingModel,
  amountXlm,
  hourlyRateXlm,
  capHours,
  autoRenew = true,
  noticePeriodDays = 14,
  rolloverPolicy = "forfeit",
  proposedStartDate,
}) {
  validatePublicKey(proposerAddress, "proposerAddress");
  validatePublicKey(counterpartyAddress, "counterpartyAddress");
  if (proposerAddress === counterpartyAddress)
    throw badRequest("Cannot propose a retainer to yourself");
  if (!["client", "freelancer"].includes(proposerRole))
    throw badRequest("proposerRole must be 'client' or 'freelancer'");
  if (!title || !String(title).trim()) throw badRequest("title is required");
  validateTerms({ periodType, billingModel, amountXlm, hourlyRateXlm, capHours, rolloverPolicy });

  const notice = parseInt(noticePeriodDays, 10);
  if (!Number.isInteger(notice) || notice < 0)
    throw badRequest("noticePeriodDays must be a non-negative integer");

  const { rows } = await pool.query(
    `INSERT INTO retainer_proposals
       (proposer_address, counterparty_address, proposer_role, title, description,
        period_type, billing_model, amount_xlm, hourly_rate_xlm, cap_hours,
        auto_renew, notice_period_days, rollover_policy, proposed_start_date,
        status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',NOW(),NOW())
     RETURNING *`,
    [
      proposerAddress,
      counterpartyAddress,
      proposerRole,
      String(title).trim().slice(0, 200),
      description ? String(description).trim().slice(0, 2000) : null,
      periodType,
      billingModel,
      money(amountXlm),
      billingModel === "capped_hourly" ? money(hourlyRateXlm) : null,
      billingModel === "capped_hourly" ? toNum(capHours) : null,
      Boolean(autoRenew),
      notice,
      rolloverPolicy,
      proposedStartDate || null,
    ]
  );

  const proposal = rowToProposal(rows[0]);
  await notify({
    userAddress: counterpartyAddress,
    type: "retainer_proposal_received",
    title: "New retainer proposal",
    body: `${proposerAddress.slice(0, 8)}… proposed a ${periodType} retainer: "${proposal.title}"`,
    linkPath: `/retainers/proposals/${proposal.id}`,
  });

  return proposal;
}

async function getProposal(proposalId) {
  const { rows } = await pool.query("SELECT * FROM retainer_proposals WHERE id = $1", [proposalId]);
  if (!rows.length) throw notFound("Retainer proposal not found");
  return rowToProposal(rows[0]);
}

async function listProposalsForUser(address, { direction = "all", status } = {}) {
  validatePublicKey(address);
  const clauses = [];
  const params = [address];

  if (direction === "incoming") clauses.push("counterparty_address = $1");
  else if (direction === "outgoing") clauses.push("proposer_address = $1");
  else clauses.push("(counterparty_address = $1 OR proposer_address = $1)");

  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT * FROM retainer_proposals WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
    params
  );
  return rows.map(rowToProposal);
}

async function withdrawProposal({ proposalId, requesterAddress }) {
  const { rows } = await pool.query("SELECT * FROM retainer_proposals WHERE id = $1", [proposalId]);
  if (!rows.length) throw notFound("Retainer proposal not found");
  const proposal = rows[0];
  if (proposal.proposer_address !== requesterAddress)
    throw forbidden("Only the proposer can withdraw this proposal");
  if (proposal.status !== "pending") throw badRequest(`Proposal is already ${proposal.status}`);

  const { rows: updated } = await pool.query(
    `UPDATE retainer_proposals SET status = 'withdrawn', updated_at = NOW(), decided_at = NOW()
     WHERE id = $1 RETURNING *`,
    [proposalId]
  );
  return rowToProposal(updated[0]);
}

/**
 * Counterparty accepts or declines a proposal. Acceptance atomically
 * creates the retainer and its first (open) period.
 */
async function respondToProposal({ proposalId, responderAddress, decision, declineReason }) {
  if (!["accepted", "declined"].includes(decision))
    throw badRequest("decision must be 'accepted' or 'declined'");

  const { rows: existing } = await pool.query("SELECT * FROM retainer_proposals WHERE id = $1", [
    proposalId,
  ]);
  if (!existing.length) throw notFound("Retainer proposal not found");
  const proposal = existing[0];

  if (proposal.counterparty_address !== responderAddress)
    throw forbidden("Only the proposal's counterparty can respond to it");
  if (proposal.status !== "pending") throw badRequest(`Proposal is already ${proposal.status}`);

  if (decision === "declined") {
    const { rows: updated } = await pool.query(
      `UPDATE retainer_proposals
       SET status = 'declined', decline_reason = $2, updated_at = NOW(), decided_at = NOW()
       WHERE id = $1 RETURNING *`,
      [proposalId, declineReason ? String(declineReason).trim().slice(0, 500) : null]
    );
    const updatedProposal = rowToProposal(updated[0]);
    await notify({
      userAddress: proposal.proposer_address,
      type: "retainer_proposal_declined",
      title: "Retainer proposal declined",
      body: `Your retainer proposal "${proposal.title}" was declined.`,
      linkPath: `/retainers/proposals/${proposalId}`,
    });
    return { proposal: updatedProposal, retainer: null };
  }

  const clientAddress =
    proposal.proposer_role === "client" ? proposal.proposer_address : proposal.counterparty_address;
  const freelancerAddress =
    proposal.proposer_role === "client" ? proposal.counterparty_address : proposal.proposer_address;

  const periodStart = proposal.proposed_start_date
    ? new Date(proposal.proposed_start_date)
    : new Date();
  const periodEnd = addPeriod(periodStart, proposal.period_type);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: retainerRows } = await client.query(
      `INSERT INTO retainers
         (proposal_id, client_address, freelancer_address, title, description, period_type,
          billing_model, amount_xlm, hourly_rate_xlm, cap_hours, auto_renew, notice_period_days,
          rollover_policy, status, balance_xlm, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',0,NOW(),NOW())
       RETURNING *`,
      [
        proposalId,
        clientAddress,
        freelancerAddress,
        proposal.title,
        proposal.description,
        proposal.period_type,
        proposal.billing_model,
        proposal.amount_xlm,
        proposal.hourly_rate_xlm,
        proposal.cap_hours,
        proposal.auto_renew,
        proposal.notice_period_days,
        proposal.rollover_policy,
      ]
    );
    const retainer = retainerRows[0];

    await client.query(
      `UPDATE retainer_proposals
       SET status = 'accepted', retainer_id = $2, updated_at = NOW(), decided_at = NOW()
       WHERE id = $1`,
      [proposalId, retainer.id]
    );

    const { rows: periodRows } = await client.query(
      `INSERT INTO retainer_periods
         (retainer_id, period_index, period_start, period_end, status,
          billing_model, amount_xlm, hourly_rate_xlm, cap_hours, rollover_hours_in)
       VALUES ($1,0,$2,$3,'open',$4,$5,$6,$7,0)
       RETURNING *`,
      [
        retainer.id,
        periodStart,
        periodEnd,
        retainer.billing_model,
        retainer.amount_xlm,
        retainer.hourly_rate_xlm,
        retainer.cap_hours,
      ]
    );

    await client.query("COMMIT");

    const retainerObj = rowToRetainer(retainer);
    const period = rowToPeriod(periodRows[0]);

    await notify({
      userAddress: proposal.proposer_address,
      type: "retainer_proposal_accepted",
      title: "Retainer proposal accepted",
      body: `"${proposal.title}" is now active. First period ends ${period.periodEnd.toISOString?.() || period.periodEnd}.`,
      linkPath: `/retainers/${retainerObj.id}`,
    });

    return { proposal: await getProposal(proposalId), retainer: retainerObj, firstPeriod: period };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Retainers ──────────────────────────────────────────────────────────────

async function getRetainer(retainerId) {
  const { rows } = await pool.query("SELECT * FROM retainers WHERE id = $1", [retainerId]);
  if (!rows.length) throw notFound("Retainer not found");
  return rowToRetainer(rows[0]);
}

async function getRetainerRow(retainerId, queryRunner = pool) {
  const { rows } = await queryRunner.query("SELECT * FROM retainers WHERE id = $1", [retainerId]);
  if (!rows.length) throw notFound("Retainer not found");
  return rows[0];
}

async function listRetainersForUser(address, { status } = {}) {
  validatePublicKey(address);
  const params = [address];
  let clause = "(client_address = $1 OR freelancer_address = $1)";
  if (status) {
    params.push(status);
    clause += ` AND status = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM retainers WHERE ${clause} ORDER BY created_at DESC`,
    params
  );
  return rows.map(rowToRetainer);
}

async function getCurrentOpenPeriod(retainerId, queryRunner = pool) {
  const { rows } = await queryRunner.query(
    `SELECT * FROM retainer_periods
     WHERE retainer_id = $1 AND status = 'open'
     ORDER BY period_index DESC LIMIT 1`,
    [retainerId]
  );
  return rows[0] || null;
}

async function listPeriodsForRetainer(retainerId) {
  const { rows } = await pool.query(
    `SELECT * FROM retainer_periods WHERE retainer_id = $1 ORDER BY period_index ASC`,
    [retainerId]
  );
  return rows.map(rowToPeriod);
}

/**
 * Client tops up the retainer's funded balance. This is the off-chain
 * ledger described in ADR-012 — `contractTxHash`, when supplied, records
 * the on-chain payment the same way `time_invoices.contract_tx_hash` does
 * today; this call does not itself submit a Soroban transaction.
 */
async function fundRetainer({ retainerId, clientAddress, amountXlm, contractTxHash }) {
  validatePublicKey(clientAddress);
  if (!(toNum(amountXlm) > 0)) throw badRequest("amountXlm must be a positive number");

  const retainer = await getRetainerRow(retainerId);
  if (retainer.client_address !== clientAddress)
    throw forbidden("Only the retainer's client can fund it");
  if (retainer.status === "cancelled") throw badRequest("Cannot fund a cancelled retainer");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO retainer_funding_events (retainer_id, funded_by, amount_xlm, contract_tx_hash, created_at)
       VALUES ($1,$2,$3,$4,NOW())`,
      [retainerId, clientAddress, money(amountXlm), contractTxHash || null]
    );
    const { rows } = await client.query(
      `UPDATE retainers SET balance_xlm = balance_xlm + $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [retainerId, money(amountXlm)]
    );
    await client.query("COMMIT");

    const updated = rowToRetainer(rows[0]);
    await notify({
      userAddress: retainer.freelancer_address,
      type: "retainer_funded",
      title: "Retainer topped up",
      body: `${amountXlm} XLM was added to "${retainer.title}". New balance: ${updated.balanceXlm} XLM.`,
      linkPath: `/retainers/${retainerId}`,
    });

    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Amendments (renewal, price change, terms, pause/resume — with consent) ──

const AMENDMENT_TYPES = new Set([
  "price_change",
  "terms_change",
  "pause",
  "resume",
  "renewal_terms",
]);

function validateAmendmentPayload(type, payload = {}, retainer) {
  if (type === "price_change") {
    const { amountXlm, hourlyRateXlm, capHours } = payload;
    if (amountXlm == null && hourlyRateXlm == null && capHours == null)
      throw badRequest(
        "price_change payload must include amountXlm, hourlyRateXlm and/or capHours"
      );
    if (amountXlm != null && !(toNum(amountXlm) > 0))
      throw badRequest("amountXlm must be positive");
    if (hourlyRateXlm != null && !(toNum(hourlyRateXlm) > 0))
      throw badRequest("hourlyRateXlm must be positive");
    if (capHours != null && !(toNum(capHours) > 0)) throw badRequest("capHours must be positive");
  } else if (type === "terms_change" || type === "renewal_terms") {
    const { autoRenew, noticePeriodDays, rolloverPolicy } = payload;
    if (noticePeriodDays != null) {
      const n = parseInt(noticePeriodDays, 10);
      if (!Number.isInteger(n) || n < 0)
        throw badRequest("noticePeriodDays must be a non-negative integer");
    }
    if (rolloverPolicy != null && !ROLLOVER_POLICIES.has(rolloverPolicy))
      throw badRequest("rolloverPolicy must be 'forfeit' or 'rollover'");
    if (autoRenew != null && typeof autoRenew !== "boolean")
      throw badRequest("autoRenew must be a boolean");
  } else if (type === "pause") {
    if (retainer.status !== "active") throw badRequest("Only an active retainer can be paused");
  } else if (type === "resume") {
    if (retainer.status !== "paused") throw badRequest("Only a paused retainer can be resumed");
  }
}

async function proposeAmendment({ retainerId, proposedBy, type, payload = {} }) {
  validatePublicKey(proposedBy);
  if (!AMENDMENT_TYPES.has(type))
    throw badRequest(`type must be one of: ${[...AMENDMENT_TYPES].join(", ")}`);

  const retainer = await getRetainerRow(retainerId);
  assertParticipant(retainer, proposedBy);
  if (retainer.status === "cancelled") throw badRequest("Cannot amend a cancelled retainer");
  if (retainer.pending_amendment_id)
    throw badRequest("An amendment is already pending for this retainer");
  validateAmendmentPayload(type, payload, retainer);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO retainer_amendments (retainer_id, type, proposed_by, payload, status, created_at)
       VALUES ($1,$2,$3,$4::jsonb,'pending',NOW())
       RETURNING *`,
      [retainerId, type, proposedBy, JSON.stringify(payload || {})]
    );
    const amendment = rows[0];

    const { rowCount } = await client.query(
      `UPDATE retainers SET pending_amendment_id = $2, updated_at = NOW()
       WHERE id = $1 AND pending_amendment_id IS NULL`,
      [retainerId, amendment.id]
    );
    if (rowCount === 0) throw badRequest("An amendment is already pending for this retainer");

    await client.query("COMMIT");

    await notify({
      userAddress: counterpartyOf(retainer, proposedBy),
      type: "retainer_amendment_proposed",
      title: `Retainer ${type.replace("_", " ")} proposed`,
      body: `A ${type.replace("_", " ")} was proposed for "${retainer.title}" and needs your response.`,
      linkPath: `/retainers/${retainerId}/amendments/${amendment.id}`,
    });

    return rowToAmendment(amendment);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function applyAmendmentEffect(client, retainer, amendment) {
  const { type, payload } = amendment;
  if (type === "price_change") {
    await client.query(
      `UPDATE retainers
       SET amount_xlm = COALESCE($2, amount_xlm),
           hourly_rate_xlm = COALESCE($3, hourly_rate_xlm),
           cap_hours = COALESCE($4, cap_hours),
           updated_at = NOW()
       WHERE id = $1`,
      [
        retainer.id,
        payload.amountXlm != null ? money(payload.amountXlm) : null,
        payload.hourlyRateXlm != null ? money(payload.hourlyRateXlm) : null,
        payload.capHours != null ? toNum(payload.capHours) : null,
      ]
    );
  } else if (type === "terms_change" || type === "renewal_terms") {
    await client.query(
      `UPDATE retainers
       SET auto_renew = COALESCE($2, auto_renew),
           notice_period_days = COALESCE($3, notice_period_days),
           rollover_policy = COALESCE($4, rollover_policy),
           updated_at = NOW()
       WHERE id = $1`,
      [
        retainer.id,
        payload.autoRenew != null ? payload.autoRenew : null,
        payload.noticePeriodDays != null ? parseInt(payload.noticePeriodDays, 10) : null,
        payload.rolloverPolicy != null ? payload.rolloverPolicy : null,
      ]
    );
  } else if (type === "pause") {
    await client.query(
      `UPDATE retainers SET status = 'paused', paused_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [retainer.id]
    );
  } else if (type === "resume") {
    await client.query(
      `UPDATE retainers SET status = 'active', paused_at = NULL, updated_at = NOW() WHERE id = $1`,
      [retainer.id]
    );
  }
}

async function respondToAmendment({ amendmentId, responderAddress, decision }) {
  if (!["accepted", "rejected"].includes(decision))
    throw badRequest("decision must be 'accepted' or 'rejected'");

  const { rows: amendmentRows } = await pool.query(
    "SELECT * FROM retainer_amendments WHERE id = $1",
    [amendmentId]
  );
  if (!amendmentRows.length) throw notFound("Amendment not found");
  const amendment = amendmentRows[0];
  if (amendment.status !== "pending") throw badRequest(`Amendment is already ${amendment.status}`);

  const retainer = await getRetainerRow(amendment.retainer_id);
  assertParticipant(retainer, responderAddress);
  if (amendment.proposed_by === responderAddress)
    throw forbidden("The proposing party cannot respond to their own amendment");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: updatedRows } = await client.query(
      `UPDATE retainer_amendments SET status = $2, decided_at = NOW() WHERE id = $1 RETURNING *`,
      [amendmentId, decision]
    );

    await client.query(
      `UPDATE retainers SET pending_amendment_id = NULL, updated_at = NOW() WHERE id = $1`,
      [retainer.id]
    );

    if (decision === "accepted") {
      await applyAmendmentEffect(client, retainer, amendment);
    }

    await client.query("COMMIT");

    await notify({
      userAddress: amendment.proposed_by,
      type: decision === "accepted" ? "retainer_amendment_accepted" : "retainer_amendment_rejected",
      title: `Amendment ${decision}`,
      body: `Your ${amendment.type.replace("_", " ")} proposal for "${retainer.title}" was ${decision}.`,
      linkPath: `/retainers/${retainer.id}`,
    });

    return { amendment: rowToAmendment(updatedRows[0]), retainer: await getRetainer(retainer.id) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Cancellation with notice and pro-rata settlement ─────────────────────────

async function requestCancellation({ retainerId, requestedBy, reason }) {
  const retainer = await getRetainerRow(retainerId);
  assertParticipant(retainer, requestedBy);
  if (!["active", "paused"].includes(retainer.status))
    throw badRequest(`Cannot request cancellation while retainer is ${retainer.status}`);

  const effectiveAt = new Date();
  effectiveAt.setUTCDate(effectiveAt.getUTCDate() + retainer.notice_period_days);

  const { rows } = await pool.query(
    `UPDATE retainers
     SET status = 'pending_cancellation',
         cancel_requested_by = $2,
         cancel_reason = $3,
         cancel_effective_at = $4,
         updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [retainerId, requestedBy, reason ? String(reason).trim().slice(0, 1000) : null, effectiveAt]
  );

  const updated = rowToRetainer(rows[0]);
  await notify({
    userAddress: counterpartyOf(retainer, requestedBy),
    type: "retainer_cancellation_requested",
    title: "Retainer cancellation requested",
    body: `"${retainer.title}" will end on ${effectiveAt.toISOString().slice(0, 10)} (${retainer.notice_period_days}-day notice).`,
    linkPath: `/retainers/${retainerId}`,
  });

  return { retainer: updated, settlementPreview: await previewCancellationSettlement(retainerId) };
}

/** Pro-rata settlement math shared by preview and finalize. */
function computeProration(period, asOf) {
  const start = new Date(period.period_start).getTime();
  const end = new Date(period.period_end).getTime();
  const at = new Date(asOf).getTime();
  const fraction = Math.max(0, Math.min(1, (at - start) / (end - start || 1)));

  if (period.billing_model === "fixed") {
    return { fraction, amountDue: round2(toNum(period.amount_xlm) * fraction) };
  }
  // Capped-hourly: settle on hours actually approved, not elapsed time —
  // see ADR-012 "Cancellation and pro-rata settlement".
  const effectiveCap = toNum(period.cap_hours) + toNum(period.rollover_hours_in);
  const billableHours = Math.min(toNum(period.approved_hours), effectiveCap);
  return { fraction, amountDue: round2(billableHours) * toNum(period.hourly_rate_xlm) };
}

async function previewCancellationSettlement(retainerId, asOf = new Date()) {
  const retainer = await getRetainerRow(retainerId);
  const period = await getCurrentOpenPeriod(retainerId);
  if (!period) return { periodId: null, message: "No open period to settle" };

  const effectiveDate = retainer.cancel_effective_at || asOf;
  const { fraction, amountDue } = computeProration(period, effectiveDate);
  const released = Math.min(toNum(retainer.balance_xlm), amountDue);

  return {
    periodId: period.id,
    asOf: effectiveDate,
    fraction: round2(fraction),
    approvedHours: period.approved_hours,
    amountDueXlm: money(amountDue),
    projectedReleaseXlm: money(released),
    projectedShortfallXlm: money(Math.max(0, amountDue - released)),
    balanceXlm: retainer.balance_xlm,
  };
}

async function finalizeCancellation(retainerId, { asOf = new Date() } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: retainerRows } = await client.query(
      "SELECT * FROM retainers WHERE id = $1 FOR UPDATE",
      [retainerId]
    );
    if (!retainerRows.length) throw notFound("Retainer not found");
    const retainer = retainerRows[0];
    if (retainer.status !== "pending_cancellation") {
      await client.query("ROLLBACK");
      return null; // already finalized or not in a cancellable state — safe no-op for the scheduler
    }

    const effectiveDate = retainer.cancel_effective_at || asOf;
    const period = await getCurrentOpenPeriod(retainerId, client);

    let statement = null;
    if (period) {
      const { fraction, amountDue } = computeProration(period, effectiveDate);
      const released = Math.min(toNum(retainer.balance_xlm), amountDue);
      const shortfall = Math.max(0, amountDue - released);

      await client.query(
        `UPDATE retainer_periods
         SET status = 'settled_prorata', period_end = $2, amount_due_xlm = $3,
             amount_released_xlm = $4, shortfall_xlm = $5, released_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [period.id, effectiveDate, money(amountDue), money(released), money(shortfall)]
      );

      await client.query(`UPDATE retainers SET balance_xlm = balance_xlm - $2 WHERE id = $1`, [
        retainerId,
        money(released),
      ]);

      const invoiceNumber = `RET-${period.id.slice(0, 8).toUpperCase()}-FINAL`;
      const { rows: stmtRows } = await client.query(
        `INSERT INTO retainer_statements
           (retainer_id, period_id, invoice_number, freelancer_address, client_address,
            logged_hours, approved_hours, disputed_hours, forfeited_hours, rollover_hours,
            amount_due_xlm, amount_released_xlm, shortfall_xlm, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,$10,$11,'settled_prorata',NOW())
         RETURNING *`,
        [
          retainerId,
          period.id,
          invoiceNumber,
          retainer.freelancer_address,
          retainer.client_address,
          period.logged_hours,
          period.approved_hours,
          period.disputed_hours,
          money(amountDue),
          money(released),
          money(shortfall),
        ]
      );
      statement = stmtRows[0];
      logger.info(
        { retainerId, periodId: period.id, fraction, amountDue, released, shortfall },
        "Retainer period settled pro-rata on cancellation"
      );
    }

    const { rows: updatedRetainer } = await client.query(
      `UPDATE retainers SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [retainerId]
    );

    await client.query("COMMIT");

    const finalRetainer = rowToRetainer(updatedRetainer[0]);
    for (const addr of [finalRetainer.clientAddress, finalRetainer.freelancerAddress]) {
      await notify({
        userAddress: addr,
        type: "retainer_cancelled",
        title: "Retainer cancelled",
        body: statement
          ? `"${finalRetainer.title}" is now cancelled. Final period settled: ${statement.amount_released_xlm} XLM released${toNum(statement.shortfall_xlm) > 0 ? ` (shortfall ${statement.shortfall_xlm} XLM)` : ""}.`
          : `"${finalRetainer.title}" is now cancelled.`,
        linkPath: `/retainers/${retainerId}`,
      });
    }

    return { retainer: finalRetainer, statement: statement ? rowToStatement(statement) : null };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Time tracking integration ─────────────────────────────────────────────────

async function logRetainerTime({
  retainerId,
  freelancerAddress,
  durationMinutes,
  description,
  startedAt,
}) {
  validatePublicKey(freelancerAddress);
  const minutes = parseInt(durationMinutes, 10);
  if (!minutes || minutes <= 0 || minutes > 1440)
    throw badRequest("durationMinutes must be a positive integer no greater than 1440 (24h)");

  const retainer = await getRetainerRow(retainerId);
  if (retainer.freelancer_address !== freelancerAddress)
    throw forbidden("Only the retainer's freelancer can log time against it");
  if (!["active", "pending_cancellation"].includes(retainer.status))
    throw badRequest(`Cannot log time while retainer is ${retainer.status}`);

  const period = await getCurrentOpenPeriod(retainerId);
  if (!period) throw badRequest("No open billing period for this retainer");

  const { rows } = await pool.query(
    `INSERT INTO time_entries
       (retainer_id, retainer_period_id, freelancer_address, duration_minutes, description,
        started_at, approval_status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())
     RETURNING *`,
    [
      retainerId,
      period.id,
      freelancerAddress,
      minutes,
      description ? String(description).trim().slice(0, 500) : null,
      startedAt || null,
    ]
  );

  await pool.query(
    `UPDATE retainer_periods SET logged_hours = logged_hours + $2, updated_at = NOW() WHERE id = $1`,
    [period.id, minutesToHours(minutes)]
  );

  const entry = rowToRetainerTimeEntry(rows[0]);
  await notify({
    userAddress: retainer.client_address,
    type: "retainer_time_logged",
    title: "New time logged",
    body: `${minutesToHours(minutes)}h logged against "${retainer.title}", pending your approval.`,
    linkPath: `/retainers/${retainerId}/time-entries/${entry.id}`,
  });

  return entry;
}

async function getTimeEntryRow(entryId, queryRunner = pool) {
  const { rows } = await queryRunner.query(
    "SELECT * FROM time_entries WHERE id = $1 AND retainer_id IS NOT NULL",
    [entryId]
  );
  if (!rows.length) throw notFound("Retainer time entry not found");
  return rows[0];
}

async function listRetainerTimeEntries(retainerId, { periodId } = {}) {
  const params = [retainerId];
  let clause = "retainer_id = $1";
  if (periodId) {
    params.push(periodId);
    clause += ` AND retainer_period_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM time_entries WHERE ${clause} ORDER BY created_at ASC`,
    params
  );
  return rows.map(rowToRetainerTimeEntry);
}

/** Client approves or rejects a pending time entry. */
async function approveRetainerTimeEntry({ entryId, clientAddress, decision }) {
  if (!["approved", "rejected"].includes(decision))
    throw badRequest("decision must be 'approved' or 'rejected'");

  const entry = await getTimeEntryRow(entryId);
  const retainer = await getRetainerRow(entry.retainer_id);
  if (retainer.client_address !== clientAddress)
    throw forbidden("Only the retainer's client can review this time entry");
  if (entry.approval_status !== "pending")
    throw badRequest(`Time entry is not pending approval (currently ${entry.approval_status})`);

  const { rows } = await pool.query(
    `UPDATE time_entries SET approval_status = $2, approved_by = $3, approved_at = NOW()
     WHERE id = $1 RETURNING *`,
    [entryId, decision, clientAddress]
  );

  if (decision === "approved") {
    await pool.query(
      `UPDATE retainer_periods SET approved_hours = approved_hours + $2, updated_at = NOW() WHERE id = $1`,
      [entry.retainer_period_id, minutesToHours(entry.duration_minutes)]
    );
  }

  const updated = rowToRetainerTimeEntry(rows[0]);
  await notify({
    userAddress: retainer.freelancer_address,
    type: "retainer_time_reviewed",
    title: `Time entry ${decision}`,
    body: `Your ${minutesToHours(entry.duration_minutes)}h entry on "${retainer.title}" was ${decision}.`,
    linkPath: `/retainers/${retainer.id}/time-entries/${entryId}`,
  });

  return updated;
}

/**
 * Either party disputes a logged time entry. This only removes the entry
 * from *this period's* approved-hours tally (if it had been approved) —
 * it never blocks the rest of the period from releasing on schedule.
 */
async function disputeRetainerTimeEntry({ entryId, disputedBy, reason }) {
  const entry = await getTimeEntryRow(entryId);
  const retainer = await getRetainerRow(entry.retainer_id);
  assertParticipant(retainer, disputedBy);
  if (!["pending", "approved"].includes(entry.approval_status))
    throw badRequest(`Cannot dispute a time entry that is ${entry.approval_status}`);

  const period = await getCurrentOpenPeriod(retainer.id);
  if (!period || period.id !== entry.retainer_period_id)
    throw badRequest("Cannot dispute a time entry whose period has already closed");

  const wasApproved = entry.approval_status === "approved";
  const hours = minutesToHours(entry.duration_minutes);

  const { rows } = await pool.query(
    `UPDATE time_entries SET approval_status = 'disputed', dispute_reason = $2 WHERE id = $1 RETURNING *`,
    [entryId, reason ? String(reason).trim().slice(0, 1000) : null]
  );

  await pool.query(
    `UPDATE retainer_periods
     SET disputed_hours = disputed_hours + $2,
         approved_hours = approved_hours - $3,
         updated_at = NOW()
     WHERE id = $1`,
    [entry.retainer_period_id, hours, wasApproved ? hours : 0]
  );

  const updated = rowToRetainerTimeEntry(rows[0]);
  await notify({
    userAddress: counterpartyOf(retainer, disputedBy),
    type: "retainer_time_disputed",
    title: "Time entry disputed",
    body: `A ${hours}h entry on "${retainer.title}" was disputed. The rest of the period will still bill on schedule.`,
    linkPath: `/retainers/${retainer.id}/time-entries/${entryId}`,
  });

  return updated;
}

/**
 * Resolve a disputed entry as approved or rejected. If its period is still
 * open, the hours flow into that period's normal approved-hours tally; if
 * the period has already released, the historical release is not reopened
 * — only the entry's own record is updated for the audit trail.
 */
async function resolveRetainerTimeEntryDispute({ entryId, resolvedBy, decision }) {
  if (!["approved", "rejected"].includes(decision))
    throw badRequest("decision must be 'approved' or 'rejected'");

  const entry = await getTimeEntryRow(entryId);
  const retainer = await getRetainerRow(entry.retainer_id);
  assertParticipant(retainer, resolvedBy);
  if (entry.approval_status !== "disputed") throw badRequest("Time entry is not under dispute");

  const { rows: periodRows } = await pool.query("SELECT * FROM retainer_periods WHERE id = $1", [
    entry.retainer_period_id,
  ]);
  const period = periodRows[0];
  const hours = minutesToHours(entry.duration_minutes);

  const { rows } = await pool.query(
    `UPDATE time_entries SET approval_status = $2, resolved_by = $3, resolved_at = NOW()
     WHERE id = $1 RETURNING *`,
    [entryId, decision, resolvedBy]
  );

  if (period) {
    await pool.query(
      `UPDATE retainer_periods
       SET disputed_hours = GREATEST(0, disputed_hours - $2),
           approved_hours = approved_hours + $3,
           updated_at = NOW()
       WHERE id = $1`,
      [period.id, hours, period.status === "open" && decision === "approved" ? hours : 0]
    );
  }

  const updated = rowToRetainerTimeEntry(rows[0]);
  await notify({
    userAddress: counterpartyOf(retainer, resolvedBy),
    type: "retainer_dispute_resolved",
    title: "Time entry dispute resolved",
    body: `The disputed ${hours}h entry on "${retainer.title}" was resolved as ${decision}.`,
    linkPath: `/retainers/${retainer.id}/time-entries/${entryId}`,
  });

  return updated;
}

// ─── Scheduled release ─────────────────────────────────────────────────────────

/**
 * Release a single period: compute the amount due from its snapshotted
 * terms and approved hours, release what the retainer's balance can
 * cover (degrading predictably on underfunding rather than failing
 * silently), roll unused capacity forward or forfeit it, and open the
 * next period unless the retainer is at a natural or notice-driven end.
 */
async function releasePeriod(periodId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: periodRows } = await client.query(
      "SELECT * FROM retainer_periods WHERE id = $1 FOR UPDATE",
      [periodId]
    );
    if (!periodRows.length) throw notFound("Retainer period not found");
    const period = periodRows[0];
    if (period.status !== "open") {
      await client.query("ROLLBACK");
      return null; // already processed — safe no-op for the scheduler
    }

    const { rows: retainerRows } = await client.query(
      "SELECT * FROM retainers WHERE id = $1 FOR UPDATE",
      [period.retainer_id]
    );
    const retainer = retainerRows[0];

    if (retainer.status === "paused") {
      await client.query(
        `UPDATE retainer_periods SET status = 'held_paused', updated_at = NOW() WHERE id = $1`,
        [periodId]
      );
      await client.query("COMMIT");
      for (const addr of [retainer.client_address, retainer.freelancer_address]) {
        await notify({
          userAddress: addr,
          type: "retainer_release_held",
          title: "Retainer release held",
          body: `"${retainer.title}" is paused, so this period's release was held rather than skipped silently.`,
          linkPath: `/retainers/${retainer.id}`,
        });
      }
      return null;
    }

    const effectiveCapHours = toNum(period.cap_hours) + toNum(period.rollover_hours_in);
    const amountDue = computeAmountDue(
      {
        billingModel: period.billing_model,
        amountXlm: period.amount_xlm,
        hourlyRateXlm: period.hourly_rate_xlm,
      },
      period.approved_hours,
      effectiveCapHours
    );
    const released = Math.min(toNum(retainer.balance_xlm), amountDue);
    const shortfall = Math.max(0, round2(amountDue - released));
    const status = shortfall > 0 ? "underfunded" : "released";

    let forfeitedHours = 0;
    let rolloverOut = 0;
    if (period.billing_model === "capped_hourly") {
      const billed = Math.min(toNum(period.approved_hours), effectiveCapHours);
      const leftover = Math.max(0, round2(effectiveCapHours - billed));
      if (retainer.rollover_policy === "rollover") rolloverOut = leftover;
      else forfeitedHours = leftover;
    }

    await client.query(
      `UPDATE retainer_periods
       SET status = $2, amount_due_xlm = $3, amount_released_xlm = $4, shortfall_xlm = $5,
           rollover_hours_out = $6, forfeited_hours = $7, released_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [
        periodId,
        status,
        money(amountDue),
        money(released),
        money(shortfall),
        rolloverOut,
        forfeitedHours,
      ]
    );

    await client.query(
      `UPDATE retainers SET balance_xlm = balance_xlm - $2, updated_at = NOW() WHERE id = $1`,
      [retainer.id, money(released)]
    );

    const invoiceNumber = `RET-${period.id.slice(0, 8).toUpperCase()}-P${period.period_index}`;
    const { rows: stmtRows } = await client.query(
      `INSERT INTO retainer_statements
         (retainer_id, period_id, invoice_number, freelancer_address, client_address,
          logged_hours, approved_hours, disputed_hours, forfeited_hours, rollover_hours,
          amount_due_xlm, amount_released_xlm, shortfall_xlm, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       RETURNING *`,
      [
        period.retainer_id,
        period.id,
        invoiceNumber,
        retainer.freelancer_address,
        retainer.client_address,
        period.logged_hours,
        period.approved_hours,
        period.disputed_hours,
        forfeitedHours,
        rolloverOut,
        money(amountDue),
        money(released),
        money(shortfall),
        status === "underfunded" ? "underfunded" : "issued",
      ]
    );

    // Natural non-renewal: the client and freelancer already agreed to
    // this by turning auto-renew off (directly, or via a terms_change
    // amendment) — no further notice period is owed.
    let naturalEnd = false;
    if (retainer.status === "active" && retainer.auto_renew === false) {
      naturalEnd = true;
      await client.query(
        `UPDATE retainers SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [retainer.id]
      );
    } else {
      const nextStart = period.period_end;
      const nextEnd = addPeriod(nextStart, retainer.period_type);
      await client.query(
        `INSERT INTO retainer_periods
           (retainer_id, period_index, period_start, period_end, status,
            billing_model, amount_xlm, hourly_rate_xlm, cap_hours, rollover_hours_in)
         VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,$9)`,
        [
          retainer.id,
          period.period_index + 1,
          nextStart,
          nextEnd,
          retainer.billing_model,
          retainer.amount_xlm,
          retainer.hourly_rate_xlm,
          retainer.cap_hours,
          rolloverOut,
        ]
      );
    }

    await client.query("COMMIT");

    const statement = rowToStatement(stmtRows[0]);
    for (const addr of [retainer.client_address, retainer.freelancer_address]) {
      await notify({
        userAddress: addr,
        type: status === "underfunded" ? "retainer_period_underfunded" : "retainer_period_released",
        title:
          status === "underfunded" ? "Retainer release underfunded" : "Retainer period released",
        body:
          status === "underfunded"
            ? `"${retainer.title}" released ${statement.amountReleasedXlm} of ${statement.amountDueXlm} XLM due — shortfall ${statement.shortfallXlm} XLM. Top up to avoid this next period.`
            : `"${retainer.title}" released ${statement.amountReleasedXlm} XLM for this period.` +
              (naturalEnd ? " This was the final period (auto-renew is off)." : ""),
        linkPath: `/retainers/${retainer.id}/statements/${statement.id}`,
      });
    }

    return statement;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Warn/forecast ahead of a period's natural end, using currently-approved
 * hours as the best available estimate. Idempotent via the guard
 * timestamps on retainer_periods so re-running never double-notifies.
 */
async function notifyUpcomingPeriods(now = new Date()) {
  const lookahead = new Date(now);
  lookahead.setUTCDate(lookahead.getUTCDate() + UNDERFUNDING_LOOKAHEAD_DAYS);

  const { rows } = await pool.query(
    `SELECT p.*, r.client_address, r.freelancer_address, r.title, r.balance_xlm, r.status AS retainer_status
     FROM retainer_periods p
     JOIN retainers r ON r.id = p.retainer_id
     WHERE p.status = 'open' AND p.period_end > $1 AND p.period_end <= $2
       AND (p.upcoming_notice_sent_at IS NULL OR p.underfunding_warned_at IS NULL)`,
    [now, lookahead]
  );

  let notified = 0;
  let warned = 0;

  for (const row of rows) {
    const effectiveCapHours = toNum(row.cap_hours) + toNum(row.rollover_hours_in);
    const amountDue = computeAmountDue(
      {
        billingModel: row.billing_model,
        amountXlm: row.amount_xlm,
        hourlyRateXlm: row.hourly_rate_xlm,
      },
      row.approved_hours,
      effectiveCapHours
    );
    const willCover = toNum(row.balance_xlm) >= amountDue;

    if (!row.upcoming_notice_sent_at) {
      for (const addr of [row.client_address, row.freelancer_address]) {
        await notify({
          userAddress: addr,
          type: "retainer_upcoming_charge",
          title: "Upcoming retainer charge",
          body: `"${row.title}" is projected to release ${money(amountDue)} XLM on ${new Date(row.period_end).toISOString().slice(0, 10)}.`,
          linkPath: `/retainers/${row.retainer_id}`,
        });
      }
      await pool.query(
        `UPDATE retainer_periods SET upcoming_notice_sent_at = NOW() WHERE id = $1`,
        [row.id]
      );
      notified++;
    }

    if (!row.underfunding_warned_at && !willCover) {
      for (const addr of [row.client_address, row.freelancer_address]) {
        await notify({
          userAddress: addr,
          type: "retainer_underfunding_warning",
          title: "Retainer may be underfunded",
          body: `"${row.title}" needs ${money(amountDue)} XLM but only has ${row.balance_xlm} XLM funded — top up before ${new Date(row.period_end).toISOString().slice(0, 10)} to avoid a degraded release.`,
          linkPath: `/retainers/${row.retainer_id}`,
        });
      }
      await pool.query(`UPDATE retainer_periods SET underfunding_warned_at = NOW() WHERE id = $1`, [
        row.id,
      ]);
      warned++;
    }
  }

  return { notified, warned };
}

/**
 * The scheduler's single entry point. Order matters: cancellations whose
 * notice has elapsed are finalized before due periods are released, so a
 * retainer's final period is always settled pro-rata by
 * `finalizeCancellation` rather than released in full by `releasePeriod`.
 */
async function runBillingCycle({ now = new Date() } = {}) {
  const results = {
    cancellationsFinalized: 0,
    periodsReleased: 0,
    periodsUnderfunded: 0,
    periodsHeldPaused: 0,
    upcomingNoticesSent: 0,
    underfundingWarningsSent: 0,
  };

  const { rows: dueCancellations } = await pool.query(
    `SELECT id FROM retainers WHERE status = 'pending_cancellation' AND cancel_effective_at <= $1`,
    [now]
  );
  for (const row of dueCancellations) {
    const outcome = await finalizeCancellation(row.id, { asOf: now });
    if (outcome) results.cancellationsFinalized++;
  }

  const { rows: duePeriods } = await pool.query(
    `SELECT id FROM retainer_periods WHERE status = 'open' AND period_end <= $1`,
    [now]
  );
  for (const row of duePeriods) {
    const statement = await releasePeriod(row.id);
    if (!statement) results.periodsHeldPaused++;
    else if (statement.status === "underfunded") results.periodsUnderfunded++;
    else results.periodsReleased++;
  }

  const { notified, warned } = await notifyUpcomingPeriods(now);
  results.upcomingNoticesSent = notified;
  results.underfundingWarningsSent = warned;

  logger.info(results, "Retainer billing cycle complete");
  return results;
}

// ─── Forecast ───────────────────────────────────────────────────────────────

async function getForecast(retainerId, requesterAddress) {
  const retainer = await getRetainerRow(retainerId);
  if (requesterAddress) assertParticipant(retainer, requesterAddress);

  const period = await getCurrentOpenPeriod(retainerId);
  if (!period) {
    return { retainerId, status: retainer.status, nextPeriod: null };
  }

  const effectiveCapHours = toNum(period.cap_hours) + toNum(period.rollover_hours_in);
  const amountDue = computeAmountDue(
    {
      billingModel: period.billing_model,
      amountXlm: period.amount_xlm,
      hourlyRateXlm: period.hourly_rate_xlm,
    },
    period.approved_hours,
    effectiveCapHours
  );
  const balance = toNum(retainer.balance_xlm);

  return {
    retainerId,
    status: retainer.status,
    nextPeriod: {
      periodId: period.id,
      periodStart: period.period_start,
      periodEnd: period.period_end,
      billingModel: period.billing_model,
      loggedHours: period.logged_hours,
      approvedHours: period.approved_hours,
      disputedHours: period.disputed_hours,
      effectiveCapHours: period.billing_model === "capped_hourly" ? effectiveCapHours : null,
      amountDueXlm: money(amountDue),
      balanceXlm: money(balance),
      willCoverInFull: balance >= amountDue,
      projectedShortfallXlm: money(Math.max(0, amountDue - balance)),
    },
  };
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function monthlyEquivalent(retainer) {
  const base =
    retainer.billing_model === "fixed"
      ? toNum(retainer.amount_xlm)
      : toNum(retainer.hourly_rate_xlm) * toNum(retainer.cap_hours);
  // Weekly periods normalized to an average-month equivalent (52/12 weeks).
  return retainer.period_type === "weekly" ? round2(base * (52 / 12)) : round2(base);
}

async function getFreelancerRecurringRevenue(freelancerAddress, { months = 6 } = {}) {
  validatePublicKey(freelancerAddress);
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - Math.max(1, parseInt(months, 10) || 6));

  const { rows: monthly } = await pool.query(
    `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
            SUM(amount_released_xlm) AS released_xlm,
            COUNT(*) AS statement_count
     FROM retainer_statements
     WHERE freelancer_address = $1 AND created_at >= $2
     GROUP BY 1 ORDER BY 1 ASC`,
    [freelancerAddress, since]
  );

  const { rows: active } = await pool.query(
    `SELECT * FROM retainers WHERE freelancer_address = $1 AND status IN ('active', 'pending_cancellation')`,
    [freelancerAddress]
  );
  const currentMonthlyRunRateXlm = round2(active.reduce((sum, r) => sum + monthlyEquivalent(r), 0));

  return {
    freelancerAddress,
    monthlyBreakdown: monthly.map((r) => ({
      month: r.month,
      releasedXlm: r.released_xlm,
      statementCount: Number(r.statement_count),
    })),
    currentMonthlyRunRateXlm,
    activeRetainerCount: active.length,
  };
}

async function getClientCommittedSpend(clientAddress) {
  validatePublicKey(clientAddress);
  const { rows } = await pool.query(
    `SELECT * FROM retainers WHERE client_address = $1 AND status IN ('active', 'pending_cancellation')`,
    [clientAddress]
  );

  const retainers = rows.map((r) => ({
    id: r.id,
    title: r.title,
    billingModel: r.billing_model,
    status: r.status,
    monthlyEquivalentXlm: monthlyEquivalent(r),
  }));
  const committedMonthlySpendXlm = round2(
    retainers.reduce((sum, r) => sum + r.monthlyEquivalentXlm, 0)
  );

  return { clientAddress, committedMonthlySpendXlm, retainers };
}

module.exports = {
  // proposals
  createProposal,
  getProposal,
  listProposalsForUser,
  withdrawProposal,
  respondToProposal,
  // retainers
  getRetainer,
  listRetainersForUser,
  listPeriodsForRetainer,
  fundRetainer,
  // amendments
  proposeAmendment,
  respondToAmendment,
  // cancellation
  requestCancellation,
  previewCancellationSettlement,
  finalizeCancellation,
  // time tracking
  logRetainerTime,
  listRetainerTimeEntries,
  approveRetainerTimeEntry,
  disputeRetainerTimeEntry,
  resolveRetainerTimeEntryDispute,
  // billing
  releasePeriod,
  notifyUpcomingPeriods,
  runBillingCycle,
  // forecast & reporting
  getForecast,
  getFreelancerRecurringRevenue,
  getClientCommittedSpend,
  // exported for tests / internal reuse
  computeAmountDue,
  computeProration,
  addPeriod,
};
