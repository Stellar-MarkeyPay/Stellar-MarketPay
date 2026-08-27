-- Silver data-quality checks

-- 1. Duplicate profiles
SELECT
    public_key,
    COUNT(*) AS duplicate_count
FROM silver_profiles
GROUP BY public_key
HAVING COUNT(*) > 1;


-- 2. Invalid job budgets
SELECT
    job_id,
    budget
FROM silver_jobs
WHERE budget < 0
   OR budget IS NULL;


-- 3. Applications pointing to missing jobs
SELECT
    a.application_id,
    a.job_id
FROM silver_applications a
LEFT JOIN silver_jobs j
    ON a.job_id = j.job_id
WHERE j.job_id IS NULL;


-- 4. Applications pointing to missing freelancers
SELECT
    a.application_id,
    a.freelancer_address
FROM silver_applications a
LEFT JOIN silver_profiles p
    ON a.freelancer_address = p.public_key
WHERE p.public_key IS NULL;


-- 5. Escrows pointing to missing jobs
SELECT
    e.escrow_id,
    e.job_id
FROM silver_escrows e
LEFT JOIN silver_jobs j
    ON e.job_id = j.job_id
WHERE j.job_id IS NULL;


-- 6. Notification null user addresses
SELECT
    COUNT(*) AS invalid_notifications
FROM silver_notifications
WHERE user_address IS NULL;


-- 7. Row-count summary
SELECT 'profiles' AS table_name, COUNT(*) AS row_count
FROM silver_profiles
UNION ALL
SELECT 'jobs', COUNT(*)
FROM silver_jobs
UNION ALL
SELECT 'applications', COUNT(*)
FROM silver_applications
UNION ALL
SELECT 'escrows', COUNT(*)
FROM silver_escrows
UNION ALL
SELECT 'notifications', COUNT(*)
FROM silver_notifications;