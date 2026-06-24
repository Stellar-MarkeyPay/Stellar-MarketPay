-- V14: ISSUE-17 — On-chain platform fee split between admin and referrer
--
-- Adds an optional per-escrow referrer captured at job-posting time (from the
-- frontend's `?ref=` referral link) and an audit table mirroring the
-- contract's release_escrow() platform fee split: when an escrow has a
-- referrer, the 1% platform fee is routed to them on-chain; otherwise it
-- defaults to the protocol admin. This is independent of the multi-level
-- referral tree (referral_tree / multi_level_payouts), which only applies
-- once a freelancer has signed up via a referral link.

ALTER TABLE escrows
  ADD COLUMN IF NOT EXISTS referrer_address TEXT REFERENCES profiles(public_key);

CREATE TABLE IF NOT EXISTS platform_fee_payouts (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID  NOT NULL REFERENCES jobs(id),
  freelancer_address TEXT NOT NULL REFERENCES profiles(public_key),
  recipient_address  TEXT NOT NULL,
  recipient_type     TEXT NOT NULL CHECK (recipient_type IN ('referrer', 'admin')),
  amount_xlm        NUMERIC(20,7) NOT NULL,
  contract_tx_hash  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_fee_payouts_job_idx
  ON platform_fee_payouts(job_id);

CREATE INDEX IF NOT EXISTS platform_fee_payouts_recipient_idx
  ON platform_fee_payouts(recipient_address);
