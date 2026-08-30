/**
 * src/services/flagService.js
 * Feature flag CRUD, Redis caching (60s TTL), and audit logging.
 */
"use strict";

const pool = require("../db/pool");
const cacheService = require("./cacheService");

const CACHE_PREFIX = "flags:ruleset:";
const CACHE_TTL = 60; // seconds

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const BREAKER_THRESHOLD = Number(process.env.FLAG_CIRCUIT_BREAKER_THRESHOLD) || 5;
const BREAKER_RECOVERY_MS = Number(process.env.FLAG_CIRCUIT_RECOVERY_MS) || 30_000;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + BREAKER_RECOVERY_MS;
  }
}

function recordSuccess() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function isCircuitOpen() {
  return Date.now() < circuitOpenUntil;
}

// ─── Flag CRUD ────────────────────────────────────────────────────────────────

async function createFlag({ key, name, description, flag_type, default_value, safe_value, created_by }) {
  const { rows } = await pool.query(
    `INSERT INTO feature_flags (key, name, description, flag_type, default_value, safe_value, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     RETURNING *`,
    [key, name, description || "", flag_type || "boolean", JSON.stringify(default_value ?? false), JSON.stringify(safe_value ?? false), created_by]
  );
  await invalidateCache();
  return rows[0];
}

async function updateFlag(id, fields) {
  const allowed = ["name", "description", "flag_type", "default_value", "safe_value", "enabled"];
  const sets = [];
  const values = [];
  let idx = 1;

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      if (field === "default_value" || field === "safe_value") {
        sets.push(`${field} = $${idx}::jsonb`);
        values.push(JSON.stringify(fields[field]));
      } else {
        sets.push(`${field} = $${idx}`);
        values.push(fields[field]);
      }
      idx++;
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE feature_flags SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  await invalidateCache();
  return rows[0] || null;
}

async function getFlag(id) {
  const { rows } = await pool.query("SELECT * FROM feature_flags WHERE id = $1", [id]);
  return rows[0] || null;
}

async function getFlagByKey(key) {
  const { rows } = await pool.query("SELECT * FROM feature_flags WHERE key = $1", [key]);
  return rows[0] || null;
}

async function listFlags({ enabled, limit = 50, offset = 0 } = {}) {
  let sql = "SELECT * FROM feature_flags";
  const params = [];
  if (enabled !== undefined) {
    sql += " WHERE enabled = $1";
    params.push(enabled);
  }
  sql += " ORDER BY created_at DESC LIMIT $" + (params.length + 1) + " OFFSET $" + (params.length + 2);
  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function countFlags() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM feature_flags");
  return rows[0].count;
}

// ─── Kill Switch ──────────────────────────────────────────────────────────────

async function killFlag(id, actorAddress) {
  const { rows } = await pool.query(
    `UPDATE feature_flags
     SET killed_at = NOW(), killed_by = $2, updated_at = NOW()
     WHERE id = $1 AND killed_at IS NULL
     RETURNING *`,
    [id, actorAddress]
  );
  if (rows[0]) {
    await auditLog(id, "killed", { killed_by: actorAddress }, actorAddress);
    await invalidateCache();
  }
  return rows[0] || null;
}

async function unkillFlag(id, actorAddress) {
  const { rows } = await pool.query(
    `UPDATE feature_flags
     SET killed_at = NULL, killed_by = NULL, updated_at = NOW()
     WHERE id = $1 AND killed_at IS NOT NULL
     RETURNING *`,
    [id]
  );
  if (rows[0]) {
    await auditLog(id, "unkilled", {}, actorAddress);
    await invalidateCache();
  }
  return rows[0] || null;
}

// ─── Targeting Rules ──────────────────────────────────────────────────────────

async function createRule({ flag_id, name, priority, conditions, allocations }) {
  const { rows } = await pool.query(
    `INSERT INTO flag_targeting_rules (flag_id, name, priority, conditions, allocations)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING *`,
    [flag_id, name, priority || 100, JSON.stringify(conditions || {}), JSON.stringify(allocations || [])]
  );
  await invalidateCache();
  return rows[0];
}

async function updateRule(id, fields) {
  const allowed = ["name", "priority", "conditions", "allocations", "enabled"];
  const sets = [];
  const values = [];
  let idx = 1;

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      if (field === "conditions" || field === "allocations") {
        sets.push(`${field} = $${idx}::jsonb`);
        values.push(JSON.stringify(fields[field]));
      } else {
        sets.push(`${field} = $${idx}`);
        values.push(fields[field]);
      }
      idx++;
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE flag_targeting_rules SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  await invalidateCache();
  return rows[0] || null;
}

async function deleteRule(id) {
  await pool.query("DELETE FROM flag_targeting_rules WHERE id = $1", [id]);
  await invalidateCache();
}

async function listRules(flagId) {
  const { rows } = await pool.query(
    "SELECT * FROM flag_targeting_rules WHERE flag_id = $1 ORDER BY priority ASC",
    [flagId]
  );
  return rows;
}

// ─── Overrides ────────────────────────────────────────────────────────────────

async function createOverride({ flag_id, context_key, value, created_by }) {
  const { rows } = await pool.query(
    `INSERT INTO flag_overrides (flag_id, context_key, value, created_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (flag_id, context_key) DO UPDATE SET value = $3::jsonb
     RETURNING *`,
    [flag_id, context_key, JSON.stringify(value), created_by]
  );
  await invalidateCache();
  return rows[0];
}

async function deleteOverride(id) {
  await pool.query("DELETE FROM flag_overrides WHERE id = $1", [id]);
  await invalidateCache();
}

async function listOverrides(flagId) {
  const { rows } = await pool.query(
    "SELECT * FROM flag_overrides WHERE flag_id = $1 ORDER BY created_at DESC",
    [flagId]
  );
  return rows;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

async function auditLog(flagId, action, changes, actorAddress, actorEmail) {
  await pool.query(
    `INSERT INTO flag_audit_log (flag_id, action, changes, actor_address, actor_email)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [flagId, action, JSON.stringify(changes || {}), actorAddress, actorEmail || null]
  );
}

async function getAuditLog(flagId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM flag_audit_log
     WHERE flag_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [flagId, limit, offset]
  );
  return rows;
}

// ─── Ruleset (full flag + rules + overrides for evaluation) ───────────────────

async function getRuleset() {
  const cached = await cacheService.get("flags:ruleset:all");
  if (cached) return cached;

  try {
    const flags = await pool.query(
      "SELECT * FROM feature_flags WHERE enabled = true OR killed_at IS NOT NULL"
    );

    const result = [];
    for (const flag of flags.rows) {
      const [rules, overrides] = await Promise.all([
        pool.query("SELECT * FROM flag_targeting_rules WHERE flag_id = $1 ORDER BY priority ASC", [flag.id]),
        pool.query("SELECT * FROM flag_overrides WHERE flag_id = $1", [flag.id]),
      ]);

      result.push({
        ...flag,
        default_value: typeof flag.default_value === "string" ? JSON.parse(flag.default_value) : flag.default_value,
        safe_value: typeof flag.safe_value === "string" ? JSON.parse(flag.safe_value) : flag.safe_value,
        targeting_rules: rules.rows.map((r) => ({
          ...r,
          conditions: typeof r.conditions === "string" ? JSON.parse(r.conditions) : r.conditions,
          allocations: typeof r.allocations === "string" ? JSON.parse(r.allocations) : r.allocations,
        })),
        overrides: overrides.rows.map((o) => ({
          ...o,
          value: typeof o.value === "string" ? JSON.parse(o.value) : o.value,
        })),
      });
    }

    await cacheService.set("flags:ruleset:all", result, CACHE_TTL);
    recordSuccess();
    return result;
  } catch (err) {
    recordFailure();
    throw err;
  }
}

// ─── Exposure Events ──────────────────────────────────────────────────────────

async function logExposure({ flag_id, variant, user_id, context }) {
  await pool.query(
    `INSERT INTO flag_exposure_events (flag_id, variant, user_id, context)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [flag_id, variant, user_id || null, JSON.stringify(context || {})]
  );
}

// ─── Cache Invalidation ───────────────────────────────────────────────────────

async function invalidateCache() {
  await cacheService.delPattern("flags:*");
}

// ─── Stale Flag Detection ────────────────────────────────────────────────────

async function getStaleFlags({ days = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM feature_flags
     WHERE enabled = true
       AND killed_at IS NULL
       AND (last_evaluated_at IS NULL OR last_evaluated_at < NOW() - ($1 || ' days')::interval)
     ORDER BY last_evaluated_at ASC NULLS FIRST`,
    [String(days)]
  );
  return rows;
}

async function updateLastEvaluated(flagId) {
  await pool.query(
    "UPDATE feature_flags SET last_evaluated_at = NOW() WHERE id = $1",
    [flagId]
  );
}

module.exports = {
  createFlag,
  updateFlag,
  getFlag,
  getFlagByKey,
  listFlags,
  countFlags,
  killFlag,
  unkillFlag,
  createRule,
  updateRule,
  deleteRule,
  listRules,
  createOverride,
  deleteOverride,
  listOverrides,
  auditLog,
  getAuditLog,
  getRuleset,
  logExposure,
  invalidateCache,
  getStaleFlags,
  updateLastEvaluated,
  isCircuitOpen,
};

// Test-only exports
module.exports._test = { recordFailure, recordSuccess };
