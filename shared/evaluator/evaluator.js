/**
 * shared/evaluator/evaluator.js
 * Pure, deterministic flag evaluation engine.
 * Shared between backend (CJS) and frontend (ESM) so they always agree.
 *
 * @module evaluator
 */

// ─── FNV-1a Hash ──────────────────────────────────────────────────────────────

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * FNV-1a hash: fast, well-distributed, deterministic.
 * Returns an unsigned 32-bit integer.
 * @param {string} input
 * @returns {number}
 */
function fnv1a(input) {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Deterministic percentage assignment: hash(userId:flagKey) % 100.
 * Returns a number in [0, 99].
 * @param {string} userId
 * @param {string} flagKey
 * @returns {number}
 */
function percentageBucket(userId, flagKey) {
  return fnv1a(`${userId}:${flagKey}`) % 100;
}

// ─── Condition Matching ───────────────────────────────────────────────────────

/**
 * Check if targeting conditions match the evaluation context.
 * @param {object} conditions
 * @param {object} context
 * @returns {boolean}
 */
function matchesConditions(conditions, context) {
  if (!conditions) return true;

  if (conditions.user_id && context.user_id) {
    if (!conditions.user_id.includes(context.user_id)) return false;
  }

  if (conditions.organisation_id && context.organisation_id) {
    if (!conditions.organisation_id.includes(context.organisation_id)) return false;
  }

  if (conditions.locale && context.locale) {
    if (!conditions.locale.includes(context.locale)) return false;
  }

  if (conditions.account_age_days && context.account_age_days != null) {
    const { min, max } = conditions.account_age_days;
    if (min != null && context.account_age_days < min) return false;
    if (max != null && context.account_age_days > max) return false;
  }

  return true;
}

// ─── Allocation Resolution ────────────────────────────────────────────────────

/**
 * Resolve which variant a user gets based on allocations.
 * @param {Array} allocations
 * @param {string} flagKey
 * @param {object} context
 * @returns {{ variant: string, value: * } | null}
 */
function resolveAllocation(allocations, flagKey, context) {
  if (!allocations || allocations.length === 0) return null;

  const first = allocations[0];

  // Percentage rollout: single allocation with rollout_percentage
  if ("rollout_percentage" in first && allocations.length === 1) {
    const userId = context.user_id || "anonymous";
    const bucket = percentageBucket(userId, flagKey);
    if (bucket < first.rollout_percentage) {
      return { variant: first.variant, value: true };
    }
    return null;
  }

  // Weighted allocation: pick variant based on cumulative weight
  const totalWeight = allocations.reduce(
    (sum, a) => sum + ("weight" in a ? a.weight : 0),
    0
  );
  if (totalWeight <= 0) return null;

  const userId = context.user_id || "anonymous";
  const bucket = percentageBucket(userId, flagKey);
  let cumulative = 0;

  for (const alloc of allocations) {
    if ("weight" in alloc) {
      cumulative += alloc.weight;
      if (bucket < (cumulative / totalWeight) * 100) {
        return { variant: alloc.variant, value: alloc.variant };
      }
    }
  }

  return null;
}

// ─── Main Evaluation ──────────────────────────────────────────────────────────

/**
 * Pure flag evaluation. No I/O, no side effects.
 * Both client and server call this exact function.
 *
 * @param {object} flag - FlagDefinition
 * @param {object} context - EvaluationContext
 * @returns {{ value: *, variant: string, reason: string }}
 */
function evaluateFlag(flag, context) {
  if (!flag) {
    return { value: null, variant: "", reason: "FLAG_NOT_FOUND" };
  }

  // Killed flag: always return safe value
  if (flag.killed_at) {
    return { value: flag.safe_value, variant: "killed", reason: "FLAG_KILLED" };
  }

  // Disabled flag: return safe default
  if (!flag.enabled) {
    return { value: flag.safe_value, variant: "disabled", reason: "FLAG_DISABLED" };
  }

  // Check overrides first (exact match on context_key)
  if (context.user_id && flag.overrides) {
    const override = flag.overrides.find((o) => o.context_key === context.user_id);
    if (override) {
      return { value: override.value, variant: "override", reason: "OVERRIDE" };
    }
  }

  // Evaluate targeting rules sorted by priority (ascending = higher priority first)
  const sortedRules = [...(flag.targeting_rules || [])]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (matchesConditions(rule.conditions, context)) {
      const resolved = resolveAllocation(rule.allocations, flag.key, context);
      if (resolved) {
        return { value: resolved.value, variant: resolved.variant, reason: "TARGETING_RULE" };
      }
    }
  }

  // No rule matched: return default value
  return { value: flag.default_value, variant: "default", reason: "DEFAULT" };
}

/**
 * Evaluate multiple flags at once. Returns a Map of key → result.
 *
 * @param {Array} flags
 * @param {object} context
 * @returns {Map<string, object>}
 */
function evaluateFlags(flags, context) {
  const results = new Map();
  for (const flag of flags) {
    results.set(flag.key, evaluateFlag(flag, context));
  }
  return results;
}

module.exports = {
  fnv1a,
  percentageBucket,
  evaluateFlag,
  evaluateFlags,
};
