/**
 * src/services/cdn/cdnService.test.js
 * Tests for the multi-CDN purge orchestrator: targeted-only purges and
 * failover across providers when one is degraded/down (#91).
 */
"use strict";

const CdnService = require("./cdnService");

function fakeProvider(name, behavior) {
  return {
    name,
    calls: [],
    purge(target) {
      this.calls.push(target);
      return behavior(target);
    },
  };
}

describe("CdnService", () => {
  test("requires at least one provider", () => {
    expect(() => new CdnService({ providers: [] })).toThrow(/at least one provider/);
  });

  test("refuses an unscoped purge (no urls/tags) — never a full-cache flush", async () => {
    const primary = fakeProvider("primary", () => Promise.resolve({ ok: true }));
    const service = new CdnService({ providers: [primary] });

    await expect(service.purge({})).rejects.toThrow(/unscoped full-cache flush/);
    expect(primary.calls).toHaveLength(0);
  });

  test("purges only the targeted urls/tags via the primary provider", async () => {
    const primary = fakeProvider("primary", () => Promise.resolve({ ok: true }));
    const service = new CdnService({ providers: [primary] });

    const result = await service.purge({
      urls: ["https://app.example/jobs/123"],
      tags: ["job-123"],
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("primary");
    expect(result.failedOver).toBe(false);
    expect(primary.calls).toEqual([{ urls: ["https://app.example/jobs/123"], tags: ["job-123"] }]);
  });

  test("fails over to the secondary provider when the primary errors", async () => {
    const primary = fakeProvider("primary", () => Promise.reject(new Error("primary down")));
    const secondary = fakeProvider("secondary", () => Promise.resolve({ ok: true }));
    const service = new CdnService({ providers: [primary, secondary] });

    const result = await service.purge({ tags: ["job-123"] });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("secondary");
    expect(result.failedOver).toBe(true);
    expect(primary.calls).toHaveLength(1);
    expect(secondary.calls).toHaveLength(1);
  });

  test("fails over on a provider timeout", async () => {
    const slowPrimary = fakeProvider(
      "primary",
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );
    const secondary = fakeProvider("secondary", () => Promise.resolve({ ok: true }));
    const service = new CdnService({ providers: [slowPrimary, secondary], timeoutMs: 20 });

    const result = await service.purge({ tags: ["job-123"] });

    expect(result.provider).toBe("secondary");
  });

  test("throws CdnPurgeError with per-provider attempts when every provider fails", async () => {
    const primary = fakeProvider("primary", () => Promise.reject(new Error("primary down")));
    const secondary = fakeProvider("secondary", () => Promise.reject(new Error("secondary down")));
    const service = new CdnService({ providers: [primary, secondary] });

    await expect(service.purge({ tags: ["job-123"] })).rejects.toMatchObject({
      name: "CdnPurgeError",
      attempts: [
        { provider: "primary", error: "primary down" },
        { provider: "secondary", error: "secondary down" },
      ],
    });
  });

  test("opens the circuit after repeated failures and skips that provider until cooldown elapses", async () => {
    const flaky = fakeProvider("flaky", () => Promise.reject(new Error("down")));
    const backup = fakeProvider("backup", () => Promise.resolve({ ok: true }));
    const service = new CdnService({
      providers: [flaky, backup],
      failureThreshold: 2,
      cooldownMs: 10000,
    });

    await service.purge({ tags: ["a"] });
    await service.purge({ tags: ["b"] });
    expect(flaky.calls).toHaveLength(2);
    expect(service.isCircuitOpen("flaky")).toBe(true);

    // Third call should skip the now-open circuit entirely — no additional call to `flaky`.
    await service.purge({ tags: ["c"] });
    expect(flaky.calls).toHaveLength(2);
    expect(backup.calls).toHaveLength(3);
  });

  test("getHealth reports circuit state per provider", async () => {
    const primary = fakeProvider("primary", () => Promise.resolve({ ok: true }));
    const service = new CdnService({ providers: [primary] });

    await service.purge({ tags: ["job-123"] });

    expect(service.getHealth()).toEqual([{ provider: "primary", circuitOpen: false, failures: 0 }]);
  });
});
