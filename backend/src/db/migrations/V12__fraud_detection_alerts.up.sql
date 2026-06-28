-- Fraud detection alerts for real-time bid anomaly analysis

CREATE TABLE IF NOT EXISTS fraud_alerts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  application_id     UUID        REFERENCES applications(id) ON DELETE SET NULL,
  freelancer_address TEXT        NOT NULL REFERENCES profiles(public_key),
  bid_amount         NUMERIC(20,7) NOT NULL,
  currency           TEXT        NOT NULL DEFAULT 'XLM',
  rule_code          TEXT        NOT NULL,
  severity           TEXT        NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  reason             TEXT        NOT NULL,
  risk_score         NUMERIC(6,2) NOT NULL DEFAULT 0,
  context            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_ip_hash     TEXT,
  user_agent         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fraud_alerts_job_created_idx
  ON fraud_alerts(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fraud_alerts_freelancer_created_idx
  ON fraud_alerts(freelancer_address, created_at DESC);

CREATE INDEX IF NOT EXISTS fraud_alerts_rule_created_idx
  ON fraud_alerts(rule_code, created_at DESC);
