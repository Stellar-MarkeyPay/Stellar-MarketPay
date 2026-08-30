/**
 * src/routes/adminAssessments.test.js
 * Proves the authoring/publish endpoints reject unauthorized requests through
 * the real verifyJWT / requireAdminRole / requireAdmin2FA chain (Issue #267
 * Phase 1, rule: no mocked-always-succeed auth check) and that malformed
 * question/skill input is rejected by the real validators before it ever
 * reaches the database.
 */
"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

jest.mock("../db/pool", () => ({ query: jest.fn() }));

const pool = require("../db/pool");
const adminAssessmentRoutes = require("./adminAssessments");

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_ADDRESS = "GADMINASSESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZXXXXXXX";
const NON_ADMIN_ADDRESS = "GUSERASSESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZXXXXXXXX";

function adminToken(extra = {}) {
  return jwt.sign({ publicKey: ADMIN_ADDRESS, role: "admin", ...extra }, JWT_SECRET);
}

function nonAdminToken() {
  return jwt.sign({ publicKey: NON_ADMIN_ADDRESS, role: "freelancer" }, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/assessments", adminAssessmentRoutes);
  return app;
}

const VALID_SKILL_BODY = { slug: "rust", label: "Rust" };

describe("authoring endpoints reject unauthorized requests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .send(VALID_SKILL_BODY);

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid JWT", async () => {
    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", "Bearer not-a-real-token")
      .send(VALID_SKILL_BODY);

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects a valid, non-admin JWT with 403 (real role check, not mocked)", async () => {
    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${nonAdminToken()}`)
      .send(VALID_SKILL_BODY);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects an admin JWT that hasn't completed required 2FA", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });

    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send(VALID_SKILL_BODY);

    expect(res.status).toBe(403);
    expect(res.body.requires2FA).toBe(true);
  });

  it("allows an admin JWT with 2FA verified through to the handler", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] }); // requireAdmin2FA check
    pool.query.mockResolvedValueOnce({ rows: [{ id: "skill-1", ...VALID_SKILL_BODY }] }); // INSERT

    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${adminToken({ "2fa_verified": true })}`)
      .send(VALID_SKILL_BODY);

    expect(res.status).toBe(201);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

describe("authoring endpoints reject malformed input before hitting the database", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValueOnce({ rows: [] }); // requireAdmin2FA: no admin_profiles row
  });

  it("rejects a skill with no label", async () => {
    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ slug: "rust" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
    expect(pool.query).toHaveBeenCalledTimes(1); // only the 2FA lookup, never an INSERT
  });

  it("rejects a skill with an uppercase / invalid slug", async () => {
    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ slug: "Rust Lang!", label: "Rust" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slug/i);
  });

  it("rejects a question with fewer than 2 options", async () => {
    const res = await request(buildApp())
      .post("/api/admin/assessments/skills/rust/questions")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({
        questionText: "What is ownership?",
        options: ["A single option"],
        correctOptionIndex: 0,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/options/i);
  });

  it("rejects a question whose correctOptionIndex is out of range", async () => {
    const res = await request(buildApp())
      .post("/api/admin/assessments/skills/rust/questions")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({
        questionText: "What is ownership?",
        options: ["A", "B", "C"],
        correctOptionIndex: 5,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/correctOptionIndex/i);
  });
});
