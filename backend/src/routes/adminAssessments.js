/**
 * src/routes/adminAssessments.js
 * Assessment authoring: create/edit/publish skills and their question banks
 * (Issue #267 Phase 1). Admin-only, mirroring admin.js's permission chain.
 *
 * Delivery/scoring (assessments.js) is untouched by this phase — it still
 * reads from backend/src/data/skillQuestions.json. Wiring delivery to read
 * from these tables is Phase 2+ scope.
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { verifyJWT, requireAdminRole, requireAdmin2FA } = require("../middleware/auth");
const { validateSkillInput, validateQuestionInput } = require("../utils/assessmentValidation");

const MIN_PUBLISHED_QUESTIONS_TO_PUBLISH_SKILL = 1;

router.use(verifyJWT, requireAdminRole, requireAdmin2FA);

// Maps a Postgres error to an HTTP response, or returns false if unhandled.
function mapPgError(e, res) {
  if (e.code === "23505") {
    res.status(409).json({ error: "A record with this identifier already exists" });
    return true;
  }
  if (e.code === "23514") {
    res.status(400).json({ error: "Data failed a database validation constraint" });
    return true;
  }
  if (e.code === "22P02") {
    res.status(400).json({ error: "Invalid identifier" });
    return true;
  }
  return false;
}

// ── GET /skills — list all skills (any status), with question counts ───────
router.get("/skills", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
              COUNT(q.id) FILTER (WHERE q.status = 'published') AS published_question_count,
              COUNT(q.id) AS total_question_count
       FROM assessment_skills s
       LEFT JOIN assessment_questions q ON q.skill_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

// ── POST /skills — create a skill (draft) ────────────────────────────────────
router.post("/skills", async (req, res, next) => {
  try {
    const error = validateSkillInput(req.body);
    if (error) return res.status(400).json({ error });

    const { slug, label, passScore, durationSeconds, cooldownDays, questionsPerAttempt } =
      req.body;
    const { rows } = await pool.query(
      `INSERT INTO assessment_skills
         (slug, label, pass_score, duration_seconds, cooldown_days, questions_per_attempt, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        slug.toLowerCase(),
        label,
        passScore ?? 70,
        durationSeconds ?? 900,
        cooldownDays ?? 30,
        questionsPerAttempt ?? null,
        req.user.publicKey,
      ]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

// ── GET /skills/:slug — skill detail + its questions (any status) ───────────
router.get("/skills/:slug", async (req, res, next) => {
  try {
    const { rows: skillRows } = await pool.query("SELECT * FROM assessment_skills WHERE slug = $1", [
      req.params.slug.toLowerCase(),
    ]);
    if (!skillRows.length) return res.status(404).json({ error: "Skill not found" });

    const { rows: questionRows } = await pool.query(
      "SELECT * FROM assessment_questions WHERE skill_id = $1 ORDER BY created_at ASC",
      [skillRows[0].id]
    );
    res.json({ success: true, data: { ...skillRows[0], questions: questionRows } });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

// ── PATCH /skills/:slug — edit label/scoring config (not slug, not archived) ─
router.patch("/skills/:slug", async (req, res, next) => {
  try {
    if (req.body.slug !== undefined) {
      return res.status(400).json({ error: "slug cannot be changed after creation" });
    }

    const { rows: existingRows } = await pool.query(
      "SELECT * FROM assessment_skills WHERE slug = $1",
      [req.params.slug.toLowerCase()]
    );
    if (!existingRows.length) return res.status(404).json({ error: "Skill not found" });
    const existing = existingRows[0];
    if (existing.status === "archived") {
      return res.status(409).json({ error: "Cannot edit an archived skill" });
    }

    const merged = {
      slug: existing.slug,
      label: req.body.label ?? existing.label,
      passScore: req.body.passScore ?? existing.pass_score,
      durationSeconds: req.body.durationSeconds ?? existing.duration_seconds,
      cooldownDays: req.body.cooldownDays ?? existing.cooldown_days,
      questionsPerAttempt:
        req.body.questionsPerAttempt !== undefined
          ? req.body.questionsPerAttempt
          : existing.questions_per_attempt,
    };
    const error = validateSkillInput(merged);
    if (error) return res.status(400).json({ error });

    const { rows } = await pool.query(
      `UPDATE assessment_skills
       SET label = $1, pass_score = $2, duration_seconds = $3, cooldown_days = $4,
           questions_per_attempt = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        merged.label,
        merged.passScore,
        merged.durationSeconds,
        merged.cooldownDays,
        merged.questionsPerAttempt,
        existing.id,
      ]
    );
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

// ── POST /skills/:slug/publish — publish once it has >=1 published question ─
router.post("/skills/:slug/publish", async (req, res, next) => {
  try {
    const { rows: skillRows } = await pool.query(
      "SELECT * FROM assessment_skills WHERE slug = $1",
      [req.params.slug.toLowerCase()]
    );
    if (!skillRows.length) return res.status(404).json({ error: "Skill not found" });
    const skill = skillRows[0];
    if (skill.status === "archived") {
      return res.status(409).json({ error: "Cannot publish an archived skill" });
    }

    const { rows: countRows } = await pool.query(
      "SELECT COUNT(*) FROM assessment_questions WHERE skill_id = $1 AND status = 'published'",
      [skill.id]
    );
    const publishedCount = Number(countRows[0].count);
    if (publishedCount < MIN_PUBLISHED_QUESTIONS_TO_PUBLISH_SKILL) {
      return res.status(409).json({
        error: `Skill needs at least ${MIN_PUBLISHED_QUESTIONS_TO_PUBLISH_SKILL} published question(s) before it can be published`,
        publishedQuestionCount: publishedCount,
      });
    }

    const { rows } = await pool.query(
      "UPDATE assessment_skills SET status = 'published', updated_at = NOW() WHERE id = $1 RETURNING *",
      [skill.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

// ── POST /skills/:slug/archive — remove a skill from authoring/delivery ─────
router.post("/skills/:slug/archive", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "UPDATE assessment_skills SET status = 'archived', updated_at = NOW() WHERE slug = $1 RETURNING *",
      [req.params.slug.toLowerCase()]
    );
    if (!rows.length) return res.status(404).json({ error: "Skill not found" });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

// ── POST /skills/:slug/questions — add a question (draft) ───────────────────
router.post("/skills/:slug/questions", async (req, res, next) => {
  try {
    const error = validateQuestionInput(req.body);
    if (error) return res.status(400).json({ error });

    const { rows: skillRows } = await pool.query(
      "SELECT * FROM assessment_skills WHERE slug = $1",
      [req.params.slug.toLowerCase()]
    );
    if (!skillRows.length) return res.status(404).json({ error: "Skill not found" });
    const skill = skillRows[0];
    if (skill.status === "archived") {
      return res.status(409).json({ error: "Cannot add questions to an archived skill" });
    }

    const { questionText, options, correctOptionIndex, difficulty, tags } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO assessment_questions
         (skill_id, question_text, options, correct_option_index, difficulty, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        skill.id,
        questionText,
        JSON.stringify(options),
        correctOptionIndex,
        difficulty || "intermediate",
        tags || [],
        req.user.publicKey,
      ]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

// ── PATCH /skills/:slug/questions/:id — edit a question ─────────────────────
// Editing a published question reverts it to draft and bumps its version, so
// an in-flight attempt never sees content change under it.
router.patch("/skills/:slug/questions/:id", async (req, res, next) => {
  try {
    const { rows: existingRows } = await pool.query(
      `SELECT q.*
       FROM assessment_questions q
       JOIN assessment_skills s ON s.id = q.skill_id
       WHERE s.slug = $1 AND q.id = $2`,
      [req.params.slug.toLowerCase(), req.params.id]
    );
    if (!existingRows.length) return res.status(404).json({ error: "Question not found" });
    const existing = existingRows[0];

    const merged = {
      questionText: req.body.questionText ?? existing.question_text,
      options: req.body.options ?? existing.options,
      correctOptionIndex:
        req.body.correctOptionIndex !== undefined
          ? req.body.correctOptionIndex
          : existing.correct_option_index,
      difficulty: req.body.difficulty ?? existing.difficulty,
      tags: req.body.tags ?? existing.tags,
    };
    const error = validateQuestionInput(merged);
    if (error) return res.status(400).json({ error });

    const wasPublished = existing.status === "published";
    const { rows } = await pool.query(
      `UPDATE assessment_questions
       SET question_text = $1, options = $2, correct_option_index = $3, difficulty = $4, tags = $5,
           version = version + 1,
           status = CASE WHEN status = 'published' THEN 'draft' ELSE status END,
           published_at = CASE WHEN status = 'published' THEN NULL ELSE published_at END,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        merged.questionText,
        JSON.stringify(merged.options),
        merged.correctOptionIndex,
        merged.difficulty,
        merged.tags,
        existing.id,
      ]
    );
    res.json({ success: true, data: rows[0], revertedToDraft: wasPublished });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

// ── POST /skills/:slug/questions/:id/publish ─────────────────────────────────
router.post("/skills/:slug/questions/:id/publish", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE assessment_questions q
       SET status = 'published', published_at = NOW(), updated_at = NOW()
       FROM assessment_skills s
       WHERE s.id = q.skill_id AND s.slug = $1 AND q.id = $2 AND s.status != 'archived'
       RETURNING q.*`,
      [req.params.slug.toLowerCase(), req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Question not found, or its skill is archived" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

// ── POST /skills/:slug/questions/:id/archive ─────────────────────────────────
router.post("/skills/:slug/questions/:id/archive", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE assessment_questions q
       SET status = 'archived', updated_at = NOW()
       FROM assessment_skills s
       WHERE s.id = q.skill_id AND s.slug = $1 AND q.id = $2
       RETURNING q.*`,
      [req.params.slug.toLowerCase(), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Question not found" });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (mapPgError(e, res)) return;
    next(e);
  }
});

module.exports = router;
