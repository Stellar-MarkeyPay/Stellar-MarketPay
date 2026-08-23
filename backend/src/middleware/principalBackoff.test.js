"use strict";

const express = require("express");
const request = require("supertest");
const { createPrincipalBackoff } = require("./principalBackoff");

class FakeRedis {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.failures = new Map();
    this.blocks = new Map();
  }

  async pttl(key) {
    const expiresAt = this.blocks.get(key);
    if (!expiresAt) return -2;
    const ttl = expiresAt - this.now();
    if (ttl <= 0) {
      this.blocks.delete(key);
      return -2;
    }
    return ttl;
  }

  async eval(_script, _keyCount, failureKey, blockKey, historyTtl, threshold, baseDelay, maxDelay) {
    const now = this.now();
    const previous = this.failures.get(failureKey);
    const attempts = previous && previous.expiresAt > now ? previous.attempts + 1 : 1;

    this.failures.set(failureKey, {
      attempts,
      expiresAt: now + Number(historyTtl),
    });

    let delay = 0;
    if (attempts >= Number(threshold)) {
      delay = Number(baseDelay) * 2 ** (attempts - Number(threshold));
      delay = Math.min(delay, Number(maxDelay));
      this.blocks.set(blockKey, now + delay);
    }

    return [attempts, delay];
  }

  async del(...keys) {
    for (const key of keys) {
      this.failures.delete(key);
      this.blocks.delete(key);
    }
    return keys.length;
  }
}

function buildApp(redis) {
  const app = express();
  app.use(express.json());

  const backoff = createPrincipalBackoff({
    namespace: "login",
    principalKeyGenerator: (req) => req.body?.publicKey,
    threshold: 2,
    historyWindowMinutes: 15,
    baseDelaySeconds: 1,
    maxDelaySeconds: 8,
    failureStatusCodes: [401],
    client: redis,
  });

  app.post("/login", backoff, (req, res) => {
    if (req.body?.ok) return res.json({ success: true });
    return res.status(401).json({ error: "Unauthorized" });
  });

  app.use((err, req, res, next) => {
    void req;
    void next;
    res.status(err.status || 500).json({ error: err.message });
  });

  return app;
}

describe("principal exponential backoff", () => {
  it("backs off repeated failures without coupling unrelated principals", async () => {
    let now = Date.now();
    const redis = new FakeRedis(() => now);
    const app = buildApp(redis);

    await request(app).post("/login").send({ publicKey: "GVICTIM" }).expect(401);
    await request(app).post("/login").send({ publicKey: "GVICTIM" }).expect(401);

    const blocked = await request(app).post("/login").send({ publicKey: "GVICTIM" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("1");
    expect(blocked.body.message).toMatch(/too many requests/i);

    await request(app).post("/login").send({ publicKey: "GOTHER" }).expect(401);

    now += 1_001;
    await request(app).post("/login").send({ publicKey: "GVICTIM" }).expect(401);

    const blockedAgain = await request(app).post("/login").send({ publicKey: "GVICTIM" });
    expect(blockedAgain.status).toBe(429);
    expect(Number(blockedAgain.headers["retry-after"])).toBe(2);
  });

  it("clears failure history after a successful authentication", async () => {
    let now = Date.now();
    const redis = new FakeRedis(() => now);
    const app = buildApp(redis);

    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(401);
    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(401);

    now += 1_001;
    await request(app).post("/login").send({ publicKey: "GRESET", ok: true }).expect(200);

    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(401);
    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(401);
    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(429);
  });
});
