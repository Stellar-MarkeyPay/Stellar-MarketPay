-- rollback: destructive. This deletes API credentials and audit history.
DROP TABLE IF EXISTS api_key_usage_daily;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS frozen_wallets;
DROP TABLE IF EXISTS audit_logs;
