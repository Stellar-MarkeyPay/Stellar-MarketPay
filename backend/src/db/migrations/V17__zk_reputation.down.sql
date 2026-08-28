-- V17__zk_reputation.down.sql
ALTER TABLE profiles DROP COLUMN IF EXISTS reputation_visibility;
DROP TABLE IF EXISTS application_reputation_proofs;
DROP TABLE IF EXISTS job_reputation_requirements;
DROP TABLE IF EXISTS reputation_revocations;
DROP TABLE IF EXISTS reputation_epochs;
DROP TABLE IF EXISTS reputation_commitments;
