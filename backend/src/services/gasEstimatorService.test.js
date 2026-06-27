"use strict";

/**
 * Tests for gasEstimatorService
 *
 * All external I/O (axios, cacheService) is mocked so tests remain fast and
 * deterministic — no real network calls are made.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("axios");
jest.mock("./cacheService", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
}));

const axios = require("axios");
const cacheService = require("./cacheService");

const {
  computeTiers,
  parseFee,
  stroopsToXlm,
  getGasEstimate,
} = require("./gasEstimatorService");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal Horizon /fee_stats shape used across multiple tests. */
function makeFeeStats(overrides = {}) {
  return {
    fee_charged: {
      p10: "150",
      p50: "400",
      p95: "1000",
      ...overrides.fee_charged,
    },
    soroban_inclusion_fee_charged: {
      p10: "200",
      p50: "600",
      p90: "1500",
      ...overrides.soroban_inclusion_fee_charged,
    },
    ...overrides,
  };
}

// ─── parseFee ─────────────────────────────────────────────────────────────────

describe("parseFee", () => {
  it("converts a string number to bigint", () => {
    expect(parseFee("500")).toBe(500n);
  });

  it("enforces the 100-stroop floor", () => {
    expect(parseFee("50")).toBe(100n);
    expect(parseFee("0")).toBe(100n);
  });

  it("returns the floor for null/undefined", () => {
    expect(parseFee(null)).toBe(100n);
    expect(parseFee(undefined)).toBe(100n);
  });

  it("handles numeric input", () => {
    expect(parseFee(300)).toBe(300n);
  });
});

// ─── stroopsToXlm ─────────────────────────────────────────────────────────────

describe("stroopsToXlm", () => {
  it("converts 10_000_000 stroops → '1'", () => {
    expect(stroopsToXlm(10_000_000n)).toBe("1");
  });

  it("converts 1 stroop → '0.0000001'", () => {
    expect(stroopsToXlm(1n)).toBe("0.0000001");
  });

  it("trims trailing zeroes from the fractional part", () => {
    expect(stroopsToXlm(1_500_000n)).toBe("0.15");
  });

  it("handles zero", () => {
    expect(stroopsToXlm(0n)).toBe("0");
  });
});

// ─── computeTiers ────────────────────────────────────────────────────────────

describe("computeTiers", () => {
  it("returns three tiers with correct labels", () => {
    const tiers = computeTiers(makeFeeStats());
    expect(tiers.slow.label).toBe("Slow");
    expect(tiers.medium.label).toBe("Medium");
    expect(tiers.fast.label).toBe("Fast");
  });

  it("slow fee = p10_inclusion + p10_resource", () => {
    const tiers = computeTiers(makeFeeStats());
    // p10 inclusion=150, p10 resource=200 → 350
    expect(tiers.slow.feeStroops).toBe(350n);
  });

  it("medium fee = p50_inclusion + p50_resource", () => {
    const tiers = computeTiers(makeFeeStats());
    // p50 inclusion=400, p50 resource=600 → 1000
    expect(tiers.medium.feeStroops).toBe(1000n);
  });

  it("fast fee = p95_inclusion + p90_resource", () => {
    const tiers = computeTiers(makeFeeStats());
    // p95 inclusion=1000, p90 resource=1500 → 2500
    expect(tiers.fast.feeStroops).toBe(2500n);
  });

  it("each tier exposes feeXlm as a string", () => {
    const tiers = computeTiers(makeFeeStats());
    for (const tier of Object.values(tiers)) {
      expect(typeof tier.feeXlm).toBe("string");
      expect(tier.feeXlm.length).toBeGreaterThan(0);
    }
  });

  it("falls back to inclusion fee when soroban stats are absent", () => {
    const stats = { fee_charged: { p10: "200", p50: "500", p95: "1200" } };
    const tiers = computeTiers(stats);
    // without soroban bucket, resource falls back to inclusion values
    expect(tiers.slow.feeStroops).toBe(400n);   // p10+p10 = 200+200
    expect(tiers.medium.feeStroops).toBe(1000n); // p50+p50 = 500+500
    expect(tiers.fast.feeStroops).toBe(2400n);   // p95+p95 = 1200+1200
  });

  it("slow ≤ medium ≤ fast", () => {
    const tiers = computeTiers(makeFeeStats());
    expect(tiers.slow.feeStroops).toBeLessThanOrEqual(tiers.medium.feeStroops);
    expect(tiers.medium.feeStroops).toBeLessThanOrEqual(tiers.fast.feeStroops);
  });

  it("estimatedWaitLedgers decreases from slow to fast", () => {
    const tiers = computeTiers(makeFeeStats());
    expect(tiers.slow.estimatedWaitLedgers).toBeGreaterThan(tiers.medium.estimatedWaitLedgers);
    expect(tiers.medium.estimatedWaitLedgers).toBeGreaterThan(tiers.fast.estimatedWaitLedgers);
  });
});

// ─── getGasEstimate ───────────────────────────────────────────────────────────

describe("getGasEstimate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.get.mockResolvedValue(null);
    cacheService.set.mockResolvedValue(undefined);
    axios.get.mockResolvedValue({ data: makeFeeStats() });
  });

  it("fetches from Horizon and returns three tiers", async () => {
    const result = await getGasEstimate();
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(result.slow).toBeDefined();
    expect(result.medium).toBeDefined();
    expect(result.fast).toBeDefined();
  });

  it("returns cached: false on a fresh fetch", async () => {
    const result = await getGasEstimate();
    expect(result.cached).toBe(false);
  });

  it("stores result in cache after fetching", async () => {
    await getGasEstimate();
    // Two writes: history array + main estimate key
    expect(cacheService.set).toHaveBeenCalledTimes(2);
    expect(cacheService.set.mock.calls.some((c) => c[0] === "gas:estimate:v1")).toBe(true);
  });

  it("returns cached: true when cache is warm", async () => {
    // Simulate a warm cache entry (stored values are already serialised strings)
    cacheService.get.mockResolvedValue({
      slow:   { feeStroops: "350",  feeXlm: "0.000035",  label: "Slow",   description: "...", estimatedWaitLedgers: 6 },
      medium: { feeStroops: "1000", feeXlm: "0.0001",    label: "Medium", description: "...", estimatedWaitLedgers: 2 },
      fast:   { feeStroops: "2500", feeXlm: "0.00025",   label: "Fast",   description: "...", estimatedWaitLedgers: 1 },
      spikeDetected: false,
      fetchedAt: new Date().toISOString(),
    });

    const result = await getGasEstimate();
    expect(axios.get).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.medium.feeStroops).toBe(1000n);
  });

  it("bustCache bypasses the cache", async () => {
    // bustCache=true skips the main cache read entirely, so get is only
    // called for the history bucket inside detectSpike.
    cacheService.get.mockResolvedValueOnce([400]); // history with 1 point

    const result = await getGasEstimate({ bustCache: true });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
  });

  it("sets spikeDetected = false with insufficient history", async () => {
    // main cache miss → null, history → 1 entry (not enough for spike detection)
    cacheService.get
      .mockResolvedValueOnce(null)   // main cache miss
      .mockResolvedValueOnce([400]); // history with 1 entry

    const result = await getGasEstimate();
    expect(result.spikeDetected).toBe(false);
  });

  it("sets spikeDetected = true when fees spike significantly", async () => {
    // Build history where p50 was consistently low (~1000 stroops)
    const lowHistory = Array(10).fill(1000);
    cacheService.get
      .mockResolvedValueOnce(null)          // main cache miss
      .mockResolvedValueOnce(lowHistory);   // low rolling history

    // Current fee_stats produce a much higher medium tier
    axios.get.mockResolvedValue({
      data: makeFeeStats({
        fee_charged: { p10: "150", p50: "3000", p95: "6000" },
        soroban_inclusion_fee_charged: { p10: "200", p50: "3000", p90: "5000" },
      }),
    });

    const result = await getGasEstimate();
    // medium = 3000 + 3000 = 6000; rolling avg ≈ 1000 → 6× → spike
    expect(result.spikeDetected).toBe(true);
  });

  it("includes a fetchedAt ISO timestamp", async () => {
    const result = await getGasEstimate();
    expect(Date.parse(result.fetchedAt)).not.toBeNaN();
  });

  it("propagates Horizon errors to the caller", async () => {
    axios.get.mockRejectedValue(new Error("network error"));
    await expect(getGasEstimate()).rejects.toThrow("network error");
  });
});
