"use strict";

const warehousePool = require("../db/warehouse/warehousePool");

async function computeStats() {
  const query = `
    WITH stats AS (
      SELECT
        (SELECT COUNT(*) FROM analytics.fact_job) AS total_jobs,
        (
          SELECT COUNT(DISTINCT client_key)
          FROM analytics.fact_job
          WHERE client_key IS NOT NULL
        ) AS total_clients,
        (
          SELECT COUNT(DISTINCT freelancer_key)
          FROM analytics.fact_job
          WHERE freelancer_key IS NOT NULL
        ) AS total_freelancers,
        (
          SELECT COUNT(DISTINCT client_key)
          FROM analytics.fact_job
          WHERE client_key IS NOT NULL
        ) AS active_users,
        (
          SELECT COALESCE(SUM(amount_xlm), 0)
          FROM analytics.fact_escrow fe
          JOIN analytics.dim_status ds
            ON ds.status_key = fe.status_key
          WHERE ds.entity_type = 'escrow'
            AND ds.status_code = 'funded'
        ) AS total_escrow_xlm,
        (
          SELECT COALESCE(AVG(budget_amount), 0)
          FROM analytics.fact_job fj
          JOIN analytics.dim_status ds
            ON ds.status_key = fj.status_key
          WHERE ds.status_code IN ('assigned', 'in_progress', 'completed')
        ) AS avg_job_budget,
        (
          SELECT
            COUNT(*) FILTER (
              WHERE ds.status_code = 'completed'
            ) * 100.0 / NULLIF(COUNT(*), 0)
          FROM analytics.fact_job fj
          JOIN analytics.dim_status ds
            ON ds.status_key = fj.status_key
          WHERE ds.status_code IN ('completed', 'cancelled')
        ) AS completion_rate
    )
    SELECT
      total_jobs AS total_jobs_posted,
      total_clients,
      total_freelancers,
      active_users,
      total_escrow_xlm,
      avg_job_budget,
      COALESCE(completion_rate, 0) AS completion_rate,
      NOW() AS last_updated
    FROM stats
  `;

  const result = await warehousePool.query(query);
  return result.rows[0];
}

async function getStats() {
  return computeStats();
}

async function getJobTrends(days = 90) {
  const query = `
    SELECT
      dd.full_date AS date,
      COUNT(*)::int AS jobs_posted,
      COALESCE(AVG(fj.budget_amount), 0) AS avg_budget
    FROM analytics.fact_job fj
    JOIN analytics.dim_date dd
      ON dd.date_key = fj.created_date_key
    WHERE dd.full_date >= CURRENT_DATE - $1::int
    GROUP BY dd.full_date
    ORDER BY dd.full_date DESC
  `;

  const result = await warehousePool.query(query, [days]);
  return result.rows;
}

async function getEscrowTrends(days = 90) {
  const query = `
    SELECT
      dd.full_date AS date,
      ds.status_code AS escrow_status,
      COUNT(*)::int AS escrow_count,
      COALESCE(SUM(fe.amount_xlm), 0) AS total_amount
    FROM analytics.fact_escrow fe
    JOIN analytics.dim_date dd
      ON dd.date_key = fe.created_date_key
    LEFT JOIN analytics.dim_status ds
      ON ds.status_key = fe.status_key
    WHERE dd.full_date >= CURRENT_DATE - $1::int
    GROUP BY dd.full_date, ds.status_code
    ORDER BY dd.full_date DESC, ds.status_code
  `;

  const result = await warehousePool.query(query, [days]);
  return result.rows;
}

async function getTopCategories(limit = 10) {
  const query = `
    SELECT
      dc.category_name AS category,
      COUNT(*)::int AS job_count,
      COALESCE(AVG(fj.budget_amount), 0) AS avg_budget
    FROM analytics.fact_job fj
    JOIN analytics.dim_category dc
      ON dc.category_key = fj.category_key
    JOIN analytics.dim_status ds
      ON ds.status_key = fj.status_key
    WHERE ds.status_code IN ('open', 'assigned', 'in_progress', 'completed')
    GROUP BY dc.category_name
    ORDER BY job_count DESC, avg_budget DESC
    LIMIT $1
  `;

  const result = await warehousePool.query(query, [limit]);
  return result.rows;
}

module.exports = {
  computeStats,
  getStats,
  getJobTrends,
  getEscrowTrends,
  getTopCategories,
};
