"use strict";

/**
 * routes/savedSearches.test.js
 *
 * Hermetic supertest suite for the /api/saved-searches endpoints.
 * All DB access is mocked; no live network calls are made.
 *
 * Endpoints covered:
 *   GET    /api/saved-searches
 *   POST   /api/saved-searches
 *   PATCH  /api/saved-searches/:id
 *   DELETE /api/saved-searches/:id
 *
 * For every endpoint: success path, unauthenticated (no token),
 * wrong-user (ownership boundary), and validation-failure cases.
 */

// ─── Environment stubs required by server.js before any require ──────────────
beforeAll(() => {
  process.env.CONTRACT_ID =
    process.env.CONTRACT_ID || "CCONTRACTID123456789012345678901234567890123456789012";
  process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
  process.env.HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  process.env.PLATFORM_WALLET_ADDRESS =
    process.env.PLATFORM_WALLET_ADDRESS ||
    "GPLATFORMWALLET1234567890123456789012345678901234567890";
});

// ─── Mock pool (must be declared before app is required) ─────────────────────
const mockQuery = jest.fn();
jest.mock("../db/pool", () => ({
  query: mockQuery,
  connect: jest.fn().mockResolvedValue({ query: mockQuery, release: jest.fn() }),
  totalCount: 0,
  idleCount: 0,
  waitingCount: 0,
}));

// ─── Mock heavy server-startup side-effects ───────────────────────────────────
jest.mock("../db/migrate", () => ({ migrate: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() }))
);
jest.mock("../services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() }))
);
jest.mock("../routes/notifications", () => {
  const { Router } = require("express");
  const r = Router();
  r.get("/", (req, res) => res.json({ success: true }));
  return r;
});

// ─── Imports ─────────────────────────────────────────────────────────────────
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../server");

// ─── Helpers ─────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
const OWNER_KEY = "GOWNER1111111111111111111111111111111111111111111111111111";
const OTHER_KEY = "GOTHER2222222222222222222222222222222222222222222222222222";
const SEARCH_ID = "1e2d3c4b-6666-4a2b-8c3d-4e5f6a7b8c9d";

function makeToken(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "15m" });
}

const OWNER_TOKEN = makeToken(OWNER_KEY);
const OTHER_TOKEN = makeToken(OTHER_KEY);

/** A realistic saved-search row returned from the DB. */
const SAVED_SEARCH_ROW = {
  id: SEARCH_ID,
  user_address: OWNER_KEY,
  query_params: { category: "Smart Contracts", min_budget: 100 },
  notify_in_app: true,
  notify_email: false,
  last_notified_at: null,
  created_at: "2026-08-15T10:00:00.000Z",
  updated_at: "2026-08-15T10:00:00.000Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/saved-searches", () => {
  beforeEach(() => jest.clearAllMocks());

  it("200 — returns the owner's saved searches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SAVED_SEARCH_ROW] });

    const res = await request(app)
      .get("/api/saved-searches")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe(SEARCH_ID);
    expect(res.body.data[0].user_address).toBe(OWNER_KEY);
    // Confirm DB was called with the owner's key
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE user_address"), [
      OWNER_KEY,
    ]);
  });

  it("200 — returns empty array when user has no saved searches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/saved-searches")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("401 — rejects requests with no token", async () => {
    const res = await request(app).get("/api/saved-searches");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing or invalid token/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("401 — rejects a tampered / invalid token", async () => {
    const res = await request(app)
      .get("/api/saved-searches")
      .set("Authorization", "Bearer this.is.invalid");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired token/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("POST /api/saved-searches", () => {
  beforeEach(() => jest.clearAllMocks());

  it("201 — creates a saved search with defaults", async () => {
    // count check → under limit, then INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: "2" }] })
      .mockResolvedValueOnce({ rows: [SAVED_SEARCH_ROW] });

    const res = await request(app)
      .post("/api/saved-searches")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`)
      .send({ query_params: { category: "Smart Contracts", min_budget: 100 } });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(SEARCH_ID);
    expect(res.body.data.notify_in_app).toBe(true);  // default
    expect(res.body.data.notify_email).toBe(false);  // default
  });

  it("201 — honours explicit notify_email: true", async () => {
    const row = { ...SAVED_SEARCH_ROW, notify_in_app: false, notify_email: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: "0" }] })
      .mockResolvedValueOnce({ rows: [row] });

    const res = await request(app)
      .post("/api/saved-searches")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`)
      .send({ query_params: { skills: ["rust"] }, notify_in_app: false, notify_email: true });

    expect(res.status).toBe(201);
    expect(res.body.data.notify_email).toBe(true);
    expect(res.body.data.notify_in_app).toBe(false);
  });

  it("400 — rejects when query_params is missing", async () => {
    const res = await request(app)
      .post("/api/saved-searches")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`)
      .send({ notify_in_app: true });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/query_params is required/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("400 — rejects when query_params is a non-object (string)", async () => {
    const res = await request(app)
      .post("/api/saved-searches")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`)
      .send({ query_params: "category=rust" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/must be an object/i);
  });

  it("400 — rejects when query_params is null", async () => {
    const res = await request(app)
      .post("/api/saved-searches")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`)
      .send({ query_params: null });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("400 — rejects when the 10-search limit is reached", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "10" }] });

    const res = await request(app)
      .post("/api/saved-searches")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`)
      .send({ query_params: { category: "Design" } });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/10 searches/i);
  });

  it("401 — rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/saved-searches")
      .send({ query_params: { category: "Design" } });

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/saved-searches/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("200 — updates notification prefs for the owner", async () => {
    const updated = { ...SAVED_SEARCH_ROW, notify_in_app: false, notify_email: true };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const res = await request(app)
      .patch(`/api/saved-searches/${SEARCH_ID}`)
      .set("Authorization", `Bearer ${OWNER_TOKEN}`)
      .send({ notify_in_app: false, notify_email: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notify_in_app).toBe(false);
    expect(res.body.data.notify_email).toBe(true);
    // The WHERE clause must include both the id and the owner's address
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $3 AND user_address = $4"),
      [false, true, SEARCH_ID, OWNER_KEY]
    );
  });

  it("404 — returns 404 when a different user tries to update", async () => {
    // DB returns no rows because user_address does not match
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch(`/api/saved-searches/${SEARCH_ID}`)
      .set("Authorization", `Bearer ${OTHER_TOKEN}`)
      .send({ notify_email: true });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
    // The DB must have been called with the other user's key, not the owner's
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [undefined, true, SEARCH_ID, OTHER_KEY]
    );
  });

  it("404 — returns 404 for a non-existent id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch("/api/saved-searches/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`)
      .send({ notify_in_app: true });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("401 — rejects unauthenticated requests", async () => {
    const res = await request(app)
      .patch(`/api/saved-searches/${SEARCH_ID}`)
      .send({ notify_email: true });

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/saved-searches/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("200 — deletes the saved search for the owner", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .delete(`/api/saved-searches/${SEARCH_ID}`)
      .set("Authorization", `Bearer ${OWNER_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Must scope the delete to both id and the owner's address
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1 AND user_address = $2"),
      [SEARCH_ID, OWNER_KEY]
    );
  });

  it("404 — returns 404 when a different user tries to delete", async () => {
    // rowCount 0 = no matching row for this (id, user_address) pair
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(app)
      .delete(`/api/saved-searches/${SEARCH_ID}`)
      .set("Authorization", `Bearer ${OTHER_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
    // DB must have been called with the other user's key, confirming the ownership check runs
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [SEARCH_ID, OTHER_KEY]);
  });

  it("404 — returns 404 for a non-existent id", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(app)
      .delete("/api/saved-searches/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${OWNER_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("401 — rejects unauthenticated requests", async () => {
    const res = await request(app).delete(`/api/saved-searches/${SEARCH_ID}`);

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
