"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const replicationRouter = require("./replication");
const pool = require("../db/pool");
const { defaultFencingService } = require("../services/fencingService");
const { defaultChainReconciliationService } = require("../services/chainReconciliationService");

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

function createTestToken(role = "admin") {
  return jwt.sign({ publicKey: "GADMIN...", role }, JWT_SECRET, { expiresIn: "1h" });
}

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/replication", replicationRouter);
  return instance;
}

describe("Replication Routes (/api/replication)", () => {
  const adminToken = createTestToken("admin");
  const userToken = createTestToken("user");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /api/replication/status returns telemetry and fencing state", async () => {
    const res = await request(app()).get("/api/replication/status");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("fencing");
    expect(res.body).toHaveProperty("replication");
    expect(res.body).toHaveProperty("poolStats");
  });

  it("GET /api/replication/conflicts returns audit trail", async () => {
    jest.spyOn(pool, "query").mockResolvedValueOnce({
      rows: [
        {
          id: "conf-1",
          table_name: "jobs",
          record_id: "job-1",
          origin_region: "primary",
          conflicting_region: "secondary",
          resolution_strategy: "STATE_MACHINE_PROGRESSION",
          resolution_status: "resolved",
          detected_at: new Date(),
          resolved_at: new Date(),
        },
      ],
    });

    const res = await request(app()).get("/api/replication/conflicts");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.conflicts).toHaveLength(1);
    expect(res.body.conflicts[0].tableName).toBe("jobs");
  });

  it("POST /api/replication/reconcile triggers chain reconciliation (requires admin)", async () => {
    jest.spyOn(defaultChainReconciliationService, "reconcileEscrows").mockResolvedValueOnce({
      totalChecked: 10,
      reconciled: 2,
      discrepancies: [],
      durationMs: 45,
    });

    // 1. Unauthenticated -> 401
    const unauth = await request(app()).post("/api/replication/reconcile").send({ dryRun: false });
    expect(unauth.status).toBe(401);

    // 2. Non-admin -> 403
    const forbidden = await request(app())
      .post("/api/replication/reconcile")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ dryRun: false });
    expect(forbidden.status).toBe(403);

    // 3. Admin -> 200
    const res = await request(app())
      .post("/api/replication/reconcile")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ dryRun: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.report.reconciled).toBe(2);
  });

  it("POST /api/replication/fence fences the local node (requires admin)", async () => {
    jest.spyOn(defaultFencingService, "fence").mockResolvedValueOnce({
      status: "fenced",
      region: "primary-cluster",
      generationToken: 1,
    });

    const res = await request(app())
      .post("/api/replication/fence")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("fenced");
  });

  it("POST /api/replication/promote promotes node with generation increment (requires admin)", async () => {
    jest.spyOn(defaultFencingService, "promote").mockResolvedValueOnce({
      success: true,
      generationToken: 2,
      expiresAt: new Date(),
    });

    const res = await request(app())
      .post("/api/replication/promote")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.generationToken).toBe(2);
  });
});
