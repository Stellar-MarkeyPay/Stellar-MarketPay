/**
 * src/services/cdn/invalidationService.test.js
 * Tests for the event-driven invalidation pipeline: contract events map to
 * *targeted* purges of exactly the affected job/profile URLs — never a
 * full-cache flush — and completion latency is recorded for SLA tracking (#91).
 */
"use strict";

jest.mock("../../db/pool", () => ({
  query: jest.fn(),
}));
jest.mock("../cacheService", () => ({
  delPattern: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  profileKey: (key: any) => `profile:${key}`,
  jobDetailKey: (id: any) => `job:detail:${id}`,
}));

const pool = require("../../db/pool");
const cache = require("../cacheService");
const CdnInvalidationService = require("./invalidationService");

function fakeCdnService(purgeImpl?: any) {
  return {
    purge: jest.fn(purgeImpl || (() => Promise.resolve({ success: true, provider: "mock" }))),
  };
}

describe("CdnInvalidationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("ignores event types that don't affect cached views", async () => {
    const cdnService = fakeCdnService();
    const svc = new CdnInvalidationService({ cdnService, publicBaseUrl: "https://app.example" });

    const result = await svc.handleContractEvent("message_sent", "job-1");

    expect(result).toBeNull();
    expect(cdnService.purge).not.toHaveBeenCalled();
  });

  test("ignores events with no jobId", async () => {
    const cdnService = fakeCdnService();
    const svc = new CdnInvalidationService({ cdnService });

    const result = await svc.handleContractEvent("escrow_released", undefined);

    expect(result).toBeNull();
    expect(cdnService.purge).not.toHaveBeenCalled();
  });

  test("purges only the affected job + both parties' profile URLs, not a full flush", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ client_address: "GCLIENT", freelancer_address: "GFREELANCER" }],
    });
    const cdnService = fakeCdnService();
    const svc = new CdnInvalidationService({ cdnService, publicBaseUrl: "https://app.example" });

    await svc.handleContractEvent("escrow_released", "job-42");

    expect(cdnService.purge).toHaveBeenCalledTimes(1);
    const [{ urls, tags }] = cdnService.purge.mock.calls[0];

    expect(urls).toEqual([
      "https://app.example/jobs/job-42",
      "https://app.example/freelancers/GCLIENT",
      "https://app.example/freelancers/GFREELANCER",
    ]);
    expect(tags).toEqual(
      expect.arrayContaining(["job-job-42", "jobs-list", "profile-GCLIENT", "profile-GFREELANCER"])
    );
    // Exactly these four surrogate keys — nothing broader.
    expect(tags).toHaveLength(4);
  });

  test("busts the origin Redis cache for the job and both profiles", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ client_address: "GCLIENT", freelancer_address: "GFREELANCER" }],
    });
    const cdnService = fakeCdnService();
    const svc = new CdnInvalidationService({ cdnService });

    await svc.handleContractEvent("escrow_released", "job-42");

    expect(cache.delPattern).toHaveBeenCalledWith("jobs:list:*");
    expect(cache.del).toHaveBeenCalledWith("job:detail:job-42");
    expect(cache.del).toHaveBeenCalledWith("profile:GCLIENT");
    expect(cache.del).toHaveBeenCalledWith("profile:GFREELANCER");
  });

  test("still purges the job URL when the job has no freelancer yet (unassigned)", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ client_address: "GCLIENT", freelancer_address: null }],
    });
    const cdnService = fakeCdnService();
    const svc = new CdnInvalidationService({ cdnService, publicBaseUrl: "https://app.example" });

    await svc.handleContractEvent("escrow_created", "job-7");

    const [{ urls }] = cdnService.purge.mock.calls[0];
    expect(urls).toEqual([
      "https://app.example/jobs/job-7",
      "https://app.example/freelancers/GCLIENT",
    ]);
  });

  test("degrades gracefully when the job-parties lookup fails", async () => {
    pool.query.mockRejectedValueOnce(new Error("db down"));
    const cdnService = fakeCdnService();
    const svc = new CdnInvalidationService({ cdnService, publicBaseUrl: "https://app.example" });

    const result = await svc.handleContractEvent("dispute_opened", "job-9");

    expect(result.urls).toEqual(["https://app.example/jobs/job-9"]);
  });

  test("emits invalidation:completed with latency and re-throws on total purge failure", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ client_address: "GCLIENT", freelancer_address: null }],
    });
    const cdnService = fakeCdnService(() => Promise.reject(new Error("all providers down")));
    const svc = new CdnInvalidationService({ cdnService });

    const failedHandler = jest.fn();
    svc.on("invalidation:failed", failedHandler);

    await expect(svc.handleContractEvent("escrow_released", "job-1")).rejects.toThrow(
      "all providers down"
    );
    expect(failedHandler).toHaveBeenCalledTimes(1);
    expect(failedHandler.mock.calls[0][0]).toMatchObject({
      jobId: "job-1",
      eventType: "escrow_released",
    });
  });

  test("records sub-5s latency for a fast purge (SLA smoke check)", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ client_address: "GCLIENT", freelancer_address: null }],
    });
    const cdnService = fakeCdnService();
    const svc = new CdnInvalidationService({ cdnService });

    const completedHandler = jest.fn();
    svc.on("invalidation:completed", completedHandler);

    const receivedAt = Date.now();
    await svc.handleContractEvent("escrow_released", "job-1", { receivedAt });

    expect(completedHandler).toHaveBeenCalledTimes(1);
    expect(completedHandler.mock.calls[0][0].latencySeconds).toBeLessThan(5);
  });
});

export {};
