-- V20__recurring_retainers.down.sql

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_billing_construct_chk;
DROP INDEX IF EXISTS time_entries_retainer_idx;
DROP INDEX IF EXISTS time_entries_retainer_period_idx;

ALTER TABLE time_entries DROP COLUMN IF EXISTS retainer_id;
ALTER TABLE time_entries DROP COLUMN IF EXISTS retainer_period_id;
ALTER TABLE time_entries DROP COLUMN IF EXISTS approval_status;
ALTER TABLE time_entries DROP COLUMN IF EXISTS approved_by;
ALTER TABLE time_entries DROP COLUMN IF EXISTS approved_at;
ALTER TABLE time_entries DROP COLUMN IF EXISTS dispute_reason;
ALTER TABLE time_entries DROP COLUMN IF EXISTS resolved_by;
ALTER TABLE time_entries DROP COLUMN IF EXISTS resolved_at;

ALTER TABLE time_entries ALTER COLUMN job_id SET NOT NULL;

DROP TABLE IF EXISTS retainer_statements;
DROP TABLE IF EXISTS retainer_funding_events;

ALTER TABLE retainers DROP CONSTRAINT IF EXISTS retainers_pending_amendment_id_fkey;
DROP TABLE IF EXISTS retainer_amendments;

DROP TABLE IF EXISTS retainer_periods;

ALTER TABLE retainer_proposals DROP CONSTRAINT IF EXISTS retainer_proposals_retainer_id_fkey;
DROP TABLE IF EXISTS retainers;
DROP TABLE IF EXISTS retainer_proposals;
