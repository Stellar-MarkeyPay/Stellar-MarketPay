/**
 * Feature store — caches computed features to eliminate training/serving skew.
 *
 * Training and serving now both read from `feature_contract.json` for feature
 * definitions and compute features through the same code paths. The feature
 * store adds a caching layer so repeated requests for the same freelancer or
 * job reuse previously computed features within a configurable TTL.
 *
 * Issue #265 — Phase 2: Feature Store
 */
"use strict";

const fs = require("fs");
const path = require("path");
const pool = require("../db/pool");

const CONTRACT_PATH = path.join(__dirname, "../../..", "ml", "feature_contract.json");

let cachedContract = null;

function loadContract() {
  if (cachedContract) return cachedContract;
  try {
    cachedContract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
    return cachedContract;
  } catch {
    // Fall back to inline definitions if contract file is missing
    return { version: "0.0.0", features: [] };
  }
}

function getFeatureNames() {
  const contract = loadContract();
  return contract.features.map((f) => f.name);
}

function getFeatureDefaults() {
  const contract = loadContract();
  const defaults = {};
  for (const f of contract.features) {
    defaults[f.name] = f.default ?? 0.5;
  }
  return defaults;
}

// ── In-memory TTL cache ────────────────────────────────────────────

const cache = new Map();
const DEFAULT_TTL_MS = 60_000; // 1 minute

function cacheKey(prefix, id) {
  return `${prefix}:${id}`;
}

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function invalidateCache(prefix, id) {
  const key = cacheKey(prefix, id);
  cache.delete(key);
}

function clearCache() {
  cache.clear();
}

// ── Feature computation with caching ──────────────────────────────

const FEATURE_QUERY = `
WITH freelancer_stats AS (
  SELECT
    p.public_key,
    p.completed_jobs,
    p.rating AS freelancer_rating,
    COALESCE((SELECT AVG(bid_amount) FROM applications WHERE freelancer_address = p.public_key), 0) AS avg_bid,
    COALESCE((
      SELECT AVG(EXTRACT(EPOCH FROM (a.created_at - j.created_at)) / 3600.0)
      FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.freelancer_address = p.public_key
    ), 0) AS avg_response_hours,
    COALESCE((
      SELECT COUNT(*)::int FROM progress_updates pu
      JOIN jobs jj ON jj.id = pu.job_id
      WHERE pu.author_address = p.public_key AND jj.status = 'completed'
    ), 0) AS progress_updates,
    COALESCE((
      SELECT AVG(stars)::float FROM ratings WHERE rated_address = p.public_key
    ), 0) AS expected_rating,
    COALESCE((
      SELECT AVG(EXTRACT(EPOCH FROM (jj.updated_at - jj.created_at)) / 86400.0)
      FROM jobs jj WHERE jj.freelancer_address = p.public_key AND jj.status = 'completed'
    ), 14) AS avg_completion_days,
    (
      SELECT COUNT(*)::float / NULLIF(
        (SELECT COUNT(*) FROM applications WHERE freelancer_address = p.public_key), 0
      )
      FROM applications a2 JOIN jobs jj2 ON jj2.id = a2.job_id
      WHERE a2.freelancer_address = p.public_key
        AND jj2.status = 'completed' AND a2.status = 'accepted'
    ) AS completion_rate,
    (
      SELECT j3.category,
             COUNT(*) FILTER (WHERE jj3.status = 'completed')::float / NULLIF(COUNT(*), 0) AS rate
      FROM applications a3
      JOIN jobs jj3 ON jj3.id = a3.job_id
      WHERE a3.freelancer_address = p.public_key AND a3.status = 'accepted'
      GROUP BY j3.category
    ) AS category_rates
  FROM profiles p
  WHERE p.public_key = $1
)
SELECT * FROM freelancer_stats
`;

async function getFreelancerFeatures(publicKey) {
  const key = cacheKey("freelancer", publicKey);
  const cached = getFromCache(key);
  if (cached) return cached;

  const { rows } = await pool.query(FEATURE_QUERY, [publicKey]);
  if (!rows.length) return getFeatureDefaults();

  const row = rows[0];
  const avgCompletionDays = Number(row.avg_completion_days) || 14;

  const features = {
    freelancer_completion_rate: Number(row.completion_rate) || 0,
    freelancer_rating_norm: normalizeRating(row.freelancer_rating),
    response_time_score: responseTimeScore(Number(row.avg_response_hours)),
    progress_frequency: progressFrequency(Number(row.progress_updates), Number(row.completed_jobs)),
    expected_rating_signal: normalizeRating(Number(row.expected_rating)),
    time_to_completion_signal: Math.max(0, 1 - Math.min(avgCompletionDays / 60, 1)),
  };

  setCache(key, features);
  return features;
}

function normalizeRating(rating) {
  if (rating === null || rating === undefined) return 0.5;
  const value = Number(rating);
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value / 5));
}

function responseTimeScore(avgHours) {
  if (!Number.isFinite(avgHours) || avgHours <= 0) return 0.5;
  return Math.max(0, 1 - avgHours / 168);
}

function progressFrequency(count, completedJobs) {
  const jobs = Math.max(Number(completedJobs) || 0, 1);
  const updates = Number(count) || 0;
  return Math.min(updates / jobs / 5, 1);
}

module.exports = {
  loadContract,
  getFeatureNames,
  getFeatureDefaults,
  getFreelancerFeatures,
  invalidateCache,
  clearCache,
};
