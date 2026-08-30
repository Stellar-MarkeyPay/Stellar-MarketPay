/**
 * contexts/FlagContext.tsx
 * Provides flag evaluation to the React tree.
 * Fetches the ruleset on mount, caches in-memory, refreshes after staleness bound.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fetchFlagRuleset, type FlagDefinition, type EvaluationContext } from "@/lib/flagApi";
import { evaluateFlag as localEvaluate, type EvaluationResult } from "@/lib/flagEvaluator";

const STALENESS_BOUND_MS = Number(process.env.NEXT_PUBLIC_FLAG_STALENESS_BOUND_MS) || 60_000;

interface FlagContextValue {
  /** Evaluate a flag from the cached ruleset */
  evaluate: (key: string, context?: EvaluationContext) => EvaluationResult;
  /** Get the raw value of a flag */
  getValue: (key: string, defaultValue?: unknown) => unknown;
  /** Check if a flag is enabled (boolean true) */
  isEnabled: (key: string) => boolean;
  /** Whether the ruleset has loaded */
  ready: boolean;
  /** The full ruleset */
  ruleset: FlagDefinition[];
}

const FlagContext = createContext<FlagContextValue | undefined>(undefined);

interface FlagProviderProps {
  children: React.ReactNode;
  /** Pre-loaded ruleset for SSR (avoids client fetch on first render) */
  initialRuleset?: FlagDefinition[];
  /** Override evaluation context (e.g., from SSR) */
  context?: EvaluationContext;
}

const EMPTY_RESULT: EvaluationResult = { value: null, variant: "", reason: "FLAG_NOT_FOUND" };

export function FlagProvider({ children, initialRuleset, context: staticContext }: FlagProviderProps) {
  const [ruleset, setRuleset] = useState<FlagDefinition[]>(initialRuleset || []);
  const [ready, setReady] = useState(Boolean(initialRuleset));
  const contextRef = useRef(staticContext || {});
  const lastFetchRef = useRef(Date.now());

  // Fetch ruleset on mount (skip if initialRuleset provided)
  useEffect(() => {
    if (initialRuleset && initialRuleset.length > 0) {
      setReady(true);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const data = await fetchFlagRuleset();
        if (!cancelled) {
          setRuleset(data);
          setReady(true);
          lastFetchRef.current = Date.now();
        }
      } catch {
        if (!cancelled) setReady(true);
      }
    }

    load();

    // Background refresh after staleness bound
    const interval = setInterval(() => {
      if (Date.now() - lastFetchRef.current >= STALENESS_BOUND_MS) {
        load();
      }
    }, STALENESS_BOUND_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [initialRuleset]);

  const evaluate = useCallback(
    (key: string, context?: EvaluationContext): EvaluationResult => {
      const flag = ruleset.find((f) => f.key === key);
      if (!flag) return EMPTY_RESULT;
      return localEvaluate(flag, context || contextRef.current);
    },
    [ruleset]
  );

  const getValue = useCallback(
    (key: string, defaultValue?: unknown): unknown => {
      const result = evaluate(key);
      return result.reason === "FLAG_NOT_FOUND" ? defaultValue : result.value;
    },
    [evaluate]
  );

  const isEnabled = useCallback(
    (key: string): boolean => {
      return evaluate(key).value === true;
    },
    [evaluate]
  );

  return (
    <FlagContext.Provider value={{ evaluate, getValue, isEnabled, ready, ruleset }}>
      {children}
    </FlagContext.Provider>
  );
}

/**
 * Hook to access the flag evaluation context.
 */
export function useFlagContext() {
  const context = useContext(FlagContext);
  if (!context) {
    throw new Error("useFlagContext must be used within a FlagProvider");
  }
  return context;
}
