"use strict";

const { RedisRateLimitStore } = require("./redisRateLimitStore");

describe("RedisRateLimitStore", () => {
  it("prefixes keys and returns totalHits plus an exact reset time", async () => {
    const client = {
      eval: jest.fn().mockResolvedValue([2, 45_000]),
    };
    const store = new RedisRateLimitStore({ prefix: "auth:ip:", client });
    store.init({ windowMs: 60_000 });

    const before = Date.now();
    const result = await store.increment("abc123");
    const after = Date.now();

    expect(result.totalHits).toBe(2);
    expect(result.resetTime.getTime()).toBeGreaterThanOrEqual(before + 45_000);
    expect(result.resetTime.getTime()).toBeLessThanOrEqual(after + 45_000);
    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "marketpay:rate-limit:auth:ip:abc123",
      "60000"
    );
    expect(store.localKeys).toBe(false);
  });

  it("fails closed with a generic 503 instead of leaking Redis details", async () => {
    const client = {
      eval: jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED redis.internal:6379")),
    };
    const store = new RedisRateLimitStore({ prefix: "auth:principal:", client });
    store.init({ windowMs: 60_000 });

    await expect(store.increment("victim")).rejects.toMatchObject({
      message: "Rate limiting service unavailable",
      status: 503,
    });
  });

  it("resets only the requested prefixed key", async () => {
    const client = {
      del: jest.fn().mockResolvedValue(1),
    };
    const store = new RedisRateLimitStore({ prefix: "webauthn:principal:", client });

    await store.resetKey("principal-hash");

    expect(client.del).toHaveBeenCalledWith(
      "marketpay:rate-limit:webauthn:principal:principal-hash"
    );
  });
});
