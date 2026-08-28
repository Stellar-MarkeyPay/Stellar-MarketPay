"use strict";

const warehousePool = require("./warehousePool");

async function runWarehouseQualityChecks() {
  const checks = [];

  const orphanJobs = await warehousePool.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM analytics.fact_job
    WHERE created_date_key IS NULL
  `);

  checks.push({
    name: "fact_job_created_date",
    passed: orphanJobs.rows[0].count === 0,
    count: orphanJobs.rows[0].count,
  });

  const duplicateJobs = await warehousePool.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM (
      SELECT job_id
      FROM analytics.fact_job
      GROUP BY job_id
      HAVING COUNT(*) > 1
    ) x
  `);

  checks.push({
    name: "duplicate_jobs",
    passed: duplicateJobs.rows[0].count === 0,
    count: duplicateJobs.rows[0].count,
  });

  const orphanApplications = await warehousePool.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM analytics.fact_application a
    LEFT JOIN analytics.fact_job j
      ON j.job_key = a.job_key
    WHERE j.job_key IS NULL
  `);

  checks.push({
    name: "application_job_fk",
    passed: orphanApplications.rows[0].count === 0,
    count: orphanApplications.rows[0].count,
  });

  const negativeEscrow = await warehousePool.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM analytics.fact_escrow
    WHERE amount_xlm < 0
  `);

  checks.push({
    name: "negative_escrow",
    passed: negativeEscrow.rows[0].count === 0,
    count: negativeEscrow.rows[0].count,
  });

  const failed = checks.filter((c) => !c.passed);

  if (failed.length > 0) {
    throw new Error(
      `Warehouse quality checks failed: ${JSON.stringify(failed)}`
    );
  }

  return {
    success: true,
    checks,
  };
}

module.exports = {
  runWarehouseQualityChecks,
};