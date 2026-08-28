"use strict";

const { randomUUID } = require("crypto");
const pool = require("../../db/pool");
const { getCryptoVault } = require("./cryptoVault");
const { createComplianceProviders } = require("./providers");
const { getApplicableRuleSet } = require("./policyService");
const { transitionIdentity } = require("./stateMachines");
const { appendAuditEvent } = require("./auditService");
const { assertCompliance, complianceError } = require("./errors");
const { sha256 } = require("./canonical");

const SUBJECT_TYPES = new Set(["individual", "corporate"]);
const providers = createComplianceProviders();

function maskName(value) {
  return (
    String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) =>
        part.length <= 1 ? "*" : `${part[0]}${"*".repeat(Math.min(5, part.length - 1))}`
      )
      .join(" ") || null
  );
}

function subjectView(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerAddress: row.owner_address,
    subjectType: row.subject_type,
    verificationStatus: row.verification_status,
    verificationTier: Number(row.verification_tier),
    legalNameMasked: row.legal_name_masked,
    countryCode: row.country_code,
    providerName: row.provider_name,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    nextScreeningAt: row.next_screening_at,
    retentionUntil: row.retention_until,
    legalHold: row.legal_hold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requiredFields(subjectType, tier) {
  const common = ["fullName", "countryCode"];
  if (tier >= 1) common.push("dateOfBirth", "residentialAddress");
  if (tier >= 2) common.push("governmentId", "liveness");
  if (tier >= 3) common.push("sourceOfFunds", "taxResidence");
  if (subjectType === "corporate") {
    return [
      "companyName",
      "registrationNumber",
      "registeredAddress",
      "incorporationCountry",
      "directors",
      "beneficialOwners",
      "authorityToAct",
      ...(tier >= 3 ? ["sourceOfFunds"] : []),
    ];
  }
  return common;
}

function validatePii(subjectType, pii, tier) {
  assertCompliance(
    pii && typeof pii === "object" && !Array.isArray(pii),
    400,
    "INVALID_IDENTITY_DATA",
    "identity data must be an object"
  );
  const missing = requiredFields(subjectType, tier).filter((field) => {
    if (field === "liveness" || field === "governmentId") return false;
    return pii[field] === undefined || pii[field] === null || pii[field] === "";
  });
  assertCompliance(
    missing.length === 0,
    400,
    "IDENTITY_FIELDS_REQUIRED",
    "Required identity fields are missing",
    { missing }
  );
  const country = String(pii.countryCode || pii.incorporationCountry || "").toUpperCase();
  assertCompliance(
    /^[A-Z]{2}$/.test(country),
    400,
    "INVALID_COUNTRY",
    "An ISO alpha-2 country code is required"
  );
  return { country, fields: Object.keys(pii).sort() };
}

async function ensureSubject(ownerAddress, subjectType = "individual", db = pool) {
  assertCompliance(
    SUBJECT_TYPES.has(subjectType),
    400,
    "INVALID_SUBJECT_TYPE",
    "subjectType must be individual or corporate"
  );
  const { rows } = await db.query(
    `INSERT INTO compliance_subjects (
       owner_address, subject_type, legacy_kyc_evidence
     )
     SELECT public_key, $2, COALESCE(is_kyc_verified, FALSE)
       FROM profiles
      WHERE public_key = $1
     ON CONFLICT (owner_address) DO UPDATE
       SET updated_at = compliance_subjects.updated_at
     RETURNING *`,
    [ownerAddress, subjectType]
  );
  if (!rows[0]) throw complianceError(404, "PROFILE_NOT_FOUND", "Profile must exist before KYC");
  assertCompliance(
    rows[0].subject_type === subjectType,
    409,
    "SUBJECT_TYPE_IMMUTABLE",
    "The compliance subject type cannot be changed"
  );
  return rows[0];
}

async function getSubjectByOwner(ownerAddress, db = pool) {
  const { rows } = await db.query("SELECT * FROM compliance_subjects WHERE owner_address = $1", [
    ownerAddress,
  ]);
  return rows[0] || null;
}

async function getVerificationStatus(ownerAddress, db = pool) {
  const subject = await getSubjectByOwner(ownerAddress, db);
  if (!subject) {
    return {
      subject: null,
      verificationStatus: "unverified",
      verificationTier: 0,
      activeSession: null,
    };
  }
  const sessionResult = await db.query(
    `SELECT id, requested_tier, status, required_fields, provided_fields,
            document_status, liveness_status, decision_reasons, expires_at,
            created_at, updated_at
       FROM compliance_verification_sessions
      WHERE subject_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [subject.id]
  );
  return { ...subjectView(subject), activeSession: sessionResult.rows[0] || null };
}

async function storeCorporateParties(subject, pii, vault, db = pool) {
  const groups = [
    ["directors", "director"],
    ["beneficialOwners", "beneficial_owner"],
  ];
  for (const [field, role] of groups) {
    const parties = Array.isArray(pii[field]) ? pii[field] : [];
    assertCompliance(
      parties.length > 0,
      400,
      "CORPORATE_PARTIES_REQUIRED",
      `${field} must include at least one party`
    );
    for (const party of parties) {
      assertCompliance(
        party.fullName,
        400,
        "PARTY_NAME_REQUIRED",
        "Corporate party name is required"
      );
      const blindIndex = vault.blindIndex(
        `corporate-party:${subject.id}`,
        `${party.fullName}|${party.dateOfBirth || ""}`
      );
      const context = {
        subjectId: subject.id,
        recordType: "corporate-party",
        blindIndex,
        schemaVersion: 1,
      };
      const envelope = vault.encrypt(party, context);
      await db.query(
        `INSERT INTO compliance_corporate_parties (
           corporate_subject_id, party_role, ownership_bps, legal_name_masked,
           country_code, pii_envelope, pii_blind_index, pii_key_id
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (corporate_subject_id, pii_blind_index, party_role) DO UPDATE
           SET ownership_bps = EXCLUDED.ownership_bps,
               legal_name_masked = EXCLUDED.legal_name_masked,
               country_code = EXCLUDED.country_code,
               pii_envelope = EXCLUDED.pii_envelope,
               pii_key_id = EXCLUDED.pii_key_id,
               updated_at = NOW()`,
        [
          subject.id,
          role,
          party.ownershipBps == null ? null : Number(party.ownershipBps),
          maskName(party.fullName),
          party.countryCode ? String(party.countryCode).toUpperCase() : null,
          JSON.stringify(envelope),
          blindIndex,
          envelope.keyId,
        ]
      );
    }
  }
}

async function startVerification(input, options = {}) {
  const db = options.db || pool;
  const vault = options.vault || getCryptoVault();
  const kycProvider = options.kycProvider || providers.kyc;
  const subjectType = input.subjectType || "individual";
  const requestedTier = Number(input.requestedTier || 1);
  assertCompliance(
    Number.isInteger(requestedTier) && requestedTier >= 1 && requestedTier <= 3,
    400,
    "INVALID_TIER",
    "requestedTier must be 1, 2, or 3"
  );
  const subject = await ensureSubject(input.ownerAddress, subjectType, db);
  const validation = validatePii(subjectType, input.identity, requestedTier);
  const policy = await getApplicableRuleSet(validation.country, new Date(), db);
  const context = { subjectId: subject.id, recordType: "identity", schemaVersion: 1 };
  const envelope = vault.encrypt(input.identity, context);
  const providerResult = await kycProvider.createSession({
    idempotencyKey: input.idempotencyKey || randomUUID(),
    subjectRef: subject.id,
    subjectType,
    requestedTier,
    requiredFields: requiredFields(subjectType, requestedTier),
    countryCode: validation.country,
    callbackUrl: input.callbackUrl || null,
  });
  transitionIdentity(subject.verification_status, "pending");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.query(
    `UPDATE compliance_subjects
        SET verification_status = 'pending', provider_name = $2,
            pii_envelope = $3::jsonb, pii_blind_index = $4, pii_key_id = $5,
            legal_name_masked = $6, country_code = $7,
            retention_until = NOW() + ($8::text || ' days')::interval,
            updated_at = NOW()
      WHERE id = $1`,
    [
      subject.id,
      providerResult.provider,
      JSON.stringify(envelope),
      vault.blindIndex(
        "identity",
        input.identity.fullName || input.identity.companyName || input.ownerAddress
      ),
      envelope.keyId,
      maskName(input.identity.fullName || input.identity.companyName),
      validation.country,
      policy.rules.retentionDays,
    ]
  );
  if (subjectType === "corporate") {
    await storeCorporateParties(subject, input.identity, vault, db);
  }
  const sessionResult = await db.query(
    `INSERT INTO compliance_verification_sessions (
       subject_id, provider_name, provider_session_ref, requested_tier,
       status, required_fields, provided_fields, document_status,
       liveness_status, expires_at
     ) VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6::jsonb, $7, $8, $9)
     RETURNING *`,
    [
      subject.id,
      providerResult.provider,
      providerResult.reference,
      requestedTier,
      JSON.stringify(requiredFields(subjectType, requestedTier)),
      JSON.stringify(validation.fields),
      providerResult.documentStatus,
      providerResult.livenessStatus,
      expiresAt.toISOString(),
    ]
  );
  await appendAuditEvent(
    {
      subjectId: subject.id,
      actorType: "subject",
      actorId: input.ownerAddress,
      action: "identity.verification_started",
      objectType: "verification_session",
      objectId: sessionResult.rows[0].id,
      correlationId: input.correlationId || randomUUID(),
      policyJurisdiction: policy.jurisdiction,
      policyVersion: policy.version,
      reasonCode: "KYC_REQUESTED",
      decision: "pending",
      evidence: { requestedTier, providedFields: validation.fields },
      metadata: { subjectType, provider: providerResult.provider },
    },
    db
  );
  return {
    subject: { ...subjectView(subject), verificationStatus: "pending" },
    session: {
      id: sessionResult.rows[0].id,
      status: "pending",
      requestedTier,
      requiredFields: requiredFields(subjectType, requestedTier),
      documentStatus: providerResult.documentStatus,
      livenessStatus: providerResult.livenessStatus,
      expiresAt: expiresAt.toISOString(),
      redirectUrl: providerResult.redirectUrl,
    },
  };
}

async function applyProviderDecision(input, options = {}) {
  const db = options.db || pool;
  const kycProvider = options.kycProvider || providers.kyc;
  const rawBody = options.rawBody || JSON.stringify(input.payload || {});
  assertCompliance(
    kycProvider.verifyWebhook(rawBody, input.signature),
    401,
    "INVALID_PROVIDER_SIGNATURE",
    "Provider webhook signature is invalid"
  );
  const decision = kycProvider.normalizeWebhook(input.payload);
  assertCompliance(
    ["pending", "needs_input", "verified", "expired", "rejected"].includes(decision.status),
    400,
    "INVALID_PROVIDER_STATUS",
    "Provider returned an unsupported status"
  );
  const sessionResult = await db.query(
    `SELECT s.*, cs.verification_status, cs.verification_tier,
            cs.country_code, cs.owner_address
       FROM compliance_verification_sessions s
       JOIN compliance_subjects cs ON cs.id = s.subject_id
      WHERE s.provider_name = $1 AND s.provider_session_ref = $2`,
    [kycProvider.name, decision.providerSessionRef]
  );
  const session = sessionResult.rows[0];
  if (!session) throw complianceError(404, "SESSION_NOT_FOUND", "Verification session not found");
  transitionIdentity(session.verification_status, decision.status);
  const country = String(decision.countryCode || session.country_code || "").toUpperCase();
  const policy = await getApplicableRuleSet(country || "DEFAULT", new Date(), db);
  const verifiedTier =
    decision.status === "verified"
      ? Math.min(Number(session.requested_tier), Math.max(0, Number(decision.tier) || 0))
      : Number(session.verification_tier);
  const expiresAt =
    decision.status === "verified"
      ? new Date(Date.now() + policy.rules.verificationValidityDays * 24 * 60 * 60 * 1000)
      : null;
  await db.query(
    `UPDATE compliance_verification_sessions
        SET status = $2, document_status = COALESCE($3, document_status),
            liveness_status = COALESCE($4, liveness_status),
            decision_reasons = $5::jsonb, provider_result_hash = $6,
            completed_at = CASE WHEN $2 IN ('verified', 'rejected', 'expired') THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id = $1`,
    [
      session.id,
      decision.status,
      decision.documentStatus || null,
      decision.livenessStatus || null,
      JSON.stringify(decision.reasons || []),
      decision.resultHash || sha256(decision),
    ]
  );
  await db.query(
    `UPDATE compliance_subjects
        SET verification_status = $2, verification_tier = $3,
            country_code = COALESCE($4, country_code),
            legal_name_masked = COALESCE($5, legal_name_masked),
            provider_customer_ref = COALESCE($7, provider_customer_ref),
            verified_at = CASE WHEN $2 = 'verified' THEN NOW() ELSE verified_at END,
            expires_at = $6,
            next_screening_at = CASE WHEN $2 = 'verified' THEN NOW() ELSE next_screening_at END,
            updated_at = NOW()
      WHERE id = $1`,
    [
      session.subject_id,
      decision.status,
      verifiedTier,
      country || null,
      decision.legalName ? maskName(decision.legalName) : null,
      expiresAt?.toISOString() || null,
      decision.providerCustomerRef || null,
    ]
  );
  await appendAuditEvent(
    {
      subjectId: session.subject_id,
      actorType: "provider",
      actorId: kycProvider.name,
      action: "identity.provider_decision",
      objectType: "verification_session",
      objectId: session.id,
      correlationId: input.correlationId || randomUUID(),
      policyJurisdiction: policy.jurisdiction,
      policyVersion: policy.version,
      reasonCode: `KYC_${decision.status.toUpperCase()}`,
      decision: decision.status,
      evidenceHash: decision.resultHash || sha256(decision),
      metadata: { tier: verifiedTier, documentStatus: decision.documentStatus },
    },
    db
  );
  return {
    subjectId: session.subject_id,
    ownerAddress: session.owner_address,
    status: decision.status,
    tier: verifiedTier,
    expiresAt: expiresAt?.toISOString() || null,
    screeningRequired: decision.status === "verified",
  };
}

function tierForAmount(amount, tierLimits) {
  for (let tier = 0; tier <= 3; tier += 1) {
    if (amount <= Number(tierLimits[tier])) return tier;
  }
  return null;
}

async function checkTransactionLimit(ownerAddress, input, db = pool) {
  const amount = Number(input.amount);
  assertCompliance(
    Number.isFinite(amount) && amount > 0,
    400,
    "INVALID_AMOUNT",
    "amount must be positive"
  );
  const subject = await getSubjectByOwner(ownerAddress, db);
  const policy = await getApplicableRuleSet(
    input.jurisdiction || subject?.country_code || "DEFAULT",
    new Date(),
    db
  );
  const tier = Number(subject?.verification_tier || 0);
  const limit = Number(policy.rules.tierLimits[tier]);
  const usageResult = subject
    ? await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS used
           FROM compliance_transactions
          WHERE originator_subject_id = $1
            AND occurred_at >= NOW() - INTERVAL '24 hours'
            AND status IN ('observed', 'held', 'approved', 'settled')`,
        [subject.id]
      )
    : { rows: [{ used: 0 }] };
  const used = Number(usageResult.rows[0]?.used || 0);
  const remaining = Math.max(0, limit - used);
  const requiredTier = tierForAmount(used + amount, policy.rules.tierLimits);
  const notExpired = !subject?.expires_at || new Date(subject.expires_at).getTime() > Date.now();
  const verified = tier === 0 || (subject?.verification_status === "verified" && notExpired);
  const withinLimit = amount <= remaining;
  const decision = {
    allowed: verified && withinLimit,
    tier,
    requiredTier,
    limit: limit.toFixed(7),
    used: used.toFixed(7),
    remaining: remaining.toFixed(7),
    reasonCode: !verified
      ? "VERIFICATION_REQUIRED"
      : withinLimit
        ? "WITHIN_TIER_LIMIT"
        : "TIER_LIMIT_EXCEEDED",
    policy: { jurisdiction: policy.jurisdiction, version: policy.version },
  };
  if (subject) {
    await appendAuditEvent(
      {
        subjectId: subject.id,
        actorType: "subject",
        actorId: ownerAddress,
        action: "identity.limit_checked",
        objectType: "compliance_subject",
        objectId: subject.id,
        correlationId: input.correlationId || randomUUID(),
        policyJurisdiction: policy.jurisdiction,
        policyVersion: policy.version,
        reasonCode: decision.reasonCode,
        decision: decision.allowed ? "allowed" : "restricted",
        evidence: { amount: amount.toFixed(7), used: decision.used, limit: decision.limit },
        metadata: { tier, requiredTier },
      },
      db
    );
  }
  return decision;
}

async function requestDeletion(ownerAddress, input = {}, options = {}) {
  const db = options.db || pool;
  const kycProvider = options.kycProvider || providers.kyc;
  const subject = await getSubjectByOwner(ownerAddress, db);
  if (!subject) throw complianceError(404, "SUBJECT_NOT_FOUND", "Compliance subject not found");
  const retentionActive = subject.retention_until && new Date(subject.retention_until) > new Date();
  const status = subject.legal_hold || retentionActive ? "retained" : "provider_pending";
  const reason = subject.legal_hold
    ? "LEGAL_HOLD"
    : retentionActive
      ? "REGULATORY_RETENTION"
      : null;
  const { rows } = await db.query(
    `INSERT INTO compliance_deletion_requests (
       subject_id, requested_by, status, retention_reason
     ) VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [subject.id, ownerAddress, status, reason]
  );
  const request = rows[0];
  if (status === "provider_pending") {
    const providerResult = subject.provider_customer_ref
      ? await kycProvider.deleteSubject(subject.provider_customer_ref)
      : { accepted: true, reference: "no-provider-record" };
    if (providerResult.accepted) {
      const tombstoneHash = sha256({
        subjectId: subject.id,
        requestId: request.id,
        pii: subject.pii_envelope,
      });
      await db.query(
        `UPDATE compliance_subjects
            SET pii_envelope = NULL, pii_blind_index = NULL, pii_key_id = NULL,
                legal_name_masked = NULL, updated_at = NOW()
          WHERE id = $1`,
        [subject.id]
      );
      await db.query(
        `UPDATE compliance_deletion_requests
            SET status = 'completed', provider_request_ref = $2,
                tombstone_hash = $3, completed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [request.id, providerResult.reference, tombstoneHash]
      );
      request.status = "completed";
      request.tombstone_hash = tombstoneHash;
    }
  }
  await appendAuditEvent(
    {
      subjectId: subject.id,
      actorType: "subject",
      actorId: ownerAddress,
      action: "identity.deletion_requested",
      objectType: "deletion_request",
      objectId: request.id,
      correlationId: input.correlationId || randomUUID(),
      reasonCode: reason || "SUBJECT_REQUEST",
      decision: request.status,
      evidence: { legalHold: subject.legal_hold, retentionUntil: subject.retention_until },
      metadata: {},
    },
    db
  );
  return {
    id: request.id,
    status: request.status,
    retentionReason: reason,
    retentionUntil: subject.retention_until,
  };
}

async function expireDueVerifications(limit = 100, db = pool) {
  const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const { rows } = await db.query(
    `UPDATE compliance_subjects
        SET verification_status = 'expired', next_screening_at = NOW(), updated_at = NOW()
      WHERE id IN (
        SELECT id FROM compliance_subjects
         WHERE verification_status = 'verified' AND expires_at <= NOW()
         ORDER BY expires_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, owner_address`,
    [boundedLimit]
  );
  return rows;
}

function decryptSubjectPii(subject, vault = getCryptoVault()) {
  if (!subject.pii_envelope) return {};
  return vault.decrypt(subject.pii_envelope, {
    subjectId: subject.id,
    recordType: "identity",
    schemaVersion: 1,
  });
}

module.exports = {
  requiredFields,
  ensureSubject,
  getSubjectByOwner,
  getVerificationStatus,
  startVerification,
  applyProviderDecision,
  checkTransactionLimit,
  requestDeletion,
  expireDueVerifications,
  decryptSubjectPii,
  subjectView,
};
