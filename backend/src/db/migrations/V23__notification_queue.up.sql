-- V23: notification_queue table for background email and webhook notification delivery

CREATE TABLE IF NOT EXISTS notification_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_address   TEXT NOT NULL,
  notification_type   TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  job_id              UUID,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'pending',
  retry_count         INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  last_attempt_at     TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_queue_status_retry_idx
  ON notification_queue (status, retry_count, created_at);

CREATE INDEX IF NOT EXISTS notification_queue_recipient_idx
  ON notification_queue (recipient_address);
