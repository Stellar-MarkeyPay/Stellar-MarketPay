-- Observation-window rollback only. RESTRICT foreign keys make accidental loss
-- visible; once compliance decisions exist, disable policy and deploy forward.
DROP TABLE IF EXISTS compliance_deletion_requests;
DROP TABLE IF EXISTS compliance_audit_events;
DROP TABLE IF EXISTS compliance_reports;
DROP TABLE IF EXISTS travel_rule_exchanges;
DROP TABLE IF EXISTS compliance_risk_assessments;
DROP TABLE IF EXISTS compliance_case_events;
DROP TABLE IF EXISTS compliance_alerts;
DROP TABLE IF EXISTS compliance_cases;
DROP TABLE IF EXISTS compliance_transactions;
DROP TABLE IF EXISTS jurisdiction_rule_sets;
DROP TABLE IF EXISTS compliance_screening_matches;
DROP TABLE IF EXISTS compliance_screenings;
DROP TABLE IF EXISTS compliance_corporate_parties;
DROP TABLE IF EXISTS compliance_verification_sessions;
DROP TABLE IF EXISTS compliance_subjects;
