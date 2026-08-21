-- rollback: destructive. This deletes insurance, proof, and SLA history.
-- Rollback insurance and SLA monitoring tables

DROP VIEW IF EXISTS insurance_summary;
DROP INDEX IF EXISTS idx_unique_active_claim_per_file;
DROP TABLE IF EXISTS sla_violations;
DROP TABLE IF EXISTS insurance_premiums_paid;
DROP TABLE IF EXISTS oracle_proofs;
DROP TABLE IF EXISTS availability_check_history;
DROP TABLE IF EXISTS insurance_claims;
DROP TABLE IF EXISTS insured_files;
