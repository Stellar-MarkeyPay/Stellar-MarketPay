-- rollback: destructive. This deletes platform-fee payout and referrer data.

DROP TABLE IF EXISTS platform_fee_payouts;

ALTER TABLE escrows
  DROP COLUMN IF EXISTS referrer_address;
