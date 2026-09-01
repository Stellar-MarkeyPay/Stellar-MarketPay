-- rollback: destructive. This deletes job and escrow milestone data.
ALTER TABLE escrows DROP COLUMN IF EXISTS milestones;
ALTER TABLE jobs DROP COLUMN IF EXISTS milestones;
