"use strict";

const { randomUUID } = require("crypto");
const pool = require("../../db/pool");
const { sha256 } = require("./canonical");
const { assertCompliance } = require("./errors");

const ACTOR_TYPES = new Set(["subject", "analyst", "system", "provider"]);

async function appendAuditEvent(input, db = pool) {
  if (db === pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await appendAuditEvent(input, client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  assertCompliance(
    ACTOR_TYPES.has(input.actorType),
    400,
    "INVALID_AUDIT_ACTOR",
    "Unknown compliance audit actor type"
  );
  const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
  assertCompliance(
    !Number.isNaN(createdAt.getTime()),
    400,
    "INVALID_AUDIT_TIME",
    "Audit timestamp is invalid"
  );
  const correlationId = input.correlationId || randomUUID();

  // Callers doing a larger transaction pass their client. Standalone writes use
  // the pool and still serialize each subject chain through a row lock.
  if (input.subjectId) {
    await db.query("SELECT id FROM compliance_subjects WHERE id = $1 FOR UPDATE", [
      input.subjectId,
    ]);
  } else {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('compliance-audit-global'))");
  }
  const previousResult = await db.query(
    `SELECT event_hash
       FROM compliance_audit_events
      WHERE subject_id IS NOT DISTINCT FROM $1
      ORDER BY chain_sequence DESC
      LIMIT 1`,
    [input.subjectId || null]
  );
  const previousHash = previousResult.rows[0]?.event_hash || null;
  const evidenceHash = input.evidenceHash || sha256(input.evidence || {});
  const immutable = {
    subjectId: input.subjectId || null,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    objectType: input.objectType,
    objectId: String(input.objectId),
    correlationId,
    policyJurisdiction: input.policyJurisdiction || null,
    policyVersion: input.policyVersion || null,
    reasonCode: input.reasonCode,
    decision: input.decision || null,
    evidenceHash,
    metadata: input.metadata || {},
    previousHash,
    createdAt: createdAt.toISOString(),
  };
  const eventHash = sha256(immutable);
  const { rows } = await db.query(
    `INSERT INTO compliance_audit_events (
       subject_id, actor_type, actor_id, action, object_type, object_id,
       correlation_id, policy_jurisdiction, policy_version, reason_code,
       decision, evidence_hash, metadata, previous_hash, event_hash, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13::jsonb, $14, $15, $16
     ) RETURNING *`,
    [
      immutable.subjectId,
      immutable.actorType,
      immutable.actorId,
      immutable.action,
      immutable.objectType,
      immutable.objectId,
      immutable.correlationId,
      immutable.policyJurisdiction,
      immutable.policyVersion,
      immutable.reasonCode,
      immutable.decision,
      immutable.evidenceHash,
      JSON.stringify(immutable.metadata),
      immutable.previousHash,
      eventHash,
      immutable.createdAt,
    ]
  );
  return rows[0];
}

async function getAuditTrail(subjectId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, chain_sequence, subject_id, actor_type, actor_id, action, object_type,
            object_id, correlation_id, policy_jurisdiction, policy_version,
            reason_code, decision, evidence_hash, metadata, previous_hash,
            event_hash, created_at
       FROM compliance_audit_events
      WHERE subject_id = $1
      ORDER BY chain_sequence`,
    [subjectId]
  );
  return rows;
}

function verifyAuditChain(events) {
  let previousHash = null;
  for (const event of events) {
    if ((event.previous_hash || null) !== previousHash) return false;
    const immutable = {
      subjectId: event.subject_id || null,
      actorType: event.actor_type,
      actorId: event.actor_id,
      action: event.action,
      objectType: event.object_type,
      objectId: String(event.object_id),
      correlationId: event.correlation_id,
      policyJurisdiction: event.policy_jurisdiction || null,
      policyVersion: event.policy_version || null,
      reasonCode: event.reason_code,
      decision: event.decision || null,
      evidenceHash: event.evidence_hash,
      metadata: event.metadata || {},
      previousHash,
      createdAt: new Date(event.created_at).toISOString(),
    };
    if (sha256(immutable) !== event.event_hash) return false;
    previousHash = event.event_hash;
  }
  return true;
}

module.exports = { appendAuditEvent, getAuditTrail, verifyAuditChain };
