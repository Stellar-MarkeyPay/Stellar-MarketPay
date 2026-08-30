/**
 * hooks/useFeatureFlag.ts
 * Convenience hooks for evaluating feature flags.
 */
import { useMemo } from "react";
import { useFlagContext } from "@/contexts/FlagContext";
import type { EvaluationContext, EvaluationResult } from "@/lib/flagApi";

interface UseFeatureFlagResult extends EvaluationResult {
  loading: boolean;
}

/**
 * Evaluate a single feature flag.
 * Returns the evaluation result plus a loading state.
 */
export function useFeatureFlag(
  key: string,
  context?: EvaluationContext
): UseFeatureFlagResult {
  const { evaluate, ready } = useFlagContext();

  const result = useMemo(() => {
    if (!ready) {
      return { value: null, variant: "", reason: "SAFE_DEFAULT", loading: true };
    }
    const r = evaluate(key, context);
    return { ...r, loading: false };
  }, [evaluate, key, context, ready]);

  return result;
}

/**
 * Evaluate multiple feature flags at once.
 * Returns a map of key → result.
 */
export function useFeatureFlags(
  keys: string[],
  context?: EvaluationContext
): { results: Map<string, EvaluationResult>; loading: boolean } {
  const { evaluate, ready } = useFlagContext();

  const results = useMemo(() => {
    if (!ready) return new Map<string, EvaluationResult>();
    const map = new Map<string, EvaluationResult>();
    for (const key of keys) {
      map.set(key, evaluate(key, context));
    }
    return map;
  }, [evaluate, keys, context, ready]);

  return { results, loading: !ready };
}
