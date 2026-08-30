"use strict";

const pool = require("../../db/pool");
const { validateRuleSet, policyChecksum } = require("./policySchema");
const { assertCompliance, complianceError } = require("./errors");
const { appendAuditEvent } = require("./auditService");

const cache = new Map();
const CACHE_TTL_MS = 30_000;

function normalizeJurisdiction(value) {
  const jurisdiction = String(value || "DEFAULT")
    .trim()
    .toUpperCase();
  assertCompliance(
    jurisdiction === "DEFAULT" || /^[A-Z]{2}(-[A-Z0-9]{1,8})?$/.test(jurisdiction),
    400,
    "INVALID_JURISDICTION",
    "jurisdiction must be DEFAULT, ISO alpha-2, or an ISO subdivision"
  );
  return jurisdiction;
}

function rowToPolicy(row) {
  const rules = validateRuleSet(row.rules);
  assertCompliance(
    policyChecksum(rules) === row.checksum,
    500,
    "POLICY_INTEGRITY_FAILED",
    "Stored compliance policy checksum does not match its rules"
  );
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    version: Number(row.version),
    schemaVersion: Number(row.schema_version),
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    checksum: row.checksum,
    rules,
  };
}

async function getApplicableRuleSet(jurisdiction, at = new Date(), db = pool) {
  const normalized = normalizeJurisdiction(jurisdiction);
  const instant = new Date(at);
  assertCompliance(
    !Number.isNaN(instant.getTime()),
    400,
    "INVALID_EFFECTIVE_TIME",
    "Policy effective time is invalid"
  );
  const cacheKey = `${normalized}:${instant.toISOString().slice(0, 16)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.policy;

  const { rows } = await db.query(
    `SELECT id, jurisdiction, version, schema_version, effective_from,
            effective_until, checksum, rules
       FROM jurisdiction_rule_sets
      WHERE status = 'published'
        AND jurisdiction IN ($1, 'DEFAULT')
        AND effective_from <= $2
        AND (effective_until IS NULL OR effective_until > $2)
      ORDER BY CASE WHEN jurisdiction = $1 THEN 0 ELSE 1 END,
               effective_from DESC, version DESC
      LIMIT 1`,
    [normalized, instant.toISOString()]
  );
  if (!rows[0]) {
    throw complianceError(503, "POLICY_UNAVAILABLE", "No effective compliance policy exists");
  }
  const policy = rowToPolicy(rows[0]);
  cache.set(cacheKey, { policy, expiresAt: Date.now() + CACHE_TTL_MS });
  return policy;
}

async function publishRuleSet(input, actor, dbPool = pool) {
  const jurisdiction = normalizeJurisdiction(input.jurisdiction);
  const rules = validateRuleSet(input.rules);
  const checksum = policyChecksum(rules);
  const effectiveFrom = new Date(input.effectiveFrom || Date.now());
  assertCompliance(
    !Number.isNaN(effectiveFrom.getTime()),
    400,
    "INVALID_EFFECTIVE_TIME",
    "effectiveFrom must be a valid date"
  );
  assertCompliance(
    input.reviewedBy && input.reviewedBy !== actor,
    400,
    "FOUR_EYES_REQUIRED",
    "A different reviewer must approve a published rule set"
  );

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `compliance-policy:${jurisdiction}`,
    ]);
    const versionResult = await client.query(
      "SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version FROM jurisdiction_rule_sets WHERE jurisdiction = $1",
      [jurisdiction]
    );
    const version = Number(versionResult.rows[0].next_version);
    const { rows } = await client.query(
      `INSERT INTO jurisdiction_rule_sets (
         jurisdiction, version, schema_version, status, effective_from,
         rules, checksum, authored_by, reviewed_by, published_at
       ) VALUES ($1, $2, 1, 'published', $3, $4::jsonb, $5, $6, $7, NOW())
       RETURNING *`,
      [
        jurisdiction,
        version,
        effectiveFrom.toISOString(),
        JSON.stringify(rules),
        checksum,
        actor,
        input.reviewedBy,
      ]
    );
    await appendAuditEvent(
      {
        subjectId: null,
        actorType: "analyst",
        actorId: actor,
        action: "policy.published",
        objectType: "jurisdiction_rule_set",
        objectId: rows[0].id,
        policyJurisdiction: jurisdiction,
        policyVersion: version,
        reasonCode: "FOUR_EYES_REVIEWED",
        decision: "published",
        evidenceHash: checksum,
        metadata: {
          effectiveFrom: effectiveFrom.toISOString(),
          reviewedBy: input.reviewedBy,
          mode: rules.mode,
        },
      },
      client
    );
    await client.query("COMMIT");
    cache.clear();
    return rowToPolicy(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listRuleSets(jurisdiction, db = pool) {
  const normalized = jurisdiction ? normalizeJurisdiction(jurisdiction) : null;
  const { rows } = await db.query(
    `SELECT id, jurisdiction, version, schema_version, status, effective_from,
            effective_until, checksum, authored_by, reviewed_by, published_at,
            rules, created_at
       FROM jurisdiction_rule_sets
      WHERE ($1::text IS NULL OR jurisdiction = $1)
      ORDER BY jurisdiction, version DESC`,
    [normalized]
  );
  return rows;
}

function evaluateGeography(input, policy) {
  const kycCountry = input.kycCountry ? String(input.kycCountry).toUpperCase() : null;
  const declaredCountry = input.declaredCountry
    ? String(input.declaredCountry).toUpperCase()
    : null;
  const ipCountry = input.ipCountry ? String(input.ipCountry).toUpperCase() : null;
  const confidence = Number(input.ipConfidence) || 0;
  const reliableIp =
    ipCountry && confidence >= policy.rules.geo.minimumConfidence ? ipCountry : null;
  const signals = [kycCountry, declaredCountry, reliableIp].filter(Boolean);
  const conflict = new Set(signals).size > 1;
  const prohibitedCountry = signals.find((country) =>
    policy.rules.prohibitedTerritories.includes(country)
  );
  let outcome = "allow";
  let reasonCode = "GEO_ALLOWED";
  if (prohibitedCountry) {
    outcome = policy.rules.mode === "enforce" ? "deny" : "review";
    reasonCode = "PROHIBITED_TERRITORY";
  } else if (conflict || input.proxyDetected || (ipCountry && !reliableIp)) {
    outcome = policy.rules.geo.conflictAction;
    if (policy.rules.mode === "observe" && outcome === "deny") outcome = "review";
    reasonCode = conflict ? "GEO_SIGNAL_CONFLICT" : "GEO_LOW_CONFIDENCE";
  }
  return {
    outcome,
    reasonCode,
    conflict,
    prohibitedTerritory: Boolean(prohibitedCountry),
    country: kycCountry || declaredCountry || reliableIp,
    methodVersion: "multi-signal-v1",
    confidence,
    signals: {
      kyc: kycCountry,
      declared: declaredCountry,
      ip: reliableIp,
      proxyDetected: Boolean(input.proxyDetected),
    },
  };
}

function clearPolicyCache() {
  cache.clear();
}

module.exports = {
  normalizeJurisdiction,
  getApplicableRuleSet,
  publishRuleSet,
  listRuleSets,
  evaluateGeography,
  clearPolicyCache,
};
