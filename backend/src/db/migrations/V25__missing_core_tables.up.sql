-- V25: Create missing tables: contract_audit_log, disputes, proposal_templates, job_reports, skill_endorsements, skill_assessments

-- 1. contract_audit_log
CREATE TABLE IF NOT EXISTS contract_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name   TEXT NOT NULL,
  caller_address  TEXT NOT NULL,
  job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
  tx_hash         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contract_audit_log_job_id_idx ON contract_audit_log(job_id);
CREATE INDEX IF NOT EXISTS contract_audit_log_caller_idx ON contract_audit_log(caller_address);

-- 2. disputes
CREATE TABLE IF NOT EXISTS disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  raised_by       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  resolved_by     TEXT,
  resolution      TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS disputes_job_id_idx ON disputes(job_id);
CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes(status);

-- 3. proposal_templates
CREATE TABLE IF NOT EXISTS proposal_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_address  TEXT NOT NULL,
  name                TEXT NOT NULL,
  content             TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS proposal_templates_freelancer_idx ON proposal_templates(freelancer_address);

-- 4. job_reports
CREATE TABLE IF NOT EXISTS job_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID REFERENCES jobs(id) ON DELETE CASCADE,
  reporter_address  TEXT NOT NULL,
  category          TEXT NOT NULL,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS job_reports_job_id_idx ON job_reports(job_id);
CREATE INDEX IF NOT EXISTS job_reports_reporter_idx ON job_reports(reporter_address);

-- 5. skill_endorsements
CREATE TABLE IF NOT EXISTS skill_endorsements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill               TEXT NOT NULL,
  endorser_address    TEXT NOT NULL,
  recipient_address   TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (skill, endorser_address, recipient_address)
);
CREATE INDEX IF NOT EXISTS skill_endorsements_recipient_idx ON skill_endorsements(recipient_address);

-- 6. skill_assessments
CREATE TABLE IF NOT EXISTS skill_assessments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key  TEXT NOT NULL,
  skill       TEXT NOT NULL,
  score       INTEGER NOT NULL,
  passed      BOOLEAN NOT NULL DEFAULT false,
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS skill_assessments_public_key_idx ON skill_assessments(public_key, skill);
