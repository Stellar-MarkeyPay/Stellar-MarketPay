"use strict";

/**
 * src/routes/disputes.test.js
 *
 * Hermetic HTTP-surface tests for the dispute evidence router (Issue #223),
 * following the supertest-against-the-exported-app pattern in auth.test.js.
 *
 * The module exposes two endpoints:
 *   GET  /api/disputes/:jobId          — intentionally public dispute + evidence read
 *   POST /api/disputes/:jobId/evidence — JWT-protected single-file evidence upload
 *
 * The database, the IPFS/Pinata service and every background/service boot are
 * mocked so the suite needs no live Postgres, Redis or network access.
 */

beforeAll(() => {
  process.env.CONTRACT_ID =
    process.env.CONTRACT_ID || "CCONTRACTID123456789012345678901234567890123456789012";
  process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
  process.env.HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  process.env.PLATFORM_WALLET_ADDRESS =
    process.env.PLATFORM_WALLET_ADDRESS ||
    "GPLATFORMWALLET1234567890123456789012345678901234567890";
});

// --- Database: a single jest.fn() query the tests drive via a SQL dispatcher ---
jest.mock("../db/pool", () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  return {
    query,
    connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }),
  };
});

// --- IPFS/Pinata: never touch the network ---
jest.mock("../services/ipfsService", () => ({
  uploadFile: jest.fn(),
  getGatewayUrl: jest.fn((cid) => `https://gateway.pinata.cloud/ipfs/${cid}`),
}));

// --- Neutralise rate limiting so repeated POSTs in one process don't 429 ---
jest.mock("../middleware/rateLimiter", () => {
  const actual = jest.requireActual("../middleware/rateLimiter");
  return {
    ...actual,
    createRateLimiter: () => (req, res, next) => next(),
  };
});

// --- Background services / boot side-effects (mirrors auth.test.js) ---
jest.mock("../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() }))
);
jest.mock("../services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() }))
);
jest.mock("../db/migrate", () => ({ migrate: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../routes/notifications", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/", (req, res) => res.json({ success: true }));
  return router;
});

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
const jwt = require("jsonwebtoken");
const { Keypair } = require("@stellar/stellar-sdk");

const pool = require("../db/pool");
const ipfsService = require("../services/ipfsService");
const app = require("../server");

const CLIENT = Keypair.random().publicKey();
const FREELANCER = Keypair.random().publicKey();
const OUTSIDER = Keypair.random().publicKey();

const JOB_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
// A well-formed CIDv0 accepted by disputeService.validateIpfsCid.
const VALID_CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

function tokenFor(publicKey) {
  return jwt.sign({ publicKey }, process.env.JWT_SECRET, { expiresIn: "15m" });
}

/**
 * Route pool.query calls to canned results by inspecting the SQL text, so a
 * test only declares the rows each logical query returns and stays insensitive
 * to call order.
 */
function mockDb({ job, evidence = [], count = 0, insert } = {}) {
  pool.query.mockImplementation((sql) => {
    if (/COUNT\(\*\)/i.test(sql)) {
      return Promise.resolve({ rows: [{ count: String(count) }] });
    }
    if (/INSERT INTO dispute_evidence/i.test(sql)) {
      return Promise.resolve({ rows: insert ? [insert] : [] });
    }
    if (/FROM dispute_evidence/i.test(sql)) {
      return Promise.resolve({ rows: evidence });
    }
    if (/FROM jobs/i.test(sql)) {
      return Promise.resolve({ rows: job ? [job] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const JOB_ROW = {
  id: JOB_ID,
  title: "Build a landing page",
  status: "in_progress",
  client_address: CLIENT,
  freelancer_address: FREELANCER,
  created_at: "2026-08-10T00:00:00.000Z",
};

const EVIDENCE_ROW = {
  id: "1b2c3d4e-5f60-4718-9293-a4b5c6d7e8f9",
  uploader_address: CLIENT,
  file_name: "screenshot.png",
  file_size: 204800,
  mime_type: "image/png",
  ipfs_cid: VALID_CID,
  created_at: "2026-08-20T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  ipfsService.getGatewayUrl.mockImplementation((cid) => `https://gateway.pinata.cloud/ipfs/${cid}`);
});

describe("GET /api/disputes/:jobId — public dispute + evidence read", () => {
  it("returns 200 with the job and mapped evidence (no auth required)", async () => {
    mockDb({ job: JOB_ROW, evidence: [EVIDENCE_ROW] });

    const res = await request(app).get(`/api/disputes/${JOB_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.job).toEqual(JOB_ROW);
    expect(res.body.data.evidence).toHaveLength(1);
    expect(res.body.data.evidence[0]).toEqual({
      id: EVIDENCE_ROW.id,
      uploaderAddress: CLIENT,
      fileName: "screenshot.png",
      fileSize: 204800,
      mimeType: "image/png",
      ipfsCid: VALID_CID,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${VALID_CID}`,
      createdAt: EVIDENCE_ROW.created_at,
    });
  });

  it("returns an empty evidence array when the job has no evidence", async () => {
    mockDb({ job: JOB_ROW, evidence: [] });

    const res = await request(app).get(`/api/disputes/${JOB_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.evidence).toEqual([]);
  });

  it("returns 404 when the job does not exist", async () => {
    mockDb({ job: null });

    const res = await request(app).get(`/api/disputes/${JOB_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Job not found" });
  });
});

describe("POST /api/disputes/:jobId/evidence — authentication boundary", () => {
  it("returns 401 when no token is supplied", async () => {
    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .attach("file", Buffer.from("proof"), { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Missing or invalid token");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is malformed", async () => {
    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", "Bearer not.a.real.token")
      .attach("file", Buffer.from("proof"), { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid or expired token");
  });

  it("returns 403 when the authenticated user is neither client nor freelancer", async () => {
    mockDb({ job: JOB_ROW });

    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(OUTSIDER)}`)
      .attach("file", Buffer.from("proof"), { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Only the client or freelancer can upload evidence" });
    expect(ipfsService.uploadFile).not.toHaveBeenCalled();
  });
});

describe("POST /api/disputes/:jobId/evidence — success path", () => {
  it("uploads evidence as the client and returns 201 with the persisted record", async () => {
    ipfsService.uploadFile.mockResolvedValue({ cid: VALID_CID });
    mockDb({ job: JOB_ROW, count: 0, insert: EVIDENCE_ROW });

    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(CLIENT)}`)
      .attach("file", Buffer.from("screenshot-bytes"), {
        filename: "screenshot.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        id: EVIDENCE_ROW.id,
        uploaderAddress: CLIENT,
        fileName: "screenshot.png",
        fileSize: 204800,
        mimeType: "image/png",
        ipfsCid: VALID_CID,
        gatewayUrl: `https://gateway.pinata.cloud/ipfs/${VALID_CID}`,
        createdAt: EVIDENCE_ROW.created_at,
      },
    });
    expect(ipfsService.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("also allows the freelancer party to upload evidence", async () => {
    ipfsService.uploadFile.mockResolvedValue({ cid: VALID_CID });
    mockDb({
      job: JOB_ROW,
      count: 0,
      insert: {
        ...EVIDENCE_ROW,
        uploader_address: FREELANCER,
        file_name: "notes.txt",
        mime_type: "text/plain",
      },
    });

    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(FREELANCER)}`)
      .attach("file", Buffer.from("delivery notes"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.uploaderAddress).toBe(FREELANCER);
    expect(res.body.data.mimeType).toBe("text/plain");
  });
});

describe("POST /api/disputes/:jobId/evidence — input validation", () => {
  it("returns 400 when no file is attached", async () => {
    mockDb({ job: JOB_ROW });

    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(CLIENT)}`)
      .field("note", "no file here");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "No file provided" });
    expect(ipfsService.uploadFile).not.toHaveBeenCalled();
  });

  it("returns 400 for a disallowed MIME type (multer fileFilter)", async () => {
    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(CLIENT)}`)
      .attach("file", Buffer.from("MZ..."), {
        filename: "malware.exe",
        contentType: "application/octet-stream",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("is not allowed");
    expect(ipfsService.uploadFile).not.toHaveBeenCalled();
  });

  it("returns 404 when uploading to a job that does not exist", async () => {
    mockDb({ job: null });

    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(CLIENT)}`)
      .attach("file", Buffer.from("proof"), { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Job not found" });
  });

  it("returns 400 once the party's 10-file limit is reached", async () => {
    mockDb({ job: JOB_ROW, count: 10 });

    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(CLIENT)}`)
      .attach("file", Buffer.from("proof"), { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Maximum 10 files allowed per party" });
    expect(ipfsService.uploadFile).not.toHaveBeenCalled();
  });

  it("returns 422 when the upload service returns a malformed CID", async () => {
    ipfsService.uploadFile.mockResolvedValue({ cid: "not-a-valid-cid" });
    mockDb({ job: JOB_ROW, count: 0 });

    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(CLIENT)}`)
      .attach("file", Buffer.from("proof"), { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "Invalid IPFS CID returned from upload service" });
  });

  it("propagates a 503 when the IPFS service is unavailable", async () => {
    ipfsService.uploadFile.mockRejectedValue(
      Object.assign(new Error("Upload service temporarily unavailable. Please try again later."), {
        status: 503,
        code: "PINATA_UNAVAILABLE",
      })
    );
    mockDb({ job: JOB_ROW, count: 0 });

    const res = await request(app)
      .post(`/api/disputes/${JOB_ID}/evidence`)
      .set("Authorization", `Bearer ${tokenFor(CLIENT)}`)
      .attach("file", Buffer.from("proof"), { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("temporarily unavailable");
  });
});
