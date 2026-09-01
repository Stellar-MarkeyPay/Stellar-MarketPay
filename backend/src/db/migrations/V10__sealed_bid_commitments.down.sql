-- rollback: destructive. This removes sealed-bid values and timing data.
ALTER TABLE applications
  DROP COLUMN IF EXISTS revealed_at,
  DROP COLUMN IF EXISTS revealed_bid_amount,
  DROP COLUMN IF EXISTS bid_revealed,
  DROP COLUMN IF EXISTS bid_nonce,
  DROP COLUMN IF EXISTS bid_commitment;

ALTER TABLE jobs
  DROP COLUMN IF EXISTS bidding_closed_at;
