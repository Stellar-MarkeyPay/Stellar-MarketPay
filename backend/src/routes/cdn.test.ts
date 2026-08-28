/**
 * src/routes/cdn.test.js
 * GET /api/cdn/health and POST /api/cdn/webhook — the external pub-sub
 * entrypoint for contract-event-driven invalidation (#91).
 */
"use strict";

const express = require("express");
const request = require("supertest");
const crypto = require("crypto");
const cdnRoutes = require("./cdn");

function buildApp({ cdnService, cdnInvalidation }: any) {
  const app = express();
  app.use(express.json());
  app.locals.cdnService = cdnService;
  app.locals.cdnInvalidation = cdnInvalidation;
  app.use("/api/cdn", cdnRoutes);
  return app;
}

describe("GET /api/cdn/health", () => {
  test("returns provider/circuit-breaker status", async () => {
    const cdnService = {
      getHealth: () => [{ provider: "cloudflare", circuitOpen: false, failures: 0 }],
    };
    const app = buildApp({ cdnService });

    const res = await request(app).get("/api/cdn/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      providers: [{ provider: "cloudflare", circuitOpen: false, failures: 0 }],
    });
  });

  test("500s when the CDN service isn't wired up", async () => {
    const app = buildApp({});
    const res = await request(app).get("/api/cdn/health");
    expect(res.status).toBe(500);
  });
});

describe("POST /api/cdn/webhook", () => {
  const originalSecret = process.env.CDN_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.CDN_WEBHOOK_SECRET = originalSecret;
  });

  test("triggers targeted invalidation for a valid event", async () => {
    delete process.env.CDN_WEBHOOK_SECRET;
    const cdnInvalidation = {
      handleContractEvent: jest
        .fn()
        .mockResolvedValue({ urls: ["u1"], tags: ["t1"], success: true }),
    };
    const app = buildApp({ cdnInvalidation });

    const res = await request(app)
      .post("/api/cdn/webhook")
      .send({ eventType: "escrow_released", jobId: "job-1" });

    expect(res.status).toBe(200);
    expect(cdnInvalidation.handleContractEvent).toHaveBeenCalledWith(
      "escrow_released",
      "job-1",
      expect.objectContaining({ receivedAt: expect.any(Number) })
    );
  });

  test("rejects missing eventType/jobId", async () => {
    delete process.env.CDN_WEBHOOK_SECRET;
    const cdnInvalidation = { handleContractEvent: jest.fn() };
    const app = buildApp({ cdnInvalidation });

    const res = await request(app).post("/api/cdn/webhook").send({});

    expect(res.status).toBe(400);
    expect(cdnInvalidation.handleContractEvent).not.toHaveBeenCalled();
  });

  test("rejects a request with a bad HMAC signature when a secret is configured", async () => {
    process.env.CDN_WEBHOOK_SECRET = "shh";
    const cdnInvalidation = { handleContractEvent: jest.fn() };
    const app = buildApp({ cdnInvalidation });

    const res = await request(app)
      .post("/api/cdn/webhook")
      .set("X-Webhook-Signature", "deadbeef")
      .send({ eventType: "escrow_released", jobId: "job-1" });

    expect(res.status).toBe(401);
    expect(cdnInvalidation.handleContractEvent).not.toHaveBeenCalled();
  });

  test("accepts a request with a correct HMAC signature", async () => {
    process.env.CDN_WEBHOOK_SECRET = "shh";
    const cdnInvalidation = { handleContractEvent: jest.fn().mockResolvedValue({ success: true }) };
    const app = buildApp({ cdnInvalidation });

    const body = { eventType: "escrow_released", jobId: "job-1" };
    const signature = crypto.createHmac("sha256", "shh").update(JSON.stringify(body)).digest("hex");

    const res = await request(app)
      .post("/api/cdn/webhook")
      .set("X-Webhook-Signature", signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(cdnInvalidation.handleContractEvent).toHaveBeenCalled();
  });

  test("returns 502 when every CDN provider fails to purge", async () => {
    delete process.env.CDN_WEBHOOK_SECRET;
    const cdnInvalidation = {
      handleContractEvent: jest.fn().mockRejectedValue(new Error("all providers down")),
    };
    const app = buildApp({ cdnInvalidation });

    const res = await request(app)
      .post("/api/cdn/webhook")
      .send({ eventType: "escrow_released", jobId: "job-1" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("all providers down");
  });
});

export {};
