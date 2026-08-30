-- V19__time_entries_backfill.up.sql
--
-- Backfill: time_entries / time_invoices (Issue #346 — time tracking and
-- billing) were only ever added to db/schema.sql, a reference snapshot
-- that migrate.js does not read — never to an actual migration file. As
-- a result neither table exists in any database built from a clean
-- `npm run migrate`, including CI's. This migration creates them
-- verbatim from schema.sql; `IF NOT EXISTS` makes it a safe no-op
-- against any environment where they were somehow created out-of-band.
--
-- See docs/ADR-012-recurring-retainers.md's "Migration plan" for how
-- this was found: V20 (recurring retainers) is the first migration to
-- alter time_entries, and failed outright without this one first.

CREATE TABLE IF NOT EXISTS time_entries (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  duration_minutes    INTEGER     NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  description         TEXT,
  started_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_entries_job_id_idx         ON time_entries(job_id);
CREATE INDEX IF NOT EXISTS time_entries_freelancer_idx     ON time_entries(freelancer_address);

CREATE TABLE IF NOT EXISTS time_invoices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  freelancer_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  client_address      TEXT        NOT NULL REFERENCES profiles(public_key),
  total_minutes       INTEGER     NOT NULL CHECK (total_minutes > 0),
  hourly_rate_xlm     NUMERIC(20,7) NOT NULL,
  total_amount_xlm    NUMERIC(20,7) NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected')),
  entry_ids           UUID[]      NOT NULL DEFAULT '{}',
  contract_tx_hash    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_invoices_job_id_idx        ON time_invoices(job_id);
CREATE INDEX IF NOT EXISTS time_invoices_freelancer_idx    ON time_invoices(freelancer_address);
CREATE INDEX IF NOT EXISTS time_invoices_client_idx        ON time_invoices(client_address);
