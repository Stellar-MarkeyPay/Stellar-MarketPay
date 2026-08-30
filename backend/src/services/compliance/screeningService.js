"use strict";

const { randomUUID } = require("crypto");
const pool = require("../../db/pool");
const { createComplianceProviders } = require("./providers");
const { getApplicableRuleSet } = require("./policyService");
const { decryptSubjectPii } = require("./identityService");
const { getCryptoVault } = require("./cryptoVault");
const { createAlertCase } = require("./caseService");
const { appendAuditEvent } = require("./auditService");
const { sha256 } = require("./canonical");
const { assertCompliance, complianceError } = require("./errors");

const providers = createComplianceProviders();
const REASONS = new Set(["onboarding", "scheduled", "transaction", "manual", "material_change"]);

function priorityForScreening(status) {
  return status === "confirmed_match" ? "critical" : "high";
}

async function persistScreening(subject, corporatePartyId, reason, result, policy, db = pool) {
  assertCompliance(
    ["clear", "potential_match", "confirmed_match", "provider_error"].includes(result.status),
    502,
    "INVALID_SCREENING_RESULT",
    "Screening provider returned an unsupported status"
  );
  const nextScreeningAt = new Date(
    Date.now() + policy.rules.screeningCadenceDays * 24 * 60 * 60 * 1000
  );
  const { rows } = await db.query(
    `INSERT INTO compliance_screenings (
       subject_id, corporate_party_id, provider_name, provider_screening_ref,
       reason, status, list_version, result_hash, next_screening_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      subject.id,
      corporatePartyId || null,
      result.provider,
      result.reference,
      reason,
      result.status,
      result.listVersion,
      result.resultHash || sha256(result),
      nextScreeningAt.toISOString(),
    ]
  );
  const screening = rows[0];
  for (const match of result.matches || []) {
    await db.query(
      `INSERT INTO compliance_screening_matches (
         screening_id, category, list_name, match_score, matched_name_masked,
         provider_match_ref, evidence
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        screening.id,
        match.category,
        match.listName,
        match.matchScore,
        match.matchedNameMasked || null,
        match.providerMatchRef || null,
        JSON.stringify(match.evidence || {}),
      ]
    );
  }
  await db.query(
    "UPDATE compliance_subjects SET next_screening_at = $2, updated_at = NOW() WHERE id = $1",
    [subject.id, nextScreeningAt.toISOString()]
  );
  if (corporatePartyId) {
    await db.query(
      "UPDATE compliance_corporate_parties SET screening_status = $2, updated_at = NOW() WHERE id = $1",
      [corporatePartyId, result.status]
    );
  }
  return screening;
}

async function screenSubject(subjectId, reason = "manual", options = {}) {
  assertCompliance(
    REASONS.has(reason),
    400,
    "INVALID_SCREENING_REASON",
    "Invalid screening reason"
  );
  const db = options.db || pool;
  const screeningProvider = options.screeningProvider || providers.screening;
  const vault = options.vault || getCryptoVault();
  const subjectResult = await db.query("SELECT * FROM compliance_subjects WHERE id = $1", [
    subjectId,
  ]);
  const subject = subjectResult.rows[0];
  if (!subject) throw complianceError(404, "SUBJECT_NOT_FOUND", "Compliance subject not found");
  const policy = await getApplicableRuleSet(subject.country_code || "DEFAULT", new Date(), db);
  const pii = decryptSubjectPii(subject, vault);
  const primaryResult = await screeningProvider.screen({
    idempotencyKey: `${subject.id}:${reason}:${new Date().toISOString().slice(0, 10)}`,
    subjectRef: subject.id,
    subjectType: subject.subject_type,
    fullName: pii.fullName || pii.companyName || subject.legal_name_masked,
    dateOfBirth: pii.dateOfBirth || null,
    countryCode: subject.country_code,
    categories: ["sanctions", "pep", "adverse_media"],
  });
  const screenings = [await persistScreening(subject, null, reason, primaryResult, policy, db)];

  if (subject.subject_type === "corporate") {
    const partiesResult = await db.query(
      "SELECT * FROM compliance_corporate_parties WHERE corporate_subject_id = $1",
      [subject.id]
    );
    for (const party of partiesResult.rows) {
      const partyPii = vault.decrypt(party.pii_envelope, {
        subjectId: subject.id,
        recordType: "corporate-party",
        blindIndex: party.pii_blind_index,
        schemaVersion: 1,
      });
      const partyResult = await screeningProvider.screen({
        idempotencyKey: `${party.id}:${reason}:${new Date().toISOString().slice(0, 10)}`,
        subjectRef: party.id,
        subjectType: "individual",
        fullName: partyPii.fullName,
        dateOfBirth: partyPii.dateOfBirth || null,
        countryCode: party.country_code || subject.country_code,
        categories: ["sanctions", "pep", "adverse_media"],
      });
      screenings.push(await persistScreening(subject, party.id, reason, partyResult, policy, db));
    }
  }

  for (const screening of screenings.filter((item) => item.status !== "clear")) {
    await createAlertCase(
      {
        dedupeKey: sha256({ screeningId: screening.id, status: screening.status }),
        subjectId: subject.id,
        screeningId: screening.id,
        ruleCode:
          screening.status === "confirmed_match"
            ? "SCREENING_CONFIRMED_MATCH"
            : "SCREENING_POTENTIAL_MATCH",
        ruleVersion: policy.version,
        severity: screening.status === "confirmed_match" ? "critical" : "high",
        score: screening.status === "confirmed_match" ? 100 : 80,
        evidence: {
          screeningId: screening.id,
          status: screening.status,
          listVersion: screening.list_version,
          resultHash: screening.result_hash,
        },
        priority: priorityForScreening(screening.status),
        caseType: "screening",
        policyJurisdiction: policy.jurisdiction,
        correlationId: options.correlationId || randomUUID(),
      },
      options.dbPool || pool
    );
  }
  const overallStatus = screenings.some((item) => item.status === "confirmed_match")
    ? "confirmed_match"
    : screenings.some((item) => item.status === "potential_match")
      ? "potential_match"
      : screenings.some((item) => item.status === "provider_error")
        ? "provider_error"
        : "clear";
  await appendAuditEvent(
    {
      subjectId: subject.id,
      actorType: reason === "manual" ? "analyst" : "system",
      actorId: options.actor || "screening-worker",
      action: "screening.completed",
      objectType: "screening_batch",
      objectId: screenings[0].id,
      correlationId: options.correlationId || randomUUID(),
      policyJurisdiction: policy.jurisdiction,
      policyVersion: policy.version,
      reasonCode: `SCREENING_${reason.toUpperCase()}`,
      decision: overallStatus,
      evidence: screenings.map((item) => ({ id: item.id, resultHash: item.result_hash })),
      metadata: { count: screenings.length, listVersion: primaryResult.listVersion },
    },
    db
  );
  return { subjectId: subject.id, status: overallStatus, screenings };
}

async function runDueScreenings(limit = 100, options = {}) {
  const configuredDb = options.db || pool;
  const lockClient = configuredDb.connect ? await configuredDb.connect() : null;
  const db = lockClient || configuredDb;
  if (lockClient) {
    const lock = await lockClient.query(
      "SELECT pg_try_advisory_lock(hashtext('compliance-screening-worker')) AS acquired"
    );
    if (!lock.rows[0]?.acquired) {
      lockClient.release();
      return [];
    }
  }
  const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  try {
    const { rows } = await db.query(
      `SELECT id
         FROM compliance_subjects
        WHERE next_screening_at IS NOT NULL AND next_screening_at <= NOW()
        ORDER BY next_screening_at
        LIMIT $1`,
      [boundedLimit]
    );
    const results = [];
    for (const row of rows) {
      try {
        // Keep the session-level worker lock on `db`, while each screening uses
        // the pool's normal transaction boundaries (including audit chaining).
        results.push(await screenSubject(row.id, "scheduled", options));
      } catch (error) {
        results.push({
          subjectId: row.id,
          status: "provider_error",
          errorCode: error.code || "ERROR",
        });
      }
    }
    return results;
  } finally {
    if (lockClient) {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext('compliance-screening-worker'))");
      lockClient.release();
    }
  }
}

async function getLatestScreening(subjectId, db = pool) {
  const { rows } = await db.query(
    `SELECT * FROM compliance_screenings
      WHERE subject_id = $1
      ORDER BY screened_at DESC
      LIMIT 1`,
    [subjectId]
  );
  return rows[0] || null;
}

module.exports = { screenSubject, runDueScreenings, getLatestScreening };
