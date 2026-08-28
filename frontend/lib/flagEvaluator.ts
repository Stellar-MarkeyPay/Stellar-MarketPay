/**
 * lib/flagEvaluator.ts
 * TypeScript wrapper for the shared flag evaluator.
 * Used for client-side evaluation from the cached ruleset.
 */
import {
  evaluateFlag as pureEvaluate,
  type EvaluationContext,
  type EvaluationResult,
  type FlagDefinition,
  type TargetingRule,
  type FlagOverride,
} from "../../shared/evaluator/evaluator";

export type { EvaluationContext, EvaluationResult, FlagDefinition };

/**
 * Evaluate a single flag from a pre-loaded ruleset.
 * Pure function — no network call. Matches server evaluation exactly.
 */
export function evaluateFlag(
  flag: FlagDefinition,
  context: EvaluationContext
): EvaluationResult {
  const flagDef = {
    id: flag.id,
    key: flag.key,
    flag_type: flag.flag_type,
    default_value: flag.default_value,
    safe_value: flag.safe_value,
    enabled: flag.enabled,
    killed_at: flag.killed_at,
    targeting_rules: (flag.targeting_rules || []) as TargetingRule[],
    overrides: (flag.overrides || []) as FlagOverride[],
  };

  return pureEvaluate(flagDef, context);
}

/**
 * Evaluate multiple flags from a ruleset.
 * Returns a map of key → result.
 */
export function evaluateFlags(
  ruleset: FlagDefinition[],
  context: EvaluationContext
): Map<string, EvaluationResult> {
  const results = new Map<string, EvaluationResult>();
  for (const flag of ruleset) {
    results.set(flag.key, evaluateFlag(flag, context));
  }
  return results;
}
