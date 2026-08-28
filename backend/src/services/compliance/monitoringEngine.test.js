"use strict";

const { evaluateTransaction } = require("./monitoringEngine");
const { calculateRiskAssessment } = require("./riskEngine");
const { DEFAULT_RULES, validateRuleSet } = require("./policySchema");

const rules = validateRuleSet(DEFAULT_RULES);

function tx(overrides = {}) {
  return {
    id: overrides.id || `tx-${Math.random()}`,
    idempotencyKey: overrides.idempotencyKey || `idem-${Math.random()}`,
    originatorSubjectId: "subject-1",
    beneficiaryAddress: overrides.beneficiaryAddress || "GCOUNTERPARTY",
    amount: overrides.amount || 100,
    occurredAt: overrides.occurredAt || "2026-08-27T12:00:00.000Z",
  };
}

describe("transaction monitoring and risk scoring", () => {
  it("detects structuring from a rolling sum of individually sub-threshold transfers", () => {
    const history = [
      tx({ id: "a", amount: 900, occurredAt: "2026-08-27T10:00:00.000Z" }),
      tx({ id: "b", amount: 900, occurredAt: "2026-08-27T11:00:00.000Z" }),
    ];
    const alerts = evaluateTransaction(tx({ id: "c", amount: 1200 }), history, {
      ...rules.monitoring,
      structuring: { ...rules.monitoring.structuring, singleThreshold: "1500" },
    });

    expect(alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleCode: "STRUCTURING_ROLLING_SUM" })])
    );
    expect(alerts[0].evidence.aggregateAmount).toBe("3000.0000000");
  });

  it("detects velocity and unusual counterparty fan-out without duplicate rule keys", () => {
    const history = Array.from({ length: 10 }, (_, index) =>
      tx({
        id: `history-${index}`,
        amount: 1100,
        beneficiaryAddress: `G${index}`,
        occurredAt: `2026-08-27T11:${String(index).padStart(2, "0")}:00.000Z`,
      })
    );
    const alerts = evaluateTransaction(
      tx({ id: "current", amount: 6000, beneficiaryAddress: "GNEW" }),
      history,
      rules.monitoring
    );

    expect(new Set(alerts.map((alert) => alert.ruleCode))).toEqual(
      new Set(["TRANSFER_VELOCITY", "UNUSUAL_NEW_COUNTERPARTY", "COUNTERPARTY_FAN_OUT"])
    );
    expect(new Set(alerts.map((alert) => alert.dedupeKey)).size).toBe(alerts.length);
  });

  it("combines explainable identity, behavior, on-chain and geography components", () => {
    const assessment = calculateRiskAssessment(
      {
        identityTier: 1,
        identityStatus: "expired",
        screeningStatus: "potential_match",
        monitoringAlerts: [{ score: 82 }],
        onchainRiskScore: 90,
        geographyRiskScore: 70,
        geoConflict: true,
      },
      rules
    );

    expect(assessment.score).toBeGreaterThanOrEqual(80);
    expect(assessment.band).toBe("critical");
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([
        "IDENTITY_EXPIRED",
        "SCREENING_POTENTIAL_MATCH",
        "MONITORING_ALERT",
        "HIGH_RISK_ONCHAIN_EXPOSURE",
        "GEO_SIGNAL_CONFLICT",
      ])
    );
    expect(assessment.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
