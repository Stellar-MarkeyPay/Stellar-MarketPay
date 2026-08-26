-- Analytics Warehouse Schema
-- Issue #268
-- Purpose: analytical workloads must be isolated from the production
-- transactional database.
--
-- This DDL intentionally excludes fact_payment and fact_application_event.
-- Their physical source contracts are not yet confirmed.

CREATE SCHEMA IF NOT EXISTS analytics;

-- ============================================================
-- Dimensions
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics.dim_date (
    date_key        INTEGER PRIMARY KEY,
    full_date       DATE NOT NULL UNIQUE,
    year            INTEGER NOT NULL,
    quarter         INTEGER NOT NULL,
    month           INTEGER NOT NULL,
    month_name      TEXT NOT NULL,
    week_of_year    INTEGER NOT NULL,
    day_of_month    INTEGER NOT NULL,
    day_of_week     INTEGER NOT NULL,
    is_weekend      BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics.dim_user (
    user_key          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_key        TEXT NOT NULL,
    role              TEXT,
    rating            NUMERIC(3,2),
    source_created_at TIMESTAMPTZ,
    effective_from    TIMESTAMPTZ NOT NULL,
    effective_to      TIMESTAMPTZ,
    is_current        BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_dim_user_version
        UNIQUE (public_key, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dim_user_current
    ON analytics.dim_user (public_key)
    WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS analytics.dim_category (
    category_key  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS analytics.dim_status (
    status_key        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type       TEXT NOT NULL,
    status_code       TEXT NOT NULL,
    status_description TEXT,

    CONSTRAINT uq_dim_status
        UNIQUE (entity_type, status_code)
);

-- ============================================================
-- Facts
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics.fact_job (
    job_key             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id              UUID NOT NULL UNIQUE,
    client_key          BIGINT,
    freelancer_key      BIGINT,
    category_key        BIGINT,
    status_key          BIGINT,
    created_date_key    INTEGER NOT NULL,
    hired_date_key      INTEGER,
    budget_amount       NUMERIC(20,7),
    applicant_count     INTEGER,
    view_count          INTEGER,
    time_to_hire_hours  NUMERIC,
    source_created_at   TIMESTAMPTZ NOT NULL,
    source_updated_at   TIMESTAMPTZ,
    warehouse_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_fact_job_client
        FOREIGN KEY (client_key) REFERENCES analytics.dim_user(user_key),

    CONSTRAINT fk_fact_job_freelancer
        FOREIGN KEY (freelancer_key) REFERENCES analytics.dim_user(user_key),

    CONSTRAINT fk_fact_job_category
        FOREIGN KEY (category_key) REFERENCES analytics.dim_category(category_key),

    CONSTRAINT fk_fact_job_status
        FOREIGN KEY (status_key) REFERENCES analytics.dim_status(status_key),

    CONSTRAINT fk_fact_job_created_date
        FOREIGN KEY (created_date_key) REFERENCES analytics.dim_date(date_key),

    CONSTRAINT fk_fact_job_hired_date
        FOREIGN KEY (hired_date_key) REFERENCES analytics.dim_date(date_key)
);

CREATE INDEX IF NOT EXISTS ix_fact_job_client_key
    ON analytics.fact_job(client_key);

CREATE INDEX IF NOT EXISTS ix_fact_job_freelancer_key
    ON analytics.fact_job(freelancer_key);

CREATE INDEX IF NOT EXISTS ix_fact_job_category_key
    ON analytics.fact_job(category_key);

CREATE INDEX IF NOT EXISTS ix_fact_job_status_key
    ON analytics.fact_job(status_key);

CREATE INDEX IF NOT EXISTS ix_fact_job_created_date_key
    ON analytics.fact_job(created_date_key);

CREATE TABLE IF NOT EXISTS analytics.fact_application (
    application_key     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id      UUID NOT NULL UNIQUE,
    job_key             BIGINT NOT NULL,
    freelancer_key      BIGINT,
    created_date_key    INTEGER NOT NULL,
    accepted_date_key   INTEGER,
    status_key          BIGINT,
    bid_amount          NUMERIC(20,7),
    created_at          TIMESTAMPTZ NOT NULL,
    accepted_at        TIMESTAMPTZ,
    warehouse_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_fact_application_job
        FOREIGN KEY (job_key) REFERENCES analytics.fact_job(job_key),

    CONSTRAINT fk_fact_application_freelancer
        FOREIGN KEY (freelancer_key) REFERENCES analytics.dim_user(user_key),

    CONSTRAINT fk_fact_application_created_date
        FOREIGN KEY (created_date_key) REFERENCES analytics.dim_date(date_key),

    CONSTRAINT fk_fact_application_accepted_date
        FOREIGN KEY (accepted_date_key) REFERENCES analytics.dim_date(date_key),

    CONSTRAINT fk_fact_application_status
        FOREIGN KEY (status_key) REFERENCES analytics.dim_status(status_key)
);

CREATE INDEX IF NOT EXISTS ix_fact_application_job_key
    ON analytics.fact_application(job_key);

CREATE INDEX IF NOT EXISTS ix_fact_application_freelancer_key
    ON analytics.fact_application(freelancer_key);

CREATE INDEX IF NOT EXISTS ix_fact_application_created_date_key
    ON analytics.fact_application(created_date_key);

CREATE INDEX IF NOT EXISTS ix_fact_application_status_key
    ON analytics.fact_application(status_key);

CREATE TABLE IF NOT EXISTS analytics.fact_job_view (
    job_view_key       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_view_id        UUID NOT NULL UNIQUE,
    job_key            BIGINT NOT NULL,
    viewed_date_key    INTEGER NOT NULL,
    ip_hash            TEXT NOT NULL,
    viewed_at          TIMESTAMPTZ NOT NULL,
    warehouse_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_fact_job_view_job
        FOREIGN KEY (job_key) REFERENCES analytics.fact_job(job_key),

    CONSTRAINT fk_fact_job_view_date
        FOREIGN KEY (viewed_date_key) REFERENCES analytics.dim_date(date_key)
);

CREATE INDEX IF NOT EXISTS ix_fact_job_view_job_key
    ON analytics.fact_job_view(job_key);

CREATE INDEX IF NOT EXISTS ix_fact_job_view_date_key
    ON analytics.fact_job_view(viewed_date_key);

CREATE TABLE IF NOT EXISTS analytics.fact_dispute (
    dispute_key        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_key            BIGINT NOT NULL,
    disputed_by_key    BIGINT,
    disputed_date_key  INTEGER NOT NULL,
    dispute_status_key BIGINT,
    dispute_reason     TEXT,
    dispute_description TEXT,
    disputed_at        TIMESTAMPTZ NOT NULL,
    warehouse_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_fact_dispute_job
        FOREIGN KEY (job_key) REFERENCES analytics.fact_job(job_key),

    CONSTRAINT fk_fact_dispute_user
        FOREIGN KEY (disputed_by_key) REFERENCES analytics.dim_user(user_key),

    CONSTRAINT fk_fact_dispute_date
        FOREIGN KEY (disputed_date_key) REFERENCES analytics.dim_date(date_key),

    CONSTRAINT fk_fact_dispute_status
        FOREIGN KEY (dispute_status_key) REFERENCES analytics.dim_status(status_key),

    CONSTRAINT uq_fact_dispute_job
        UNIQUE (job_key)
);

CREATE INDEX IF NOT EXISTS ix_fact_dispute_date_key
    ON analytics.fact_dispute(disputed_date_key);

CREATE TABLE IF NOT EXISTS analytics.fact_escrow (
    escrow_key         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    escrow_id          UUID NOT NULL UNIQUE,
    job_key            BIGINT NOT NULL,
    client_key         BIGINT,
    freelancer_key     BIGINT,
    created_date_key   INTEGER NOT NULL,
    released_date_key  INTEGER,
    status_key         BIGINT,
    amount_xlm         NUMERIC(20,7) NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL,
    released_at        TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ,
    warehouse_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_fact_escrow_job
        FOREIGN KEY (job_key) REFERENCES analytics.fact_job(job_key),

    CONSTRAINT fk_fact_escrow_client
        FOREIGN KEY (client_key) REFERENCES analytics.dim_user(user_key),

    CONSTRAINT fk_fact_escrow_freelancer
        FOREIGN KEY (freelancer_key) REFERENCES analytics.dim_user(user_key),

    CONSTRAINT fk_fact_escrow_created_date
        FOREIGN KEY (created_date_key) REFERENCES analytics.dim_date(date_key),

    CONSTRAINT fk_fact_escrow_released_date
        FOREIGN KEY (released_date_key) REFERENCES analytics.dim_date(date_key),

    CONSTRAINT fk_fact_escrow_status
        FOREIGN KEY (status_key) REFERENCES analytics.dim_status(status_key)
);

CREATE INDEX IF NOT EXISTS ix_fact_escrow_job_key
    ON analytics.fact_escrow(job_key);

CREATE INDEX IF NOT EXISTS ix_fact_escrow_status_key
    ON analytics.fact_escrow(status_key);

CREATE INDEX IF NOT EXISTS ix_fact_escrow_created_date_key
    ON analytics.fact_escrow(created_date_key);

-- ============================================================
-- Historical snapshot
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics.snapshot_job_daily (
    snapshot_date   DATE NOT NULL,
    job_id          UUID NOT NULL,
    status          TEXT,
    applicant_count INTEGER,
    view_count      INTEGER,
    budget          NUMERIC(20,7),
    escrow_status   TEXT,
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (snapshot_date, job_id)
);

CREATE INDEX IF NOT EXISTS ix_snapshot_job_daily_job_id
    ON analytics.snapshot_job_daily(job_id);
