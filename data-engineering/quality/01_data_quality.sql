-- ============================================================
-- DATA QUALITY CHECKS
-- Stellar MarketPay
-- ============================================================

-- ============================================================
-- 1. ROW COUNT CHECKS
-- ============================================================

SELECT
    'silver_profiles' AS table_name,
    COUNT(*) AS row_count,
    CASE
        WHEN COUNT(*) > 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM silver_profiles

UNION ALL

SELECT
    'silver_jobs',
    COUNT(*),
    CASE
        WHEN COUNT(*) > 0 THEN 'PASS'
        ELSE 'FAIL'
    END
FROM silver_jobs

UNION ALL

SELECT
    'silver_applications',
    COUNT(*),
    CASE
        WHEN COUNT(*) > 0 THEN 'PASS'
        ELSE 'FAIL'
    END
FROM silver_applications

UNION ALL

SELECT
    'silver_escrows',
    COUNT(*),
    CASE
        WHEN COUNT(*) > 0 THEN 'PASS'
        ELSE 'FAIL'
    END
FROM silver_escrows;


-- ============================================================
-- 2. NULL CHECKS — CRITICAL BUSINESS COLUMNS
-- ============================================================

SELECT
    'jobs.job_id' AS check_name,
    COUNT(*) AS failed_rows,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM silver_jobs
WHERE job_id IS NULL

UNION ALL

SELECT
    'jobs.title',
    COUNT(*),
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END
FROM silver_jobs
WHERE title IS NULL

UNION ALL

SELECT
    'applications.job_id',
    COUNT(*),
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END
FROM silver_applications
WHERE job_id IS NULL

UNION ALL

SELECT
    'applications.freelancer_address',
    COUNT(*),
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END
FROM silver_applications
WHERE freelancer_address IS NULL;


-- ============================================================
-- 3. REFERENTIAL INTEGRITY
-- Applications must reference an existing job.
-- ============================================================

SELECT
    'orphan_applications' AS check_name,
    COUNT(*) AS failed_rows,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM silver_applications a
LEFT JOIN silver_jobs j
    ON a.job_id = j.job_id
WHERE j.job_id IS NULL;


-- ============================================================
-- 4. BUSINESS RULE — BID AMOUNT
-- ============================================================

SELECT
    'negative_bid_amounts' AS check_name,
    COUNT(*) AS failed_rows,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM silver_applications
WHERE bid_amount < 0;


-- ============================================================
-- 5. BUSINESS RULE — ESCROW AMOUNT
-- ============================================================

SELECT
    'negative_escrow_amounts' AS check_name,
    COUNT(*) AS failed_rows,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM silver_escrows
WHERE amount_xlm < 0;


-- ============================================================
-- 6. VALID APPLICATION STATUSES
-- ============================================================

SELECT
    'invalid_application_status' AS check_name,
    COUNT(*) AS failed_rows,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM silver_applications
WHERE status NOT IN (
    'pending',
    'accepted',
    'rejected',
    'withdrawn'
);


-- ============================================================
-- 7. VALID ESCROW STATUSES
-- ============================================================

SELECT
    'invalid_escrow_status' AS check_name,
    COUNT(*) AS failed_rows,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM silver_escrows
WHERE status NOT IN (
    'funded',
    'released',
    'refunded',
    'timeout_refunded'
);


-- ============================================================
-- 8. GOLD TABLE COMPLETENESS
-- ============================================================

SELECT
    'gold_job_performance' AS table_name,
    COUNT(*) AS row_count,
    CASE
        WHEN COUNT(*) = (SELECT COUNT(*) FROM silver_jobs)
        THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM gold_job_performance

UNION ALL

SELECT
    'gold_freelancer_performance',
    COUNT(*),
    CASE
        WHEN COUNT(*) = (SELECT COUNT(*) FROM silver_profiles)
        THEN 'PASS'
        ELSE 'FAIL'
    END
FROM gold_freelancer_performance;


-- ============================================================
-- 9. APPLICATION FUNNEL COMPLETENESS
-- ============================================================

SELECT
    'gold_application_funnel' AS table_name,
    COUNT(*) AS rows,
    CASE
        WHEN COUNT(*) > 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM gold_application_funnel;


-- ============================================================
-- 10. REVENUE / ESCROW COMPLETENESS
-- ============================================================

SELECT
    'gold_marketplace_revenue' AS table_name,
    COUNT(*) AS rows,
    CASE
        WHEN COUNT(*) > 0 THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM gold_marketplace_revenue;