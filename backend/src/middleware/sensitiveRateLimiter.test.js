"use strict";

const express = require("express");
const request = require("supertest");
const { createSensitiveRateLimiters } = require("./rateLimiter");

class SharedMemoryStore {
  constructor({ prefix, backing, now = () => Date.now() }) {
    this.prefix = prefix;
    this.localKeys = false;
    this.backing = backing;
    this.now = now;
    this.windowMs = 0;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const fullKey = `${this.prefix}${key}`;
    const now = this.now();
    let record = this.backing.get(fullKey);

    if (!record || record.expiresAt <= now) {
      record = { totalHits: 0, expiresAt: now + this.windowMs };
    }

    record.totalHits += 1;
    this.backing.set(fullKey, record);

    return {
      totalHits: record.totalHits,
      resetTime: new Date(record.expiresAt),
    };
  }

  async decrement(key) {
    const fullKey = `${this.prefix}${key}`;
    const record = this.backing.get(fullKey);
    if (!record) return;
    if (record.totalHits <= 1) {
      this.backing.delete(fullKey);
    } else {
      record.totalHits -= 1;
      this.backing.set(fullKey, record);
    }
  }

  async resetKey(key) {
    this.backing.delete(`${this.prefix}${key}`);
  }
}

function buildApp({
  backing = new Map(),
  now,
  namespace = "test-sensitive",
  maxRequestsPerIp = 10,
  maxRequestsPerPrincipal = 2,
  windowMinutes = 1,
  authenticatePrincipal = false,
} = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());

  if (authenticatePrincipal) {
    app.use((req, _res, next) => {
      if (req.body?.publicKey) req.user = { publicKey: req.body.publicKey };
      next();
    });
  }

  const limiters = createSensitiveRateLimiters({
    namespace,
    maxRequestsPerIp,
    maxRequestsPerPrincipal,
    windowMinutes,
    principalKeyGenerator: (req) => req.body?.publicKey,
    storeFactory: ({ prefix }) => new SharedMemoryStore({ prefix, backing, now }),
  });

  app.post("/test", ...limiters, (req, res) => {
    res.json({ success: true });
  });

  return app;
}

describe("sensitive trust-aware dual-axis rate limiting", () => {
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

  it("does not let an unverified principal become a global lockout key across rotating IPs", async () => {
    const app = buildApp({ maxRequestsPerIp: 10, maxRequestsPerPrincipal: 2 });

    for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
      await request(app)
        .post("/test")
        .set("X-Forwarded-For", ip)
        .send({ publicKey: "GVICTIM" })
        .expect(200);
    }
  });

  it("limits an authenticated principal across rotating client IPs", async () => {
    const app = buildApp({
      maxRequestsPerIp: 10,
      maxRequestsPerPrincipal: 2,
      authenticatePrincipal: true,
    });

    await request(app)
      .post("/test")
      .set("X-Forwarded-For", "203.0.113.1")
      .send({ publicKey: "GACCOUNT" })
      .expect(200);

    await request(app)
      .post("/test")
      .set("X-Forwarded-For", "203.0.113.2")
      .send({ publicKey: "GACCOUNT" })
      .expect(200);

    const blocked = await request(app)
      .post("/test")
      .set("X-Forwarded-For", "203.0.113.3")
      .send({ publicKey: "GACCOUNT" });

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(60);
    expect(blocked.headers["cache-control"]).toBe("no-store");
    expect(blocked.body).toEqual({
      message: "Too many requests — please wait before trying again",
    });
    expect(JSON.stringify(blocked.body)).not.toContain("GACCOUNT");
  });

  it("limits one client IP even when the caller rotates unverified principals", async () => {
    const app = buildApp({ maxRequestsPerIp: 2, maxRequestsPerPrincipal: 10 });

    await request(app)
      .post("/test")
      .set("X-Forwarded-For", "198.51.100.20")
      .send({ publicKey: "GONE" })
      .expect(200);

    await request(app)
      .post("/test")
      .set("X-Forwarded-For", "198.51.100.20")
      .send({ publicKey: "GTWO" })
      .expect(200);

    await request(app)
      .post("/test")
      .set("X-Forwarded-For", "198.51.100.20")
      .send({ publicKey: "GTHREE" })
      .expect(429);
  });

  it("shares authenticated-principal limiter state between independent app instances", async () => {
    const backing = new Map();
    const appA = buildApp({ backing, maxRequestsPerPrincipal: 2, authenticatePrincipal: true });
    const appB = buildApp({ backing, maxRequestsPerPrincipal: 2, authenticatePrincipal: true });

    await request(appA)
      .post("/test")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ publicKey: "GSHARED" })
      .expect(200);

    await request(appB)
      .post("/test")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ publicKey: "GSHARED" })
      .expect(200);

    await request(appA)
      .post("/test")
      .set("X-Forwarded-For", "203.0.113.12")
      .send({ publicKey: "GSHARED" })
      .expect(429);
  });

  it("allows requests again after the shared authenticated-principal window expires", async () => {
    const backing = new Map();
    let now = Date.now();
    const app = buildApp({
      backing,
      now: () => now,
      maxRequestsPerPrincipal: 1,
      windowMinutes: 1,
      authenticatePrincipal: true,
    });

    await request(app)
      .post("/test")
      .set("X-Forwarded-For", "192.0.2.10")
      .send({ publicKey: "GRESET" })
      .expect(200);

    await request(app)
      .post("/test")
      .set("X-Forwarded-For", "192.0.2.11")
      .send({ publicKey: "GRESET" })
      .expect(429);

    now += 60_001;

    await request(app)
      .post("/test")
      .set("X-Forwarded-For", "192.0.2.12")
      .send({ publicKey: "GRESET" })
      .expect(200);
  });
});
