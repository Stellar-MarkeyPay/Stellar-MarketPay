-- rollback: destructive. This deletes profile email and digest-token values.

DROP INDEX IF EXISTS profiles_digest_unsubscribe_token_idx;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS last_login_at,
  DROP COLUMN IF EXISTS digest_unsubscribe_token;
