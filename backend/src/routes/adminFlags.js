/**
 * src/routes/adminFlags.js
 * Admin CRUD for feature flags, targeting rules, overrides, and audit log.
 * All routes require admin role + 2FA.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT, requireAdminRole, requireAdmin2FA } = require("../middleware/auth");
const flagService = require("../services/flagService");

// All routes require authentication + admin + 2FA
router.use(verifyJWT, requireAdminRole, requireAdmin2FA);

// ─── Flags CRUD ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/flags
 * List all flags with counts.
 */
router.get("/", async (req, res, next) => {
  try {
    const { enabled, limit, offset } = req.query;
    const flags = await flagService.listFlags({
      enabled: enabled !== undefined ? enabled === "true" : undefined,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    const total = await flagService.countFlags();
    const staleFlags = await flagService.getStaleFlags();

    res.json({
      success: true,
      data: {
        flags,
        total,
        staleCount: staleFlags.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/flags
 * Create a new flag.
 */
router.post("/", async (req, res, next) => {
  try {
    const { key, name, description, flag_type, default_value, safe_value } = req.body;

    if (!key || !/^[a-z][a-z0-9._-]{1,127}$/.test(key)) {
      return res.status(400).json({ error: "Invalid flag key format" });
    }
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (safe_value === undefined || safe_value === null) {
      return res.status(400).json({ error: "Safe value is required (returned when service is down)" });
    }

    const existing = await flagService.getFlagByKey(key);
    if (existing) {
      return res.status(409).json({ error: "Flag with this key already exists" });
    }

    const flag = await flagService.createFlag({
      key,
      name,
      description,
      flag_type,
      default_value,
      safe_value,
      created_by: req.user.publicKey,
    });

    await flagService.auditLog(flag.id, "created", { key, name, flag_type }, req.user.publicKey);

    res.status(201).json({ success: true, data: flag });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/flags/:id
 * Get a single flag with its rules and overrides.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const flag = await flagService.getFlag(req.params.id);
    if (!flag) {
      return res.status(404).json({ error: "Flag not found" });
    }

    const [rules, overrides, auditLog] = await Promise.all([
      flagService.listRules(flag.id),
      flagService.listOverrides(flag.id),
      flagService.getAuditLog(flag.id, { limit: 20 }),
    ]);

    res.json({
      success: true,
      data: { ...flag, targeting_rules: rules, overrides, auditLog },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/flags/:id
 * Update a flag.
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const flag = await flagService.getFlag(req.params.id);
    if (!flag) {
      return res.status(404).json({ error: "Flag not found" });
    }

    const updated = await flagService.updateFlag(req.params.id, req.body);
    if (!updated) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    await flagService.auditLog(flag.id, "updated", { before: flag, after: updated }, req.user.publicKey);

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/flags/:id
 * Archive (soft-delete) a flag by disabling it.
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const flag = await flagService.getFlag(req.params.id);
    if (!flag) {
      return res.status(404).json({ error: "Flag not found" });
    }

    await flagService.updateFlag(req.params.id, { enabled: false });
    await flagService.auditLog(flag.id, "archived", { reason: req.body.reason || "No reason provided" }, req.user.publicKey);

    res.json({ success: true, message: "Flag archived" });
  } catch (err) {
    next(err);
  }
});

// ─── Kill Switch ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/flags/:id/kill
 * Instantly kill a flag (evaluate to safe_value).
 */
router.post("/:id/kill", async (req, res, next) => {
  try {
    const killed = await flagService.killFlag(req.params.id, req.user.publicKey);
    if (!killed) {
      return res.status(404).json({ error: "Flag not found or already killed" });
    }
    res.json({ success: true, data: killed });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/flags/:id/unkill
 * Revive a killed flag.
 */
router.post("/:id/unkill", async (req, res, next) => {
  try {
    const revived = await flagService.unkillFlag(req.params.id, req.user.publicKey);
    if (!revived) {
      return res.status(404).json({ error: "Flag not found or not killed" });
    }
    res.json({ success: true, data: revived });
  } catch (err) {
    next(err);
  }
});

// ─── Targeting Rules ──────────────────────────────────────────────────────────

/**
 * POST /api/admin/flags/:id/rules
 * Create a targeting rule for a flag.
 */
router.post("/:id/rules", async (req, res, next) => {
  try {
    const flag = await flagService.getFlag(req.params.id);
    if (!flag) {
      return res.status(404).json({ error: "Flag not found" });
    }

    const rule = await flagService.createRule({
      flag_id: flag.id,
      name: req.body.name,
      priority: req.body.priority,
      conditions: req.body.conditions,
      allocations: req.body.allocations,
    });

    await flagService.auditLog(flag.id, "rule_created", { rule }, req.user.publicKey);

    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/flags/:id/rules/:ruleId
 * Update a targeting rule.
 */
router.patch("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    const updated = await flagService.updateRule(req.params.ruleId, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await flagService.auditLog(req.params.id, "rule_updated", { rule: updated }, req.user.publicKey);

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/flags/:id/rules/:ruleId
 * Delete a targeting rule.
 */
router.delete("/:id/rules/:ruleId", async (req, res, next) => {
  try {
    await flagService.deleteRule(req.params.ruleId);
    await flagService.auditLog(req.params.id, "rule_deleted", { ruleId: req.params.ruleId }, req.user.publicKey);

    res.json({ success: true, message: "Rule deleted" });
  } catch (err) {
    next(err);
  }
});

// ─── Overrides ────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/flags/:id/overrides
 * Create or update an override for a user.
 */
router.post("/:id/overrides", async (req, res, next) => {
  try {
    const flag = await flagService.getFlag(req.params.id);
    if (!flag) {
      return res.status(404).json({ error: "Flag not found" });
    }

    const { context_key, value } = req.body;
    if (!context_key) {
      return res.status(400).json({ error: "context_key is required" });
    }

    const override = await flagService.createOverride({
      flag_id: flag.id,
      context_key,
      value,
      created_by: req.user.publicKey,
    });

    await flagService.auditLog(flag.id, "override_created", { context_key, value }, req.user.publicKey);

    res.status(201).json({ success: true, data: override });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/flags/:id/overrides/:overrideId
 * Remove an override.
 */
router.delete("/:id/overrides/:overrideId", async (req, res, next) => {
  try {
    await flagService.deleteOverride(req.params.overrideId);
    await flagService.auditLog(req.params.id, "override_deleted", { overrideId: req.params.overrideId }, req.user.publicKey);

    res.json({ success: true, message: "Override deleted" });
  } catch (err) {
    next(err);
  }
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/flags/:id/audit
 * Get audit log for a flag.
 */
router.get("/:id/audit", async (req, res, next) => {
  try {
    const { limit, offset } = req.query;
    const log = await flagService.getAuditLog(req.params.id, {
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    res.json({ success: true, data: log });
  } catch (err) {
    next(err);
  }
});

// ─── Stale Flags ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/flags/stale
 * Get flags not evaluated in 30+ days.
 */
router.get("/stale", async (req, res, next) => {
  try {
    const { days } = req.query;
    const stale = await flagService.getStaleFlags({ days: days ? Number(days) : 30 });
    res.json({ success: true, data: stale });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
