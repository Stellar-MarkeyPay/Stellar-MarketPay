"use strict";

const path = require("path");
const pool = require("../src/db/pool");
const { loadMigrationPairs, migrate, rollbackLastMigration } = require("../src/db/migrate");

const migrationsDir = path.join(__dirname, "../src/db/migrations");
const destructiveRollback = /\bDROP\s+(?:TABLE|COLUMN)\b/i;
const destructiveMarker = /^\s*--\s*rollback:\s*destructive\b/im;

function assertRollbackMetadata(migrations) {
  for (const migration of migrations) {
    if (destructiveRollback.test(migration.downSql) && !destructiveMarker.test(migration.downSql)) {
      throw new Error(`${migration.name}.down.sql is destructive but is missing a rollback: destructive marker`);
    }
  }
}

async function appliedMigrationCount() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM schema_migrations");
  return rows[0].count;
}

async function verifyRoundTrip() {
  const migrations = loadMigrationPairs();
  if (!migrations.length) throw new Error(`No migration pairs found in ${migrationsDir}`);
  assertRollbackMetadata(migrations);

  await migrate();
  if ((await appliedMigrationCount()) !== migrations.length) {
    throw new Error("Initial migration run did not apply every migration");
  }

  for (let index = 0; index < migrations.length; index += 1) {
    const rolledBack = await rollbackLastMigration();
    if (rolledBack == null) throw new Error("Rollback ended before every migration was reverted");
  }
  if ((await appliedMigrationCount()) !== 0) throw new Error("Rollback left migrations in the ledger");

  await migrate();
  if ((await appliedMigrationCount()) !== migrations.length) {
    throw new Error("Re-apply did not apply every migration");
  }

  console.log(`Verified up/down/up for ${migrations.length} migrations.`);
}

verifyRoundTrip()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
