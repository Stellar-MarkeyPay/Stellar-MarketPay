"use strict";

const { sha256 } = require("./canonical");
const { assertCompliance } = require("./errors");

const ALLOWED_TOP_LEVEL = new Set([
  "mode",
  "prohibitedTerritories",
  "tierLimits",
  "screeningCadenceDays",
  "verificationValidityDays",
  "retentionDays",
  "travelRule",
  "monitoring",
  "riskWeights",
  "riskThresholds",
  "geo",
  "reports",
]);

const DEFAULT_RULES = Object.freeze({
  mode: "observe",
  prohibitedTerritories: [],
  tierLimits: { 0: "0", 1: "1000", 2: "10000", 3: "100000" },
  screeningCadenceDays: 1,
  verificationValidityDays: 365,
  retentionDays: 1825,
  travelRule: {
    threshold: "1000",
    requiredFields: ["fullName", "account", "country"],
  },
  monitoring: {
    structuring: {
      windowHours: 24,
      singleThreshold: "1000",
      aggregateThreshold: "3000",
      minimumCount: 3,
    },
    velocity: { windowMinutes: 60, maxCount: 10, maxAmount: "10000" },
    counterparty: { windowDays: 30, newCounterpartyAmount: "5000", fanOutCount: 10 },
  },
  riskWeights: {
    identity: 0.25,
    screening: 0.3,
    behaviour: 0.2,
    onchain: 0.2,
    geography: 0.05,
  },
  riskThresholds: { medium: 35, high: 60, critical: 80 },
  geo: { minimumConfidence: 0.8, conflictAction: "review" },
  reports: ["SAR_JSON"],
});

function numberInRange(value, name, minimum, maximum) {
  const number = Number(value);
  assertCompliance(
    Number.isFinite(number) && number >= minimum && number <= maximum,
    400,
    "INVALID_POLICY",
    `${name} must be between ${minimum} and ${maximum}`
  );
  return number;
}

function positiveAmount(value, name, allowZero = false) {
  const amount = numberInRange(
    value,
    name,
    allowZero ? 0 : Number.EPSILON,
    Number.MAX_SAFE_INTEGER
  );
  return String(amount);
}

function validateRuleSet(input) {
  assertCompliance(
    input && typeof input === "object" && !Array.isArray(input),
    400,
    "INVALID_POLICY",
    "rules must be an object"
  );

  for (const key of Object.keys(input)) {
    assertCompliance(
      ALLOWED_TOP_LEVEL.has(key),
      400,
      "INVALID_POLICY",
      `Unknown policy field: ${key}`
    );
  }

  const source = JSON.parse(JSON.stringify({ ...DEFAULT_RULES, ...input }));
  assertCompliance(
    ["observe", "enforce"].includes(source.mode),
    400,
    "INVALID_POLICY",
    "mode must be observe or enforce"
  );

  assertCompliance(
    Array.isArray(source.prohibitedTerritories) &&
      source.prohibitedTerritories.every((code) => /^[A-Z]{2}$/.test(code)),
    400,
    "INVALID_POLICY",
    "prohibitedTerritories must contain ISO alpha-2 country codes"
  );
  source.prohibitedTerritories = [...new Set(source.prohibitedTerritories)].sort();

  assertCompliance(
    source.tierLimits && typeof source.tierLimits === "object",
    400,
    "INVALID_POLICY",
    "tierLimits are required"
  );
  source.tierLimits = Object.fromEntries(
    [0, 1, 2, 3].map((tier) => [
      tier,
      positiveAmount(source.tierLimits[tier], `tierLimits.${tier}`, true),
    ])
  );
  for (let tier = 1; tier <= 3; tier += 1) {
    assertCompliance(
      Number(source.tierLimits[tier]) >= Number(source.tierLimits[tier - 1]),
      400,
      "INVALID_POLICY",
      "tier limits must be monotonic"
    );
  }

  source.screeningCadenceDays = numberInRange(
    source.screeningCadenceDays,
    "screeningCadenceDays",
    1,
    365
  );
  source.verificationValidityDays = numberInRange(
    source.verificationValidityDays,
    "verificationValidityDays",
    1,
    3650
  );
  source.retentionDays = numberInRange(source.retentionDays, "retentionDays", 1, 36500);

  assertCompliance(
    source.travelRule && Array.isArray(source.travelRule.requiredFields),
    400,
    "INVALID_POLICY",
    "travelRule.requiredFields must be an array"
  );
  source.travelRule.threshold = positiveAmount(
    source.travelRule.threshold,
    "travelRule.threshold",
    true
  );
  source.travelRule.requiredFields = [...new Set(source.travelRule.requiredFields.map(String))];

  const structuring = source.monitoring?.structuring;
  const velocity = source.monitoring?.velocity;
  const counterparty = source.monitoring?.counterparty;
  assertCompliance(
    structuring && velocity && counterparty,
    400,
    "INVALID_POLICY",
    "All monitoring rule groups are required"
  );
  structuring.windowHours = numberInRange(
    structuring.windowHours,
    "structuring.windowHours",
    1,
    720
  );
  structuring.singleThreshold = positiveAmount(
    structuring.singleThreshold,
    "structuring.singleThreshold"
  );
  structuring.aggregateThreshold = positiveAmount(
    structuring.aggregateThreshold,
    "structuring.aggregateThreshold"
  );
  structuring.minimumCount = numberInRange(
    structuring.minimumCount,
    "structuring.minimumCount",
    2,
    1000
  );
  velocity.windowMinutes = numberInRange(
    velocity.windowMinutes,
    "velocity.windowMinutes",
    1,
    43200
  );
  velocity.maxCount = numberInRange(velocity.maxCount, "velocity.maxCount", 1, 10000);
  velocity.maxAmount = positiveAmount(velocity.maxAmount, "velocity.maxAmount");
  counterparty.windowDays = numberInRange(
    counterparty.windowDays,
    "counterparty.windowDays",
    1,
    3650
  );
  counterparty.newCounterpartyAmount = positiveAmount(
    counterparty.newCounterpartyAmount,
    "counterparty.newCounterpartyAmount"
  );
  counterparty.fanOutCount = numberInRange(
    counterparty.fanOutCount,
    "counterparty.fanOutCount",
    2,
    10000
  );

  const weightNames = ["identity", "screening", "behaviour", "onchain", "geography"];
  let weightTotal = 0;
  for (const name of weightNames) {
    source.riskWeights[name] = numberInRange(source.riskWeights[name], `riskWeights.${name}`, 0, 1);
    weightTotal += source.riskWeights[name];
  }
  assertCompliance(
    Math.abs(weightTotal - 1) < 0.000001,
    400,
    "INVALID_POLICY",
    "riskWeights must sum to 1"
  );

  const thresholds = source.riskThresholds;
  thresholds.medium = numberInRange(thresholds.medium, "riskThresholds.medium", 0, 100);
  thresholds.high = numberInRange(thresholds.high, "riskThresholds.high", 0, 100);
  thresholds.critical = numberInRange(thresholds.critical, "riskThresholds.critical", 0, 100);
  assertCompliance(
    thresholds.medium < thresholds.high && thresholds.high < thresholds.critical,
    400,
    "INVALID_POLICY",
    "risk thresholds must be strictly increasing"
  );

  source.geo.minimumConfidence = numberInRange(
    source.geo.minimumConfidence,
    "geo.minimumConfidence",
    0,
    1
  );
  assertCompliance(
    ["review", "deny"].includes(source.geo.conflictAction),
    400,
    "INVALID_POLICY",
    "geo.conflictAction must be review or deny"
  );
  assertCompliance(
    Array.isArray(source.reports) && source.reports.every((name) => typeof name === "string"),
    400,
    "INVALID_POLICY",
    "reports must be an array"
  );

  return source;
}

function policyChecksum(rules) {
  return sha256(validateRuleSet(rules));
}

module.exports = { DEFAULT_RULES, validateRuleSet, policyChecksum };
