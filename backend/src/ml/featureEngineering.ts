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
 * Feature engineering for (freelancer, job) match ranking.
 * Signals derived from applications, ratings, progress_updates, and profiles.
 */
("use strict");

const pool = require("../db/pool");

const FEATURE_NAMES = [
  "skill_overlap",
  "freelancer_completion_rate",
  "category_match_rate",
  "freelancer_rating_norm",
  "budget_fit",
  "job_recency",
  "response_time_score",
  "progress_frequency",
  "client_rating_norm",
  "expected_rating_signal",
  "time_to_completion_signal",
];

function skillOverlap(freelancerSkills: any, jobSkills: any) {
  const fSet = new Set((freelancerSkills || []).map((s: any) => String(s).toLowerCase()));
  const jSkills = (jobSkills || []).map((s: any) => String(s).toLowerCase());
  if (!jSkills.length) return 0.5;
  const overlap = jSkills.filter((s: any) => fSet.has(s)).length;
  return overlap / jSkills.length;
}

function normalizeRating(rating: any) {
  if (rating === null || rating === undefined) return 0.5;
  const value = Number(rating);
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value / 5));
}

function budgetFit(jobBudget: any, avgBid: any) {
  const budget = Number(jobBudget);
  const bid = Number(avgBid);
  if (!Number.isFinite(budget) || budget <= 0) return 0.5;
  if (!Number.isFinite(bid) || bid <= 0) return 0.5;
  const ratio = Math.abs(bid - budget) / budget;
  return Math.max(0, 1 - Math.min(ratio, 1));
}

function jobRecency(createdAt: any) {
  if (!createdAt) return 0.5;
  const days = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-Math.max(days, 0) / 30);
}

function responseTimeScore(avgHours: any) {
  if (!Number.isFinite(avgHours) || avgHours <= 0) return 0.5;
  return Math.max(0, 1 - avgHours / 168);
}

function progressFrequency(count: any, completedJobs: any) {
  const jobs = Math.max(Number(completedJobs) || 0, 1);
  const updates = Number(count) || 0;
  return Math.min(updates / jobs / 5, 1);
}

function buildFeatureVector(freelancer: any, job: any, stats: any) {
  const features = {
    skill_overlap: skillOverlap(freelancer.skills, job.skills),
    freelancer_completion_rate: stats.completionRate,
    category_match_rate: stats.categoryMatchRate,
    freelancer_rating_norm: normalizeRating(freelancer.rating),
    budget_fit: budgetFit(job.budget, stats.avgBidAmount),
    job_recency: jobRecency(job.created_at || job.createdAt),
    response_time_score: responseTimeScore(stats.avgResponseHours),
    progress_frequency: progressFrequency(stats.progressUpdateCount, freelancer.completed_jobs),
    client_rating_norm: normalizeRating(stats.clientRating),
    expected_rating_signal: normalizeRating(stats.expectedRating),
    time_to_completion_signal: stats.timeToCompletionSignal,
  };

  return features;
}

async function loadFreelancerStats(publicKey: any) {
  const { rows } = await rawQuery<ApplicationTable>(
    `
    WITH freelancer_apps AS (
      SELECT
        a.bid_amount,
        a.created_at,
        a.status,
        j.category,
        j.status AS job_status,
        j.created_at AS job_created_at,
        j.updated_at AS job_updated_at
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.freelancer_address = $1
    ),
    category_completed AS (
      SELECT
        j.category,
        COUNT(*) FILTER (WHERE j.status = 'completed')::float
          / NULLIF(COUNT(*), 0) AS category_rate
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.freelancer_address = $1 AND a.status = 'accepted'
      GROUP BY j.category
    ),
    response AS (
      SELECT AVG(EXTRACT(EPOCH FROM (a.created_at - j.created_at)) / 3600.0) AS avg_hours
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.freelancer_address = $1
    ),
    progress AS (
      SELECT COUNT(*)::int AS update_count
      FROM progress_updates pu
      JOIN jobs j ON j.id = pu.job_id
      WHERE pu.author_address = $1 AND j.status = 'completed'
    ),
    ratings AS (
      SELECT AVG(stars)::float AS avg_stars
      FROM ratings
      WHERE rated_address = $1
    ),
    completion_times AS (
      SELECT AVG(
        EXTRACT(EPOCH FROM (j.updated_at - j.created_at)) / 86400.0
      ) AS avg_days
      FROM jobs j
      WHERE j.freelancer_address = $1 AND j.status = 'completed'
    )
    SELECT
      p.completed_jobs,
      p.rating,
      COALESCE((SELECT AVG(bid_amount) FROM freelancer_apps), 0) AS avg_bid,
      COALESCE((SELECT avg_hours FROM response), 0) AS avg_response_hours,
      COALESCE((SELECT update_count FROM progress), 0) AS progress_updates,
      COALESCE((SELECT avg_stars FROM ratings), 0) AS expected_rating,
      COALESCE((SELECT avg_days FROM completion_times), 14) AS avg_completion_days,
      (
        SELECT COUNT(*)::float / NULLIF((SELECT COUNT(*) FROM freelancer_apps), 0)
        FROM freelancer_apps
        WHERE job_status = 'completed' AND status = 'accepted'
      ) AS completion_rate
    FROM profiles p
    WHERE p.public_key = $1
    `,
    [publicKey]
  );

  if (!rows.length) {
    return {
      completionRate: 0,
      categoryMatchRate: 0.5,
      avgBidAmount: 0,
      avgResponseHours: 0,
      progressUpdateCount: 0,
      clientRating: null,
      expectedRating: null,
      timeToCompletionSignal: 0.5,
      categoryRates: new Map(),
    };
  }

  const row = rows[0];
  const avgCompletionDays = Number(row.avg_completion_days) || 14;
  const timeToCompletionSignal = Math.max(0, 1 - Math.min(avgCompletionDays / 60, 1));

  const { rows: categoryRows } = await rawQuery<ApplicationTable>(
    `
    SELECT j.category,
           COUNT(*) FILTER (WHERE j.status = 'completed')::float
             / NULLIF(COUNT(*), 0) AS rate
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.freelancer_address = $1 AND a.status = 'accepted'
    GROUP BY j.category
    `,
    [publicKey]
  );

  const categoryRates = new Map(categoryRows.map((r: any) => [r.category, Number(r.rate) || 0]));

  return {
    completionRate: Number(row.completion_rate) || 0,
    categoryMatchRate: 0.5,
    avgBidAmount: Number(row.avg_bid) || 0,
    avgResponseHours: Number(row.avg_response_hours) || 0,
    progressUpdateCount: Number(row.progress_updates) || 0,
    clientRating: null,
    expectedRating: Number(row.expected_rating) || null,
    timeToCompletionSignal,
    categoryRates,
    completedJobs: Number(row.completed_jobs) || 0,
  };
}

async function loadFreelancerProfile(publicKey: any) {
  const { rows } = await rawQuery<ProfileTable>(
    `SELECT public_key, skills, completed_jobs, rating, created_at FROM profiles WHERE public_key = $1`,
    [publicKey]
  );
  if (!rows.length) return null;
  return {
    public_key: rows[0].public_key,
    skills: rows[0].skills || [],
    completed_jobs: rows[0].completed_jobs || 0,
    rating: rows[0].rating,
    created_at: rows[0].created_at,
  };
}

async function loadJobRow(jobId: any) {
  const { rows } = await rawQuery<JobTable>(
    `SELECT j.*, p.rating AS client_rating
     FROM jobs j
     LEFT JOIN profiles p ON p.public_key = j.client_address
     WHERE j.id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

async function buildPairFeatures(freelancerAddress: any, jobRow: any) {
  const [freelancer, stats] = await Promise.all([
    loadFreelancerProfile(freelancerAddress),
    loadFreelancerStats(freelancerAddress),
  ]);

  if (!freelancer || !jobRow) return null;

  stats.categoryMatchRate = stats.categoryRates.get(jobRow.category) ?? 0.5;
  stats.clientRating = jobRow.client_rating;

  return buildFeatureVector(freelancer, jobRow, stats);
}

async function buildBatchFeatures(freelancerAddress: any, jobRows: any) {
  const [freelancer, stats] = await Promise.all([
    loadFreelancerProfile(freelancerAddress),
    loadFreelancerStats(freelancerAddress),
  ]);

  if (!freelancer) return [];

  return jobRows.map((jobRow: any) => {
    const jobStats = {
      ...stats,
      categoryMatchRate: stats.categoryRates.get(jobRow.category) ?? 0.5,
      clientRating: jobRow.client_rating,
    };
    return {
      jobId: jobRow.id,
      features: buildFeatureVector(freelancer, jobRow, jobStats),
      completedJobs: freelancer.completed_jobs,
    };
  });
}

async function buildFreelancerBatchFeatures(freelancerRows: any, jobRow: any) {
  const clientRating = jobRow.client_rating;

  const results = await Promise.all(
    freelancerRows.map(async (freelancer: any) => {
      const stats = await loadFreelancerStats(freelancer.public_key);
      stats.categoryMatchRate = stats.categoryRates.get(jobRow.category) ?? 0.5;
      stats.clientRating = clientRating;

      return {
        freelancerAddress: freelancer.public_key,
        features: buildFeatureVector(freelancer, jobRow, stats),
        completedJobs: freelancer.completed_jobs || 0,
      };
    })
  );

  return results;
}

module.exports = {
  FEATURE_NAMES,
  buildFeatureVector,
  buildPairFeatures,
  buildBatchFeatures,
  buildFreelancerBatchFeatures,
  loadFreelancerProfile,
  loadFreelancerStats,
  loadJobRow,
  skillOverlap,
};
