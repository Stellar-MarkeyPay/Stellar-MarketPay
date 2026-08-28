-- Additive compliance-core schema. Enforcement starts disabled through the
-- seeded observe-only policy; publishing policy is an explicit admin action.

CREATE TABLE IF NOT EXISTS compliance_subjects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_address         TEXT NOT NULL UNIQUE REFERENCES profiles(public_key) ON DELETE RESTRICT,
  subject_type          TEXT NOT NULL CHECK (subject_type IN ('individual', 'corporate')),
  verification_status   TEXT NOT NULL DEFAULT 'unverified'
                          CHECK (verification_status IN ('unverified', 'pending', 'needs_input', 'verified', 'expired', 'rejected')),
  verification_tier     SMALLINT NOT NULL DEFAULT 0 CHECK (verification_tier BETWEEN 0 AND 3),
  legal_name_masked     TEXT,
  country_code          TEXT CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  provider_name         TEXT,
  provider_customer_ref TEXT,
  pii_envelope          JSONB,
  pii_blind_index       TEXT,
  pii_key_id            TEXT,
  verified_at           TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  next_screening_at     TIMESTAMPTZ,
  retention_until       TIMESTAMPTZ,
  legal_hold            BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_kyc_evidence   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_subjects_screening_due_idx
  ON compliance_subjects(next_screening_at)
  WHERE next_screening_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_subjects_expiry_idx
  ON compliance_subjects(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS compliance_verification_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id            UUID NOT NULL REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  provider_name         TEXT NOT NULL,
  provider_session_ref  TEXT,
  requested_tier        SMALLINT NOT NULL CHECK (requested_tier BETWEEN 1 AND 3),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'needs_input', 'verified', 'expired', 'rejected', 'cancelled')),
  required_fields       JSONB NOT NULL DEFAULT '[]'::jsonb,
  provided_fields       JSONB NOT NULL DEFAULT '[]'::jsonb,
  document_status       TEXT NOT NULL DEFAULT 'not_required'
                          CHECK (document_status IN ('not_required', 'required', 'pending', 'verified', 'rejected')),
  liveness_status       TEXT NOT NULL DEFAULT 'not_required'
                          CHECK (liveness_status IN ('not_required', 'required', 'pending', 'verified', 'rejected')),
  decision_reasons      JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_result_hash  TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_name, provider_session_ref)
);

CREATE INDEX IF NOT EXISTS compliance_verification_subject_idx
  ON compliance_verification_sessions(subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS compliance_corporate_parties (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_subject_id  UUID NOT NULL REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  party_role            TEXT NOT NULL CHECK (party_role IN ('director', 'beneficial_owner', 'authorised_representative')),
  ownership_bps         INTEGER CHECK (ownership_bps IS NULL OR ownership_bps BETWEEN 0 AND 10000),
  legal_name_masked     TEXT NOT NULL,
  country_code          TEXT CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  pii_envelope          JSONB NOT NULL,
  pii_blind_index       TEXT NOT NULL,
  pii_key_id            TEXT NOT NULL,
  screening_status      TEXT NOT NULL DEFAULT 'pending'
                          CHECK (screening_status IN ('pending', 'clear', 'potential_match', 'confirmed_match', 'provider_error')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (corporate_subject_id, pii_blind_index, party_role)
);

CREATE TABLE IF NOT EXISTS compliance_screenings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id            UUID NOT NULL REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  corporate_party_id    UUID REFERENCES compliance_corporate_parties(id) ON DELETE RESTRICT,
  provider_name         TEXT NOT NULL,
  provider_screening_ref TEXT,
  reason                TEXT NOT NULL CHECK (reason IN ('onboarding', 'scheduled', 'transaction', 'manual', 'material_change')),
  status                TEXT NOT NULL CHECK (status IN ('clear', 'potential_match', 'confirmed_match', 'provider_error')),
  list_version          TEXT,
  result_hash           TEXT NOT NULL,
  screened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_screening_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_screenings_subject_idx
  ON compliance_screenings(subject_id, screened_at DESC);

CREATE TABLE IF NOT EXISTS compliance_screening_matches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id          UUID NOT NULL REFERENCES compliance_screenings(id) ON DELETE RESTRICT,
  category              TEXT NOT NULL CHECK (category IN ('sanctions', 'pep', 'adverse_media', 'other')),
  list_name             TEXT NOT NULL,
  match_score           NUMERIC(5,2) NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  matched_name_masked   TEXT,
  provider_match_ref    TEXT,
  evidence              JSONB NOT NULL DEFAULT '{}'::jsonb,
  disposition           TEXT NOT NULL DEFAULT 'unreviewed'
                          CHECK (disposition IN ('unreviewed', 'false_positive', 'true_match', 'monitor')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jurisdiction_rule_sets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction          TEXT NOT NULL,
  version               INTEGER NOT NULL,
  schema_version        INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  effective_from        TIMESTAMPTZ NOT NULL,
  effective_until       TIMESTAMPTZ,
  rules                 JSONB NOT NULL,
  checksum              TEXT NOT NULL,
  authored_by           TEXT NOT NULL,
  reviewed_by           TEXT,
  published_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (jurisdiction, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS jurisdiction_rule_active_version_idx
  ON jurisdiction_rule_sets(jurisdiction, effective_from)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS compliance_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key       TEXT NOT NULL UNIQUE,
  originator_subject_id UUID NOT NULL REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  beneficiary_subject_id UUID REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  beneficiary_address   TEXT NOT NULL,
  beneficiary_wallet_type TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (beneficiary_wallet_type IN ('institution', 'self_hosted', 'unknown')),
  counterparty_institution TEXT,
  amount                NUMERIC(30,7) NOT NULL CHECK (amount > 0),
  asset                 TEXT NOT NULL,
  direction             TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  jurisdiction          TEXT NOT NULL,
  policy_version        INTEGER NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'observed'
                          CHECK (status IN ('observed', 'held', 'approved', 'rejected', 'settled')),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_transactions_subject_time_idx
  ON compliance_transactions(originator_subject_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS compliance_transactions_counterparty_idx
  ON compliance_transactions(originator_subject_id, beneficiary_address, occurred_at DESC);

CREATE TABLE IF NOT EXISTS compliance_cases (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id            UUID NOT NULL REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'triaged', 'investigating', 'escalated', 'decided', 'closed')),
  priority              TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  case_type             TEXT NOT NULL CHECK (case_type IN ('screening', 'monitoring', 'travel_rule', 'identity', 'geo', 'manual')),
  assigned_to           TEXT,
  decision              TEXT CHECK (decision IS NULL OR decision IN ('cleared', 'monitor', 'restrict', 'reject', 'file_report')),
  decision_reason       TEXT,
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at            TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_cases_queue_idx
  ON compliance_cases(status, priority, opened_at);
CREATE INDEX IF NOT EXISTS compliance_cases_assignee_idx
  ON compliance_cases(assigned_to, status);

CREATE TABLE IF NOT EXISTS compliance_alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key            TEXT NOT NULL UNIQUE,
  subject_id            UUID NOT NULL REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  transaction_id        UUID REFERENCES compliance_transactions(id) ON DELETE RESTRICT,
  screening_id          UUID REFERENCES compliance_screenings(id) ON DELETE RESTRICT,
  case_id               UUID REFERENCES compliance_cases(id) ON DELETE RESTRICT,
  rule_code             TEXT NOT NULL,
  rule_version          INTEGER NOT NULL,
  severity              TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  score                 NUMERIC(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  evidence              JSONB NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'suppressed')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS compliance_alerts_queue_idx
  ON compliance_alerts(status, severity, created_at);

CREATE TABLE IF NOT EXISTS compliance_case_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id               UUID NOT NULL REFERENCES compliance_cases(id) ON DELETE RESTRICT,
  actor_address         TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  from_status           TEXT,
  to_status             TEXT,
  reason_code           TEXT NOT NULL,
  note                  TEXT,
  evidence              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_case_events_case_idx
  ON compliance_case_events(case_id, created_at);

CREATE TABLE IF NOT EXISTS compliance_risk_assessments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id            UUID NOT NULL REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  transaction_id        UUID REFERENCES compliance_transactions(id) ON DELETE RESTRICT,
  score                 NUMERIC(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  band                  TEXT NOT NULL CHECK (band IN ('low', 'medium', 'high', 'critical')),
  components            JSONB NOT NULL,
  reasons               JSONB NOT NULL,
  model_version         TEXT NOT NULL,
  policy_version        INTEGER NOT NULL,
  evidence_hash         TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_risk_subject_idx
  ON compliance_risk_assessments(subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS travel_rule_exchanges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL UNIQUE REFERENCES compliance_transactions(id) ON DELETE RESTRICT,
  required              BOOLEAN NOT NULL,
  threshold_amount      NUMERIC(30,7),
  protocol_name         TEXT,
  protocol_reference    TEXT,
  counterparty_type     TEXT NOT NULL CHECK (counterparty_type IN ('institution', 'self_hosted', 'unknown')),
  status                TEXT NOT NULL
                          CHECK (status IN ('not_required', 'pending', 'sent', 'acknowledged', 'failed', 'self_hosted_verified', 'rejected')),
  payload_envelope      JSONB,
  payload_key_id        TEXT,
  self_hosted_evidence  JSONB,
  receipt_hash          TEXT,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at       TIMESTAMPTZ,
  last_error_code       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS travel_rule_retry_idx
  ON travel_rule_exchanges(next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS compliance_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id               UUID NOT NULL REFERENCES compliance_cases(id) ON DELETE RESTRICT,
  report_type           TEXT NOT NULL,
  jurisdiction          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'filed', 'rejected')),
  report_envelope       JSONB NOT NULL,
  report_key_id         TEXT NOT NULL,
  renderer_version      TEXT NOT NULL,
  content_hash          TEXT NOT NULL,
  filing_reference      TEXT,
  prepared_by           TEXT NOT NULL,
  approved_by           TEXT,
  filed_at              TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_audit_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_sequence        BIGSERIAL NOT NULL UNIQUE,
  subject_id            UUID REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  actor_type            TEXT NOT NULL CHECK (actor_type IN ('subject', 'analyst', 'system', 'provider')),
  actor_id               TEXT NOT NULL,
  action                TEXT NOT NULL,
  object_type           TEXT NOT NULL,
  object_id             TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  policy_jurisdiction   TEXT,
  policy_version        INTEGER,
  reason_code           TEXT NOT NULL,
  decision              TEXT,
  evidence_hash         TEXT NOT NULL,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash         TEXT,
  event_hash            TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_audit_subject_idx
  ON compliance_audit_events(subject_id, chain_sequence);
CREATE INDEX IF NOT EXISTS compliance_audit_correlation_idx
  ON compliance_audit_events(correlation_id, created_at);

CREATE TABLE IF NOT EXISTS compliance_deletion_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id            UUID NOT NULL REFERENCES compliance_subjects(id) ON DELETE RESTRICT,
  requested_by          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested', 'retained', 'provider_pending', 'deleting', 'completed', 'rejected')),
  retention_reason      TEXT,
  provider_request_ref  TEXT,
  tombstone_hash        TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_deletion_status_idx
  ON compliance_deletion_requests(status, requested_at);

-- Observe-only fallback policy. It is deliberately non-enforcing until an
-- admin publishes a reviewed jurisdiction-specific bundle.
INSERT INTO jurisdiction_rule_sets (
  jurisdiction, version, schema_version, status, effective_from, rules,
  checksum, authored_by, reviewed_by, published_at
)
VALUES (
  'DEFAULT',
  1,
  1,
  'published',
  '1970-01-01T00:00:00Z',
  '{
    "mode":"observe",
    "prohibitedTerritories":[],
    "tierLimits":{"0":"0","1":"1000","2":"10000","3":"100000"},
    "screeningCadenceDays":1,
    "verificationValidityDays":365,
    "retentionDays":1825,
    "travelRule":{"threshold":"1000","requiredFields":["fullName","account","country"]},
    "monitoring":{"structuring":{"windowHours":24,"singleThreshold":"1000","aggregateThreshold":"3000","minimumCount":3},"velocity":{"windowMinutes":60,"maxCount":10,"maxAmount":"10000"},"counterparty":{"windowDays":30,"newCounterpartyAmount":"5000","fanOutCount":10}},
    "riskWeights":{"identity":0.25,"screening":0.30,"behaviour":0.20,"onchain":0.20,"geography":0.05},
    "riskThresholds":{"medium":35,"high":60,"critical":80},
    "geo":{"minimumConfidence":0.8,"conflictAction":"review"},
    "reports":["SAR_JSON"]
  }'::jsonb,
  '4de6eb9e79efedcc74ad2125d6aa9431733b18d61e30ddda347f1a08f4b5be8a',
  'migration',
  'migration',
  NOW()
)
ON CONFLICT (jurisdiction, version) DO NOTHING;
