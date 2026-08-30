/**
 * src/routes/flags.js
 * Public evaluation endpoints for feature flags.
 */
"use strict";

const express = require("express");
const router = express.Router();
const flagEvaluator = require("../services/flagEvaluator");
const { flagContextMiddleware } = require("../middleware/flagContext");
const { createRateLimiter } = require("../middleware/rateLimiter");

const rateLimiter = createRateLimiter(60, 1);

/**
 * POST /api/flags/evaluate
 * Evaluate a single flag.
 * Body: { key: string, context?: EvaluationContext }
 */
router.post("/evaluate", rateLimiter, flagContextMiddleware, async (req, res, next) => {
  try {
    const { key, context: overrideContext } = req.body;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'key' parameter" });
    }

    const context = { ...req.flagContext, ...overrideContext };
    const result = await flagEvaluator.evaluateFlag(key, context);

    res.json({ success: true, data: { key, ...result } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/flags/evaluate-batch
 * Evaluate multiple flags at once.
 * Body: { keys: string[], context?: EvaluationContext }
 */
router.post("/evaluate-batch", rateLimiter, flagContextMiddleware, async (req, res, next) => {
  try {
    const { keys, context: overrideContext } = req.body;
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: "Missing or invalid 'keys' parameter" });
    }
    if (keys.length > 100) {
      return res.status(400).json({ error: "Maximum 100 flags per batch" });
    }

    const context = { ...req.flagContext, ...overrideContext };
    const ruleset = await flagEvaluator.getRuleset();
    const filteredRuleset = ruleset.filter((f) => keys.includes(f.key));
    const results = await flagEvaluator.evaluateFlagsFromRuleset(filteredRuleset, context);

    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/flags/ruleset
 * Get the full ruleset for client-side evaluation.
 * Returns all enabled flags with their rules and overrides.
 */
router.get("/ruleset", rateLimiter, async (req, res, next) => {
  try {
    const ruleset = await flagEvaluator.getRuleset();
    res.json({ success: true, data: ruleset });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
