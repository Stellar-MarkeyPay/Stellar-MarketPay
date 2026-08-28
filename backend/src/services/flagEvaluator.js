/**
 * src/services/flagEvaluator.js
 * Wraps the shared evaluator with DB/Redis lookups and safe-default fallback.
 */
"use strict";

const { evaluateFlag: pureEvaluate } = require("../../../shared/evaluator");
const flagService = require("./flagService");

/**
 * Evaluate a single flag by key against a context.
 * Falls back to safe defaults if the flag service is unreachable.
 */
async function evaluateFlag(flagKey, context) {
  if (flagService.isCircuitOpen()) {
    return {
      value: null,
      variant: "",
      reason: "SAFE_DEFAULT",
    };
  }

  try {
    const flag = await flagService.getFlagByKey(flagKey);
    if (!flag) {
      return { value: null, variant: "", reason: "FLAG_NOT_FOUND" };
    }

    const ruleTargetingRules = await flagService.listRules(flag.id);
    const overrides = await flagService.listOverrides(flag.id);

    const flagDef = {
      id: flag.id,
      key: flag.key,
      flag_type: flag.flag_type,
      default_value: typeof flag.default_value === "string" ? JSON.parse(flag.default_value) : flag.default_value,
      safe_value: typeof flag.safe_value === "string" ? JSON.parse(flag.safe_value) : flag.safe_value,
      enabled: flag.enabled,
      killed_at: flag.killed_at,
      targeting_rules: ruleTargetingRules.map((r) => ({
        ...r,
        conditions: typeof r.conditions === "string" ? JSON.parse(r.conditions) : r.conditions,
        allocations: typeof r.allocations === "string" ? JSON.parse(r.allocations) : r.allocations,
      })),
      overrides: overrides.map((o) => ({
        ...o,
        value: typeof o.value === "string" ? JSON.parse(o.value) : o.value,
      })),
    };

    const result = pureEvaluate(flagDef, context);

    // Log exposure in background (non-blocking)
    flagService.logExposure({
      flag_id: flag.id,
      variant: result.variant,
      user_id: context.user_id,
      context,
    }).catch(() => {});

    // Update last_evaluated_at in background
    flagService.updateLastEvaluated(flag.id).catch(() => {});

    return result;
  } catch (err) {
    // Service unreachable: fall back to safe defaults
    return {
      value: null,
      variant: "",
      reason: "SAFE_DEFAULT",
    };
  }
}

/**
 * Evaluate multiple flags from a pre-loaded ruleset (for batch evaluation).
 * No DB lookups — uses the ruleset fetched and cached by getRuleset().
 */
async function evaluateFlagsFromRuleset(ruleset, context) {
  if (!ruleset || !Array.isArray(ruleset)) {
    return {};
  }

  const results = {};
  for (const flag of ruleset) {
    const flagDef = {
      id: flag.id,
      key: flag.key,
      flag_type: flag.flag_type,
      default_value: flag.default_value,
      safe_value: flag.safe_value,
      enabled: flag.enabled,
      killed_at: flag.killed_at,
      targeting_rules: flag.targeting_rules || [],
      overrides: flag.overrides || [],
    };

    const result = pureEvaluate(flagDef, context);
    results[flag.key] = result;

    // Log exposure in background
    flagService.logExposure({
      flag_id: flag.id,
      variant: result.variant,
      user_id: context.user_id,
      context,
    }).catch(() => {});
  }

  return results;
}

/**
 * Get the cached ruleset. Falls back to empty array on error.
 */
async function getRuleset() {
  try {
    return await flagService.getRuleset();
  } catch {
    return [];
  }
}

module.exports = {
  evaluateFlag,
  evaluateFlagsFromRuleset,
  getRuleset,
};
