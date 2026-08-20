/**
 * lib/sorobanFees.ts
 * Fee estimation for Soroban contract calls.
 *
 * Two layers:
 *   1. estimateSorobanFee()   — simulate a specific transaction (per-call precision)
 *   2. fetchDynamicFeesTiers() — pull Slow/Medium/Fast tiers from the backend
 *      gas estimator, which is backed by live Horizon fee_stats data.
 *
 * Use layer 2 to pre-populate the fee picker UI before the user has built
 * a transaction, then layer 1 after simulation to confirm the exact fee.
 */

import { Transaction, SorobanRpc } from "@stellar/stellar-sdk";
import { sorobanServer, NETWORK_PASSPHRASE } from "./stellar";
import { optionalClientEnv } from "./env";

export interface FeeEstimate {
  /** Sum of base fee + Soroban resource fee, in stroops. */
  totalStroops: bigint;
  /** Same value as a human-readable XLM amount (max 7 decimals). */
  totalXlm: string;
  /** USD equivalent — null if no price available. */
  totalUsd: number | null;
  /** Just the resource (CPU/memory/storage) portion. */
  resourceFeeStroops: bigint;
  /** The base inclusion fee that was set on the transaction. */
  inclusionFeeStroops: bigint;
}

const STROOPS_PER_XLM = BigInt(10_000_000);

function stroopsToXlm(stroops: bigint): string {
  const integer = stroops / STROOPS_PER_XLM;
  const fraction = stroops % STROOPS_PER_XLM;
  const fractionStr = fraction.toString().padStart(7, "0").replace(/0+$/, "");
  return fractionStr ? `${integer}.${fractionStr}` : integer.toString();
}

/**
 * Run `simulateTransaction` on a Soroban transaction and return the fee that
 * will actually be charged. Throws a friendly error if simulation fails.
 */
export async function estimateSorobanFee(
  tx: Transaction,
  xlmPriceUsd: number | null
): Promise<FeeEstimate> {
  const sim = await sorobanServer.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Could not estimate fee — the contract rejected the call: ${sim.error}`);
  }

  const resourceFeeStroops = BigInt(sim.minResourceFee || "0");
  const inclusionFeeStroops = BigInt(tx.fee || "0");
  const totalStroops = resourceFeeStroops + inclusionFeeStroops;

  const totalXlm = stroopsToXlm(totalStroops);
  const totalUsd = typeof xlmPriceUsd === "number" ? Number(totalXlm) * xlmPriceUsd : null;

  return {
    totalStroops,
    totalXlm,
    totalUsd,
    resourceFeeStroops,
    inclusionFeeStroops,
  };
}

/**
 * After submission, Horizon/RPC reports the actual fee charged.
 * Used for the post-confirmation log line in the AC.
 */
export async function fetchActualFee(txHash: string): Promise<{
  feeChargedStroops: bigint;
  feeChargedXlm: string;
} | null> {
  try {
    const info = await sorobanServer.getTransaction(txHash);
    if (info.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) return null;
    // Fee data is most reliably parsed from the result envelope.
    const meta = (info as unknown as { resultMetaXdr?: unknown }).resultMetaXdr;
    if (!meta) return null;
    // The envelope stores the fee in the txInternal: rather than parse XDR
    // here we rely on resultXdr/feeCharged when present.
    const feeChargedRaw = (info as unknown as { feeCharged?: string | number }).feeCharged;
    if (feeChargedRaw == null) return null;
    const feeChargedStroops = BigInt(feeChargedRaw);
    return {
      feeChargedStroops,
      feeChargedXlm: stroopsToXlm(feeChargedStroops),
    };
  } catch {
    return null;
  }
}

/** Human label for a contract call, used in the confirmation modal. */
export function describeContractCall(fnName: string): string {
  const labels: Record<string, string> = {
    create_escrow: "Lock job budget in escrow",
    start_work: "Mark job as in progress",
    release_escrow: "Release escrow to freelancer",
    release_with_conversion: "Release escrow with currency conversion",
    refund_escrow: "Refund escrow to client",
    raise_dispute: "Raise dispute on escrow",
    mint_certificate: "Mint completion certificate",
    cast_vote: "Cast governance vote",
  };
  return labels[fnName] || fnName.replace(/_/g, " ");
}

export { stroopsToXlm, NETWORK_PASSPHRASE };

// ─── Dynamic fee tiers (from backend gas estimator) ──────────────────────────

/** A single fee tier returned by the backend gas estimator. */
export interface FeeTier {
  /** Total fee in stroops (as string — BigInt not serialisable over JSON). */
  feeStroops: string;
  /** Human-readable XLM amount, e.g. "0.0001". */
  feeXlm: string;
  /** "Slow" | "Medium" | "Fast" */
  label: "Slow" | "Medium" | "Fast";
  /** One-line user-facing description of expected wait time. */
  description: string;
  /** Expected ledgers until inclusion. */
  estimatedWaitLedgers: number;
}

export interface DynamicFeeEstimate {
  slow: FeeTier;
  medium: FeeTier;
  fast: FeeTier;
  /** True when fees are spiking above recent rolling average. */
  spikeDetected: boolean;
  /** ISO timestamp of the Horizon fetch (may be older if served from cache). */
  fetchedAt: string;
  /** True when the backend served this from its 15-second cache. */
  cached: boolean;
}

const API_BASE = optionalClientEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000");

/**
 * Fetch Slow / Medium / Fast fee tier estimates from the backend gas estimator.
 *
 * The backend caches results for 15 seconds so this is safe to call on every
 * page render — it won't hammer Horizon.
 *
 * @param forceRefresh  When true, tells the backend to bypass its cache.
 */
export async function fetchDynamicFeeTiers(forceRefresh = false): Promise<DynamicFeeEstimate> {
  const path = forceRefresh ? "/api/gas-estimate/refresh" : "/api/gas-estimate";
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    // Allow browsers to use their HTTP cache for the 15-second window too.
    cache: forceRefresh ? "no-store" : "default",
  });

  if (!res.ok) {
    throw new Error(`Gas estimator request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { success: boolean; data: DynamicFeeEstimate };
  if (!json.success || !json.data) {
    throw new Error("Gas estimator returned an unexpected response shape");
  }

  return json.data;
}

/**
 * Pick the recommended tier fee in stroops for a given preference.
 * Useful when building a transaction and you want a single fee value.
 *
 * @param estimate  Result from fetchDynamicFeeTiers()
 * @param tier      User preference — defaults to "medium"
 * @returns fee in stroops as a number (safe for Stellar SDK's `fee` field)
 */
export function pickTierFeeStroops(
  estimate: DynamicFeeEstimate,
  tier: "slow" | "medium" | "fast" = "medium"
): number {
  return Number(estimate[tier].feeStroops);
}
