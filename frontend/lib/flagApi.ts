/**
 * lib/flagApi.ts
 * API functions for feature flag ruleset and evaluation.
 */
import axios from "axios";

const api = axios.create({
  baseURL: (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000") + "",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
  timeout: 5000,
});

export interface FlagRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: Record<string, unknown>;
  allocations: Array<Record<string, unknown>>;
}

export interface FlagOverride {
  id: string;
  context_key: string;
  value: unknown;
}

export interface FlagDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  flag_type: "boolean" | "multivariate" | "percentage";
  default_value: unknown;
  safe_value: unknown;
  enabled: boolean;
  killed_at: string | null;
  targeting_rules: FlagRule[];
  overrides: FlagOverride[];
}

export interface EvaluationContext {
  user_id?: string;
  organisation_id?: string;
  account_age_days?: number;
  locale?: string;
}

export interface EvaluationResult {
  value: unknown;
  variant: string;
  reason: string;
}

/**
 * Fetch the full flag ruleset for client-side evaluation.
 * Cached server-side with 60s TTL.
 */
export async function fetchFlagRuleset(): Promise<FlagDefinition[]> {
  try {
    const { data } = await api.get<{ success: boolean; data: FlagDefinition[] }>("/api/flags/ruleset");
    return data.data || [];
  } catch {
    return [];
  }
}

/**
 * Evaluate a single flag via the server.
 */
export async function evaluateFlag(
  key: string,
  context?: EvaluationContext
): Promise<{ key: string } & EvaluationResult> {
  const { data } = await api.post<{ success: boolean; data: { key: string } & EvaluationResult }>(
    "/api/flags/evaluate",
    { key, context }
  );
  return data.data;
}

/**
 * Evaluate multiple flags via the server.
 */
export async function evaluateFlags(
  keys: string[],
  context?: EvaluationContext
): Promise<Record<string, EvaluationResult>> {
  const { data } = await api.post<{ success: boolean; data: Record<string, EvaluationResult> }>(
    "/api/flags/evaluate-batch",
    { keys, context }
  );
  return data.data;
}
