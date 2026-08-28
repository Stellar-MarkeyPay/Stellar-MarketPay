"use strict";

const warehousePool = require("../db/warehouse/warehousePool");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cacheKey(name, params = {}) {
  const dayKey = new Date().toISOString().slice(0, 10);
  return `${name}:${dayKey}:${JSON.stringify(params)}`;
}

async function withDailyCache(name, params, loader) {
  const key = cacheKey(name, params);
  const cached = cache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await loader();

  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return value;
}

/**
 * Category analytics
 * Warehouse only:
 * fact_job + fact_application + dimensions
 */


async function getCategoryInsights(limit = 20) {
  return withDailyCache("categories", { limit }, async () => {
    const { rows } = await warehousePool.query(
      `
      SELECT
        dc.category_name AS category,
        COUNT(*)::int AS total_jobs,

        ROUND(
          AVG(fj.budget_amount)::numeric,
          7
        ) AS avg_budget,

        ROUND(
          AVG(COALESCE(app_counts.application_count, 0))::numeric,
          2
        ) AS avg_applications_per_job,

        ROUND(
          COALESCE(
            SUM(
              CASE
                WHEN accepted_counts.accepted_count > 0
                THEN accepted_counts.accepted_count
                ELSE 0
              END
            )::numeric
            /
            NULLIF(
              SUM(COALESCE(app_counts.application_count, 0))::numeric,
              0
            )
            * 100,
            0
          ),
          2
        ) AS acceptance_rate,

        COUNT(*) FILTER (
          WHERE COALESCE(app_counts.application_count, 0) < 5
        )::int AS low_competition_jobs,

        COUNT(DISTINCT fj.client_key)::int AS unique_clients

      FROM analytics.fact_job fj

      JOIN analytics.dim_category dc
        ON dc.category_key = fj.category_key

      LEFT JOIN (
        SELECT
          job_key,
          COUNT(*)::int AS application_count
        FROM analytics.fact_application
        GROUP BY job_key
      ) app_counts
        ON app_counts.job_key = fj.job_key

      LEFT JOIN (
        SELECT
          job_key,
          COUNT(*)::int AS accepted_count
        FROM analytics.fact_application fa
        JOIN analytics.dim_status ds
          ON ds.status_key = fa.status_key
        WHERE ds.status_code = 'accepted'
        GROUP BY job_key
      ) accepted_counts
        ON accepted_counts.job_key = fj.job_key

      GROUP BY dc.category_name

      ORDER BY total_jobs DESC, avg_budget DESC

      LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => ({
      category: row.category,
      totalJobs: toNumber(row.total_jobs),
      avgBudget: toNumber(row.avg_budget),
      avgApplicationsPerJob: toNumber(row.avg_applications_per_job),
      acceptanceRate: toNumber(row.acceptance_rate),
      lowCompetitionJobs: toNumber(row.low_competition_jobs),
      uniqueClients: toNumber(row.unique_clients),
    }));
  });
}



async function getSkillInsights(limit = 20) {
  return withDailyCache("skills", { limit }, async () => {
    const { rows } = await warehousePool.query(
      `
      SELECT
        dc.category_name AS skill,
        COUNT(*)::int AS demand_count,
        ROUND(
          AVG(
            COALESCE(app_counts.application_count, 0)
          )::numeric,
          2
        ) AS avg_applications_per_job,
        COUNT(*) FILTER (
          WHERE COALESCE(app_counts.application_count, 0) < 5
        )::int AS low_competition_jobs
      FROM analytics.fact_job fj
      JOIN analytics.dim_category dc
        ON dc.category_key = fj.category_key
      LEFT JOIN (
        SELECT
          job_key,
          COUNT(*)::int AS application_count
        FROM analytics.fact_application
        GROUP BY job_key
      ) app_counts
        ON app_counts.job_key = fj.job_key
      GROUP BY dc.category_name
      ORDER BY demand_count DESC, skill ASC
      LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => ({
      skill: row.skill,
      demandCount: toNumber(row.demand_count),
      avgApplicationsPerJob: toNumber(row.avg_applications_per_job),
      lowCompetitionJobs: toNumber(row.low_competition_jobs),
    }));
  });
}

/**
 * Skills are not currently represented in the warehouse contract.
 *
 * IMPORTANT:
 * Do not query public.jobs or public.silver_jobs here.
 * Doing so would violate the warehouse-only analytics requirement.
 */
// async function getSkillInsights(limit = 20) {
//   return [];
// }

/**
 * Competitive jobs
 *
 * All analytical data comes from analytics.*
 *
 * The current warehouse fact_job does not contain:
 *   - title
 *   - currency
 *
 * Therefore title is null and currency defaults to XLM.
 * job_id remains the stable job identifier.
 */

async function getCompetitiveJobs(limit = 20) {
  return withDailyCache("competitive", { limit }, async () => {
    const { rows } = await warehousePool.query(
      `
      SELECT
        fj.job_id AS id,
        dc.category_name AS category,
        fj.budget_amount AS budget,
        COUNT(fa.application_key)::int AS application_count,
        CASE
          WHEN COUNT(fa.application_key) = 0 THEN 'uncontested'
          WHEN COUNT(fa.application_key) < 3 THEN 'light'
          ELSE 'active'
        END AS competition_level
      FROM analytics.fact_job fj
      LEFT JOIN analytics.dim_category dc
        ON dc.category_key = fj.category_key
      LEFT JOIN analytics.fact_application fa
        ON fa.job_key = fj.job_key
      JOIN analytics.dim_status ds
        ON ds.status_key = fj.status_key
      WHERE ds.status_code = 'open'
      GROUP BY
        fj.job_id,
        dc.category_name,
        fj.budget_amount
      HAVING COUNT(fa.application_key) < 5
      ORDER BY
        application_count ASC,
        fj.budget_amount DESC
      LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => ({
      id: row.id,
      title: null,
      category: row.category,
      budget: toNumber(row.budget),
      currency: null,
      clientAddress: null,
      createdAt: null,
      applicationCount: toNumber(row.application_count),
      competitionLevel: row.competition_level,
    }));
  });
}

/**
 * Historical payment/job budget trends
 */


async function getPayTrends(days = 30) {
  return withDailyCache("pay-trends", { days }, async () => {
    const { rows } = await warehousePool.query(
      `
      SELECT
        dd.full_date AS date,
        dc.category_name AS category,
        ROUND(AVG(fj.budget_amount)::numeric, 7) AS avg_budget,
        COUNT(*)::int AS job_count
      FROM analytics.fact_job fj
      JOIN analytics.dim_date dd
        ON dd.date_key = fj.created_date_key
      LEFT JOIN analytics.dim_category dc
        ON dc.category_key = fj.category_key
      WHERE dd.full_date >= CURRENT_DATE - $1::integer
      GROUP BY
        dd.full_date,
        dc.category_name
      ORDER BY
        dd.full_date ASC,
        dc.category_name ASC
      `,
      [days]
    );

    return rows.map((row) => ({
      date: row.date,
      category: row.category,
      avgBudget: toNumber(row.avg_budget),
      jobCount: toNumber(row.job_count),
    }));
  });
}

/**
 * Client retention / mix.
 *
 * First job date is calculated from fact_job.
 */
async function getClientMix() {
  return withDailyCache("client-mix", {}, async () => {
    const { rows } = await warehousePool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE d.full_date >= CURRENT_DATE - INTERVAL '30 days'
        )::int AS new_clients,

        COUNT(*) FILTER (
          WHERE d.full_date < CURRENT_DATE - INTERVAL '30 days'
        )::int AS returning_clients,

        COUNT(*)::int AS total_clients

      FROM (
        SELECT
          client_key,
          MIN(created_date_key) AS first_post_date_key
        FROM analytics.fact_job
        WHERE client_key IS NOT NULL
        GROUP BY client_key
      ) first_posts

      JOIN analytics.dim_date d
        ON d.date_key = first_posts.first_post_date_key
    `);

    const row = rows[0] || {};

    return {
      newClients: toNumber(row.new_clients),
      returningClients: toNumber(row.returning_clients),
      totalClients: toNumber(row.total_clients),
    };
  });
}

module.exports = {
  getCategoryInsights,
  getSkillInsights,
  getCompetitiveJobs,
  getPayTrends,
  getClientMix,
  
};


