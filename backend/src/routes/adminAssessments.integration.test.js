/**
 * src/routes/adminAssessments.integration.test.js
 * Integration tests against a REAL Postgres database (see jest.setup.js for
 * DATABASE_URL; CI provides a postgres:16-alpine service for this job).
 * `../db/pool` is NOT mocked here — every query in this file hits the actual
 * V16__assessment_authoring schema, so the assertions below prove the real
 * CHECK constraints and the real create -> publish authoring flow work, not
 * just that the route code calls pool.query with plausible-looking SQL.
 */
"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const pool = require("../db/pool");
const { migrate } = require("../db/migrate");
const adminAssessmentRoutes = require("./adminAssessments");

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_ADDRESS = "GADMINASSESSINTEG1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZXX";
const NON_ADMIN_ADDRESS = "GUSERASSESSINTEG1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZXXX";

function adminToken() {
  return jwt.sign({ publicKey: ADMIN_ADDRESS, role: "admin" }, JWT_SECRET);
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

async function resetTables() {
  await pool.query("TRUNCATE assessment_questions, assessment_skills CASCADE");
}

const VALID_QUESTION = {
  questionText: "What does `cargo check` do?",
  options: [
    "Runs tests",
    "Type-checks without building a binary",
    "Deploys to crates.io",
    "Formats code",
  ],
  correctOptionIndex: 1,
};

beforeAll(async () => {
  await migrate();
}, 30000);

afterEach(async () => {
  await resetTables();
});

afterAll(async () => {
  await pool.end();
});

describe("assessment authoring — real schema constraints", () => {
  it("rejects an unauthorized request through the real auth chain (no mocked check)", async () => {
    const unauth = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .send({ slug: "rust", label: "Rust" });
    expect(unauth.status).toBe(401);

    const forbidden = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${nonAdminToken()}`)
      .send({ slug: "rust", label: "Rust" });
    expect(forbidden.status).toBe(403);

    const { rows } = await pool.query("SELECT * FROM assessment_skills WHERE slug = 'rust'");
    expect(rows).toHaveLength(0);
  });

  it("creates a skill through the API and persists it in Postgres", async () => {
    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ slug: "rust", label: "Rust" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("draft");

    const { rows } = await pool.query("SELECT * FROM assessment_skills WHERE slug = 'rust'");
    expect(rows).toHaveLength(1);
    expect(rows[0].pass_score).toBe(70);
  });

  it("enforces the unique slug constraint (real 23505, not app-level)", async () => {
    await pool.query(
      `INSERT INTO assessment_skills (slug, label, created_by) VALUES ('rust', 'Rust', 'seed')`
    );

    const res = await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ slug: "rust", label: "Rust Duplicate" });

    expect(res.status).toBe(409);
  });

  it("rejects an out-of-range pass_score at the database layer, bypassing app validation", async () => {
    await expect(
      pool.query(
        `INSERT INTO assessment_skills (slug, label, pass_score, created_by)
         VALUES ('rust', 'Rust', 150, 'seed')`
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a correct_option_index outside the options array at the database layer", async () => {
    const { rows: skillRows } = await pool.query(
      `INSERT INTO assessment_skills (slug, label, created_by) VALUES ('rust', 'Rust', 'seed') RETURNING id`
    );

    await expect(
      pool.query(
        `INSERT INTO assessment_questions (skill_id, question_text, options, correct_option_index, created_by)
         VALUES ($1, 'Q', '["a","b"]'::jsonb, 5, 'seed')`,
        [skillRows[0].id]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects an options array with fewer than 2 entries at the database layer", async () => {
    const { rows: skillRows } = await pool.query(
      `INSERT INTO assessment_skills (slug, label, created_by) VALUES ('rust', 'Rust', 'seed') RETURNING id`
    );

    await expect(
      pool.query(
        `INSERT INTO assessment_questions (skill_id, question_text, options, correct_option_index, created_by)
         VALUES ($1, 'Q', '["only-one"]'::jsonb, 0, 'seed')`,
        [skillRows[0].id]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("blocks publishing a skill with zero published questions", async () => {
    await request(buildApp())
      .post("/api/admin/assessments/skills")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ slug: "rust", label: "Rust" });

    const res = await request(buildApp())
      .post("/api/admin/assessments/skills/rust/publish")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(409);
    expect(res.body.publishedQuestionCount).toBe(0);

    const { rows } = await pool.query("SELECT status FROM assessment_skills WHERE slug = 'rust'");
    expect(rows[0].status).toBe("draft");
  });

  it("full authoring flow: create skill, add question, publish question, publish skill", async () => {
    const app = buildApp();
    const auth = { Authorization: `Bearer ${adminToken()}` };

    await request(app)
      .post("/api/admin/assessments/skills")
      .set(auth)
      .send({ slug: "rust", label: "Rust" });

    const questionRes = await request(app)
      .post("/api/admin/assessments/skills/rust/questions")
      .set(auth)
      .send(VALID_QUESTION);
    expect(questionRes.status).toBe(201);
    expect(questionRes.body.data.status).toBe("draft");
    const questionId = questionRes.body.data.id;

    const stillBlocked = await request(app)
      .post("/api/admin/assessments/skills/rust/publish")
      .set(auth);
    expect(stillBlocked.status).toBe(409);

    const publishQuestion = await request(app)
      .post(`/api/admin/assessments/skills/rust/questions/${questionId}/publish`)
      .set(auth);
    expect(publishQuestion.status).toBe(200);
    expect(publishQuestion.body.data.status).toBe("published");

    const publishSkill = await request(app)
      .post("/api/admin/assessments/skills/rust/publish")
      .set(auth);
    expect(publishSkill.status).toBe(200);
    expect(publishSkill.body.data.status).toBe("published");

    const detail = await request(app).get("/api/admin/assessments/skills/rust").set(auth);
    expect(detail.body.data.questions).toHaveLength(1);
    expect(detail.body.data.questions[0].status).toBe("published");
  });

  it("reverts a published question to draft and bumps its version when edited", async () => {
    const app = buildApp();
    const auth = { Authorization: `Bearer ${adminToken()}` };

    await request(app)
      .post("/api/admin/assessments/skills")
      .set(auth)
      .send({ slug: "rust", label: "Rust" });
    const created = await request(app)
      .post("/api/admin/assessments/skills/rust/questions")
      .set(auth)
      .send(VALID_QUESTION);
    const questionId = created.body.data.id;

    await request(app)
      .post(`/api/admin/assessments/skills/rust/questions/${questionId}/publish`)
      .set(auth);

    const edited = await request(app)
      .patch(`/api/admin/assessments/skills/rust/questions/${questionId}`)
      .set(auth)
      .send({ questionText: "What does `cargo check` actually do?" });

    expect(edited.status).toBe(200);
    expect(edited.body.data.status).toBe("draft");
    expect(edited.body.data.version).toBe(2);
    expect(edited.body.revertedToDraft).toBe(true);
  });
});
