-- V18__verifiable_credentials.down.sql
--
-- Drop all tables created by V18 in reverse dependency order.
-- Presentation requests first (no dependents), then the rest.

DROP TABLE IF EXISTS presentation_requests;
DROP TABLE IF EXISTS credential_imports;
DROP TABLE IF EXISTS credential_presentations;
DROP TABLE IF EXISTS verifiable_credentials;
DROP TABLE IF EXISTS credential_status_lists;
DROP TABLE IF EXISTS did_key_history;
DROP TABLE IF EXISTS did_documents;
