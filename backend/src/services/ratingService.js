/**
 * src/services/ratingService.js
 */
"use strict";

const pool = require("../db/pool");
const { refreshFreelancerTier } = require("./profileService");
const reputationService = require("./reputationService");

async function createRating({ jobId, raterAddress, ratedAddress, stars, review }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO ratings (job_id, rater_address, rated_address, stars, review)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id, rater_address) DO NOTHING
       RETURNING *`,
      [jobId, raterAddress, ratedAddress, stars, review || null]
    );

    if (!rows.length) {
      const e = new Error("Rating already submitted for this job");
      e.status = 409;
      throw e;
    }

    const freelancerTier = await refreshFreelancerTier(ratedAddress, client);

    // ZK reputation (Issue #319): only freelancer-facing ratings are
    // committed today — "avg rating", "completion count", "earnings band"
    // and "dispute-free streak" are all freelancer-reputation statements.
    // A client rating a freelancer creates a commitment leaf in the same
    // transaction as the rating itself, so the two can never diverge — see
    // reputationService.js's module doc for the atomicity guarantee this
    // gives the Merkle history. Client-side reputation (a freelancer rating
    // a client) is out of this v1's scope; see docs/ADR-010-zk-reputation.md.
    const { rows: jobRows } = await client.query(
      "SELECT freelancer_address, disputed_by FROM jobs WHERE id = $1",
      [jobId]
    );
    const job = jobRows[0];
    if (job && job.freelancer_address === ratedAddress) {
      await reputationService.commitRating(client, {
        ratingId: rows[0].id,
        jobId,
        subjectAddress: ratedAddress,
        stars,
        disputeFlag: Boolean(job.disputed_by),
      });
    }

    await client.query("COMMIT");
    return { ...rows[0], freelancer_tier: freelancerTier };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getRatingsForUser(publicKey) {
  const { rows } = await pool.query(
    `SELECT * FROM ratings WHERE rated_address = $1 ORDER BY created_at DESC`,
    [publicKey]
  );
  return rows;
}

module.exports = { createRating, getRatingsForUser };
