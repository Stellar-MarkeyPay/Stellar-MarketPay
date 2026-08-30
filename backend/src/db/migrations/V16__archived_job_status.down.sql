-- V16__archived_job_status.down.sql
-- Revert 'archived' status: move archived jobs back to 'cancelled' before
-- dropping the enum value (Postgres does not support removing enum values
-- directly; a full type rebuild is required in production).

UPDATE jobs SET status = 'cancelled' WHERE status = 'archived';

-- NOTE: Postgres does not allow DROP VALUE on an enum. In production, a full
-- enum rebuild would be needed. This migration rolls back data only.
