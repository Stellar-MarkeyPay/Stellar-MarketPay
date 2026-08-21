"use strict";

const fs = require("fs");
const path = require("path");
const pool = require("./pool");

const migrationsDir = path.join(__dirname, "migrations");

function parseVersion(name) {
  const m = name.match(/^V(\d+)__/i);
  return m ? Number(m[1]) : null;
}

function loadMigrationPairs() {
  const files = fs.readdirSync(migrationsDir);
  const upFiles = files.filter((f) => f.endsWith(".up.sql"));

  return upFiles
    .map((upFile) => {
      const version = parseVersion(upFile);
      const downFile = upFile.replace(/\.up\.sql$/, ".down.sql");
      if (version == null) return null;
      if (!files.includes(downFile)) {
        throw new Error(`Rollback file missing for migration ${upFile}`);
      }
      return {
        version,
        name: upFile.replace(/\.up\.sql$/, ""),
        upSql: fs.readFileSync(path.join(migrationsDir, upFile), "utf8"),
        downSql: fs.readFileSync(path.join(migrationsDir, downFile), "utf8"),
      };
    })
    .filter(Boolean)
    // Some historical migrations share a numeric version. The filename is the
    // migration identity; version is only used to provide the primary ordering.
    .sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Upgrade the original version-keyed ledger in place. Version numbers are
  // not unique in this repository, whereas a migration filename always is.
  await client.query(`
    DO $$
    DECLARE
      primary_key_name TEXT;
    BEGIN
      SELECT con.conname INTO primary_key_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE con.contype = 'p'
        AND rel.relname = 'schema_migrations'
        AND ns.nspname = current_schema();

      IF primary_key_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE schema_migrations DROP CONSTRAINT %I', primary_key_name);
      END IF;

      ALTER TABLE schema_migrations
        ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

async function getAppliedMigrationNames(client) {
  const { rows } = await client.query("SELECT name FROM schema_migrations");
  return new Set(rows.map((r) => r.name));
}

async function migrate() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const migrations = loadMigrationPairs();
    const applied = await getAppliedMigrationNames(client);

    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        console.log(`⏭️  Skipping V${migration.version} (already applied)`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.upSql);
        await client.query("INSERT INTO schema_migrations (name, version) VALUES ($1, $2)", [
          migration.name,
          migration.version,
        ]);
        await client.query("COMMIT");
        console.log(`✅ Applied V${migration.version}`);
      } catch (err) {
        await client.query("ROLLBACK");
        // Handle duplicate key error gracefully
        if (err.code === "23505" && err.constraint === "schema_migrations_pkey") {
          console.log(`⏭️  Skipping V${migration.version} (already applied, duplicate key)`);
          applied.add(migration.name);
          continue;
        }
        throw err;
      }
    }
    console.log("✅ All migrations completed successfully");
  } finally {
    client.release();
  }
}

async function rollbackLastMigration() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query(
      "SELECT version, name FROM schema_migrations ORDER BY version DESC, applied_at DESC, name DESC LIMIT 1"
    );

    if (!rows.length) return null;
    const last = rows[0];
    const downPath = path.join(migrationsDir, `${last.name}.down.sql`);

    if (!fs.existsSync(downPath)) {
      throw new Error(`Rollback file missing for migration ${last.name}`);
    }

    const downSql = fs.readFileSync(downPath, "utf8");

    await client.query("BEGIN");
    try {
      await client.query(downSql);
      // Versions are not unique in the historical migration set. Deleting by
      // version removed every migration sharing that version and caused the
      // round-trip verifier to stop early. The filename is the ledger key.
      await client.query("DELETE FROM schema_migrations WHERE name = $1", [last.name]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    return last.name;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const mode = process.argv[2] || "up";
  const run = mode === "down" ? rollbackLastMigration : migrate;

  run()
    .then((result) => {
      if (mode === "down") {
        console.log(result == null ? "No migrations to rollback" : `Rolled back ${result}`);
      } else {
        console.log("Migrations complete");
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { loadMigrationPairs, migrate, rollbackLastMigration };
