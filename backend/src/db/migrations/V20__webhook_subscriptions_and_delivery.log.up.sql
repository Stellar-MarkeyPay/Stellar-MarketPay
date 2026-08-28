-- V20: Webhook subscriptions and delivery log
-- ─────────────────────────────────────────
-- webhook_subscriptions — managed per-subscription event delivery configuration
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id       UUID        NOT NULL,              -- references profiles(id) or external integrator
  subscriber_type     TEXT        NOT NULL DEFAULT 'profile', -- 'profile' | 'external'
  name                TEXT        NOT NULL,
  description         TEXT,
  url                 TEXT        NOT NULL,
  secret              TEXT        NOT NULL,              -- per-subscription HMAC secret
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  is_disabled         BOOLEAN     NOT NULL DEFAULT false,
  selected_event_types JSONB      NOT NULL DEFAULT '[]'::jsonb, -- array of event types to receive
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT webhook_subscriptions_is_active_check CHECK (is_active IN (true, false)),
  CONSTRAINT webhook_subscriptions_is_disabled_check CHECK (is_disabled IN (true, false)),
  CONSTRAINT webhook_subscriptions_secret_not_empty CHECK (char_length(secret) > 0)
);

CREATE INDEX IF NOT EXISTS webhook_subscriptions_subscriber_idx ON webhook_subscriptions(subscriber_id, subscriber_type);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_active_idx ON webhook_subscriptions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS webhook_subscriptions_disabled_idx ON webhook_subscriptions(is_disabled) WHERE is_disabled = true;
CREATE INDEX IF NOT EXISTS webhook_subscriptions_events_idx ON webhook_subscriptions using gist (selected_event_types);

-- ─────────────────────────────────────────
-- webhook_delivery_log — per-delivery audit trail
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id     UUID        NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_id            UUID        NOT NULL,              -- the original event ID that triggered this delivery
  event_type          TEXT        NOT NULL,              -- e.g. "escrow_created"
  payload_hash        TEXT        NOT NULL,              -- SHA-256 hash of the raw payload for dedup
  delivered_at        TIMESTAMPTZ,
  status              TEXT        NOT NULL DEFAULT 'pending', -- 'sent', 'failed', 'retried', 'disabled'
  http_status_code    INTEGER,                            -- response status from recipient
  response_time_ms    INTEGER,                            -- round-trip time
  error_message       TEXT,
  retry_count         INTEGER     NOT NULL DEFAULT 0,
  max_retries         INTEGER     NOT NULL DEFAULT 5,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT webhook_delivery_log_status_check CHECK (status IN ('pending', 'sent', 'failed', 'retried', 'disabled')),
  CONSTRAINT webhook_delivery_log_retry_count_nn CHECK (retry_count >= 0),
  CONSTRAINT webhook_delivery_log_max_retries_nn CHECK (max_retries > 0)
);

CREATE INDEX IF NOT EXISTS webhook_delivery_log_subscription_idx ON webhook_delivery_log(subscription_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_log_event_idx ON webhook_delivery_log(event_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_log_status_idx ON webhook_delivery_log(status);
CREATE INDEX IF NOT EXISTS webhook_delivery_log_created_idx ON webhook_delivery_log(created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_delivery_log_retry_idx ON webhook_delivery_log(retry_count, status);

-- ─────────────────────────────────────────
-- Update jobs table to track webhook-triggered events
-- ─────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_webhook_notified_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS webhook_notification_count INTEGER NOT NULL DEFAULT 0;

-- Add comment
COMMENT ON TABLE webhook_subscriptions IS 'Managed per-subscription webhook delivery configuration';
COMMENT ON TABLE webhook_delivery_log IS 'Per-delivery audit trail with retry tracking and dedup hash';