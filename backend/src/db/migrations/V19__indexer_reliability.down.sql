DROP TABLE IF EXISTS indexer_reconciliation_findings;
DROP TABLE IF EXISTS indexer_reconciliation_runs;
DROP TABLE IF EXISTS indexer_outbox;
DROP TABLE IF EXISTS indexer_ledger_lineage;
DROP TABLE IF EXISTS indexer_checkpoints;
DROP TABLE IF EXISTS indexer_applied_effects;
DROP TABLE IF EXISTS indexer_raw_events;
DROP TABLE IF EXISTS indexer_reorg_journal;
DROP TABLE IF EXISTS indexer_ledger_batches;

ALTER TABLE indexer_state
  DROP COLUMN IF EXISTS last_reconciled_at,
  DROP COLUMN IF EXISTS last_event_uid,
  DROP COLUMN IF EXISTS last_event_ledger;

DROP INDEX IF EXISTS contract_events_canonical_job_created_idx;
DROP INDEX IF EXISTS contract_events_event_uid_uq;

ALTER TABLE contract_events
  DROP COLUMN IF EXISTS canonical,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS event_uid;

DROP TABLE IF EXISTS donor_stats;
DROP TABLE IF EXISTS payment_records;
