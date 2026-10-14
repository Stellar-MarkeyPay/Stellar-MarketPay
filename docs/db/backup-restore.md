# Database backup and restore procedure

## Overview

The application database is the authoritative record of jobs, applications, and
payment history. This document defines the backup schedule, retention policy,
storage layout, step-by-step restore procedure, point-in-time recovery (PITR),
and the recurring restore drill.

## Backup schedule and retention

### Schedule

| Frequency | Time (UTC) | Retention | Storage tier          |
| --------- | ---------- | --------- | --------------------- |
| Hourly    | :00       | 24 hours  | Local SSD / fast disk |
| Daily     | 00:00      | 7 days    | Local SSD / fast disk |
| Weekly    | Sun 00:00  | 4 weeks   | Object storage        |
| Monthly   | 01 00:00   | 12 months | Object storage + tape |

### Retention policy

- **Daily** backups are retained for **7 days**.
- **Weekly** backups (promoted from Sunday daily) are retained for **4 weeks**.
- **Monthly** backups (promoted from the first of the month) are retained for
  **12 months**.
- The most recent backup of each tier must always be present.

### Storage locations

| Tier      | Location                                    | Off-site copy |
| --------- | ------------------------------------------- | ------------- |
| Primary   | Managed PostgreSQL continuous backup        | Yes           |
| Local     | `./backups/daily`, `weekly`, `monthly`      | No            |
| Off-site  | `s3://marketpay-backups` or `gs://` bucket  | Yes           |

The managed PostgreSQL provider maintains continuous WAL archiving and
continuous backup. The `scripts/db/backup.sh` script creates logical dumps that
serve as an additional recovery path and as the source for the scratch restore
drill.

### Off-site copies

Set `OFF_SITE_COPY` to an S3 or GCS URI:

```bash
export OFF_SITE_COPY=s3://marketpay-backups/prod
./scripts/db/backup.sh
```

The script copies the daily and monthly backups (plus globals and checksums) to
the configured bucket. Use provider-side bucket replication or
cross-region/dual-region buckets for durability.

## Restore procedure

### Prerequisites

- PostgreSQL client tools (`pg_restore`, `psql`, `pg_dump`) version 16 or
  compatible.
- A target PostgreSQL instance for the scratch restore.
- The latest backup file and its `.sha256` checksum.
- Backend application source (for running migrations, if needed).

### Step-by-step restore to scratch

1. **Verify backup integrity before restoring**

   ```bash
   ./scripts/db/verify.sh ./backups/daily/stellarwork_20260820T000000Z.sql.gz
   ```

   The verify script checks:
   - SHA256 checksum of the backup file.
   - Presence of expected tables (`profiles`, `jobs`, `applications`,
     `payments`, `escrow_contracts`, etc.).
   - Row counts for critical tables.
   - Foreign-key integrity.
   - Index presence.
   - Required extensions (`pg_trgm`).

2. **Prepare the scratch database**

   ```bash
   export PGHOST=scratch-db.internal
   export PGPORT=5432
   export PGUSER=stellarwork
   export PGPASSWORD=scratch_password
   export PGDATABASE=stellarwork_restore_scratch
   export DROP_IF_EXISTS=1
   ```

3. **Restore and measure time**

   ```bash
   time ./scripts/db/restore.sh \
     ./backups/daily/stellarwork_20260820T000000Z.sql.gz \
     stellarwork_restore_scratch
   ```

   The script outputs:
   - Total elapsed time.
   - Restore-only time (excluding database creation/dropping).
   - A JSON report at `./artifacts/restore-report.json`.

4. **Run migrations if schema has drifted**

   ```bash
   export RUN_MIGRATIONS=1
   ./scripts/db/restore.sh ./backups/daily/stellarwork_20260820T000000Z.sql.gz stellarwork_restore_scratch
   ```

5. **Verify restored data**

   ```bash
   ./scripts/db/verify.sh ./backups/daily/stellarwork_20260820T000000Z.sql.gz
   ```

   Compare the verification report against the pre-restore report. Row counts
   should match within the tolerance defined by `EXPECTED_ROW_TOLERANCE`
   (default: 1%).

6. **Smoke test the restored application**

   Point the backend to the scratch database and run a subset of integration
   tests:

   ```bash
   cd backend
   DATABASE_URL="postgresql://stellarwork:scratch_password@scratch-db.internal:5432/stellarwork_restore_scratch" \
     npm run test -- --testPathPattern="services/(escrowService|jobService|applicationService)"
   ```

### Point-in-time recovery (PITR)

Managed PostgreSQL providers (AWS RDS, GCP Cloud SQL, Azure Database) support
PITR via continuous WAL archiving. To restore to a specific point in time:

1. **Identify the target timestamp** from the incident timeline.
2. **Create a new database instance** from the latest base backup using the
   provider's control plane.
3. **Apply WAL replay up to the target timestamp** using the provider's
   recovery interface (e.g., `restore_to_time` in AWS RDS).
4. **Export the recovered database** with `pg_dump` to a local file.
5. **Verify the recovered data** with `scripts/db/verify.sh`.
6. **Promote the recovered database** to production only after the incident
   commander and database operator have validated the data.

PITR recovery time objective (RTO) depends on the provider's replay speed and
the distance between the failure time and the latest WAL archive. Document the
observed RTO after each PITR exercise.

## Recurring restore drill

### Objective

Prove that backups are restorable and that the procedure stays valid. A backup
that has never been restored is not a backup.

### Frequency

Run the full drill (backup → restore → verify → smoke test) at the following
intervals:

- **Weekly**: Automated GitHub Actions workflow (see below).
- **Monthly**: Manual drill with a team observer. Record the result in the
  incident log and attach the verification report.

### Procedure

1. Trigger the `db-restore-drill` workflow or run it locally.
2. The workflow:
   - Starts a fresh PostgreSQL service.
   - Runs migrations and inserts known seed data.
   - Runs `scripts/db/backup.sh`.
   - Drops and recreates the scratch database.
   - Runs `scripts/db/restore.sh` and captures the elapsed time.
   - Runs `scripts/db/verify.sh` and captures pass/fail.
   - Runs a subset of backend integration tests against the restored database.
   - Uploads the backup, restore report, and verification report as artifacts.
3. If any step fails, the workflow exits non-zero and notifies the team.
4. Record the observed restore time in `docs/dr/game-day-report.md`.

### Pass criteria

- Restore completes within **15 minutes** for a 10 GB database.
- Verification report shows **0 failed checks**.
- Integration tests pass against the restored database.
- All artifacts (backup, checksum, reports) are present.

## Environment variables reference

| Variable                | Required | Default                          | Description                                |
| ----------------------- | -------- | -------------------------------- | ------------------------------------------ |
| `DATABASE_URL`          | Yes      | —                                | PostgreSQL connection string                |
| `BACKUP_DIR`            | No       | `./backups`                      | Root directory for backup tiers             |
| `RETENTION_DAYS`        | No       | `7`                              | Days to keep daily backups                  |
| `RETENTION_WEEKS`       | No       | `4`                              | Weeks to keep weekly backups                |
| `RETENTION_MONTHS`      | No       | `12`                             | Months to keep monthly backups              |
| `OFF_SITE_COPY`         | No       | —                                | `s3://bucket/path` or `gs://bucket/path`    |
| `DROP_IF_EXISTS`        | No       | `1`                              | Drop target database before restore         |
| `RUN_MIGRATIONS`        | No       | `0`                              | Run backend migrations after restore        |
| `RESTORE_REPORT`        | No       | `./artifacts/restore-report.json`| JSON path for restore timing report         |
| `EXPECTED_ROW_TOLERANCE`| No       | `1`                              | Percent tolerance for row-count comparison  |
| `VERIFY_REPORT`         | No       | `./artifacts/verify-report.json` | JSON path for verification report           |

## Scripts reference

| Script                   | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `scripts/db/backup.sh`   | Compressed pg_dump with checksums, tier promotion, retention |
| `scripts/db/restore.sh`  | Restore to scratch DB with timing and optional migrations    |
| `scripts/db/verify.sh`   | Checksum, schema, row-count, FK, and index validation        |

## Incident response

If the restore procedure fails during a real incident:

1. Do **not** delete the existing production database until the restored copy
   is validated.
2. Capture the full `stderr` output from `restore.sh` and `verify.sh`.
3. Open an incident ticket and attach the verification report.
4. If the backup itself is corrupted, fall back to the managed provider's
   PITR.
5. After recovery, schedule a retrospective and update this runbook if the
   procedure changed.
