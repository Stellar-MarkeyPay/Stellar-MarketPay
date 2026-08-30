"use strict";

const Redis = require("ioredis");
const { RedisRateLimitStore } = require("./redisRateLimitStore");

const describeRedis = process.env.REDIS_URL ? describe : describe.skip;

describeRedis("RedisRateLimitStore integration", () => {
  let clientA;
  let clientB;
  let storeA;
  let storeB;

  beforeEach(() => {
    const options = {
      lazyConnect: false,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2500,
    };

    clientA = new Redis(process.env.REDIS_URL, options);
    clientB = new Redis(process.env.REDIS_URL, options);

    const uniquePrefix = `integration:${process.pid}:${Date.now()}:${Math.random()}:`;
    storeA = new RedisRateLimitStore({ prefix: uniquePrefix, client: clientA });
    storeB = new RedisRateLimitStore({ prefix: uniquePrefix, client: clientB });
    storeA.init({ windowMs: 10_000 });
    storeB.init({ windowMs: 10_000 });
  });

  afterEach(async () => {
    await storeA.resetAll();
    await Promise.allSettled([clientA.quit(), clientB.quit()]);
  });

  it("shares counters across independent Redis clients", async () => {
    const first = await storeA.increment("same-bucket");
    const second = await storeB.increment("same-bucket");

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(second.resetTime).toBeInstanceOf(Date);
    expect(second.resetTime.getTime()).toBeGreaterThan(Date.now());
  });
});
