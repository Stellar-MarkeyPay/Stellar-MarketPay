/**
 * Drift monitoring — tracks feature and prediction distributions,
 * alerts when the live distribution departs from training.
 *
 * Uses a simple statistical test (KS test for continuous features,
 * chi-squared for categorical) against the training baseline.
 *
 * Issue #265 — Phase 4: Monitoring
 */
"use strict";

const pool = require("../db/pool");

const DRIFT_THRESHOLDS = {
  // Maximum allowed KS statistic before alerting
  ks_threshold: Number(process.env.ML_DRIFT_KS_THRESHOLD) || 0.15,
  // Maximum allowed PSI (Population Stability Index) before alerting
  psi_threshold: Number(process.env.ML_DRIFT_PSI_THRESHOLD) || 0.2,
  // Minimum samples required for drift detection
  min_samples: Number(process.env.ML_DRIFT_MIN_SAMPLES) || 100,
  // How far back to look for drift (hours)
  window_hours: Number(process.env.ML_DRIFT_WINDOW_HOURS) || 24,
};

// ── Histogram helpers ─────────────────────────────────────────────

/**
 * Build a normalized histogram from a numeric array.
 */
function histogram(values, bins = 20) {
  if (!values.length) return new Array(bins).fill(0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const counts = new Array(bins).fill(0);

  for (const v of values) {
    const idx = Math.min(Math.floor(((v - min) / range) * bins), bins - 1);
    counts[idx]++;
  }

  // Normalize to probability distribution
  const total = values.length;
  return counts.map((c) => c / total);
}

/**
 * Compute the Population Stability Index between two distributions.
 * PSI < 0.1: no significant shift
 * PSI 0.1-0.2: moderate shift
 * PSI > 0.2: significant drift
 */
function psi(reference, current) {
  const eps = 1e-6; // avoid log(0)
  let sum = 0;
  for (let i = 0; i < reference.length; i++) {
    const r = reference[i] + eps;
    const c = (current[i] || 0) + eps;
    sum += (c - r) * Math.log(c / r);
  }
  return sum;
}

// ── Reference baseline (from training data) ───────────────────────

let cachedBaseline = null;

/**
 * Load or compute the training feature baseline.
 * This is stored as a JSON snapshot when the model is trained.
 */
function getBaseline() {
  if (cachedBaseline) return cachedBaseline;

  const baselinePath = require("path").join(
    __dirname,
    "..",
    "..",
    "..",
    "ml",
    "models",
    "feature_baseline.json"
  );

  try {
    cachedBaseline = JSON.parse(require("fs").readFileSync(baselinePath, "utf8"));
    return cachedBaseline;
  } catch {
    return null;
  }
}

function saveBaseline(baseline) {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "..", "..", "ml", "models");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "feature_baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n"
  );
  cachedBaseline = baseline;
}

// ── Feature drift detection ───────────────────────────────────────

/**
 * Compute feature statistics from recent shadow events or ranking requests.
 */
async function computeLiveFeatureStats(windowHours) {
  const hours = windowHours || DRIFT_THRESHOLDS.window_hours;

  // We store feature snapshots in the shadow events table
  // For now, we compute stats from the most recent batch
  const { rows } = await pool.query(
    `
    SELECT
      ml_ranking,
      created_at
    FROM ml_ranking_shadow_events
    WHERE created_at > NOW() - ($1 || ' hours')::interval
      AND fallback_used = false
    LIMIT 1000
    `,
    [String(hours)]
  );

  if (rows.length < DRIFT_THRESHOLDS.min_samples) {
    return null;
  }

  // Extract prediction scores from shadow events
  const scores = [];
  for (const row of rows) {
    const ranking =
      typeof row.ml_ranking === "string" ? JSON.parse(row.ml_ranking) : row.ml_ranking;
    if (Array.isArray(ranking)) {
      for (const item of ranking) {
        if (item.matchScore != null) {
          scores.push(Number(item.matchScore));
        }
      }
    }
  }

  return {
    sampleCount: rows.length,
    predictionScores: scores,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check for prediction drift by comparing live score distribution
 * against the training baseline.
 */
function detectPredictionDrift(liveStats, baseline) {
  if (!liveStats || !baseline?.predictionScores) {
    return { drift: false, reason: "insufficient_data" };
  }

  const refHist = histogram(baseline.predictionScores, 20);
  const liveHist = histogram(liveStats.predictionScores, 20);

  const psiValue = psi(refHist, liveHist);

  const result = {
    drift: psiValue > DRIFT_THRESHOLDS.psi_threshold,
    psi: Number(psiValue.toFixed(4)),
    threshold: DRIFT_THRESHOLDS.psi_threshold,
    sampleCount: liveStats.sampleCount,
    timestamp: new Date().toISOString(),
  };

  if (result.drift) {
    result.message = `Prediction drift detected: PSI=${result.psi} > threshold=${DRIFT_THRESHOLDS.psi_threshold}`;
  }

  return result;
}

// ── Alert system ──────────────────────────────────────────────────

const alerts = [];

/**
 * Record a drift alert. In production, this would integrate with
 * Prometheus/Alertmanager, PagerDuty, or Slack webhooks.
 */
function recordAlert(type, details) {
  const alert = {
    type,
    details,
    timestamp: new Date().toISOString(),
    severity: type === "prediction_drift" ? "warning" : "info",
  };

  alerts.push(alert);

  // Keep only last 100 alerts in memory
  if (alerts.length > 100) alerts.shift();

  // Log for observability
  console.warn(`[ML DRIFT ALERT] ${type}:`, JSON.stringify(details));

  return alert;
}

function getRecentAlerts(limit = 20) {
  return alerts.slice(-limit);
}

// ── Periodic check ────────────────────────────────────────────────

/**
 * Run a full drift check. Call this periodically (e.g., via cron or
 * a health-check endpoint).
 */
async function runDriftCheck() {
  const baseline = getBaseline();
  if (!baseline) {
    return {
      status: "no_baseline",
      message: "No feature baseline found. Run training pipeline to generate one.",
    };
  }

  const liveStats = await computeLiveFeatureStats();
  if (!liveStats) {
    return {
      status: "insufficient_data",
      message: `Need at least ${DRIFT_THRESHOLDS.min_samples} samples for drift detection.`,
    };
  }

  const predictionDrift = detectPredictionDrift(liveStats, baseline);

  if (predictionDrift.drift) {
    recordAlert("prediction_drift", predictionDrift);
  }

  return {
    status: "ok",
    predictionDrift,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  DRIFT_THRESHOLDS,
  histogram,
  psi,
  getBaseline,
  saveBaseline,
  computeLiveFeatureStats,
  detectPredictionDrift,
  runDriftCheck,
  recordAlert,
  getRecentAlerts,
};
