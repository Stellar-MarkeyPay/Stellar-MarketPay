"use strict";

/**
 * OpenAPI contract tests.
 *
 * These boot the real Express app (src/server.js, same module the production
 * process runs) and hit it with supertest, then assert each real response
 * against the same swagger-jsdoc spec object that /api/docs serves live
 * (src/config/swagger.js — built from the shared src/config/swaggerOptions.js
 * also used by scripts/generate-openapi.js). A hand-written fixture could
 * never catch spec drift because it would just replay whatever the spec
 * already claims; asserting the live HTTP response against the live spec
 * fails the moment either one changes without the other.
 */

const jestOpenAPI = require("jest-openapi").default;
const swaggerSpec = require("../config/swagger");

jestOpenAPI(swaggerSpec);

beforeAll(() => {
  process.env.CONTRACT_ID =
    process.env.CONTRACT_ID || "CCONTRACTID123456789012345678901234567890123456789012";
  process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
  process.env.HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  process.env.PLATFORM_WALLET_ADDRESS =
    process.env.PLATFORM_WALLET_ADDRESS ||
    "GPLATFORMWALLET1234567890123456789012345678901234567890";
});

jest.mock("../db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  return {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  };
});

jest.mock("../services/indexerService", () => {
  return jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    getHealth: jest.fn().mockReturnValue(null),
  }));
});

jest.mock("../services/priceAlertService", () => {
  return jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  }));
});

jest.mock("../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../routes/notifications", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/", (req, res) => res.json({ success: true }));
  return router;
});

jest.mock("../services/gasEstimatorService", () => ({
  getGasEstimate: jest.fn(),
}));

jest.mock("../services/applicationService", () => ({
  submitApplication: jest.fn(),
  getApplicationsForJob: jest.fn(),
  getApplicationsForFreelancer: jest.fn(),
  acceptApplication: jest.fn(),
  withdrawApplication: jest.fn(),
  closeBiddingForJob: jest.fn(),
  revealApplicationBid: jest.fn(),
}));

jest.mock("../services/analytics", () => ({
  predictJobCompletion: jest.fn().mockResolvedValue({ likelihood: 0.5 }),
  trainRegressionModel: jest.fn().mockResolvedValue({ trained: true }),
}));

jest.mock("../services/jobService", () => ({
  createJob: jest.fn(),
  getJob: jest.fn(),
  listJobs: jest.fn(),
  listJobsByClient: jest.fn(),
  updateJobEscrowId: jest.fn(),
  deleteJob: jest.fn(),
  boostJob: jest.fn(),
  incrementShareCount: jest.fn(),
  raiseDispute: jest.fn(),
  resolveDispute: jest.fn(),
  getRecommendedJobs: jest.fn(),
  incrementViewCount: jest.fn(),
  extendJobExpiry: jest.fn(),
  getSuggestions: jest.fn(),
}));

const { Utils, Keypair } = require("@stellar/stellar-sdk");

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Utils: {
      buildChallengeTx: jest.fn(),
      verifyChallengeTx: jest.fn(),
    },
  };
});

const request = require("supertest");
const app = require("../server");
const pool = require("../db/pool");
const { getGasEstimate } = require("../services/gasEstimatorService");
const { getApplicationsForJob } = require("../services/applicationService");
const { getJob } = require("../services/jobService");

const TEST_KEYPAIR = Keypair.random();
const CHALLENGE_XDR = "AAAAAFakeChallengeTransactionXDRBase64Encoded==";
const SIGNED_XDR = "AAAAAFakeSignedChallengeTransactionXDRBase64==";

function getCookie(res, name) {
  return (res.headers["set-cookie"] || [])
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(";")[0];
}

describe("OpenAPI contract: response bodies match the published spec", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ _embedded: { records: [{ sequence: 123 }] } }),
    });
    process.env.REGION = "primary-cluster";
    process.env.CLUSTER_ROLE = "active";
    process.env.REQUIRE_WRITABLE_DB = "true";
  });

  it("GET /health — healthy dependencies", async () => {
    pool.query.mockResolvedValue({ rows: [{ in_recovery: false, replay_lag_seconds: "0" }] });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res).toSatisfyApiSpec();
  });

  it("GET /health — degraded when the database check fails, still matches spec", async () => {
    pool.query.mockRejectedValue(new Error("connection refused"));

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res).toSatisfyApiSpec();
  });

  it("GET /api/gas-estimate matches the documented schema", async () => {
    getGasEstimate.mockResolvedValue({
      slow: {
        feeStroops: 100n,
        feeXlm: 0.00001,
        label: "Slow",
        description: "Lowest cost, may take longer to confirm",
        estimatedWaitLedgers: 5,
      },
      medium: {
        feeStroops: 1000n,
        feeXlm: 0.0001,
        label: "Medium",
        description: "Balanced cost and confirmation time",
        estimatedWaitLedgers: 2,
      },
      fast: {
        feeStroops: 10000n,
        feeXlm: 0.001,
        label: "Fast",
        description: "Recommended for time-sensitive transactions",
        estimatedWaitLedgers: 1,
      },
      spikeDetected: false,
      fetchedAt: new Date().toISOString(),
      cached: false,
    });

    const res = await request(app).get("/api/gas-estimate");

    expect(res.status).toBe(200);
    expect(res).toSatisfyApiSpec();
  });

  it("GET /api/applications/job/{jobId} matches the documented schema", async () => {
    getApplicationsForJob.mockResolvedValue([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        jobId: "550e8400-e29b-41d4-a716-446655440111",
        freelancerId: "GFREELANCER123456789012345678901234567890123456789",
        proposal: "I can build this.",
        bidAmount: 250,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ]);
    getJob.mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440111" });

    const res = await request(app).get(
      "/api/applications/job/550e8400-e29b-41d4-a716-446655440111"
    );

    expect(res.status).toBe(200);
    expect(res).toSatisfyApiSpec();
  });

  it("POST /api/jobs without auth returns the documented 401", async () => {
    const res = await request(app).post("/api/jobs").send({});

    expect(res.status).toBe(401);
    expect(res).toSatisfyApiSpec();
  });

  describe("SEP-10 auth flow", () => {
    beforeEach(() => {
      delete process.env.ADMIN_WALLET_ADDRESSES;
    });

    it("GET /api/auth — challenge — matches the documented schema", async () => {
      Utils.buildChallengeTx.mockReturnValue(CHALLENGE_XDR);

      const res = await request(app)
        .get("/api/auth")
        .query({ account: TEST_KEYPAIR.publicKey() });

      expect(res.status).toBe(200);
      expect(res).toSatisfyApiSpec();
    });

    it("GET /api/auth — missing account — matches the documented 400", async () => {
      const res = await request(app).get("/api/auth");

      expect(res.status).toBe(400);
      expect(res).toSatisfyApiSpec();
    });

    it("POST /api/auth — login, refresh, logout — each response matches the documented schema", async () => {
      Utils.verifyChallengeTx.mockReturnValue(TEST_KEYPAIR.publicKey());

      const loginRes = await request(app).post("/api/auth").send({ transaction: SIGNED_XDR });
      expect(loginRes.status).toBe(200);
      expect(loginRes).toSatisfyApiSpec();

      const refreshCookie = getCookie(loginRes, "refreshToken");
      const refreshRes = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", refreshCookie);
      expect(refreshRes.status).toBe(200);
      expect(refreshRes).toSatisfyApiSpec();

      const logoutRes = await request(app).post("/api/auth/logout").set("Cookie", refreshCookie);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes).toSatisfyApiSpec();
    });

    it("POST /api/auth — invalid signature — matches the documented 401", async () => {
      Utils.verifyChallengeTx.mockImplementation(() => {
        throw new Error("Invalid challenge signature");
      });

      const res = await request(app)
        .post("/api/auth")
        .send({ transaction: "TAMPERED_TRANSACTION_XDR" });

      expect(res.status).toBe(401);
      expect(res).toSatisfyApiSpec();
    });
  });
});
