/**
 * Model registry — versioning, lineage, promotion gate, and rollback.
 *
 * Models are stored in `ml/models/` with metadata tracked in a JSON
 * registry file. Each model has:
 *   - version (semver or date-based)
 *   - lineage (parent version, config hash, dataset fingerprint)
 *   - evaluation metrics
 *   - fairness gate results
 *   - promotion status (staging → production)
 *
 * Issue #265 — Phase 3: Registry and Gating
 */
"use strict";

const fs = require("fs");
const path = require("path");

const MODELS_DIR = path.join(__dirname, "..", "..", "..", "ml", "models");
const REGISTRY_PATH = path.join(MODELS_DIR, "registry.json");

// ── Registry I/O ──────────────────────────────────────────────────

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return { models: [], production: null };
  }
}

function saveRegistry(registry) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
}

// ── Model registration ────────────────────────────────────────────

/**
 * Register a newly trained model in the registry.
 * @param {object} artifact - The model artifact from training
 * @param {object} gates - { evaluation: boolean, fairness: boolean }
 * @returns {{ version: string, status: string }}
 */
function registerModel(artifact, gates = {}) {
  const registry = loadRegistry();
  const version = artifact.version;
  const existing = registry.models.find((m) => m.version === version);

  const entry = {
    version,
    registeredAt: new Date().toISOString(),
    type: artifact.type,
    evaluation: artifact.evaluation || {},
    fairness: artifact.fairness || {},
    trainingConfig: artifact.training_config || null,
    gates: {
      evaluation: gates.evaluation ?? false,
      fairness: gates.fairness ?? false,
      passed: (gates.evaluation ?? false) && (gates.fairness ?? false),
    },
    status: "staging",
    parentVersion: registry.production?.version || null,
    artifactPath: path.join(MODELS_DIR, `model_${version}.json`),
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    registry.models.push(entry);
  }

  // Write model artifact
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.writeFileSync(entry.artifactPath, JSON.stringify(artifact, null, 2) + "\n");

  saveRegistry(registry);
  return { version, status: entry.status };
}

// ── Promotion gate ────────────────────────────────────────────────

/**
 * Check if a model passes both evaluation and fairness gates.
 * @param {string} version
 * @returns {{ passed: boolean, reasons: string[] }}
 */
function evaluatePromotionGate(version) {
  const registry = loadRegistry();
  const model = registry.models.find((m) => m.version === version);
  if (!model) return { passed: false, reasons: ["model_not_found"] };

  const reasons = [];

  // Evaluation gate: must beat baseline NDCG
  const ndcg = model.evaluation?.ndcg_at_10 || 0;
  const baseline = model.evaluation?.baseline_ndcg_at_10 || 0;
  if (ndcg <= baseline) {
    reasons.push(`evaluation_gate_failed: ndcg_at_10=${ndcg} <= baseline=${baseline}`);
  }

  // Fairness gate: new freelancer impression share must be >= threshold
  const fairnessShare = model.fairness?.new_freelancer_impression_share;
  if (fairnessShare !== undefined && fairnessShare < 0.1) {
    reasons.push(`fairness_gate_failed: new_freelancer_share=${fairnessShare} < 0.10`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

// ── Promotion ─────────────────────────────────────────────────────

/**
 * Promote a model from staging to production.
 * Only succeeds if the model passes the promotion gate.
 * @param {string} version
 * @returns {{ success: boolean, message: string }}
 */
function promoteModel(version) {
  const gate = evaluatePromotionGate(version);
  if (!gate.passed) {
    return {
      success: false,
      message: `Gate failed: ${gate.reasons.join("; ")}`,
    };
  }

  const registry = loadRegistry();
  const model = registry.models.find((m) => m.version === version);
  if (!model) {
    return { success: false, message: "Model not found" };
  }

  // Demote current production
  if (registry.production) {
    const current = registry.models.find((m) => m.version === registry.production.version);
    if (current) current.status = "archived";
  }

  model.status = "production";
  registry.production = {
    version: model.version,
    promotedAt: new Date().toISOString(),
    previousVersion: registry.production?.version || null,
  };

  saveRegistry(registry);
  return { success: true, message: `Model ${version} promoted to production` };
}

// ── Rollback ──────────────────────────────────────────────────────

/**
 * Roll back to a previous model version.
 * @param {string} targetVersion - Version to roll back to (optional; rolls back to parent if omitted)
 * @returns {{ success: boolean, message: string }}
 */
function rollbackModel(targetVersion) {
  const registry = loadRegistry();
  if (!registry.production) {
    return { success: false, message: "No production model to roll back from" };
  }

  const currentProduction = registry.models.find((m) => m.version === registry.production.version);
  const target = targetVersion || registry.production.previousVersion;

  if (!target) {
    return { success: false, message: "No previous version available for rollback" };
  }

  const targetModel = registry.models.find((m) => m.version === target);
  if (!targetModel) {
    return { success: false, message: `Target version ${target} not found` };
  }

  if (currentProduction) currentProduction.status = "archived";

  targetModel.status = "production";
  registry.production = {
    version: targetModel.version,
    promotedAt: new Date().toISOString(),
    previousVersion: currentProduction?.version || null,
    rollback: true,
  };

  saveRegistry(registry);
  return {
    success: true,
    message: `Rolled back from ${currentProduction?.version || "unknown"} to ${target}`,
  };
}

// ── Queries ───────────────────────────────────────────────────────

function getProductionModel() {
  const registry = loadRegistry();
  if (!registry.production) return null;
  return registry.models.find((m) => m.version === registry.production.version) || null;
}

function getModelHistory(limit = 10) {
  const registry = loadRegistry();
  return registry.models
    .slice(-limit)
    .reverse()
    .map((m) => ({
      version: m.version,
      status: m.status,
      registeredAt: m.registeredAt,
      evaluation: m.evaluation,
      gates: m.gates,
    }));
}

module.exports = {
  loadRegistry,
  registerModel,
  evaluatePromotionGate,
  promoteModel,
  rollbackModel,
  getProductionModel,
  getModelHistory,
};
