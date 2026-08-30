/**
 * shared/evaluator/evaluator.d.ts
 * TypeScript declarations for the shared flag evaluator.
 */

export type FlagType = "boolean" | "multivariate" | "percentage";

export type Allocation =
  | { variant: string; rollout_percentage: number }
  | { variant: string; weight: number };

export interface TargetingConditions {
  user_id?: string[];
  organisation_id?: string[];
  account_age_days?: { min?: number; max?: number };
  locale?: string[];
}

export interface TargetingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: TargetingConditions;
  allocations: Allocation[];
}

export interface FlagOverride {
  context_key: string;
  value: unknown;
}

export interface FlagDefinition {
  id: string;
  key: string;
  flag_type: FlagType;
  default_value: unknown;
  safe_value: unknown;
  enabled: boolean;
  killed_at: string | null;
  targeting_rules: TargetingRule[];
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
  reason:
    | "FLAG_DISABLED"
    | "FLAG_KILLED"
    | "OVERRIDE"
    | "TARGETING_RULE"
    | "DEFAULT"
    | "SAFE_DEFAULT"
    | "FLAG_NOT_FOUND";
}

export function fnv1a(input: string): number;
export function percentageBucket(userId: string, flagKey: string): number;
export function evaluateFlag(flag: FlagDefinition, context: EvaluationContext): EvaluationResult;
export function evaluateFlags(
  flags: FlagDefinition[],
  context: EvaluationContext
): Map<string, EvaluationResult>;
