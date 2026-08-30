// src/services/historyService.js
"use strict";

const pool = require("../db/pool");
const logger = require("../utils/logger").createServiceLogger("history_service");

/**
 * Get completion rate for a freelancer (jobs completed / jobs assigned)
 * @param {string} freelancerAddress
 * @returns {Promise<number>} completion rate between 0 and 1
 */
async function getCompletionRate(freelancerAddress) {
  const query = `
    SELECT COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) AS total
    FROM jobs
    WHERE freelancer_address = $1
  `;
  const { rows } = await pool.query(query, [freelancerAddress]);
  const { completed = 0, total = 0 } = rows[0];
  return total > 0 ? completed / total : 0;
}

/**
 * Get dispute rate for a freelancer (disputes / jobs completed)
 * @param {string} freelancerAddress
 * @returns {Promise<number>} dispute rate between 0 and 1
 */
async function getDisputeRate(freelancerAddress) {
  const query = `
    SELECT COUNT(*) FILTER (WHERE d.status = 'open') AS open_disputes,
           COUNT(*) FILTER (WHERE j.status = 'completed') AS completed_jobs
    FROM disputes d
    JOIN jobs j ON d.job_id = j.id
    WHERE j.freelancer_address = $1
  `;
  const { rows } = await pool.query(query, [freelancerAddress]);
  const { open_disputes = 0, completed_jobs = 0 } = rows[0];
  return completed_jobs > 0 ? open_disputes / completed_jobs : 0;
}

/**
 * Get average rating for a freelancer
 * @param {string} freelancerAddress
 * @returns {Promise<number>} average rating (1-5) or 0 if none
 */
async function getAverageRating(freelancerAddress) {
  const query = `
    SELECT AVG(stars) AS avg_rating
    FROM ratings
    WHERE rated_address = $1
  `;
  const { rows } = await pool.query(query, [freelancerAddress]);
  const { avg_rating } = rows[0];
  return avg_rating || 0;
}

module.exports = {
  getCompletionRate,
  getDisputeRate,
  getAverageRating,
};
