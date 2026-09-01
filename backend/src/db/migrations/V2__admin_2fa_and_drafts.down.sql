-- rollback: destructive. This deletes admin 2FA settings and saved drafts.
DROP TABLE IF EXISTS job_drafts;
DROP TABLE IF EXISTS admin_profiles;
