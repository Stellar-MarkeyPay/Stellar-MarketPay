"use strict";

const { randomUUID } = require("crypto");
const pool = require("../../db/pool");
const { getApplicableRuleSet, evaluateGeography } = require("./policyService");
const {
  ensureSubject,
  getSubjectByOwner,
  checkTransactionLimit,
  decryptSubjectPii,
} = require("./identityService");
const { evaluateTransaction } = require("./monitoringEngine");
const { calculateRiskAssessment } = require("./riskEngine");
const { createComplianceProviders } = require("./providers");
const { getLatestScreening, screenSubject } = require("./screeningService");
const { createAlertCase } = require("./caseService");
const { prepareExchange } = require("./travelRuleService");
const { appendAuditEvent } = require("./auditService");
const { assertCompliance, complianceError } = require("./errors");
const { sha256 } = require("./canonical");

const providers = createComplianceProviders();
const WALLET_TYPES = new Set(["institution", "self_hosted", "unknown"]);
const DIRECTIONS = new Set(["outbound", "inbound"]);

function validateTransfer(input) {
  const amount = Number(input.amount);
  assertCompliance(
    Number.isFinite(amount) && amount > 0,
    400,
    "INVALID_AMOUNT",
    "amount must be positive"
  );
  assertCompliance(input.idempotencyKey, 400, "IDEMPOTENCY_REQUIRED", "idempotencyKey is required");
  assertCompliance(
    input.beneficiaryAddress,
    400,
    "BENEFICIARY_REQUIRED",
    "beneficiaryAddress is required"
  );
  assertCompliance(input.asset, 400, "ASSET_REQUIRED", "asset is required");
  const walletType = input.beneficiaryWalletType || "unknown";
  assertCompliance(WALLET_TYPES.has(walletType), 400, "INVALID_WALLET_TYPE", "Invalid wallet type");
  const direction = input.direction || "outbound";
  assertCompliance(
    DIRECTIONS.has(direction),
    400,
    "INVALID_DIRECTION",
    "Invalid transfer direction"
  );
  const occurredAt = new Date(input.occurredAt || Date.now());
  assertCompliance(
    !Number.isNaN(occurredAt.getTime()),
    400,
    "INVALID_TIME",
    "occurredAt is invalid"
  );
  return { amount, walletType, direction, occurredAt };
}

function priorityForAlert(alert) {
  return alert.severity === "critical" ? "critical" : alert.severity === "high" ? "high" : "medium";
}

async function recordAndEvaluateTransfer(ownerAddress, input, options = {}) {
  const db = options.db || pool;
  const onchainProvider = options.onchainProvider || providers.onchain;
  const normalized = validateTransfer(input);
  const existing = await db.query(
    `SELECT ct.*, ra.score AS risk_score, ra.band AS risk_band
       FROM compliance_transactions ct
       LEFT JOIN LATERAL (
         SELECT score, band FROM compliance_risk_assessments
          WHERE transaction_id = ct.id ORDER BY created_at DESC LIMIT 1
       ) ra ON TRUE
      WHERE ct.idempotency_key = $1`,
    [input.idempotencyKey]
  );
  if (existing.rows[0]) return { idempotentReplay: true, transaction: existing.rows[0] };

  let subject = await getSubjectByOwner(ownerAddress, db);
  if (!subject) subject = await ensureSubject(ownerAddress, input.subjectType || "individual", db);
  const jurisdiction = String(
    input.jurisdiction || subject.country_code || "DEFAULT"
  ).toUpperCase();
  const policy = await getApplicableRuleSet(jurisdiction, normalized.occurredAt, db);
  const limitDecision = await checkTransactionLimit(
    ownerAddress,
    { amount: normalized.amount, jurisdiction, correlationId: input.correlationId },
    db
  );
  const geoDecision = evaluateGeography(
    {
      kycCountry: subject.country_code,
      declaredCountry: input.declaredCountry,
      ipCountry: input.ipCountry,
      ipConfidence: input.ipConfidence,
      proxyDetected: input.proxyDetected,
    },
    policy
  );
  const beneficiarySubjectResult = await db.query(
    "SELECT id FROM compliance_subjects WHERE owner_address = $1",
    [input.beneficiaryAddress]
  );
  const metadata = {
    source: input.source || "api",
    geo: geoDecision,
    geoSignalSource: input.geoSignalSource || "service",
    ipAuditToken: input.ipAuditToken || null,
    externalReferenceHash: input.externalReference ? sha256(input.externalReference) : null,
  };
  const transactionResult = await db.query(
    `INSERT INTO compliance_transactions (
       idempotency_key, originator_subject_id, beneficiary_subject_id,
       beneficiary_address, beneficiary_wallet_type, counterparty_institution,
       amount, asset, direction, jurisdiction, policy_version, occurred_at,
       status, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'observed', $13::jsonb)
     RETURNING *`,
    [
      input.idempotencyKey,
      subject.id,
      beneficiarySubjectResult.rows[0]?.id || null,
      input.beneficiaryAddress,
      normalized.walletType,
      input.counterpartyInstitution || null,
      normalized.amount,
      input.asset,
      normalized.direction,
      jurisdiction,
      policy.version,
      normalized.occurredAt.toISOString(),
      JSON.stringify(metadata),
    ]
  );
  const transaction = transactionResult.rows[0];
  transaction.originator_address = ownerAddress;
  transaction.originator_country = subject.country_code;

  const historyResult = await db.query(
    `SELECT id, amount, beneficiary_address, occurred_at
       FROM compliance_transactions
      WHERE originator_subject_id = $1 AND id <> $2
        AND occurred_at >= $3::timestamptz - INTERVAL '30 days'
      ORDER BY occurred_at`,
    [subject.id, transaction.id, normalized.occurredAt.toISOString()]
  );
  const history = historyResult.rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    beneficiaryAddress: row.beneficiary_address,
    occurredAt: row.occurred_at,
  }));
  const engineTransaction = {
    id: transaction.id,
    idempotencyKey: input.idempotencyKey,
    originatorSubjectId: subject.id,
    beneficiaryAddress: input.beneficiaryAddress,
    amount: normalized.amount,
    occurredAt: normalized.occurredAt.toISOString(),
  };
  const monitoringAlerts = evaluateTransaction(engineTransaction, history, policy.rules.monitoring);
  const onchain = await onchainProvider.assessAddress(input.beneficiaryAddress);

  let latestScreening = await getLatestScreening(subject.id, db);
  if (!latestScreening && subject.pii_envelope) {
    const screening = await screenSubject(subject.id, "transaction", {
      db,
      screeningProvider: options.screeningProvider,
      vault: options.vault,
      actor: "transaction-monitor",
    });
    latestScreening = screening.screenings[0];
  }

  const createdCases = [];
  for (const alert of monitoringAlerts) {
    createdCases.push(
      await createAlertCase(
        {
          ...alert,
          subjectId: subject.id,
          transactionId: transaction.id,
          ruleVersion: policy.version,
          priority: priorityForAlert(alert),
          caseType: "monitoring",
          policyJurisdiction: policy.jurisdiction,
          correlationId: input.correlationId,
        },
        options.dbPool || pool
      )
    );
  }
  if (geoDecision.outcome !== "allow") {
    createdCases.push(
      await createAlertCase(
        {
          dedupeKey: sha256({ transactionId: transaction.id, rule: geoDecision.reasonCode }),
          subjectId: subject.id,
          transactionId: transaction.id,
          ruleCode: geoDecision.reasonCode,
          ruleVersion: policy.version,
          severity: geoDecision.outcome === "deny" ? "critical" : "high",
          score: geoDecision.outcome === "deny" ? 100 : 70,
          evidence: geoDecision,
          priority: geoDecision.outcome === "deny" ? "critical" : "high",
          caseType: "geo",
          policyJurisdiction: policy.jurisdiction,
          correlationId: input.correlationId,
        },
        options.dbPool || pool
      )
    );
  }
  const risk = calculateRiskAssessment(
    {
      identityTier: subject.verification_tier,
      identityStatus: subject.verification_status,
      screeningStatus: latestScreening?.status,
      monitoringAlerts,
      onchainRiskScore: onchain.score,
      geographyRiskScore:
        geoDecision.outcome === "deny" ? 100 : geoDecision.outcome === "review" ? 70 : 0,
      geoConflict: geoDecision.conflict,
      prohibitedTerritory: geoDecision.prohibitedTerritory,
    },
    policy.rules
  );
  const riskResult = await db.query(
    `INSERT INTO compliance_risk_assessments (
       subject_id, transaction_id, score, band, components, reasons,
       model_version, policy_version, evidence_hash
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
     RETURNING *`,
    [
      subject.id,
      transaction.id,
      risk.score,
      risk.band,
      JSON.stringify(risk.components),
      JSON.stringify(risk.reasons),
      risk.modelVersion,
      policy.version,
      risk.evidenceHash,
    ]
  );
  if (["high", "critical"].includes(risk.band) && createdCases.length === 0) {
    createdCases.push(
      await createAlertCase(
        {
          dedupeKey: sha256({ transactionId: transaction.id, rule: "COMPOSITE_RISK" }),
          subjectId: subject.id,
          transactionId: transaction.id,
          ruleCode: "COMPOSITE_RISK",
          ruleVersion: policy.version,
          severity: risk.band,
          score: risk.score,
          evidence: {
            components: risk.components,
            reasons: risk.reasons,
            evidenceHash: risk.evidenceHash,
          },
          priority: risk.band,
          caseType: "monitoring",
          policyJurisdiction: policy.jurisdiction,
          correlationId: input.correlationId,
        },
        options.dbPool || pool
      )
    );
  }

  let travelRule;
  try {
    travelRule = await prepareExchange(
      {
        transaction,
        policy,
        originatorPii: decryptSubjectPii(subject, options.vault),
        beneficiary: input.beneficiary || {},
        correlationId: input.correlationId,
      },
      options
    );
  } catch (error) {
    if (
      ![
        "TRAVEL_RULE_DATA_REQUIRED",
        "COUNTERPARTY_UNREACHABLE",
        "COUNTERPARTY_INSTITUTION_REQUIRED",
      ].includes(error.code)
    ) {
      throw error;
    }
    createdCases.push(
      await createAlertCase(
        {
          dedupeKey: sha256({ transactionId: transaction.id, rule: error.code }),
          subjectId: subject.id,
          transactionId: transaction.id,
          ruleCode: error.code,
          ruleVersion: policy.version,
          severity: "high",
          score: 75,
          evidence: { code: error.code, details: error.details || {} },
          priority: "high",
          caseType: "travel_rule",
          policyJurisdiction: policy.jurisdiction,
          correlationId: input.correlationId,
        },
        options.dbPool || pool
      )
    );
    travelRule = { required: true, status: "failed", errorCode: error.code };
  }

  const shouldHold =
    policy.rules.mode === "enforce" &&
    (!limitDecision.allowed ||
      geoDecision.outcome === "deny" ||
      ["high", "critical"].includes(risk.band) ||
      (travelRule.required &&
        !["sent", "acknowledged", "self_hosted_verified"].includes(travelRule.status)));
  const status = policy.rules.mode === "observe" ? "observed" : shouldHold ? "held" : "approved";
  await db.query(
    "UPDATE compliance_transactions SET status = $2, updated_at = NOW() WHERE id = $1",
    [transaction.id, status]
  );
  await appendAuditEvent(
    {
      subjectId: subject.id,
      actorType: "system",
      actorId: "transaction-monitor",
      action: "transaction.compliance_decision",
      objectType: "transaction",
      objectId: transaction.id,
      correlationId: input.correlationId || randomUUID(),
      policyJurisdiction: policy.jurisdiction,
      policyVersion: policy.version,
      reasonCode: shouldHold ? "COMPLIANCE_HOLD" : "COMPLIANCE_CHECK_COMPLETE",
      decision: status,
      evidence: {
        limitDecision,
        geoDecision,
        riskEvidenceHash: risk.evidenceHash,
        travelRuleStatus: travelRule.status,
      },
      metadata: { riskBand: risk.band, alertCount: createdCases.length },
    },
    db
  );
  return {
    idempotentReplay: false,
    transaction: { ...transaction, status },
    limitDecision,
    geoDecision,
    risk: riskResult.rows[0],
    alerts: monitoringAlerts,
    cases: createdCases.map((item) => item.case || { id: item.case_id }),
    travelRule: {
      id: travelRule.id || null,
      required: travelRule.required,
      status: travelRule.status,
      counterpartyType: travelRule.counterparty_type || normalized.walletType,
      errorCode: travelRule.errorCode || null,
    },
  };
}

async function getTransaction(transactionId, ownerAddress, db = pool) {
  const { rows } = await db.query(
    `SELECT ct.*, ra.score AS risk_score, ra.band AS risk_band,
            tr.required AS travel_rule_required, tr.status AS travel_rule_status
       FROM compliance_transactions ct
       JOIN compliance_subjects cs ON cs.id = ct.originator_subject_id
       LEFT JOIN LATERAL (
         SELECT score, band FROM compliance_risk_assessments
          WHERE transaction_id = ct.id ORDER BY created_at DESC LIMIT 1
       ) ra ON TRUE
       LEFT JOIN travel_rule_exchanges tr ON tr.transaction_id = ct.id
      WHERE ct.id = $1 AND cs.owner_address = $2`,
    [transactionId, ownerAddress]
  );
  if (!rows[0])
    throw complianceError(404, "TRANSACTION_NOT_FOUND", "Compliance transaction not found");
  return rows[0];
}

module.exports = { recordAndEvaluateTransfer, getTransaction };
