/**
 * src/routes/assessments.js
 * Skill assessment endpoints.
 *
 * GET  /api/assessments/:skill          — get questions (options only, no answers)
 * POST /api/assessments/:skill/submit   — submit answers, record result
 * GET  /api/assessments/results/:publicKey — get all results for a user
 */
"use strict";

const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { verifyJWT } = require("../middleware/auth");
const questions = require("../data/skillQuestions.json");

const PASS_SCORE = 70; // percent
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * @swagger
 * /api/assessments/{skill}:
 *   get:
 *     summary: Get skill assessment questions
 *     description: Returns the question bank for a skill assessment (multiple-choice options only, no answers) along with the caller's most recent attempt and whether they are eligible to retake it. Retakes are subject to a 30-day cooldown per skill.
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: skill
 *         required: true
 *         schema:
 *           type: string
 *           enum: [javascript, react, typescript, nodejs, solidity, stellar]
 *         description: Skill identifier (case-insensitive; lowercased before lookup)
 *         example: javascript
 *     responses:
 *       200:
 *         description: Assessment questions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     skill:
 *                       type: string
 *                     label:
 *                       type: string
 *                     questions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           question:
 *                             type: string
 *                           options:
 *                             type: array
 *                             items:
 *                               type: string
 *                     durationSeconds:
 *                       type: integer
 *                       example: 900
 *                     passScore:
 *                       type: integer
 *                       example: 70
 *                     canRetake:
 *                       type: boolean
 *                     retakeAvailableAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     lastAttempt:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         score:
 *                           type: integer
 *                         passed:
 *                           type: boolean
 *                         taken_at:
 *                           type: string
 *                           format: date-time
 *             example:
 *               success: true
 *               data:
 *                 skill: javascript
 *                 label: JavaScript
 *                 questions:
 *                   - id: 1
 *                     question: What does `typeof null` return in JavaScript?
 *                     options: ["null", "undefined", "object", "boolean"]
 *                 durationSeconds: 900
 *                 passScore: 70
 *                 canRetake: true
 *                 retakeAvailableAt: null
 *                 lastAttempt: null
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Unknown skill - no question bank exists for the given skill identifier
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Unknown skill
 */
// ─── GET /api/assessments/:skill ─────────────────────────────────────────────
// Returns questions without answers. Also returns last attempt info if authed.
router.get("/:skill", verifyJWT, async (req, res, next) => {
  try {
    const skill = req.params.skill.toLowerCase();
    const bank = questions[skill];
    if (!bank) return res.status(404).json({ error: "Unknown skill" });

    const publicKey = req.user.publicKey;

    // Check last attempt
    const { rows } = await pool.query(
      `SELECT score, passed, taken_at FROM skill_assessments
       WHERE public_key = $1 AND skill = $2
       ORDER BY taken_at DESC LIMIT 1`,
      [publicKey, skill]
    );

    const last = rows[0] || null;
    const canRetake = !last || Date.now() - new Date(last.taken_at).getTime() >= COOLDOWN_MS;
    const retakeAvailableAt =
      last && !canRetake
        ? new Date(new Date(last.taken_at).getTime() + COOLDOWN_MS).toISOString()
        : null;

    // Strip answers before sending
    const safeQuestions = bank.questions.map(({ id, question, options }) => ({
      id,
      question,
      options,
    }));

    res.json({
      success: true,
      data: {
        skill,
        label: bank.label,
        questions: safeQuestions,
        durationSeconds: 15 * 60,
        passScore: PASS_SCORE,
        canRetake,
        retakeAvailableAt,
        lastAttempt: last,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/assessments/{skill}/submit:
 *   post:
 *     summary: Submit skill assessment answers
 *     description: Grades the caller's answers against the skill's question bank, records the attempt, and — if the score meets the 70% pass threshold — issues a certificate (sha256 hash plus a deterministic IPFS-CID-like identifier) that is upserted per (publicKey, skill). Submission is blocked while a 30-day cooldown from the previous attempt is active.
 *     tags: [Assessments]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: skill
 *         required: true
 *         schema:
 *           type: string
 *           enum: [javascript, react, typescript, nodejs, solidity, stellar]
 *         description: Skill identifier (case-insensitive; lowercased before lookup)
 *         example: javascript
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - answers
 *             properties:
 *               answers:
 *                 type: object
 *                 description: Map of question id to the index of the option chosen (0-based)
 *                 additionalProperties:
 *                   type: integer
 *           example:
 *             answers:
 *               "1": 2
 *               "2": 1
 *               "3": 1
 *     responses:
 *       200:
 *         description: Assessment graded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     skill:
 *                       type: string
 *                     score:
 *                       type: integer
 *                       description: Percentage score (0-100)
 *                     passed:
 *                       type: boolean
 *                     correct:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     certificate:
 *                       type: object
 *                       nullable: true
 *                       description: Present only when passed is true
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         certificate_hash:
 *                           type: string
 *                         ipfs_cid:
 *                           type: string
 *                         issued_at:
 *                           type: string
 *                           format: date-time
 *             example:
 *               success: true
 *               data:
 *                 skill: javascript
 *                 score: 80
 *                 passed: true
 *                 correct: 4
 *                 total: 5
 *                 certificate:
 *                   id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                   certificate_hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
 *                   ipfs_cid: Qm3f5c8a1234a5b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3
 *                   issued_at: "2026-01-15T10:30:00.000Z"
 *       400:
 *         description: Bad request - answers object is missing or not an object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: answers object is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Unknown skill - no question bank exists for the given skill identifier
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Unknown skill
 *       429:
 *         description: Assessment cooldown active - the skill was attempted within the last 30 days
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Assessment cooldown active
 *                 retakeAvailableAt:
 *                   type: string
 *                   format: date-time
 */
// ─── POST /api/assessments/:skill/submit ─────────────────────────────────────
// Body: { answers: { [questionId]: selectedOptionIndex } }
router.post("/:skill/submit", verifyJWT, async (req, res, next) => {
  try {
    const skill = req.params.skill.toLowerCase();
    const bank = questions[skill];
    if (!bank) return res.status(404).json({ error: "Unknown skill" });

    const publicKey = req.user.publicKey;
    const { answers } = req.body;
    if (!answers || typeof answers !== "object") {
      return res.status(400).json({ error: "answers object is required" });
    }

    // Enforce 30-day cooldown
    const { rows: prev } = await pool.query(
      `SELECT taken_at FROM skill_assessments
       WHERE public_key = $1 AND skill = $2
       ORDER BY taken_at DESC LIMIT 1`,
      [publicKey, skill]
    );
    if (prev.length && Date.now() - new Date(prev[0].taken_at).getTime() < COOLDOWN_MS) {
      const retakeAt = new Date(new Date(prev[0].taken_at).getTime() + COOLDOWN_MS).toISOString();
      return res
        .status(429)
        .json({ error: "Assessment cooldown active", retakeAvailableAt: retakeAt });
    }

    // Grade
    let correct = 0;
    for (const q of bank.questions) {
      if (parseInt(answers[q.id], 10) === q.answer) correct++;
    }
    const score = Math.round((correct / bank.questions.length) * 100);
    const passed = score >= PASS_SCORE;

    await pool.query(
      `INSERT INTO skill_assessments (public_key, skill, score, passed)
       VALUES ($1, $2, $3, $4)`,
      [publicKey, skill, score, passed]
    );

    let certificate = null;

    // Generate on-chain certificate if passed
    if (passed) {
      const adminKey = process.env.ADMIN_PUBLIC_KEYS
        ? process.env.ADMIN_PUBLIC_KEYS.split(",")[0].trim()
        : "platform";
      const issuedAt = new Date().toISOString();
      const raw = `${publicKey}|${skill}|${score}|${issuedAt}|${adminKey}`;
      const certificateHash = crypto.createHash("sha256").update(raw).digest("hex");

      // Generate a deterministic IPFS CID-like identifier
      const cidRaw = crypto.createHash("sha256").update(`ipfs:${raw}`).digest("hex").slice(0, 46);
      const ipfsCid = `Qm${cidRaw}`;

      // Store certificate
      const { rows: certRows } = await pool.query(
        `INSERT INTO skill_certificates (public_key, skill, score, certificate_hash, ipfs_cid, issued_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (public_key, skill) DO UPDATE
           SET score = EXCLUDED.score,
               certificate_hash = EXCLUDED.certificate_hash,
               ipfs_cid = EXCLUDED.ipfs_cid,
               issued_at = EXCLUDED.issued_at
         RETURNING id, certificate_hash, ipfs_cid, issued_at`,
        [publicKey, skill, score, certificateHash, ipfsCid, issuedAt]
      );

      certificate = certRows[0];
    }

    res.json({
      success: true,
      data: { skill, score, passed, correct, total: bank.questions.length, certificate },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/assessments/results/{publicKey}:
 *   get:
 *     summary: Get skill assessment results for a user
 *     description: Public endpoint that returns the most recent assessment attempt for each skill the given Stellar public key has taken (one row per skill, the latest by taken_at). Used to render verified skill badges on a freelancer's profile. No authentication required.
 *     tags: [Assessments]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) whose assessment results are being requested
 *         example: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *     responses:
 *       200:
 *         description: Assessment results retrieved successfully (empty array if the user has not taken any assessments)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       skill:
 *                         type: string
 *                       score:
 *                         type: integer
 *                       passed:
 *                         type: boolean
 *                       taken_at:
 *                         type: string
 *                         format: date-time
 *             example:
 *               success: true
 *               data:
 *                 - skill: javascript
 *                   score: 80
 *                   passed: true
 *                   taken_at: "2026-01-15T10:30:00.000Z"
 *                 - skill: solidity
 *                   score: 55
 *                   passed: false
 *                   taken_at: "2026-02-01T09:12:00.000Z"
 */
// ─── GET /api/assessments/results/:publicKey ─────────────────────────────────
// Public — returns verified (passed) badges for a profile
router.get("/results/:publicKey", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (skill) skill, score, passed, taken_at
       FROM skill_assessments
       WHERE public_key = $1
       ORDER BY skill, taken_at DESC`,
      [req.params.publicKey]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
