-- ─────────────────────────────────────────
-- V19 — Indexer reliability hardening
-- ─────────────────────────────────────────

-- Legacy sink tables referenced by indexerService.js but previously not
-- formalised in the migration set.
CREATE TABLE IF NOT EXISTS payment_records (
  operation_id   TEXT PRIMARY KEY,
  tx_hash        TEXT NOT NULL,
  ledger         BIGINT,
  job_id         TEXT,
  from_address   TEXT NOT NULL,
  to_address     TEXT NOT NULL,
  amount         NUMERIC(20,7) NOT NULL,
  asset          TEXT NOT NULL,
  memo           TEXT,
  direction      TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_records_job_id_idx ON payment_records(job_id);
CREATE INDEX IF NOT EXISTS payment_records_ledger_idx ON payment_records(ledger DESC);

CREATE TABLE IF NOT EXISTS donor_stats (
  address             TEXT PRIMARY KEY,
  total_donated_xlm   NUMERIC(20,7) NOT NULL DEFAULT 0,
  donation_count      INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public-facing contract event projection gains canonical identity so replay
-- and reorg handling can be idempotent.
ALTER TABLE contract_events
  ADD COLUMN IF NOT EXISTS event_uid TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'contract_events',
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS contract_events_event_uid_uq
  ON contract_events(event_uid)
  WHERE event_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS contract_events_canonical_job_created_idx
  ON contract_events(job_id, created_at ASC)
  WHERE canonical = TRUE;

-- Legacy singleton row retained for compatibility, but richer checkpointing
-- lives below.
ALTER TABLE indexer_state
  ADD COLUMN IF NOT EXISTS last_event_ledger BIGINT,
  ADD COLUMN IF NOT EXISTS last_event_uid TEXT,
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS indexer_ledger_batches (
  batch_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,
  batch_kind      TEXT NOT NULL DEFAULT 'live',
  from_ledger     BIGINT,
  to_ledger       BIGINT,
  replay_run_id   UUID,
  status          TEXT NOT NULL DEFAULT 'pending',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at    TIMESTAMPTZ,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS indexer_ledger_batches_source_started_idx
  ON indexer_ledger_batches(source, started_at DESC);

CREATE TABLE IF NOT EXISTS indexer_reorg_journal (
  reorg_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                TEXT NOT NULL,
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_tip_ledger        BIGINT,
  new_tip_ledger        BIGINT,
  rollback_from_ledger  BIGINT NOT NULL,
  rollback_to_ledger    BIGINT,
  status                TEXT NOT NULL DEFAULT 'detected',
  details               JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS indexer_raw_events (
  event_uid              TEXT PRIMARY KEY,
  batch_id               UUID REFERENCES indexer_ledger_batches(batch_id) ON DELETE SET NULL,
  source                 TEXT NOT NULL,
  ledger_sequence        BIGINT NOT NULL,
  ledger_hash            TEXT,
  parent_ledger_hash     TEXT,
  tx_hash                TEXT,
  event_index            INTEGER NOT NULL DEFAULT 0,
  event_type             TEXT NOT NULL,
  schema_version         INTEGER NOT NULL DEFAULT 1,
  job_id                 TEXT,
  payload                JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at            TIMESTAMPTZ,
  canonical              BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by_reorg_id UUID REFERENCES indexer_reorg_journal(reorg_id) ON DELETE SET NULL,
  seen_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indexer_raw_events_source_ledger_idx
  ON indexer_raw_events(source, ledger_sequence ASC, event_index ASC);

CREATE INDEX IF NOT EXISTS indexer_raw_events_job_idx
  ON indexer_raw_events(job_id, ledger_sequence ASC, event_index ASC);

CREATE INDEX IF NOT EXISTS indexer_raw_events_canonical_idx
  ON indexer_raw_events(source, canonical, ledger_sequence ASC);

CREATE TABLE IF NOT EXISTS indexer_applied_effects (
  effect_uid       TEXT PRIMARY KEY,
  event_uid        TEXT NOT NULL REFERENCES indexer_raw_events(event_uid) ON DELETE CASCADE,
  effect_type      TEXT NOT NULL,
  target_table     TEXT NOT NULL,
  target_key       TEXT NOT NULL,
  replay_safe      BOOLEAN NOT NULL DEFAULT TRUE,
  applied_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS indexer_applied_effects_event_uid_idx
  ON indexer_applied_effects(event_uid);

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  stream_name          TEXT PRIMARY KEY,
  last_ledger_sequence BIGINT,
  last_ledger_hash     TEXT,
  last_event_uid       TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS indexer_ledger_lineage (
  source               TEXT NOT NULL,
  ledger_sequence      BIGINT NOT NULL,
  ledger_hash          TEXT,
  parent_ledger_hash   TEXT,
  closed_at            TIMESTAMPTZ,
  observed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, ledger_sequence)
);

CREATE TABLE IF NOT EXISTS indexer_outbox (
  outbox_uid      TEXT PRIMARY KEY,
  event_uid       TEXT NOT NULL REFERENCES indexer_raw_events(event_uid) ON DELETE CASCADE,
  side_effect     TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  suppressed      BOOLEAN NOT NULL DEFAULT FALSE,
  dispatched_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indexer_outbox_pending_idx
  ON indexer_outbox(dispatched_at, suppressed, created_at ASC);

CREATE TABLE IF NOT EXISTS indexer_reconciliation_runs (
  run_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode            TEXT NOT NULL,
  from_ledger     BIGINT,
  to_ledger       BIGINT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',
  summary         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS indexer_reconciliation_findings (
  finding_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID REFERENCES indexer_reconciliation_runs(run_id) ON DELETE SET NULL,
  divergence_class  TEXT NOT NULL,
  job_id            TEXT,
  ledger_sequence   BIGINT,
  expected          JSONB NOT NULL DEFAULT '{}'::jsonb,
  actual            JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostics       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indexer_reconciliation_findings_class_idx
  ON indexer_reconciliation_findings(divergence_class, created_at DESC);
