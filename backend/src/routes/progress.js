/**
 * src/routes/progress.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const { addProgressUpdate, getProgressUpdates } = require("../services/progressService");

/**
 * @swagger
 * /api/progress/{jobId}:
 *   get:
 *     summary: List progress updates for a job
 *     description: Returns all progress updates posted for a job, newest first, each annotated with the author's display name. Public endpoint — no authentication required.
 *     tags: [Progress]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the job whose progress updates are being requested
 *         example: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *     responses:
 *       200:
 *         description: Progress updates retrieved successfully (empty array if none exist)
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
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       job_id:
 *                         type: string
 *                         format: uuid
 *                       author_address:
 *                         type: string
 *                       update_text:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       author_name:
 *                         type: string
 *                         nullable: true
 *             example:
 *               success: true
 *               data:
 *                 - id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                   job_id: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                   author_address: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   update_text: Finished the escrow release flow, starting on the dispute UI next.
 *                   created_at: "2026-08-20T15:00:00.000Z"
 *                   author_name: Jane Freelancer
 */
router.get("/:jobId", async (req, res, next) => {
  try {
    const updates = await getProgressUpdates(req.params.jobId);
    res.json({ success: true, data: updates });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/progress:
 *   post:
 *     summary: Post a progress update for a job
 *     description: Creates a new progress update row for a job. No authentication is enforced by this route — the caller supplies the author address directly in the request body.
 *     tags: [Progress]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - authorAddress
 *               - updateText
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the job this update belongs to
 *               authorAddress:
 *                 type: string
 *                 description: Stellar public key of the update author
 *               updateText:
 *                 type: string
 *                 description: Free-text progress update body
 *           example:
 *             jobId: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *             authorAddress: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *             updateText: Finished the escrow release flow, starting on the dispute UI next.
 *     responses:
 *       200:
 *         description: Progress update created successfully
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
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     job_id:
 *                       type: string
 *                       format: uuid
 *                     author_address:
 *                       type: string
 *                     update_text:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                 job_id: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                 author_address: GFREELANCER5AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 update_text: Finished the escrow release flow, starting on the dispute UI next.
 *                 created_at: "2026-08-21T10:00:00.000Z"
 *       400:
 *         description: Bad request - jobId, authorAddress, or updateText missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Missing required fields for progress update
 */
router.post("/", async (req, res, next) => {
  try {
    const update = await addProgressUpdate(req.body);
    res.json({ success: true, data: update });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
