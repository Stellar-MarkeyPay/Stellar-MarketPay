/**
 * scripts/reindex-job-search-vector.js
 *
 * Recomputes job_search_vector for every row in `jobs`, unconditionally
 * (unlike the migration backfill, which only fills rows where it is NULL).
 *
 * The trigger in V11/V16 keeps job_search_vector in sync on every INSERT/
 * UPDATE, but any write path that bypasses it (a restored backup, a manual
 * `UPDATE jobs SET ...` run directly against the database, a future
 * migration that touches title/description/skills/category without also
 * touching the vector) can leave it stale. Run this to bring it back in
 * sync with the current trigger definition. See ADR-009.
 *
 * Usage: npm run reindex:job-search (from backend/)
 */
"use strict";

const pool = require("../src/db/pool");

async function reindexJobSearchVector() {
  const client = await pool.connect();
  try {
    const { rowCount } = await client.query(`
      UPDATE jobs SET job_search_vector =
        setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(description, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(array_to_string(skills, ' '), '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(category, '')), 'D')
    `);
    return rowCount;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  reindexJobSearchVector()
    .then((rowCount) => {
      console.log(`✅ Reindexed job_search_vector for ${rowCount} job(s)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Reindex failed:", err.message);
      process.exit(1);
    });
}

module.exports = { reindexJobSearchVector };
