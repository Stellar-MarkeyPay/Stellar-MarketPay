/**
 * src/services/gasEstimatorService.js
 *
 * Dynamic Gas Price Estimator for Soroban (Issue: Dynamic Gas Price Estimator)
 *
 * Fetches recent fee stats from Stellar Horizon, computes percentile-based
 * fee tiers (Slow / Medium / Fast), and includes a simple spike-prediction
 * heuristic based on recent fee trend.
 *
 * Architecture:
 *  - fetchFeeStats()     — raw data from Horizon /fee_stats endpoint
 *  - computeTiers()      — percentile math → { slow, medium, fast }
 *  - detectSpike()       — compares current p50 against rolling history
 *  - getGasEstimate()    — public entry point, caches result for 15 s
 */
"use strict";

const axios = require("axios");
const cache = require("./cacheService");

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY = "gas:estimate:v1";
const CACHE_TTL_SECONDS = 15; // refresh every 15 s
const HISTORY_CACHE_KEY = "gas:history:v1";
const HISTORY_TTL_SECONDS = 600; // keep 10 min of rolling history
const MAX_HISTORY_POINTS = 40; // ~10 min @ 15 s cadence
const SPIKE_MULTIPLIER = 1.5; // p50 > 1.5× rolling avg → spike

// Minimum inclusion fee floor enforced by the Stellar protocol (100 stroops).
const BASE_FEE_FLOOR = 100n;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a fee value that Horizon may return as a string or number.
 *
 * @param {string|number|undefined} value
 * @returns {bigint}
 */
function parseFee(value: any) {
  if (value == null) return BASE_FEE_FLOOR;
  const n = BigInt(Math.round(Number(value)));
  return n < BASE_FEE_FLOOR ? BASE_FEE_FLOOR : n;
}

/**
 * Convert stroops (bigint) to a human-readable XLM string (7 decimals max).
 *
 * @param {bigint} stroops
 * @returns {string}
 */
function stroopsToXlm(stroops: any) {
  const STROOPS_PER_XLM = 10_000_000n;
  const integer = stroops / STROOPS_PER_XLM;
  const fraction = stroops % STROOPS_PER_XLM;
  const fractionStr = fraction.toString().padStart(7, "0").replace(/0+$/, "");
  return fractionStr ? `${integer}.${fractionStr}` : integer.toString();
}

/**
 * Serialise a tier object so it can be stored in Redis (which requires
 * plain strings — BigInt is not JSON-serialisable by default).
 *
 * @param {import('./gasEstimatorService').FeeTier} tier
 */
function serialiseTier(tier: any) {
  return {
    feeStroops: tier.feeStroops.toString(),
    feeXlm: tier.feeXlm,
    label: tier.label,
    description: tier.description,
    estimatedWaitLedgers: tier.estimatedWaitLedgers,
  };
}

/**
 * Deserialise a tier from Redis back to the canonical shape.
 *
 * @param {ReturnType<typeof serialiseTier>} raw
 * @returns {import('./gasEstimatorService').FeeTier}
 */
function deserialiseTier(raw: any) {
  return {
    feeStroops: BigInt(raw.feeStroops),
    feeXlm: raw.feeXlm,
    label: raw.label,
    description: raw.description,
    estimatedWaitLedgers: raw.estimatedWaitLedgers,
  };
}

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Fetch `/fee_stats` from Horizon.
 *
 * Returns the raw Horizon fee_stats object.
 * @param {string} horizonUrl
 */
async function fetchFeeStats(horizonUrl: any) {
  const url = `${horizonUrl.replace(/\/$/, "")}/fee_stats`;
  const { data } = await axios.get(url, { timeout: 8000 });
  return data;
}

/**
 * Compute the three fee tiers from a Horizon fee_stats response.
 *
 * Horizon exposes percentiles for both the inclusion fee and the Soroban
 * resource fee bucket.  We use:
 *   slow   → p10 inclusion + p10 resource
 *   medium → p50 inclusion + p50 resource   (the "safe default")
 *   fast   → p95 inclusion + p90 resource   (will land in next 1–2 ledgers)
 *
 * @param {object} feeStats   Raw Horizon /fee_stats response
 * @returns {{ slow: FeeTier, medium: FeeTier, fast: FeeTier }}
 */
function computeTiers(feeStats: any) {
  // Inclusion fee percentiles (from charged_fees.base_fee percentiles)
  const ip = feeStats?.fee_charged || {};
  const inclusion = {
    p10: parseFee(ip.p10),
    p50: parseFee(ip.p50),
    p95: parseFee(ip.p95),
  };

  // Soroban resource fee percentiles (soroban_inclusion_fee_charged if present)
  const sp = feeStats?.soroban_inclusion_fee_charged || {};
  const resource = {
    p10: parseFee(sp.p10 ?? ip.p10),
    p50: parseFee(sp.p50 ?? ip.p50),
    p90: parseFee(sp.p90 ?? ip.p95),
  };

  const slowFee = inclusion.p10 + resource.p10;
  const medFee = inclusion.p50 + resource.p50;
  const fastFee = inclusion.p95 + resource.p90;

  return {
    slow: {
      feeStroops: slowFee,
      feeXlm: stroopsToXlm(slowFee),
      label: "Slow",
      description: "Likely to confirm within ~6 ledgers (~30 s)",
      estimatedWaitLedgers: 6,
    },
    medium: {
      feeStroops: medFee,
      feeXlm: stroopsToXlm(medFee),
      label: "Medium",
      description: "Likely to confirm within ~2 ledgers (~10 s)",
      estimatedWaitLedgers: 2,
    },
    fast: {
      feeStroops: fastFee,
      feeXlm: stroopsToXlm(fastFee),
      label: "Fast",
      description: "Likely to confirm within the next ledger (~5 s)",
      estimatedWaitLedgers: 1,
    },
  };
}

/**
 * Persist the current p50 in a rolling history array (stored in Redis).
 * Returns true when the estimator detects a fee spike.
 *
 * @param {bigint} currentP50Stroops
 * @returns {Promise<boolean>} spikeDetected
 */
async function detectSpike(currentP50Stroops: any) {
  const history = (await cache.get(HISTORY_CACHE_KEY)) || [];
  const current = Number(currentP50Stroops);

  history.push(current);
  if (history.length > MAX_HISTORY_POINTS) history.shift();

  await cache.set(HISTORY_CACHE_KEY, history, HISTORY_TTL_SECONDS);

  if (history.length < 3) return false; // not enough data yet

  const rollingAvg =
    history.slice(0, -1).reduce((s: any, v: any) => s + v, 0) / (history.length - 1);
  return current > rollingAvg * SPIKE_MULTIPLIER;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} FeeTier
 * @property {bigint}  feeStroops            Total fee in stroops
 * @property {string}  feeXlm                Human-readable XLM amount
 * @property {string}  label                 "Slow" | "Medium" | "Fast"
 * @property {string}  description           User-facing description
 * @property {number}  estimatedWaitLedgers  Expected ledgers until inclusion
 */

/**
 * @typedef {object} GasEstimate
 * @property {FeeTier} slow
 * @property {FeeTier} medium
 * @property {FeeTier} fast
 * @property {boolean} spikeDetected   Fee spike alert flag
 * @property {string}  fetchedAt       ISO timestamp
 * @property {boolean} cached          True when this response was served from cache
 */

/**
 * Retrieve gas estimates.  Caches results for CACHE_TTL_SECONDS to avoid
 * hammering Horizon on every page load.
 *
 * @param {{ horizonUrl?: string, bustCache?: boolean }} [opts]
 * @returns {Promise<GasEstimate>}
 */
async function getGasEstimate(opts: any = {}) {
  const {
    horizonUrl = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org",
    bustCache = false,
  } = opts;

  if (!bustCache) {
    const cached = await cache.get(CACHE_KEY);
    if (cached) {
      return {
        slow: deserialiseTier(cached.slow),
        medium: deserialiseTier(cached.medium),
        fast: deserialiseTier(cached.fast),
        spikeDetected: cached.spikeDetected,
        fetchedAt: cached.fetchedAt,
        cached: true,
      };
    }
  }

  const feeStats = await fetchFeeStats(horizonUrl);
  const tiers = computeTiers(feeStats);
  const spikeDetected = await detectSpike(tiers.medium.feeStroops);
  const fetchedAt = new Date().toISOString();

  const payload = {
    slow: serialiseTier(tiers.slow),
    medium: serialiseTier(tiers.medium),
    fast: serialiseTier(tiers.fast),
    spikeDetected,
    fetchedAt,
  };

  await cache.set(CACHE_KEY, payload, CACHE_TTL_SECONDS);

  return { ...tiers, spikeDetected, fetchedAt, cached: false };
}

module.exports = {
  getGasEstimate,
  // Exported for unit tests
  computeTiers,
  detectSpike,
  parseFee,
  stroopsToXlm,
  fetchFeeStats,
  CACHE_KEY,
  CACHE_TTL_SECONDS,
  SPIKE_MULTIPLIER,
};

export {};
