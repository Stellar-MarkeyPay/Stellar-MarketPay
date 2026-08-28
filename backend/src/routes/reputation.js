/**
 * src/routes/reputation.js
 *
 * Zero-knowledge reputation API (Issue #319).
 *
 *   GET  /api/reputation/:publicKey/summary   public: latest epoch/root/leaf count
 *   GET  /api/reputation/:publicKey/openings  self only: raw values+blindings for client-side proving
 *   POST /api/reputation/prove                self only: hosted proving service (see reputationService.js
 *                                              for exactly what this learns)
 *   POST /api/reputation/verify               public: off-chain verification path
 *   GET  /api/reputation/statements           public: the four statement kinds and their parameter shapes
 *
 * "Self only" means the caller's JWT publicKey must equal :publicKey — a
 * freelancer can always inspect and prove their own history; nobody else
 * gets the raw openings, which is the whole point of moving reputation
 * behind proofs.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createSensitiveRateLimiters } = require("../middleware/rateLimiter");
const reputationService = require("../services/reputationService");
const statements = require("../zk/statements");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("reputation-route");

const STATEMENT_KINDS = ["rating_threshold", "completion_count", "earnings_band", "dispute_free"];

const [openingsIpLimiter, openingsPrincipalLimiter] = createSensitiveRateLimiters({
  namespace: "reputation-openings",
  windowMinutes: 15,
  maxRequestsPerIp: 30,
  maxRequestsPerPrincipal: 20,
  principalKeyGenerator: (req) => req.user?.publicKey,
});

const [proveIpLimiter, provePrincipalLimiter] = createSensitiveRateLimiters({
  namespace: "reputation-prove",
  windowMinutes: 15,
  maxRequestsPerIp: 20,
  maxRequestsPerPrincipal: 10,
  principalKeyGenerator: (req) => req.user?.publicKey,
});

function requireSelf(req, res, next) {
  if (req.user?.publicKey !== req.params.publicKey) {
    return res.status(403).json({ error: "Forbidden: can only access your own reputation data" });
  }
  next();
}

/**
 * @swagger
 * /api/reputation/statements:
 *   get:
 *     summary: List the provable reputation statement kinds
 *     description: >
 *       Describes the four statements a freelancer can prove and a client can
 *       require — rating_threshold, completion_count, earnings_band, and
 *       dispute_free — with their public parameter shapes and what stays
 *       hidden. See docs/ADR-010-zk-reputation.md for the full guarantee in
 *       plain language.
 *     tags: [Reputation]
 *     responses:
 *       200:
 *         description: Statement catalog
 */
router.get("/statements", (req, res) => {
  res.json({
    success: true,
    data: [
      {
        kind: "rating_threshold",
        label: "Average rating at or above a threshold",
        params: { thresholdScaled: "integer 100-500 (stars x100, e.g. 450 = 4.5 stars)" },
        hides: "every individual star rating and review in the proved range",
      },
      {
        kind: "completion_count",
        label: "At least N completed, rated jobs",
        params: { minCount: "positive integer" },
        hides: "which specific jobs",
      },
      {
        kind: "earnings_band",
        label: "Total earnings within a band",
        params: { minAmount: "stroops", maxAmount: "stroops" },
        hides: "the exact total and every individual job's pay",
      },
      {
        kind: "dispute_free",
        label: "No disputes across the proved range",
        params: {},
        hides: "which jobs, or whether any came close",
      },
    ],
  });
});

/**
 * @swagger
 * /api/reputation/{publicKey}/summary:
 *   get:
 *     summary: Public summary of a subject's anchored reputation state
 *     description: >
 *       The latest epoch, Merkle root, and leaf count for a subject — enough
 *       for a verifier to sanity-check a proof's freshness without seeing any
 *       underlying rating. Public reputation (GET /api/ratings/:key) remains
 *       available unchanged for anyone who prefers it (Issue #319).
 *     tags: [Reputation]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Summary }
 *       404: { description: No reputation history yet }
 */
router.get("/:publicKey/summary", async (req, res, next) => {
  try {
    const epoch = await reputationService.latestEpoch(req.params.publicKey);
    if (!epoch)
      return res.status(404).json({ error: "No reputation history for this subject yet" });
    res.json({ success: true, data: epoch });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/reputation/{publicKey}/openings:
 *   get:
 *     summary: Fetch your own committed rating openings for client-side proving
 *     description: >
 *       Returns every (value, blinding) pair for the authenticated subject's
 *       committed rating history, so a proof can be built entirely client-side
 *       without the platform learning which statement, range, or audience was
 *       chosen. Only the authenticated subject may fetch their own openings.
 *     tags: [Reputation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Openings }
 *       403: { description: Forbidden — not the subject }
 */
router.get(
  "/:publicKey/openings",
  openingsIpLimiter,
  verifyJWT,
  openingsPrincipalLimiter,
  requireSelf,
  async (req, res, next) => {
    try {
      const openings = await reputationService.getOwnOpenings(req.params.publicKey);
      res.json({ success: true, data: openings });
    } catch (err) {
      next(err);
    }
  }
);

function validateStatementParams(kind, params = {}) {
  if (!STATEMENT_KINDS.includes(kind)) {
    return `statementKind must be one of ${STATEMENT_KINDS.join(", ")}`;
  }
  if (kind === "rating_threshold") {
    const t = Number(params.thresholdScaled);
    if (!Number.isInteger(t) || t < statements.SCORE_SCALE || t > statements.MAX_SCORE_PER_JOB) {
      return "thresholdScaled must be an integer between 100 and 500";
    }
  }
  if (kind === "completion_count") {
    if (!Number.isInteger(params.minCount) || params.minCount <= 0) {
      return "minCount must be a positive integer";
    }
  }
  if (kind === "earnings_band") {
    if (params.minAmount == null || params.maxAmount == null) {
      return "minAmount and maxAmount (stroops) are required";
    }
    try {
      if (BigInt(params.minAmount) < 0n || BigInt(params.maxAmount) < BigInt(params.minAmount)) {
        return "invalid earnings band";
      }
    } catch {
      return "minAmount/maxAmount must be integer strings";
    }
  }
  return null;
}

function validateContext(context) {
  if (!context || typeof context !== "object") return "context is required";
  if (!context.audience || typeof context.audience !== "string")
    return "context.audience is required";
  if (!context.purpose || typeof context.purpose !== "string") return "context.purpose is required";
  if (!context.nonce || typeof context.nonce !== "string") return "context.nonce is required";
  if (!Number.isFinite(Number(context.expiresAt))) return "context.expiresAt (unix ms) is required";
  const maxTtlMs = 24 * 60 * 60 * 1000;
  if (Number(context.expiresAt) > Date.now() + maxTtlMs) {
    return `context.expiresAt may not be more than ${maxTtlMs}ms in the future`;
  }
  return null;
}

/**
 * @swagger
 * /api/reputation/{publicKey}/prove:
 *   post:
 *     summary: Hosted proving service — build a reputation proof server-side
 *     description: >
 *       Builds a full proof for one of the four statement kinds, over the
 *       subject's most recent N non-revoked ratings, bound to the given
 *       context (audience/purpose/nonce/expiry). Only the authenticated
 *       subject may request a proof about themselves. This endpoint sees the
 *       subject's plaintext rating history in the proved range, the chosen
 *       statement, and who it is being proved to — see
 *       docs/ADR-010-zk-reputation.md, "Proving paths", for the full
 *       trust-boundary statement. Prefer GET .../openings and client-side
 *       proving if the platform should not learn any of that.
 *     tags: [Reputation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Proof built }
 *       400: { description: Bad request }
 *       403: { description: Forbidden — not the subject }
 *       422: { description: "Statement does not hold, or not enough contiguous ratings" }
 */
router.post(
  "/:publicKey/prove",
  proveIpLimiter,
  verifyJWT,
  provePrincipalLimiter,
  requireSelf,
  async (req, res, next) => {
    try {
      const { statementKind, statementParams, count, context } = req.body || {};
      const paramError = validateStatementParams(statementKind, statementParams);
      if (paramError) return res.status(400).json({ error: paramError });
      if (!Number.isInteger(count) || count <= 0) {
        return res.status(400).json({ error: "count must be a positive integer" });
      }
      const contextError = validateContext(context);
      if (contextError) return res.status(400).json({ error: contextError });

      const proof = await reputationService.buildProofForSubject({
        subjectAddress: req.params.publicKey,
        statementKind,
        statementParams,
        count,
        context,
      });
      logger.info(
        { subject: req.params.publicKey, statementKind, count, audience: context.audience },
        "Built hosted reputation proof"
      );
      res.status(201).json({ success: true, data: proof });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/reputation/verify:
 *   post:
 *     summary: Off-chain verification path for a reputation proof
 *     description: >
 *       Verifies a proof against this platform's epoch/root history without
 *       any on-chain settlement — for contexts (e.g. a client screening
 *       applicants) that only need a yes/no answer. See PUT
 *       /api/jobs/:id/reputation-requirement and the application-time
 *       verification in routes/applications.js for the built-in consumer of
 *       this same path.
 *     tags: [Reputation]
 *     responses:
 *       200: { description: Verification result }
 *       400: { description: Malformed proof }
 */
router.post("/verify", async (req, res, next) => {
  try {
    const { proof, audience, purpose } = req.body || {};
    if (!proof || typeof proof !== "object") {
      return res.status(400).json({ error: "proof is required" });
    }
    const result = await reputationService.verifyProofOffChain(proof, { audience, purpose });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
