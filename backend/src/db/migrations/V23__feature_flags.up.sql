-- Feature flags and experimentation platform (Issue #259).
--
-- Adds flag storage, targeting rules, overrides, audit log, experiments
-- and exposure tracking. All tables use idempotent IF NOT EXISTS.

-- ─── Flags ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feature_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE
                  CHECK (key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description   TEXT NOT NULL DEFAULT '',
  flag_type     TEXT NOT NULL DEFAULT 'boolean'
                  CHECK (flag_type IN ('boolean', 'multivariate', 'percentage')),
  default_value JSONB NOT NULL DEFAULT 'false',
  safe_value    JSONB NOT NULL DEFAULT 'false',
  enabled       BOOLEAN NOT NULL DEFAULT true,
  killed_at     TIMESTAMPTZ,
  killed_by     TEXT,
  created_by    TEXT NOT NULL REFERENCES profiles(public_key) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_evaluated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS feature_flags_enabled_idx ON feature_flags(enabled) WHERE enabled;
CREATE INDEX IF NOT EXISTS feature_flags_key_idx ON feature_flags(key);

-- ─── Targeting Rules ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flag_targeting_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id       UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  priority      INTEGER NOT NULL DEFAULT 100,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  conditions    JSONB NOT NULL DEFAULT '{}',
  allocations   JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flag_targeting_rules_flag_idx ON flag_targeting_rules(flag_id, priority);

-- ─── Overrides ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flag_overrides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id       UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  context_key   TEXT NOT NULL,
  value         JSONB NOT NULL,
  created_by    TEXT NOT NULL REFERENCES profiles(public_key) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flag_id, context_key)
);

CREATE INDEX IF NOT EXISTS flag_overrides_flag_idx ON flag_overrides(flag_id);
CREATE INDEX IF NOT EXISTS flag_overrides_context_idx ON flag_overrides(context_key);

-- ─── Audit Log ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flag_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id       UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 64),
  changes       JSONB NOT NULL DEFAULT '{}',
  actor_address TEXT NOT NULL,
  actor_email   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flag_audit_log_flag_idx ON flag_audit_log(flag_id, created_at DESC);
CREATE INDEX IF NOT EXISTS flag_audit_log_actor_idx ON flag_audit_log(actor_address, created_at DESC);

-- ─── Experiments ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flag_experiments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id              UUID NOT NULL UNIQUE REFERENCES feature_flags(id) ON DELETE CASCADE,
  hypothesis           TEXT NOT NULL DEFAULT '',
  primary_metric       TEXT NOT NULL DEFAULT 'conversion',
  min_sample_size      INTEGER NOT NULL DEFAULT 100,
  significance_level   NUMERIC(4,3) NOT NULL DEFAULT 0.05,
  status               TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'running', 'ended')),
  started_at           TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  winner_variant       TEXT,
  created_by           TEXT NOT NULL REFERENCES profiles(public_key) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flag_experiments_status_idx ON flag_experiments(status) WHERE status = 'running';

-- ─── Exposure Events ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flag_exposure_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id       UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  variant       TEXT NOT NULL,
  user_id       TEXT,
  context       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flag_exposure_events_flag_idx ON flag_exposure_events(flag_id, created_at DESC);
CREATE INDEX IF NOT EXISTS flag_exposure_events_flag_variant_idx ON flag_exposure_events(flag_id, variant);
