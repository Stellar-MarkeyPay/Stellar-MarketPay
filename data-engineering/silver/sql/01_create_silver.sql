-- Silver layer for Stellar MarketPay
-- Purpose: clean, typed, analytics-ready representations of core source tables.

DROP TABLE IF EXISTS silver_notifications;
DROP TABLE IF EXISTS silver_escrows;
DROP TABLE IF EXISTS silver_applications;
DROP TABLE IF EXISTS silver_jobs;
DROP TABLE IF EXISTS silver_profiles;

CREATE TABLE silver_profiles AS
SELECT
    public_key,
    NULLIF(TRIM(display_name), '') AS display_name,
    NULLIF(TRIM(bio), '') AS bio,
    skills,
    role,
    COALESCE(completed_jobs, 0) AS completed_jobs,
    COALESCE(total_earned_xlm, 0)::numeric(20,7) AS total_earned_xlm,
    rating,
    COALESCE(reputation_points, 0) AS reputation_points,
    COALESCE(referral_count, 0) AS referral_count,
    COALESCE(is_kyc_verified, false) AS is_kyc_verified,
    created_at,
    updated_at,
    CURRENT_TIMESTAMP AS silver_loaded_at
FROM profiles
WHERE public_key IS NOT NULL;


CREATE TABLE silver_jobs AS
SELECT
    id AS job_id,
    NULLIF(TRIM(title), '') AS title,
    NULLIF(TRIM(description), '') AS description,
    budget::numeric(20,7) AS budget,
    currency,
    NULLIF(TRIM(category), '') AS category,
    skills,
    status,
    client_address,
    freelancer_address,
    deadline,
    timezone,
    applicant_count,
    view_count,
    share_count,
    visibility,
    created_at,
    updated_at,
    CURRENT_TIMESTAMP AS silver_loaded_at
FROM jobs
WHERE id IS NOT NULL
  AND client_address IS NOT NULL
  AND budget >= 0;


CREATE TABLE silver_applications AS
SELECT
    id AS application_id,
    job_id,
    freelancer_address,
    NULLIF(TRIM(proposal), '') AS proposal,
    bid_amount::numeric(20,7) AS bid_amount,
    status,
    accepted_at,
    created_at,
    referred_by,
    currency,
    screening_answers,
    withdrawn_at,
    CURRENT_TIMESTAMP AS silver_loaded_at
FROM applications
WHERE id IS NOT NULL
  AND job_id IS NOT NULL
  AND freelancer_address IS NOT NULL
  AND bid_amount >= 0;


CREATE TABLE silver_escrows AS
SELECT
    id AS escrow_id,
    job_id,
    contract_id,
    amount_xlm::numeric(20,7) AS amount_xlm,
    milestones,
    status,
    released_at,
    timeout_at,
    guardian_address,
    guardian_approved,
    guardian_approved_at,
    created_at,
    updated_at,
    CURRENT_TIMESTAMP AS silver_loaded_at
FROM escrows
WHERE id IS NOT NULL
  AND job_id IS NOT NULL
  AND amount_xlm >= 0;


CREATE TABLE silver_notifications AS
SELECT
    id AS notification_id,
    user_address,
    type AS notification_type,
    NULLIF(TRIM(title), '') AS title,
    NULLIF(TRIM(body), '') AS body,
    COALESCE(read, false) AS is_read,
    job_id,
    link_path,
    created_at,
    CURRENT_TIMESTAMP AS silver_loaded_at
FROM notifications
WHERE id IS NOT NULL
  AND user_address IS NOT NULL;