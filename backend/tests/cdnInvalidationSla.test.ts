/**
 * backend/tests/cdnInvalidationSla.test.js
 * End-to-end SLA verification for the event-driven CDN invalidation
 * pipeline (#91): from a simulated on-chain event to a completed, targeted
 * purge in under 5 seconds — exercising the real CdnService (failover +
 * circuit breaker) and CdnInvalidationService together, not mocked out.
 *
 * This is the harness that would be pointed at real CDN vendor accounts and
 * a production-like origin to produce the acceptance-criteria numbers; here
 * it runs against the in-memory mock provider so the SLA gate is
 * CI-enforceable without live vendor credentials. See
 * docs/CDN_STRATEGY.md#sla-verification for how to re-point it at staging.
 */
"use strict";

jest.mock("../src/db/pool", () => ({
  query: jest.fn(),
}));
jest.mock("../src/services/cacheService", () => ({
  delPattern: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  profileKey: (key: any) => `profile:${key}`,
  jobDetailKey: (id: any) => `job:detail:${id}`,
}));

const pool = require("../src/db/pool");
const CdnService = require("../src/services/cdn/cdnService");
const CdnInvalidationService = require("../src/services/cdn/invalidationService");
const { createMockProvider } = require("../src/services/cdn/providers");

const SLA_SECONDS = 5;

describe("CDN invalidation SLA (event -> targeted purge < 5s)", () => {
  test("a single job-closed event purges within SLA using the primary provider", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ client_address: "GCLIENT", freelancer_address: "GFREELANCER" }],
    });

    const primary = createMockProvider("primary");
    const cdnService = new CdnService({ providers: [primary] });
    const invalidation = new CdnInvalidationService({
      cdnService,
      publicBaseUrl: "https://app.example",
    });

    const receivedAt = Date.now();
    const result = await invalidation.handleContractEvent("escrow_released", "job-sla-1", {
      receivedAt,
    });

    expect(result.latencySeconds).toBeLessThan(SLA_SECONDS);
    expect(result.provider).toBe("primary");
    // Targeted: exactly the job + its two parties — never a full flush.
    expect(primary.purged[0].urls).toHaveLength(3);
  });

  test("still meets SLA after failing over from a down primary to the secondary provider", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ client_address: "GCLIENT", freelancer_address: null }],
    });

    const downProvider = {
      name: "primary-down",
      purge: () => Promise.reject(new Error("vendor outage")),
    };
    const secondary = createMockProvider("secondary");
    const cdnService = new CdnService({ providers: [downProvider, secondary], timeoutMs: 500 });
    const invalidation = new CdnInvalidationService({
      cdnService,
      publicBaseUrl: "https://app.example",
    });

    const receivedAt = Date.now();
    const result = await invalidation.handleContractEvent("dispute_opened", "job-sla-2", {
      receivedAt,
    });

    expect(result.failedOver).toBe(true);
    expect(result.provider).toBe("secondary");
    expect(result.latencySeconds).toBeLessThan(SLA_SECONDS);
  });

  test("propagation latency across a burst of 20 concurrent events stays within SLA at p95", async () => {
    pool.query.mockResolvedValue({
      rows: [{ client_address: "GCLIENT", freelancer_address: "GFREELANCER" }],
    });

    const primary = createMockProvider("primary");
    const cdnService = new CdnService({ providers: [primary] });
    const invalidation = new CdnInvalidationService({
      cdnService,
      publicBaseUrl: "https://app.example",
    });

    const latencies = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        invalidation
          .handleContractEvent("escrow_released", `job-sla-burst-${i}`, { receivedAt: Date.now() })
          .then((r: any) => r.latencySeconds)
      )
    );

    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    expect(p95).toBeLessThan(SLA_SECONDS);
  });
});

export {};
