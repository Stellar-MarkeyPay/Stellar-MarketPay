"use strict";

const express = require("express");
const request = require("supertest");

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const pool = require("../db/pool");
const healthRouter = require("./health");

function app() {
  const instance = express();
  instance.use("/health", healthRouter);
  return instance;
}

describe("health routes", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      REGION: "primary-cluster",
      CLUSTER_ROLE: "active",
      REQUIRE_WRITABLE_DB: "true",
      STELLAR_NETWORK: "testnet",
      HORIZON_URL: "https://horizon.example",
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: { records: [{ sequence: 123 }] },
      }),
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("keeps liveness independent of external dependencies", async () => {
    const response = await request(app()).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "alive",
      region: "primary-cluster",
      cluster_role: "active",
    });
    expect(pool.query).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports a writable database as ready", async () => {
    pool.query.mockResolvedValue({
      rows: [{ in_recovery: false, replay_lag_seconds: "0" }],
    });

    const response = await request(app()).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "healthy",
      region: "primary-cluster",
      database: {
        status: "ok",
        role: "primary",
        writable: true,
        replay_lag_seconds: 0,
      },
    });
  });

  it("keeps a read-only disaster-recovery replica out of traffic", async () => {
    pool.query.mockResolvedValue({
      rows: [{ in_recovery: true, replay_lag_seconds: "12.5" }],
    });

    const response = await request(app()).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: "degraded",
      database: {
        role: "replica",
        writable: false,
        replay_lag_seconds: 12.5,
      },
    });
  });

  it("allows a read-only replica to pass warm-standby checks", async () => {
    pool.query.mockResolvedValue({
      rows: [{ in_recovery: true, replay_lag_seconds: "8" }],
    });

    const response = await request(app()).get("/health/standby");

    expect(response.status).toBe(200);
    expect(response.body.database).toMatchObject({
      role: "replica",
      writable: false,
      replay_lag_seconds: 8,
    });
  });

  it("does not report zero lag before a replica has replayed a transaction", async () => {
    pool.query.mockResolvedValue({
      rows: [{ in_recovery: true, replay_lag_seconds: null }],
    });

    const response = await request(app()).get("/health/standby");

    expect(response.status).toBe(200);
    expect(response.body.database.replay_lag_seconds).toBeNull();
  });
});

export {};
