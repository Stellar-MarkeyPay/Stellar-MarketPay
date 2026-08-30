"use strict";

const { randomUUID } = require("crypto");
const pool = require("../../db/pool");
const { getCryptoVault } = require("./cryptoVault");
const { createComplianceProviders } = require("./providers");
const { transitionTravelRule } = require("./stateMachines");
const { appendAuditEvent } = require("./auditService");
const { assertCompliance, complianceError } = require("./errors");
const { sha256 } = require("./canonical");

const providers = createComplianceProviders();
const SELF_HOSTED_METHODS = new Set(["signed_challenge", "microtransaction", "wallet_connection"]);

function buildTravelRulePayload(transaction, originatorPii, beneficiary, requiredFields) {
  const canonical = {
    fullName: originatorPii.fullName || originatorPii.companyName || null,
    account: transaction.originator_address || null,
    country: transaction.originator_country || null,
    beneficiaryName: beneficiary.fullName || null,
    beneficiaryAccount: transaction.beneficiary_address,
    beneficiaryCountry: beneficiary.country || null,
    amount: String(transaction.amount),
    asset: transaction.asset,
    transactionId: transaction.id,
  };
  const missing = requiredFields.filter((field) => !canonical[field]);
  assertCompliance(
    missing.length === 0,
    409,
    "TRAVEL_RULE_DATA_REQUIRED",
    "Travel Rule information is incomplete",
    { missing }
  );
  return canonical;
}

async function prepareExchange(input, options = {}) {
  const db = options.db || pool;
  const vault = options.vault || getCryptoVault();
  const provider = options.travelRuleProvider || providers.travelRule;
  const transaction = input.transaction;
  const policy = input.policy;
  const required = Number(transaction.amount) >= Number(policy.rules.travelRule.threshold);
  const existing = await db.query("SELECT * FROM travel_rule_exchanges WHERE transaction_id = $1", [
    transaction.id,
  ]);
  if (existing.rows[0]) return existing.rows[0];

  if (!required) {
    const { rows } = await db.query(
      `INSERT INTO travel_rule_exchanges (
         transaction_id, required, threshold_amount, counterparty_type, status
       ) VALUES ($1, FALSE, $2, $3, 'not_required')
       RETURNING *`,
      [transaction.id, policy.rules.travelRule.threshold, transaction.beneficiary_wallet_type]
    );
    return rows[0];
  }

  if (transaction.beneficiary_wallet_type === "self_hosted") {
    const { rows } = await db.query(
      `INSERT INTO travel_rule_exchanges (
         transaction_id, required, threshold_amount, counterparty_type,
         status, next_attempt_at
       ) VALUES ($1, TRUE, $2, 'self_hosted', 'pending', NULL)
       RETURNING *`,
      [transaction.id, policy.rules.travelRule.threshold]
    );
    await appendAuditEvent(
      {
        subjectId: transaction.originator_subject_id,
        actorType: "system",
        actorId: "travel-rule-engine",
        action: "travel_rule.self_hosted_evidence_required",
        objectType: "travel_rule_exchange",
        objectId: rows[0].id,
        correlationId: input.correlationId || randomUUID(),
        policyJurisdiction: policy.jurisdiction,
        policyVersion: policy.version,
        reasonCode: "SELF_HOSTED_WALLET",
        decision: "pending",
        evidence: { transactionId: transaction.id, address: transaction.beneficiary_address },
        metadata: { threshold: policy.rules.travelRule.threshold },
      },
      db
    );
    return rows[0];
  }

  assertCompliance(
    transaction.beneficiary_wallet_type === "institution" && transaction.counterparty_institution,
    409,
    "COUNTERPARTY_INSTITUTION_REQUIRED",
    "A reachable institution or self-hosted-wallet declaration is required"
  );
  const discovery = await provider.discover(transaction.counterparty_institution);
  assertCompliance(
    discovery.reachable,
    409,
    "COUNTERPARTY_UNREACHABLE",
    "Counterparty institution is not reachable through the Travel Rule protocol"
  );
  const payload = buildTravelRulePayload(
    transaction,
    input.originatorPii,
    input.beneficiary || {},
    policy.rules.travelRule.requiredFields
  );
  const context = { transactionId: transaction.id, recordType: "travel-rule", schemaVersion: 1 };
  const envelope = vault.encrypt(payload, context);
  const insertResult = await db.query(
    `INSERT INTO travel_rule_exchanges (
       transaction_id, required, threshold_amount, protocol_name,
       counterparty_type, status, payload_envelope, payload_key_id,
       attempt_count, next_attempt_at
     ) VALUES ($1, TRUE, $2, $3, 'institution', 'pending', $4::jsonb, $5, 0, NOW())
     RETURNING *`,
    [
      transaction.id,
      policy.rules.travelRule.threshold,
      provider.name,
      JSON.stringify(envelope),
      envelope.keyId,
    ]
  );
  const exchange = insertResult.rows[0];
  try {
    const result = await provider.send({
      transactionId: transaction.id,
      counterpartyInstitution: transaction.counterparty_institution,
      endpoint: discovery.endpoint,
      payload,
    });
    transitionTravelRule("pending", result.status === "acknowledged" ? "sent" : result.status);
    const status = result.status === "acknowledged" ? "acknowledged" : "sent";
    const { rows } = await db.query(
      `UPDATE travel_rule_exchanges
          SET status = $2, protocol_reference = $3, receipt_hash = $4,
              attempt_count = attempt_count + 1, next_attempt_at = NULL,
              last_error_code = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [exchange.id, status, result.reference, result.receiptHash]
    );
    await appendAuditEvent(
      {
        subjectId: transaction.originator_subject_id,
        actorType: "provider",
        actorId: provider.name,
        action: "travel_rule.exchange_sent",
        objectType: "travel_rule_exchange",
        objectId: exchange.id,
        correlationId: input.correlationId || randomUUID(),
        policyJurisdiction: policy.jurisdiction,
        policyVersion: policy.version,
        reasonCode: "THRESHOLD_EXCEEDED",
        decision: status,
        evidenceHash: result.receiptHash,
        metadata: { protocolReference: result.reference },
      },
      db
    );
    return rows[0];
  } catch (error) {
    await db.query(
      `UPDATE travel_rule_exchanges
          SET status = 'failed', attempt_count = attempt_count + 1,
              next_attempt_at = NOW() + INTERVAL '15 minutes',
              last_error_code = $2, updated_at = NOW()
        WHERE id = $1`,
      [exchange.id, error.code || "PROVIDER_ERROR"]
    );
    throw error;
  }
}

async function verifySelfHostedWallet(transactionId, input, actor, db = pool) {
  assertCompliance(
    SELF_HOSTED_METHODS.has(input.verificationMethod),
    400,
    "INVALID_WALLET_EVIDENCE",
    "Unsupported self-hosted-wallet verification method"
  );
  assertCompliance(
    /^[a-f0-9]{64}$/i.test(String(input.evidenceHash || "")),
    400,
    "INVALID_WALLET_EVIDENCE",
    "A SHA-256 evidence hash is required"
  );
  const result = await db.query(
    `SELECT tr.*, ct.originator_subject_id
       FROM travel_rule_exchanges tr
       JOIN compliance_transactions ct ON ct.id = tr.transaction_id
      WHERE tr.transaction_id = $1`,
    [transactionId]
  );
  const exchange = result.rows[0];
  if (!exchange) throw complianceError(404, "EXCHANGE_NOT_FOUND", "Travel Rule exchange not found");
  assertCompliance(
    exchange.counterparty_type === "self_hosted",
    409,
    "NOT_SELF_HOSTED",
    "The transfer is not marked as self-hosted"
  );
  transitionTravelRule(exchange.status, "self_hosted_verified");
  const evidence = {
    method: input.verificationMethod,
    evidenceHash: input.evidenceHash,
    verifiedAt: new Date().toISOString(),
    addressAttested: true,
  };
  const { rows } = await db.query(
    `UPDATE travel_rule_exchanges
        SET status = 'self_hosted_verified', self_hosted_evidence = $2::jsonb,
            receipt_hash = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [exchange.id, JSON.stringify(evidence), sha256(evidence)]
  );
  await appendAuditEvent(
    {
      subjectId: exchange.originator_subject_id,
      actorType: "subject",
      actorId: actor,
      action: "travel_rule.self_hosted_verified",
      objectType: "travel_rule_exchange",
      objectId: exchange.id,
      correlationId: input.correlationId || randomUUID(),
      reasonCode: "WALLET_CONTROL_EVIDENCE",
      decision: "self_hosted_verified",
      evidenceHash: input.evidenceHash,
      metadata: { verificationMethod: input.verificationMethod },
    },
    db
  );
  return rows[0];
}

async function getExchange(transactionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, transaction_id, required, threshold_amount, protocol_name,
            protocol_reference, counterparty_type, status, self_hosted_evidence,
            receipt_hash, attempt_count, next_attempt_at, last_error_code,
            created_at, updated_at
       FROM travel_rule_exchanges
      WHERE transaction_id = $1`,
    [transactionId]
  );
  return rows[0] || null;
}

async function retryDueExchanges(limit = 100, options = {}) {
  const configuredDb = options.db || pool;
  const lockClient = configuredDb.connect ? await configuredDb.connect() : null;
  const db = lockClient || configuredDb;
  if (lockClient) {
    const lock = await lockClient.query(
      "SELECT pg_try_advisory_lock(hashtext('compliance-travel-rule-worker')) AS acquired"
    );
    if (!lock.rows[0]?.acquired) {
      lockClient.release();
      return [];
    }
  }
  const provider = options.travelRuleProvider || providers.travelRule;
  const vault = options.vault || getCryptoVault();
  const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  try {
    const { rows } = await db.query(
      `SELECT tr.*, ct.counterparty_institution, ct.originator_subject_id
         FROM travel_rule_exchanges tr
         JOIN compliance_transactions ct ON ct.id = tr.transaction_id
        WHERE tr.status IN ('pending', 'failed')
          AND tr.counterparty_type = 'institution'
          AND tr.next_attempt_at <= NOW()
        ORDER BY tr.next_attempt_at
        LIMIT $1`,
      [boundedLimit]
    );
    const results = [];
    for (const exchange of rows) {
      try {
        const payload = vault.decrypt(exchange.payload_envelope, {
          transactionId: exchange.transaction_id,
          recordType: "travel-rule",
          schemaVersion: 1,
        });
        const response = await provider.send({
          transactionId: exchange.transaction_id,
          counterpartyInstitution: exchange.counterparty_institution,
          payload,
        });
        await db.query(
          `UPDATE travel_rule_exchanges
              SET status = 'sent', protocol_reference = $2, receipt_hash = $3,
                  attempt_count = attempt_count + 1, next_attempt_at = NULL,
                  last_error_code = NULL, updated_at = NOW()
            WHERE id = $1`,
          [exchange.id, response.reference, response.receiptHash]
        );
        results.push({ id: exchange.id, status: "sent" });
      } catch (error) {
        const delayMinutes = Math.min(1440, 15 * 2 ** Math.min(exchange.attempt_count, 6));
        await db.query(
          `UPDATE travel_rule_exchanges
              SET status = 'failed', attempt_count = attempt_count + 1,
                  next_attempt_at = NOW() + ($2::text || ' minutes')::interval,
                  last_error_code = $3, updated_at = NOW()
            WHERE id = $1`,
          [exchange.id, delayMinutes, error.code || "PROVIDER_ERROR"]
        );
        results.push({ id: exchange.id, status: "failed" });
      }
    }
    return results;
  } finally {
    if (lockClient) {
      await lockClient.query(
        "SELECT pg_advisory_unlock(hashtext('compliance-travel-rule-worker'))"
      );
      lockClient.release();
    }
  }
}

module.exports = {
  buildTravelRulePayload,
  prepareExchange,
  verifySelfHostedWallet,
  getExchange,
  retryDueExchanges,
};
