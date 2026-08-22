/**
 * src/routes/cdn.js
 * Multi-CDN operational endpoints (#91):
 *   GET  /api/cdn/health   provider + circuit-breaker status (failover visibility)
 *   POST /api/cdn/webhook  external pub-sub entrypoint for contract-event-driven
 *                          purges — mirrors the internal indexerService wiring,
 *                          for deployments that run event ingestion as a
 *                          separate worker/queue consumer rather than in-process.
 */
"use strict";

const crypto = require("crypto");
const express = require("express");
const router = express.Router();

function verifyWebhookSignature(req) {
  const secret = process.env.CDN_WEBHOOK_SECRET;
  if (!secret) return true; // not configured — allow (local/dev)

  const signature = req.get("X-Webhook-Signature") || "";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(req.body || {}))
    .digest("hex");

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * @swagger
 * /api/cdn/health:
 *   get:
 *     summary: Get CDN provider health/circuit-breaker status
 *     description: >
 *       Returns per-provider health and circuit-breaker status for the multi-CDN
 *       setup, used for failover visibility. Reads `req.app.locals.cdnService`;
 *       if it hasn't been wired up (e.g. no CDN providers configured) the
 *       endpoint responds with 500.
 *     tags: [CDN]
 *     responses:
 *       200:
 *         description: Provider health list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 providers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       provider:
 *                         type: string
 *                         example: cloudflare
 *                       circuitOpen:
 *                         type: boolean
 *                         example: false
 *                       failures:
 *                         type: integer
 *                         example: 0
 *             example:
 *               success: true
 *               providers:
 *                 - provider: cloudflare
 *                   circuitOpen: false
 *                   failures: 0
 *       500:
 *         description: CDN service not available (not wired up in app.locals)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: CDN service not available
 */
router.get("/health", (req, res) => {
  const cdnService = req.app.locals.cdnService;
  if (!cdnService) return res.status(500).json({ error: "CDN service not available" });
  res.json({ success: true, providers: cdnService.getHealth() });
});

/**
 * @swagger
 * /api/cdn/webhook:
 *   post:
 *     summary: Receive a contract-event-driven CDN invalidation webhook
 *     description: >
 *       External pub-sub entrypoint that mirrors the internal indexerService
 *       wiring, for deployments that run event ingestion as a separate
 *       worker/queue consumer rather than in-process. When `CDN_WEBHOOK_SECRET`
 *       is set, the request body must be signed with HMAC-SHA256 over the raw
 *       JSON body and presented in the `X-Webhook-Signature` header; when the
 *       secret is not configured, signature verification is skipped (local/dev).
 *     tags: [CDN]
 *     parameters:
 *       - in: header
 *         name: X-Webhook-Signature
 *         schema:
 *           type: string
 *         required: false
 *         description: >
 *           Hex-encoded HMAC-SHA256 signature of the JSON request body, keyed
 *           with CDN_WEBHOOK_SECRET. Required only when that env var is set.
 *         example: 3f29a1c9e2b7...
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - eventType
 *               - jobId
 *             properties:
 *               eventType:
 *                 type: string
 *                 description: Contract event type that triggered the purge
 *                 example: escrow_released
 *               jobId:
 *                 type: string
 *                 description: ID of the job whose cached URLs/surrogate keys should be purged
 *                 example: job-1
 *           example:
 *             eventType: escrow_released
 *             jobId: job-1
 *     responses:
 *       200:
 *         description: Invalidation handled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 result:
 *                   type: object
 *                   description: Result of the invalidation, as returned by the CDN invalidation service
 *                   properties:
 *                     urls:
 *                       type: array
 *                       items:
 *                         type: string
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                     success:
 *                       type: boolean
 *             example:
 *               success: true
 *               result:
 *                 urls: ["u1"]
 *                 tags: ["t1"]
 *                 success: true
 *       400:
 *         description: Missing eventType or jobId in the request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: eventType and jobId are required
 *       401:
 *         description: Invalid HMAC webhook signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid webhook signature
 *       500:
 *         description: Invalidation service not available (not wired up in app.locals)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalidation service not available
 *       502:
 *         description: Every configured CDN provider failed to purge
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: all providers down
 */
router.post("/webhook", async (req, res) => {
  if (!verifyWebhookSignature(req)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const cdnInvalidation = req.app.locals.cdnInvalidation;
  if (!cdnInvalidation)
    return res.status(500).json({ error: "Invalidation service not available" });

  const { eventType, jobId } = req.body || {};
  if (!eventType || !jobId) {
    return res.status(400).json({ error: "eventType and jobId are required" });
  }

  try {
    const result = await cdnInvalidation.handleContractEvent(eventType, jobId, {
      receivedAt: Date.now(),
    });
    res.json({ success: true, result });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

module.exports = router;
