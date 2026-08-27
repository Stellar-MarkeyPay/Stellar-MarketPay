-- ============================================================
-- GOLD LAYER
-- Business-ready marketplace analytics
-- ============================================================

DROP TABLE IF EXISTS gold_application_funnel;
DROP TABLE IF EXISTS gold_marketplace_revenue;
DROP TABLE IF EXISTS gold_freelancer_performance;
DROP TABLE IF EXISTS gold_job_performance;


-- ============================================================
-- 1. JOB PERFORMANCE
-- ============================================================

CREATE TABLE gold_job_performance AS
SELECT
    j.job_id,
    j.title,
    j.category,
    j.skills,
    j.status,
    j.budget,
    j.currency,
    j.client_address,
    j.freelancer_address,
    j.created_at,
    j.deadline,

    COUNT(DISTINCT a.application_id) AS total_applications,

    COUNT(DISTINCT CASE
        WHEN a.status = 'accepted'
        THEN a.application_id
    END) AS accepted_applications,

    COUNT(DISTINCT CASE
        WHEN a.status = 'pending'
        THEN a.application_id
    END) AS pending_applications,

    COUNT(DISTINCT CASE
        WHEN a.status = 'withdrawn'
        THEN a.application_id
    END) AS withdrawn_applications,

    COALESCE(AVG(a.bid_amount), 0)::numeric(20,7)
        AS average_bid_amount,

    COALESCE(MIN(a.bid_amount), 0)::numeric(20,7)
        AS minimum_bid_amount,

    COALESCE(MAX(a.bid_amount), 0)::numeric(20,7)
        AS maximum_bid_amount,

    COALESCE(e.amount_xlm, 0)::numeric(20,7)
        AS escrow_amount

FROM silver_jobs j

LEFT JOIN silver_applications a
    ON j.job_id = a.job_id

LEFT JOIN silver_escrows e
    ON j.job_id = e.job_id

GROUP BY
    j.job_id,
    j.title,
    j.category,
    j.skills,
    j.status,
    j.budget,
    j.currency,
    j.client_address,
    j.freelancer_address,
    j.created_at,
    j.deadline,
    e.amount_xlm;


-- ============================================================
-- 2. FREELANCER PERFORMANCE
-- ============================================================

CREATE TABLE gold_freelancer_performance AS
SELECT
    p.public_key AS freelancer_address,
    p.display_name,
    p.role,

    p.completed_jobs,
    p.total_earned_xlm,
    p.rating,
    p.reputation_points,

    COUNT(DISTINCT a.application_id)
        AS total_applications,

    COUNT(DISTINCT CASE
        WHEN a.status = 'accepted'
        THEN a.application_id
    END) AS accepted_applications,

    COUNT(DISTINCT CASE
        WHEN a.status = 'pending'
        THEN a.application_id
    END) AS pending_applications,

    COALESCE(AVG(a.bid_amount), 0)::numeric(20,7)
        AS average_bid_amount,

    COALESCE(SUM(
        CASE
            WHEN a.status = 'accepted'
            THEN a.bid_amount
            ELSE 0
        END
    ), 0)::numeric(20,7) AS accepted_bid_value

FROM silver_profiles p

LEFT JOIN silver_applications a
    ON p.public_key = a.freelancer_address

GROUP BY
    p.public_key,
    p.display_name,
    p.role,
    p.completed_jobs,
    p.total_earned_xlm,
    p.rating,
    p.reputation_points;


-- ============================================================
-- 3. MARKETPLACE REVENUE / ESCROW
-- ============================================================

CREATE TABLE gold_marketplace_revenue AS
SELECT
    e.status AS escrow_status,

    COUNT(*) AS escrow_count,

    SUM(e.amount_xlm)::numeric(20,7)
        AS total_escrow_value,

    AVG(e.amount_xlm)::numeric(20,7)
        AS average_escrow_value,

    SUM(
        CASE
            WHEN e.status = 'released'
            THEN e.amount_xlm
            ELSE 0
        END
    )::numeric(20,7) AS released_value,

    SUM(
        CASE
            WHEN e.status IN ('refunded', 'timeout_refunded')
            THEN e.amount_xlm
            ELSE 0
        END
    )::numeric(20,7) AS refunded_value

FROM silver_escrows e

GROUP BY e.status;


-- ============================================================
-- 4. APPLICATION FUNNEL
-- ============================================================

CREATE TABLE gold_application_funnel AS
SELECT
    status,

    COUNT(*) AS application_count,

    COUNT(DISTINCT job_id)
        AS jobs_with_applications,

    COUNT(DISTINCT freelancer_address)
        AS unique_applicants,

    AVG(bid_amount)::numeric(20,7)
        AS average_bid_amount,

    MIN(created_at)
        AS first_application_at,

    MAX(created_at)
        AS latest_application_at

FROM silver_applications

GROUP BY status;