-- V19__time_entries_backfill.down.sql
--
-- Only safe to run once V20 (recurring retainers) has already been
-- rolled back — its down migration removes the retainer_id/
-- retainer_period_id foreign keys these tables would otherwise still
-- be referenced by.

DROP TABLE IF EXISTS time_invoices;
DROP TABLE IF EXISTS time_entries;
