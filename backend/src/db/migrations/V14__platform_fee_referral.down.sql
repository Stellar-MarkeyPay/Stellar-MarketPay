-- V14 rollback: drop platform fee payout table and escrow referrer column

DROP TABLE IF EXISTS platform_fee_payouts;

ALTER TABLE escrows
  DROP COLUMN IF EXISTS referrer_address;
