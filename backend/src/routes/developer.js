"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createApiKey, listApiKeys, revokeApiKey } = require("../services/developerService");

function requireDeveloperWallet(req, res, next) {
  if (!req.user?.publicKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.use(verifyJWT, requireDeveloperWallet);

/**
 * @swagger
 * /api/developer/keys:
 *   get:
 *     summary: List developer API keys
 *     description: Returns all API keys (active and revoked) owned by the authenticated wallet, including today's request count for each key. The raw key value is never returned here — only the stored prefix.
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: API keys retrieved successfully
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
 *                       label:
 *                         type: string
 *                       key_prefix:
 *                         type: string
 *                         description: First 12 characters of the API key, safe to display
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       last_used_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       revoked_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       requests_today:
 *                         type: integer
 *                         description: Number of requests made with this key so far today
 *             example:
 *               success: true
 *               data:
 *                 - id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                   label: CI pipeline key
 *                   key_prefix: sk_live_AbCd
 *                   created_at: "2026-01-10T08:00:00.000Z"
 *                   last_used_at: "2026-08-20T14:32:00.000Z"
 *                   revoked_at: null
 *                   requests_today: 42
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get("/keys", async (req, res, next) => {
  try {
    const keys = await listApiKeys(req.user.publicKey);
    res.json({ success: true, data: keys });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/developer/keys:
 *   post:
 *     summary: Create a new developer API key
 *     description: Generates a new API key for the authenticated wallet and returns the raw secret exactly once — it is stored only as a salted hash and cannot be retrieved again after this response.
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *                 description: Human-readable label for the key. Defaults to "Developer key" if omitted, blank, or not a string.
 *           example:
 *             label: CI pipeline key
 *     responses:
 *       201:
 *         description: API key created successfully
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
 *                     label:
 *                       type: string
 *                     keyPrefix:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     apiKey:
 *                       type: string
 *                       description: The raw API key secret. Shown only in this response — save it now.
 *             example:
 *               success: true
 *               data:
 *                 id: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *                 label: CI pipeline key
 *                 keyPrefix: sk_live_AbCd
 *                 createdAt: "2026-08-21T10:00:00.000Z"
 *                 apiKey: "sk_live_<shown-once-save-it>"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post("/keys", async (req, res, next) => {
  try {
    const { label } = req.body || {};
    const created = await createApiKey({
      ownerPublicKey: req.user.publicKey,
      label,
    });

    res.status(201).json({
      success: true,
      data: {
        id: created.key.id,
        label: created.key.label,
        keyPrefix: created.key.key_prefix,
        createdAt: created.key.created_at,
        apiKey: created.apiKey,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/developer/keys/{id}:
 *   delete:
 *     summary: Revoke a developer API key
 *     description: Revokes (soft-deletes) an API key owned by the authenticated wallet by setting its revoked_at timestamp. Once revoked, the key can no longer authenticate requests.
 *     tags: [Developer]
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
 *         description: ID of the API key to revoke
 *         example: 2a6e9d3f-1a2b-4c3d-9e0f-1a2b3c4d5e6f
 *     responses:
 *       200:
 *         description: API key revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: API key revoked
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: API key not found, not owned by the caller, or already revoked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: API key not found
 */
router.delete("/keys/:id", async (req, res, next) => {
  try {
    const revoked = await revokeApiKey(req.user.publicKey, req.params.id);
    if (!revoked) {
      return res.status(404).json({ error: "API key not found" });
    }

    res.json({ success: true, message: "API key revoked" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
