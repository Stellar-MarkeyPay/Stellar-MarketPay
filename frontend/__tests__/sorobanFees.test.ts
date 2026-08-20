/**
 * __tests__/sorobanFees.test.ts
 *
 * Unit tests for the dynamic fee-tier helpers in lib/sorobanFees.ts.
 * All network calls are intercepted via global.fetch mock.
 */

// Mock stellar.ts before any imports to prevent env validation at module load time
jest.mock("@/lib/stellar", () => ({
  sorobanServer: {},
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

import {
  fetchDynamicFeeTiers,
  pickTierFeeStroops,
  type DynamicFeeEstimate,
  type FeeTier,
} from "@/lib/sorobanFees";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTier(overrides: Partial<FeeTier> = {}): FeeTier {
  return {
    feeStroops: "1000",
    feeXlm: "0.0001",
    label: "Medium",
    description: "Likely to confirm within ~2 ledgers (~10 s)",
    estimatedWaitLedgers: 2,
    ...overrides,
  };
}

function makeDynamicFeeEstimate(overrides: Partial<DynamicFeeEstimate> = {}): DynamicFeeEstimate {
  return {
    slow: makeTier({ label: "Slow", feeStroops: "350", estimatedWaitLedgers: 6 }),
    medium: makeTier({ label: "Medium", feeStroops: "1000", estimatedWaitLedgers: 2 }),
    fast: makeTier({ label: "Fast", feeStroops: "2500", estimatedWaitLedgers: 1 }),
    spikeDetected: false,
    fetchedAt: "2024-01-01T00:00:00.000Z",
    cached: false,
    ...overrides,
  };
}

function mockFetch(body: object, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  });
}

// ─── fetchDynamicFeeTiers ─────────────────────────────────────────────────────

describe("fetchDynamicFeeTiers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the parsed estimate on success", async () => {
    const estimate = makeDynamicFeeEstimate();
    mockFetch({ success: true, data: estimate });

    const result = await fetchDynamicFeeTiers();

    expect(result.slow.label).toBe("Slow");
    expect(result.medium.label).toBe("Medium");
    expect(result.fast.label).toBe("Fast");
    expect(result.spikeDetected).toBe(false);
  });

  it("calls /api/gas-estimate by default", async () => {
    const estimate = makeDynamicFeeEstimate();
    mockFetch({ success: true, data: estimate });

    await fetchDynamicFeeTiers();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/gas-estimate"),
      expect.any(Object)
    );
    expect((global.fetch as jest.Mock).mock.calls[0][0]).not.toContain("/refresh");
  });

  it("calls /api/gas-estimate/refresh when forceRefresh=true", async () => {
    const estimate = makeDynamicFeeEstimate();
    mockFetch({ success: true, data: estimate });

    await fetchDynamicFeeTiers(true);

    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain("/refresh");
  });

  it("throws when the response status is not ok", async () => {
    mockFetch({ error: "Horizon unavailable" }, 502);

    await expect(fetchDynamicFeeTiers()).rejects.toThrow(/502/);
  });

  it("throws when success flag is false", async () => {
    mockFetch({ success: false, data: null });

    await expect(fetchDynamicFeeTiers()).rejects.toThrow(/unexpected response shape/i);
  });

  it("surfaces the spikeDetected flag", async () => {
    const estimate = makeDynamicFeeEstimate({ spikeDetected: true });
    mockFetch({ success: true, data: estimate });

    const result = await fetchDynamicFeeTiers();
    expect(result.spikeDetected).toBe(true);
  });

  it("preserves feeStroops as a string (BigInt-safe transfer)", async () => {
    const estimate = makeDynamicFeeEstimate();
    mockFetch({ success: true, data: estimate });

    const result = await fetchDynamicFeeTiers();
    expect(typeof result.medium.feeStroops).toBe("string");
  });
});

// ─── pickTierFeeStroops ───────────────────────────────────────────────────────

describe("pickTierFeeStroops", () => {
  const estimate = makeDynamicFeeEstimate();

  it("returns medium fee by default", () => {
    expect(pickTierFeeStroops(estimate)).toBe(1000);
  });

  it("returns slow fee when requested", () => {
    expect(pickTierFeeStroops(estimate, "slow")).toBe(350);
  });

  it("returns fast fee when requested", () => {
    expect(pickTierFeeStroops(estimate, "fast")).toBe(2500);
  });

  it("returns a number (usable as Stellar SDK fee field)", () => {
    expect(typeof pickTierFeeStroops(estimate, "medium")).toBe("number");
  });

  it("slow ≤ medium ≤ fast", () => {
    const slow = pickTierFeeStroops(estimate, "slow");
    const medium = pickTierFeeStroops(estimate, "medium");
    const fast = pickTierFeeStroops(estimate, "fast");
    expect(slow).toBeLessThanOrEqual(medium);
    expect(medium).toBeLessThanOrEqual(fast);
  });
});
