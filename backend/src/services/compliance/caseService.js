"use strict";

const { randomUUID } = require("crypto");
const pool = require("../../db/pool");
const { transitionCase } = require("./stateMachines");
const { appendAuditEvent } = require("./auditService");
const { assertCompliance, complianceError } = require("./errors");

const PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const CASE_TYPES = new Set(["screening", "monitoring", "travel_rule", "identity", "geo", "manual"]);
const DECISIONS = new Set(["cleared", "monitor", "restrict", "reject", "file_report"]);

async function createAlertCase(input, dbPool = pool) {
  assertCompliance(
    PRIORITIES.has(input.priority),
    400,
    "INVALID_PRIORITY",
    "Invalid case priority"
  );
  assertCompliance(CASE_TYPES.has(input.caseType), 400, "INVALID_CASE_TYPE", "Invalid case type");
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT a.*, c.status AS case_status
         FROM compliance_alerts a
         LEFT JOIN compliance_cases c ON c.id = a.case_id
        WHERE a.dedupe_key = $1`,
      [input.dedupeKey]
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0];
    }

    const caseResult = await client.query(
      `INSERT INTO compliance_cases (subject_id, priority, case_type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.subjectId, input.priority, input.caseType]
    );
    const complianceCase = caseResult.rows[0];
    const alertResult = await client.query(
      `INSERT INTO compliance_alerts (
         dedupe_key, subject_id, transaction_id, screening_id, case_id,
         rule_code, rule_version, severity, score, evidence
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING *`,
      [
        input.dedupeKey,
        input.subjectId,
        input.transactionId || null,
        input.screeningId || null,
        complianceCase.id,
        input.ruleCode,
        input.ruleVersion,
        input.severity,
        input.score,
        JSON.stringify(input.evidence || {}),
      ]
    );
    await client.query(
      `INSERT INTO compliance_case_events (
         case_id, actor_address, event_type, from_status, to_status,
         reason_code, evidence
       ) VALUES ($1, 'system', 'opened', NULL, 'open', $2, $3::jsonb)`,
      [complianceCase.id, input.ruleCode, JSON.stringify({ alertId: alertResult.rows[0].id })]
    );
    await appendAuditEvent(
      {
        subjectId: input.subjectId,
        actorType: "system",
        actorId: "compliance-engine",
        action: "case.opened",
        objectType: "case",
        objectId: complianceCase.id,
        correlationId: input.correlationId || randomUUID(),
        policyJurisdiction: input.policyJurisdiction,
        policyVersion: input.ruleVersion,
        reasonCode: input.ruleCode,
        decision: "human_review_required",
        evidence: input.evidence,
        metadata: { alertId: alertResult.rows[0].id, priority: input.priority },
      },
      client
    );
    await client.query("COMMIT");
    return { ...alertResult.rows[0], case: complianceCase };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listCases(filters = {}, db = pool) {
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 50));
  const { rows } = await db.query(
    `SELECT c.*,
            COUNT(a.id)::int AS alert_count,
            COALESCE(MAX(a.score), 0) AS maximum_alert_score
       FROM compliance_cases c
       LEFT JOIN compliance_alerts a ON a.case_id = c.id
      WHERE ($1::text IS NULL OR c.status = $1)
        AND ($2::text IS NULL OR c.assigned_to = $2)
        AND ($3::text IS NULL OR c.priority = $3)
      GROUP BY c.id
      ORDER BY CASE c.priority
                 WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                 WHEN 'medium' THEN 2 ELSE 3
               END, c.opened_at
      LIMIT $4`,
    [filters.status || null, filters.assignedTo || null, filters.priority || null, limit]
  );
  return rows;
}

async function getCase(caseId, db = pool) {
  const caseResult = await db.query("SELECT * FROM compliance_cases WHERE id = $1", [caseId]);
  if (!caseResult.rows[0])
    throw complianceError(404, "CASE_NOT_FOUND", "Compliance case not found");
  const alerts = await db.query(
    "SELECT * FROM compliance_alerts WHERE case_id = $1 ORDER BY created_at",
    [caseId]
  );
  const events = await db.query(
    "SELECT * FROM compliance_case_events WHERE case_id = $1 ORDER BY created_at, id",
    [caseId]
  );
  return { ...caseResult.rows[0], alerts: alerts.rows, events: events.rows };
}

async function updateCase(caseId, input, actor, dbPool = pool) {
  assertCompliance(input.reasonCode, 400, "REASON_REQUIRED", "A reason code is required");
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM compliance_cases WHERE id = $1 FOR UPDATE",
      [caseId]
    );
    const current = currentResult.rows[0];
    if (!current) throw complianceError(404, "CASE_NOT_FOUND", "Compliance case not found");
    const targetStatus = input.status || current.status;
    transitionCase(current.status, targetStatus);
    if (input.decision) {
      assertCompliance(
        DECISIONS.has(input.decision),
        400,
        "INVALID_DECISION",
        "Invalid case decision"
      );
      assertCompliance(
        targetStatus === "decided" || targetStatus === "closed",
        400,
        "DECISION_STATE_REQUIRED",
        "A decision requires decided or closed status"
      );
    }
    const assignedTo = input.assignedTo === undefined ? current.assigned_to : input.assignedTo;
    const { rows } = await client.query(
      `UPDATE compliance_cases
          SET status = $2,
              assigned_to = $3,
              decision = COALESCE($4, decision),
              decision_reason = COALESCE($5, decision_reason),
              decided_at = CASE WHEN $2 = 'decided' THEN NOW() ELSE decided_at END,
              closed_at = CASE WHEN $2 = 'closed' THEN NOW() ELSE closed_at END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [caseId, targetStatus, assignedTo, input.decision || null, input.reason || null]
    );
    await client.query(
      `INSERT INTO compliance_case_events (
         case_id, actor_address, event_type, from_status, to_status,
         reason_code, note, evidence
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        caseId,
        actor,
        input.decision ? "decision" : "transition",
        current.status,
        targetStatus,
        input.reasonCode,
        input.reason || null,
        JSON.stringify(input.evidence || {}),
      ]
    );
    if (input.decision) {
      await client.query(
        `UPDATE compliance_alerts
            SET status = 'resolved', resolved_at = NOW()
          WHERE case_id = $1 AND status IN ('open', 'in_review')`,
        [caseId]
      );
    } else if (targetStatus !== "open") {
      await client.query(
        "UPDATE compliance_alerts SET status = 'in_review' WHERE case_id = $1 AND status = 'open'",
        [caseId]
      );
    }
    await appendAuditEvent(
      {
        subjectId: current.subject_id,
        actorType: "analyst",
        actorId: actor,
        action: input.decision ? "case.decided" : "case.transitioned",
        objectType: "case",
        objectId: caseId,
        correlationId: input.correlationId || randomUUID(),
        reasonCode: input.reasonCode,
        decision: input.decision || targetStatus,
        evidence: input.evidence || {},
        metadata: { fromStatus: current.status, toStatus: targetStatus },
      },
      client
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createAlertCase, listCases, getCase, updateCase };
