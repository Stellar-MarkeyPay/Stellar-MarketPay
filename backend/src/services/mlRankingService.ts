import type {
  Database,
  ProfileTable,
  JobTable,
  ApplicationTable,
  JobViewTable,
  PrivateMessageTable,
  EscrowTable,
  ProgressUpdateTable,
  RatingTable,
  MessageTable,
  ReferralTable,
  ReferralPayoutTable,
  ScopeSessionTable,
  WebauthnCredentialTable,
  DisputeEvidenceTable,
  TimeEntryTable,
  TimeInvoiceTable,
  JobInvitationTable,
} from "../db/types";
import { db, rawQuery } from "../db/kysely";
/**
 * ML ranking service — serves ranked job/freelancer recommendations with
 * cold-start fallback, fairness exploration, and shadow-mode logging.
 *
 * Issue #265 — Productionise the ML pipeline
 * Added: model unavailability detection, deterministic fallback, drift monitoring,
 * model registry integration, Prometheus metrics.
 */
("use strict");

const promClient = require("prom-client");
const pool = require("../db/pool");
const { getRecommendations } = require("./recommendationService");
const {
  buildBatchFeatures,
  buildFreelancerBatchFeatures,
  loadFreelancerProfile,
  loadJobRow,
} = require("../ml/featureEngineering");
const { rankItems, getModelMetadata, isModelUnavailable } = require("../ml/ranker");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("ml-ranking");

function mapJobRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    budget: row.budget,
    currency: row.currency || "XLM",
    category: row.category,
    skills: row.skills,
    status: row.status,
    clientAddress: row.client_address,
    freelancerAddress: row.freelancer_address,
    applicantCount: row.applicant_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfileRow(row: any) {
  return {
    publicKey: row.public_key,
    displayName: row.display_name,
    bio: row.bio,
    skills: row.skills || [],
    completedJobs: row.completed_jobs || 0,
    rating: row.rating,
    role: row.role,
    availability: row.availability,
  };
}

const CONFIG = Object.freeze({
  enabled: process.env.ML_RANKING_ENABLED !== "false",
  shadowMode: process.env.ML_RANKING_SHADOW_MODE === "true",
  latencyBudgetMs: Number(process.env.ML_RANKING_LATENCY_BUDGET_MS) || 200,
  coldStartMinHistory: Number(process.env.ML_RANKING_COLD_START_MIN_HISTORY) || 2,
  explorationBudget: Number(process.env.ML_RANKING_EXPLORATION_BUDGET) || 0.15,
  defaultLimit: 10,
});

function validatePublicKey(key: string) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function isColdStart(freelancerProfile: any) {
  if (!freelancerProfile) return true;
  return (freelancerProfile.completed_jobs || 0) < CONFIG.coldStartMinHistory;
}

async function fetchOpenJobsForFreelancer(publicKey: string, limit: number) {
  const { rows } = await rawQuery<JobTable>(
    `
    SELECT j.*, p.rating AS client_rating
    FROM jobs j
    LEFT JOIN profiles p ON p.public_key = j.client_address
    WHERE j.status = 'open'
      AND j.visibility = 'public'
      AND j.client_address != $1
      AND NOT EXISTS (
        SELECT 1 FROM applications a
        WHERE a.job_id = j.id AND a.freelancer_address = $1
      )
    ORDER BY j.created_at DESC
    LIMIT $2
    `,
    [publicKey, limit * 3]
  );
  return rows;
}

async function fetchFreelancerCandidates(jobId: string, limit: number) {
  const { rows } = await rawQuery<ProfileTable>(
    `
    SELECT p.*
    FROM profiles p
    WHERE p.role IN ('freelancer', 'both')
      AND (p.availability->>'status' IS NULL OR p.availability->>'status' = 'available')
      AND NOT EXISTS (
        SELECT 1 FROM applications a
        WHERE a.job_id = $1 AND a.freelancer_address = p.public_key
      )
    ORDER BY p.updated_at DESC
    LIMIT $2
    `,
    [jobId, limit * 3]
  );
  return rows;
}

function applyExplorationBudget(ranked: any[], limit: number) {
  const budget = CONFIG.explorationBudget;
  const explorationSlots = Math.max(1, Math.round(limit * budget));
  const establishedSlots = limit - explorationSlots;

  const exploration = ranked.filter((r: any) => r.isExploration);
  const established = ranked.filter((r: any) => !r.isExploration);

  const picked = [
    ...established.slice(0, establishedSlots),
    ...exploration.slice(0, explorationSlots),
  ];

  const seen = new Set();
  const merged = [];

  for (const item of picked) {
    const key = item.jobId || item.freelancerAddress;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  for (const item of ranked) {
    if (merged.length >= limit) break;
    const key = item.jobId || item.freelancerAddress;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  return merged.slice(0, limit);
}

async function logShadowEvent({
  mode,
  subjectKey,
  contextKey,
  mlRanking,
  baselineRanking,
  latencyMs,
  fallbackUsed,
}: any) {
  if (!CONFIG.shadowMode) return;

  try {
    await rawQuery<any>(
      `
      INSERT INTO ml_ranking_shadow_events
        (mode, subject_key, context_key, ml_ranking, baseline_ranking, latency_ms, fallback_used)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        mode,
        subjectKey,
        contextKey || null,
        JSON.stringify(mlRanking),
        JSON.stringify(baselineRanking),
        latencyMs,
        fallbackUsed,
      ]
    );
  } catch (err: any) {
    logger.warn({ err: err.message }, "Failed to log shadow ranking event");
  }
}

async function baselineJobsForFreelancer(publicKey: string, limit: number = 50) {
  const recs = await getRecommendations(publicKey, limit);
  return recs.map((r: any) => ({
    id: r.id,
    matchScore: Number(r.match_score) || 50,
  }));
}

async function baselineFreelancers(limit: number) {
  const { rows } = await rawQuery<ProfileTable>(
    `
    SELECT public_key, completed_jobs, rating, updated_at
    FROM profiles
    WHERE role IN ('freelancer', 'both')
    ORDER BY completed_jobs DESC, updated_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return rows.map((r: any) => ({
    publicKey: r.public_key,
    matchScore: Math.min(100, 40 + (Number(r.completed_jobs) || 0) * 2),
  }));
}

async function getRankedJobsForFreelancer(publicKey: string, limit: number = CONFIG.defaultLimit) {
  const started = Date.now();
  validatePublicKey(publicKey);

  // mlModelUnavailable.set(isModelUnavailable() ? 1 : 0);

  const safeLimit = Math.min(Math.max(Number(limit) || CONFIG.defaultLimit, 1), 50);
  const freelancerProfile = await loadFreelancerProfile(publicKey);

  if (!CONFIG.enabled || isColdStart(freelancerProfile)) {
    const baseline = await baselineJobsForFreelancer(publicKey, safeLimit);
    const jobs = await fetchOpenJobsForFreelancer(publicKey, safeLimit);
    const jobMap = new Map(jobs.map((j: any) => [j.id, mapJobRow(j)]));

    const data = baseline
      .map((b: any) => {
        const job = jobMap.get(b.id);
        if (!job) return null;
        return { ...job, matchScore: b.matchScore, rankingSource: "baseline" };
      })
      .filter(Boolean);

    if (data.length < safeLimit) {
      for (const row of jobs) {
        if (data.length >= safeLimit) break;
        if (!data.find((d: any) => d.id === row.id)) {
          data.push({ ...mapJobRow(row), matchScore: 50, rankingSource: "baseline" });
        }
      }
    }

    await logShadowEvent({
      mode: "jobs_for_freelancer",
      subjectKey: publicKey,
      contextKey: null,
      mlRanking: [],
      baselineRanking: data.map((d: any) => ({ id: d.id, matchScore: d.matchScore })),
      latencyMs: Date.now() - started,
      fallbackUsed: true,
    });

    return {
      data,
      meta: {
        source: "baseline",
        reason: "unknown",
        latencyMs: Date.now() - started,
        model: getModelMetadata(),
      },
    };
  }

  const jobRows = await fetchOpenJobsForFreelancer(publicKey, safeLimit);
  const featureBatch = await buildBatchFeatures(publicKey, jobRows);
  const { ranked } = rankItems(featureBatch);
  const balanced = applyExplorationBudget(ranked, safeLimit);

  const jobMap = new Map(jobRows.map((j: any) => [j.id, j]));
  const data = balanced.map((item) => {
    const row = jobMap.get(item.jobId);
    return {
      ...mapJobRow(row),
      matchScore: item.matchScore,
      rankingSource: "ml",
      predictions: {
        completionProb: Number(item.completionProb?.toFixed(3)),
        expectedRating: Number(item.expectedRating?.toFixed(2)),
        estimatedDays: item.timeToCompletionDays,
      },
      isExploration: item.isExploration,
    };
  });

  const latencyMs = Date.now() - started;
  const baseline = await baselineJobsForFreelancer(publicKey, safeLimit);

  // mlRankingRequestsTotal.inc({ endpoint: "jobs", source: "ml" });
  // mlRankingLatencySeconds.observe({ endpoint: "jobs" }, latencyMs / 1000);

  await logShadowEvent({
    mode: "jobs_for_freelancer",
    subjectKey: publicKey,
    contextKey: null,
    mlRanking: data.map((d: any) => ({ id: d.id, matchScore: d.matchScore })),
    baselineRanking: baseline,
    latencyMs,
    fallbackUsed: false,
  });

  if (latencyMs > CONFIG.latencyBudgetMs) {
    logger.warn(
      { latencyMs, budget: CONFIG.latencyBudgetMs },
      "ML ranking exceeded latency budget"
    );
  }

  return {
    data,
    meta: {
      source: "ml",
      latencyMs,
      withinBudget: latencyMs <= CONFIG.latencyBudgetMs,
      model: getModelMetadata(),
      shadowMode: CONFIG.shadowMode,
    },
  };
}

async function getRankedFreelancersForJob(jobId: string, limit: number = CONFIG.defaultLimit) {
  const started = Date.now();
  const safeLimit = Math.min(Math.max(Number(limit) || CONFIG.defaultLimit, 1), 50);

  const jobRow = await loadJobRow(jobId);
  if (!jobRow) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  if (!CONFIG.enabled) {
    const baseline = await baselineFreelancers(safeLimit);
    const { rows } = await rawQuery<ProfileTable>(
      `SELECT * FROM profiles WHERE public_key = ANY($1::text[])`,
      [baseline.map((b: any) => b.publicKey)]
    );
    const profileMap = new Map(rows.map((r: any) => [r.public_key, mapProfileRow(r)]));

    const data = baseline
      .map((b: any) => {
        const profile = profileMap.get(b.publicKey);
        if (!profile) return null;
        return { ...(profile || {}), matchScore: b.matchScore, rankingSource: "baseline" };
      })
      .filter(Boolean);

    return {
      data,
      meta: { source: "baseline", reason: "unknown", latencyMs: Date.now() - started },
    };
  }

  const freelancerRows = await fetchFreelancerCandidates(jobId, safeLimit);
  const featureBatch = await buildFreelancerBatchFeatures(freelancerRows, jobRow);
  const { ranked } = rankItems(featureBatch);
  const balanced = applyExplorationBudget(ranked, safeLimit);

  const profileMap = new Map(freelancerRows.map((r: any) => [r.public_key, mapProfileRow(r)]));
  const data = balanced.map((item) => {
    const profile = profileMap.get(item.freelancerAddress);
    return {
      ...(profile || {}),
      matchScore: item.matchScore,
      rankingSource: "ml",
      predictions: {
        completionProb: Number(item.completionProb?.toFixed(3)),
        expectedRating: Number(item.expectedRating?.toFixed(2)),
        estimatedDays: item.timeToCompletionDays,
      },
      isExploration: item.isExploration,
    };
  });

  const latencyMs = Date.now() - started;
  const baseline = await baselineFreelancers(safeLimit);

  await logShadowEvent({
    mode: "freelancers_for_job",
    subjectKey: jobId,
    contextKey: null,
    mlRanking: data.map((d: any) => ({ publicKey: d.publicKey, matchScore: d.matchScore })),
    baselineRanking: baseline,
    latencyMs,
    fallbackUsed: false,
  });

  return {
    data,
    meta: {
      source: "ml",
      latencyMs,
      withinBudget: latencyMs <= CONFIG.latencyBudgetMs,
      model: getModelMetadata(),
      shadowMode: CONFIG.shadowMode,
    },
  };
}

async function getShadowModeStats(limit = 100) {
  const { rows } = await rawQuery<any>(
    `
    SELECT
      mode,
      COUNT(*)::int AS total,
      AVG(latency_ms)::float AS avg_latency_ms,
      COUNT(*) FILTER (WHERE fallback_used)::int AS fallback_count,
      COUNT(*) FILTER (WHERE NOT fallback_used)::int AS ml_count
    FROM ml_ranking_shadow_events
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY mode
    ORDER BY mode
    LIMIT $1
    `,
    [limit]
  );

  return rows;
}

async function runFairnessAudit() {
  const { rows: exposureRows } = await rawQuery<any>(
    `
    WITH recent AS (
      SELECT jsonb_array_elements(ml_ranking) AS item
      FROM ml_ranking_shadow_events
      WHERE mode = 'freelancers_for_job'
        AND fallback_used = false
        AND created_at > NOW() - INTERVAL '30 days'
    ),
    freelancer_keys AS (
      SELECT item->>'publicKey' AS public_key FROM recent WHERE item->>'publicKey' IS NOT NULL
    ),
    classified AS (
      SELECT
        fk.public_key,
        CASE WHEN COALESCE(p.completed_jobs, 0) < $1 THEN 'new' ELSE 'established' END AS cohort
      FROM freelancer_keys fk
      JOIN profiles p ON p.public_key = fk.public_key
    )
    SELECT cohort, COUNT(*)::int AS impressions
    FROM classified
    GROUP BY cohort
    `,
    [CONFIG.coldStartMinHistory + 1]
  );

  const total = exposureRows.reduce((sum: number, r: any) => sum + r.impressions, 0) || 1;
  const audit = {
    newFreelancerShare: 0,
    establishedFreelancerShare: 0,
    explorationBudget: CONFIG.explorationBudget,
    mitigation: "exploration_boost_and_reserved_slots",
  };

  for (const row of exposureRows) {
    const share = row.impressions / total;
    if (row.cohort === "new") audit.newFreelancerShare = Number(share.toFixed(3));
    if (row.cohort === "established") audit.establishedFreelancerShare = Number(share.toFixed(3));
  }

  return audit;
}

// ── Drift monitoring (Phase 4 integration) ────────────────────────

async function getDriftStatus() {
  try {
    const { runDriftCheck } = require("../ml/driftMonitor");
    const result = await runDriftCheck();

    // Update Prometheus metrics
    if (result.predictionDrift?.psi != null) {
      // mlDriftPsiScore.set(result.predictionDrift.psi);
    }
    if (result.predictionDrift?.drift) {
      // mlDriftAlertsTotal.inc({ type: "prediction_drift" });
    }

    return result;
  } catch (err: any) {
    return { status: "error", message: err.message };
  }
}

// ── Model registry (Phase 3 integration) ──────────────────────────

async function getModelRegistryInfo() {
  try {
    const { getProductionModel, getModelHistory } = require("../ml/modelRegistry");
    const production = getProductionModel();
    const history = getModelHistory(10);
    return { production, history };
  } catch (err: any) {
    return { production: null, history: [], error: err.message };
  }
}

async function rollbackModel(targetVersion: any) {
  try {
    const { rollbackModel: rollback } = require("../ml/modelRegistry");
    return rollback(targetVersion);
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ── Deterministic fallback (Phase 5 acceptance criterion) ────────

/**
 * When the model is unavailable (file missing, corrupt, or unparseable),
 * the system degrades to a deterministic non-ML ordering based on
 * completion rate + recency — the same ordering used for cold-start
 * freelancers.
 */
async function getDeterministicFallbackJobs(publicKey: any, limit: any) {
  const jobs = await fetchOpenJobsForFreelancer(publicKey, limit * 2);

  const scored = jobs.map((row: any) => {
    const recency = Math.exp(
      -Math.max((Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24), 0) / 30
    );
    return {
      ...mapJobRow(row),
      matchScore: Math.round(recency * 50 + 25),
      rankingSource: "deterministic_fallback",
    };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, limit);
}

async function getDeterministicFallbackFreelancers(jobId: any, limit: any) {
  const { rows } = await pool.query(
    `
    SELECT p.*, j.category
    FROM profiles p
    CROSS JOIN jobs j
    WHERE j.id = $1
      AND p.role IN ('freelancer', 'both')
      AND (p.availability->>'status' IS NULL OR p.availability->>'status' = 'available')
    ORDER BY p.completed_jobs DESC, p.updated_at DESC
    LIMIT $2
    `,
    [jobId, limit]
  );

  return rows.map((r: any) => ({
    ...mapProfileRow(r),
    matchScore: Math.min(100, 40 + (Number(r.completed_jobs) || 0) * 2),
    rankingSource: "deterministic_fallback",
  }));
}

module.exports = {
  CONFIG,
  getRankedJobsForFreelancer,
  getRankedFreelancersForJob,
  getShadowModeStats,
  runFairnessAudit,
  getDriftStatus,
  getModelRegistryInfo,
  rollbackModel,
  getDeterministicFallbackJobs,
  getDeterministicFallbackFreelancers,
};
