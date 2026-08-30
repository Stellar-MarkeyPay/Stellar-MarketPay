"use strict";

const { sha256 } = require("./canonical");

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function calculateRiskAssessment(input, policy) {
  const reasons = [];
  const tier = Math.max(0, Math.min(3, Number(input.identityTier) || 0));
  let identity = [100, 65, 30, 10][tier];
  if (input.identityStatus === "expired") {
    identity = Math.max(identity, 80);
    reasons.push("IDENTITY_EXPIRED");
  } else if (input.identityStatus === "rejected") {
    identity = 100;
    reasons.push("IDENTITY_REJECTED");
  } else if (input.identityStatus !== "verified") {
    reasons.push("IDENTITY_INCOMPLETE");
  }

  let screening = 0;
  if (input.screeningStatus === "potential_match") {
    screening = 80;
    reasons.push("SCREENING_POTENTIAL_MATCH");
  } else if (input.screeningStatus === "confirmed_match") {
    screening = 100;
    reasons.push("SCREENING_CONFIRMED_MATCH");
  } else if (input.screeningStatus === "provider_error" || !input.screeningStatus) {
    screening = 50;
    reasons.push("SCREENING_UNAVAILABLE");
  }

  const behaviour = clamp(
    Math.max(0, ...(input.monitoringAlerts || []).map((alert) => Number(alert.score) || 0))
  );
  if (behaviour > 0) reasons.push("MONITORING_ALERT");

  const onchain = clamp(input.onchainRiskScore);
  if (onchain >= 60) reasons.push("HIGH_RISK_ONCHAIN_EXPOSURE");

  let geography = clamp(input.geographyRiskScore);
  if (input.geoConflict) {
    geography = Math.max(geography, 70);
    reasons.push("GEO_SIGNAL_CONFLICT");
  }
  if (input.prohibitedTerritory) {
    geography = 100;
    reasons.push("PROHIBITED_TERRITORY");
  }

  const components = { identity, screening, behaviour, onchain, geography };
  const score = Number(
    Object.entries(components)
      .reduce((total, [name, value]) => total + value * policy.riskWeights[name], 0)
      .toFixed(2)
  );
  const thresholds = policy.riskThresholds;
  const band =
    score >= thresholds.critical
      ? "critical"
      : score >= thresholds.high
        ? "high"
        : score >= thresholds.medium
          ? "medium"
          : "low";

  const result = {
    score,
    band,
    components,
    reasons: [...new Set(reasons)],
    modelVersion: "explainable-weighted-v1",
  };
  return { ...result, evidenceHash: sha256({ input, result }) };
}

module.exports = { calculateRiskAssessment };
