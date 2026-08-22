/**
 * routes/savedSearches.js
 * CRUD endpoints for saved job search alerts (Issue #284).
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { verifyJWT } = require("../middleware/auth");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("saved-searches");
const MAX_SAVED_SEARCHES = 10;

/**
 * @swagger
 * /api/saved-searches:
 *   get:
 *     summary: List the authenticated user's saved searches
 *     description: >
 *       Returns all saved job-search alerts owned by the authenticated
 *       user, newest first.
 *     tags: [SavedSearches]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The user's saved searches
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       user_address: { type: string }
 *                       query_params: { type: object }
 *                       notify_in_app: { type: boolean }
 *                       notify_email: { type: boolean }
 *                       last_notified_at: { type: string, format: date-time, nullable: true }
 *                       created_at: { type: string, format: date-time }
 *                       updated_at: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 - id: "1e2d3c4b-6666-4a2b-8c3d-4e5f6a7b8c9d"
 *                   user_address: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                   query_params: { category: "Smart Contracts", min_budget: 100 }
 *                   notify_in_app: true
 *                   notify_email: false
 *                   last_notified_at: null
 *                   created_at: "2026-08-15T10:00:00.000Z"
 *                   updated_at: "2026-08-15T10:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get("/", verifyJWT, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_address, query_params, notify_in_app, notify_email, last_notified_at, created_at, updated_at
       FROM saved_searches
       WHERE user_address = $1
       ORDER BY created_at DESC`,
      [req.user.publicKey]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/saved-searches:
 *   post:
 *     summary: Save a new search query
 *     description: >
 *       Saves a new job-search alert for the authenticated user, with
 *       optional in-app/email notification preferences. Enforces a
 *       maximum of 10 saved searches per user; `notify_in_app` defaults
 *       to true unless explicitly set to false, and `notify_email`
 *       defaults to false.
 *     tags: [SavedSearches]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query_params
 *             properties:
 *               query_params:
 *                 type: object
 *                 description: Arbitrary job-search filter parameters to re-run for alerting (e.g. category, skills, budget range)
 *               notify_in_app:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to notify the user in-app when new matches are found
 *               notify_email:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to email the user when new matches are found
 *           example:
 *             query_params:
 *               category: "Smart Contracts"
 *               skills: ["rust", "soroban"]
 *               min_budget: 100
 *             notify_in_app: true
 *             notify_email: true
 *     responses:
 *       201:
 *         description: Saved search created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     user_address: { type: string }
 *                     query_params: { type: object }
 *                     notify_in_app: { type: boolean }
 *                     notify_email: { type: boolean }
 *                     last_notified_at: { type: string, format: date-time, nullable: true }
 *                     created_at: { type: string, format: date-time }
 *                     updated_at: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 id: "1e2d3c4b-6666-4a2b-8c3d-4e5f6a7b8c9d"
 *                 user_address: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                 query_params: { category: "Smart Contracts", skills: ["rust", "soroban"], min_budget: 100 }
 *                 notify_in_app: true
 *                 notify_email: true
 *                 last_notified_at: null
 *                 created_at: "2026-08-21T10:00:00.000Z"
 *                 updated_at: "2026-08-21T10:00:00.000Z"
 *       400:
 *         description: query_params is missing/not an object, or the user has reached the 10-saved-search limit
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             examples:
 *               missingQueryParams:
 *                 value:
 *                   success: false
 *                   error: query_params is required and must be an object
 *               limitReached:
 *                 value:
 *                   success: false
 *                   error: "You can save up to 10 searches. Please delete one first."
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post("/", verifyJWT, async (req, res, next) => {
  try {
    const { query_params, notify_in_app, notify_email } = req.body;

    if (!query_params || typeof query_params !== "object") {
      return res
        .status(400)
        .json({ success: false, error: "query_params is required and must be an object" });
    }

    // Check limit
    const countResult = await pool.query(
      "SELECT COUNT(*) AS cnt FROM saved_searches WHERE user_address = $1",
      [req.user.publicKey]
    );
    if (Number(countResult.rows[0].cnt) >= MAX_SAVED_SEARCHES) {
      return res.status(400).json({
        success: false,
        error: `You can save up to ${MAX_SAVED_SEARCHES} searches. Please delete one first.`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO saved_searches (user_address, query_params, notify_in_app, notify_email)
       VALUES ($1, $2::jsonb, $3, $4)
       RETURNING id, user_address, query_params, notify_in_app, notify_email, last_notified_at, created_at, updated_at`,
      [
        req.user.publicKey,
        JSON.stringify(query_params),
        notify_in_app !== false,
        Boolean(notify_email),
      ]
    );

    logger.info({ userId: req.user.publicKey, searchId: rows[0].id }, "Saved search created");
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/saved-searches/{id}:
 *   patch:
 *     summary: Update notification preferences for a saved search
 *     description: >
 *       Updates `notify_in_app` and/or `notify_email` for a saved search
 *       owned by the authenticated user. Omitted fields are left
 *       unchanged (via COALESCE). Only the owning user can update their
 *       own saved search.
 *     tags: [SavedSearches]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the saved search to update
 *         example: 1e2d3c4b-6666-4a2b-8c3d-4e5f6a7b8c9d
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notify_in_app:
 *                 type: boolean
 *                 description: Whether to notify the user in-app when new matches are found
 *               notify_email:
 *                 type: boolean
 *                 description: Whether to email the user when new matches are found
 *           example:
 *             notify_in_app: false
 *             notify_email: true
 *     responses:
 *       200:
 *         description: Saved search updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     user_address: { type: string }
 *                     query_params: { type: object }
 *                     notify_in_app: { type: boolean }
 *                     notify_email: { type: boolean }
 *                     last_notified_at: { type: string, format: date-time, nullable: true }
 *                     created_at: { type: string, format: date-time }
 *                     updated_at: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 id: "1e2d3c4b-6666-4a2b-8c3d-4e5f6a7b8c9d"
 *                 user_address: GAFREELANCER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *                 query_params: { category: "Smart Contracts", min_budget: 100 }
 *                 notify_in_app: false
 *                 notify_email: true
 *                 last_notified_at: null
 *                 created_at: "2026-08-15T10:00:00.000Z"
 *                 updated_at: "2026-08-21T11:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Saved search not found, or not owned by the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             example:
 *               success: false
 *               error: Saved search not found
 */
router.patch("/:id", verifyJWT, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notify_in_app, notify_email } = req.body;

    const { rows } = await pool.query(
      `UPDATE saved_searches
       SET notify_in_app = COALESCE($1, notify_in_app),
           notify_email = COALESCE($2, notify_email),
           updated_at = NOW()
       WHERE id = $3 AND user_address = $4
       RETURNING id, user_address, query_params, notify_in_app, notify_email, last_notified_at, created_at, updated_at`,
      [notify_in_app, notify_email, id, req.user.publicKey]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Saved search not found" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/saved-searches/{id}:
 *   delete:
 *     summary: Delete a saved search
 *     description: >
 *       Deletes a saved search owned by the authenticated user. Only the
 *       owning user can delete their own saved search.
 *     tags: [SavedSearches]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the saved search to delete
 *         example: 1e2d3c4b-6666-4a2b-8c3d-4e5f6a7b8c9d
 *     responses:
 *       200:
 *         description: Saved search deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Saved search not found, or not owned by the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             example:
 *               success: false
 *               error: Saved search not found
 */
router.delete("/:id", verifyJWT, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM saved_searches WHERE id = $1 AND user_address = $2",
      [id, req.user.publicKey]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Saved search not found" });
    }

    logger.info({ userId: req.user.publicKey, searchId: id }, "Saved search deleted");
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
