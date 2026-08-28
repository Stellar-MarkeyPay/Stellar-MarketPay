/**
 * lib/flagSSR.ts
 * Server-side flag evaluation helper for Next.js getServerSideProps.
 */
import type { EvaluationContext, EvaluationResult } from "@/lib/flagApi";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface SSRFlagResult {
  ruleset: any[];
  evaluation: Record<string, EvaluationResult>;
}

/**
 * Fetch the ruleset and evaluate flags during SSR.
 * Use in getServerSideProps to pass flag values to pages.
 *
 * @example
 * export const getServerSideProps: GetServerSideProps = async (ctx) => {
 *   const flags = await getServerSideFlags(["new_checkout", "dark_mode"], {
 *     user_id: session?.user?.id,
 *     locale: ctx.locale,
 *   });
 *   return { props: { ...flags } };
 * };
 */
export async function getServerSideFlags(
  keys: string[],
  context?: EvaluationContext
): Promise<SSRFlagResult> {
  try {
    const res = await fetch(`${API_URL}/api/flags/evaluate-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys, context }),
    });

    if (!res.ok) {
      return { ruleset: [], evaluation: {} };
    }

    const data = await res.json();
    return {
      ruleset: [],
      evaluation: data.data || {},
    };
  } catch {
    return { ruleset: [], evaluation: {} };
  }
}

/**
 * Fetch the full ruleset during SSR (for client-side evaluation).
 */
export async function getServerSideRuleset(): Promise<any[]> {
  try {
    const res = await fetch(`${API_URL}/api/flags/ruleset`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch {
    return [];
  }
}
