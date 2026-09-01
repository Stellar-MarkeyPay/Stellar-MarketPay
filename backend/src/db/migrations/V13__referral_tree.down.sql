-- rollback: destructive. This deletes referral-tree payouts and hierarchy data.

DROP VIEW IF EXISTS referral_tree_stats;
DROP TABLE IF EXISTS multi_level_payouts;
DROP TABLE IF EXISTS referral_tree;

ALTER TABLE referrals
  DROP COLUMN IF EXISTS depth,
  DROP COLUMN IF EXISTS parent_address;
