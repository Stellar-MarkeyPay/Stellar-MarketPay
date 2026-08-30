"use strict";

const { FencingService } = require("./fencingService");
const pool = require("../db/pool");

describe("FencingService & Split-Brain Prevention", () => {
  let fencingService;

  beforeEach(() => {
    fencingService = new FencingService({
      region: "primary-cluster",
      nodeId: "node-primary-0",
      isAuthority: true,
      heartbeatIntervalMs: 100,
      leaseDurationSeconds: 1,
    });
  });

  afterEach(() => {
    fencingService.stop();
  });

  it("initializes in active state for authority region", () => {
    const state = fencingService.getFencingState();
    expect(state.region).toBe("primary-cluster");
    expect(state.isAuthority).toBe(true);
    expect(state.isFenced).toBe(false);
    expect(state.generationToken).toBe(1);
  });

  it("switches to FENCED_READ_ONLY mode after consecutive heartbeat failures", () => {
    expect(fencingService.isFenced).toBe(false);

    // Simulate 3 missed heartbeats
    fencingService.handleLeaseLoss("WAN Partition detected; lease lost");

    expect(fencingService.isFenced).toBe(true);
    expect(pool.getStats().isFenced).toBe(true);
  });

  it("supports manual fencing and graceful draining", async () => {
    const res = await fencingService.fence();
    expect(res.status).toBe("fenced");
    expect(fencingService.isFenced).toBe(true);
  });

  it("advances generation token upon promotion", async () => {
    // Mock query response for promotion
    jest.spyOn(pool, "query").mockResolvedValueOnce({
      rows: [{ granted: true, generation_token: 2, expires_at: new Date(Date.now() + 10000) }],
    });

    const promotion = await fencingService.promote();
    expect(promotion.success).toBe(true);
    expect(promotion.generationToken).toBe(2);
    expect(fencingService.isAuthority).toBe(true);
    expect(fencingService.isFenced).toBe(false);
  });
});
