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

function verifyWebhookSignature(req: any) {
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

router.get("/health", (req: any, res: any) => {
  const cdnService = req.app.locals.cdnService;
  if (!cdnService) return res.status(500).json({ error: "CDN service not available" });
  res.json({ success: true, providers: cdnService.getHealth() });
});

router.post("/webhook", async (req: any, res: any) => {
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
  } catch (error: any) {
    res.status(502).json({ error: error.message });
  }
});

module.exports = router;

export {};
