-- Rollback for feature flags and experimentation platform (Issue #259).

DROP TABLE IF EXISTS flag_exposure_events;
DROP TABLE IF EXISTS flag_experiments;
DROP TABLE IF EXISTS flag_audit_log;
DROP TABLE IF EXISTS flag_overrides;
DROP TABLE IF EXISTS flag_targeting_rules;
DROP TABLE IF EXISTS feature_flags;
