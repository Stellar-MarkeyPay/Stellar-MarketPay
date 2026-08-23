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

function buildApp(redis, { authenticatePrincipal = false } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());

  if (authenticatePrincipal) {
    app.use((req, _res, next) => {
      if (req.body?.publicKey) req.user = { publicKey: req.body.publicKey };
      next();
    });
  }

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
  const previousTrustedProxies = process.env.TRUSTED_PROXY_IPS;

  beforeEach(() => {
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1,::ffff:127.0.0.1";
  });

  afterAll(() => {
    if (previousTrustedProxies === undefined) {
      delete process.env.TRUSTED_PROXY_IPS;
    } else {
      process.env.TRUSTED_PROXY_IPS = previousTrustedProxies;
    }
  });

  it("backs off repeated failures from the same pre-auth principal and client IP", async () => {
    let now = Date.now();
    const redis = new FakeRedis(() => now);
    const app = buildApp(redis);

    await request(app)
      .post("/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ publicKey: "GVICTIM" })
      .expect(401);
    await request(app)
      .post("/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ publicKey: "GVICTIM" })
      .expect(401);

    const blocked = await request(app)
      .post("/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ publicKey: "GVICTIM" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("1");
    expect(blocked.headers["cache-control"]).toBe("no-store");
    expect(blocked.body).toEqual({
      message: "Too many requests — please wait before trying again",
    });

    now += 1_001;
    await request(app)
      .post("/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ publicKey: "GVICTIM" })
      .expect(401);

    const blockedAgain = await request(app)
      .post("/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ publicKey: "GVICTIM" });
    expect(blockedAgain.status).toBe(429);
    expect(Number(blockedAgain.headers["retry-after"])).toBe(2);
  });

  it("does not let rotated IPs globally back off an unverified victim principal", async () => {
    const redis = new FakeRedis();
    const app = buildApp(redis);

    for (const ip of ["203.0.113.21", "203.0.113.22", "203.0.113.23"]) {
      await request(app)
        .post("/login")
        .set("X-Forwarded-For", ip)
        .send({ publicKey: "GVICTIM" })
        .expect(401);
    }
  });

  it("backs off an authenticated principal across rotating IPs", async () => {
    const redis = new FakeRedis();
    const app = buildApp(redis, { authenticatePrincipal: true });

    await request(app)
      .post("/login")
      .set("X-Forwarded-For", "198.51.100.1")
      .send({ publicKey: "GACCOUNT" })
      .expect(401);
    await request(app)
      .post("/login")
      .set("X-Forwarded-For", "198.51.100.2")
      .send({ publicKey: "GACCOUNT" })
      .expect(401);

    await request(app)
      .post("/login")
      .set("X-Forwarded-For", "198.51.100.3")
      .send({ publicKey: "GACCOUNT" })
      .expect(429);
  });

  it("clears failure history after a successful authentication", async () => {
    let now = Date.now();
    const redis = new FakeRedis(() => now);
    const app = buildApp(redis, { authenticatePrincipal: true });

    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(401);
    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(401);

    now += 1_001;
    await request(app).post("/login").send({ publicKey: "GRESET", ok: true }).expect(200);

    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(401);
    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(401);
    await request(app).post("/login").send({ publicKey: "GRESET" }).expect(429);
  });
});
