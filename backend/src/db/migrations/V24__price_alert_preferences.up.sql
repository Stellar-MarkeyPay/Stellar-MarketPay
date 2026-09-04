-- V24: price_alert_preferences table for XLM price threshold notifications

CREATE TABLE IF NOT EXISTS price_alert_preferences (
  freelancer_address          TEXT PRIMARY KEY,
  min_xlm_price_usd           NUMERIC(20,7),
  max_xlm_price_usd           NUMERIC(20,7),
  email_notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  email                       TEXT,
  last_min_alert_at           TIMESTAMPTZ,
  last_max_alert_at           TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
