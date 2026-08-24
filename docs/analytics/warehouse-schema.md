# Analytics Warehouse Schema

## Design Principles

- Use surrogate keys for warehouse dimensions.
- Preserve source system identifiers for traceability.
- Use conformed dimensions across fact tables.
- Define an explicit grain for every fact.
- Preserve historical state where source data is mutable.
- Store monetary values using fixed-precision numeric types.
- Keep analytical workloads separate from the transactional database.

---

# Dimensions

## dim_date

### Grain
One row per calendar date.

### Purpose
Provides a shared date dimension for all fact tables and enables consistent time-based analysis.

### Columns

| Column | Type | Description |
|---|---|---|
| date_key | INTEGER | Surrogate key in YYYYMMDD format |
| full_date | DATE | Calendar date |
| year | INTEGER | Calendar year |
| quarter | INTEGER | Calendar quarter |
| month | INTEGER | Month number |
| month_name | TEXT | Month name |
| week_of_year | INTEGER | ISO week number |
| day_of_month | INTEGER | Day of month |
| day_of_week | INTEGER | Day of week |
| is_weekend | BOOLEAN | Whether the date is Saturday/Sunday |

---

## dim_user

### Grain
One row per user version.

### Purpose
Stores user attributes used for marketplace analysis while preserving historical changes.

### Columns

| Column | Type | Description |
|---|---|---|
| user_key | BIGINT | Warehouse surrogate key |
| public_key | TEXT | Source user identifier |
| role | TEXT | User role |
| rating | NUMERIC(3,2) | User rating |
| completed_jobs | INTEGER | Completed jobs at this version |
| total_earned_xlm | NUMERIC(20,7) | Total earnings at this version |
| source_created_at | TIMESTAMPTZ | Source creation timestamp |
| effective_from | TIMESTAMPTZ | Start of dimension version |
| effective_to | TIMESTAMPTZ | End of dimension version |
| is_current | BOOLEAN | Whether this is the current version |

### Historical Strategy

SCD Type 2.

When tracked user attributes change, the existing record is expired and a new version is inserted.

---

## dim_category

### Grain
One row per marketplace job category.

### Purpose
Standardizes job categories for consistent reporting.

### Columns

| Column | Type | Description |
|---|---|---|
| category_key | BIGINT | Warehouse surrogate key |
| category_name | TEXT | Source category |
| effective_from | TIMESTAMPTZ | Version start |
| effective_to | TIMESTAMPTZ | Version end |
| is_current | BOOLEAN | Current version |

---

## dim_status

### Grain
One row per business entity/status combination.

### Purpose
Provides standardized status values for jobs, applications and escrows.

### Columns

| Column | Type | Description |
|---|---|---|
| status_key | BIGINT | Warehouse surrogate key |
| entity_type | TEXT | Entity owning the status |
| status_code | TEXT | Source status |
| status_description | TEXT | Human-readable definition |

---

# Fact Tables

## fact_job

### Grain
One row per marketplace job.

### Purpose
Stores measurable job-level marketplace activity.

### Columns

| Column | Type | Description |
|---|---|---|
| job_key | BIGINT | Warehouse surrogate key |
| job_id | UUID | Source job identifier |
| client_key | BIGINT | FK to dim_user |
| freelancer_key | BIGINT | FK to dim_user |
| category_key | BIGINT | FK to dim_category |
| status_key | BIGINT | FK to dim_status |
| created_date_key | INTEGER | FK to dim_date |
| hired_date_key | INTEGER | FK to dim_date |
| completed_date_key | INTEGER | FK to dim_date |
| budget_amount | NUMERIC(20,7) | Job budget |
| applicant_count | INTEGER | Applicants associated with job |
| view_count | INTEGER | Job views |
| time_to_hire_hours | NUMERIC | Calculated time to hire |
| duration_days | NUMERIC | Job duration |
| source_created_at | TIMESTAMPTZ | Source creation time |
| source_updated_at | TIMESTAMPTZ | Source update time |
| warehouse_loaded_at | TIMESTAMPTZ | Warehouse load timestamp |

---

## fact_application

### Grain
One row per application.

### Purpose
Stores application-level marketplace activity and conversion measures.

### Columns

| Column | Type | Description |
|---|---|---|
| application_key | BIGINT | Warehouse surrogate key |
| application_id | UUID | Source application identifier |
| job_key | BIGINT | FK to fact_job |
| freelancer_key | BIGINT | FK to dim_user |
| created_date_key | INTEGER | FK to dim_date |
| accepted_date_key | INTEGER | FK to dim_date |
| status_key | BIGINT | FK to dim_status |
| bid_amount | NUMERIC(20,7) | Application bid |
| currency | TEXT | Bid currency |
| created_at | TIMESTAMPTZ | Application creation time |
| accepted_at | TIMESTAMPTZ | Application acceptance time |
| withdrawn_at | TIMESTAMPTZ | Application withdrawal time |
| warehouse_loaded_at | TIMESTAMPTZ | Warehouse load timestamp |

---

## fact_application_event

### Grain
One row per application lifecycle event.

### Purpose
Preserves application state transitions for funnel and historical analysis.

### Columns

| Column | Type | Description |
|---|---|---|
| application_event_key | BIGINT | Surrogate key |
| application_id | UUID | Source application |
| job_id | UUID | Source job |
| freelancer_key | BIGINT | FK to dim_user |
| event_type | TEXT | Lifecycle event |
| event_timestamp | TIMESTAMPTZ | Event time |
| source_event_id | TEXT | Source event identifier when available |
| loaded_at | TIMESTAMPTZ | Warehouse load timestamp |

### Expected Events

- APPLICATION_SUBMITTED
- APPLICATION_ACCEPTED
- APPLICATION_REJECTED
- APPLICATION_WITHDRAWN

---

## fact_escrow

### Grain
One row per escrow.

### Purpose
Stores escrow funding, release and refund-related financial measures.

### Columns

| Column | Type | Description |
|---|---|---|
| escrow_key | BIGINT | Warehouse surrogate key |
| escrow_id | UUID | Source escrow identifier |
| job_key | BIGINT | FK to fact_job |
| client_key | BIGINT | FK to dim_user |
| freelancer_key | BIGINT | FK to dim_user |
| created_date_key | INTEGER | FK to dim_date |
| released_date_key | INTEGER | FK to dim_date |
| status_key | BIGINT | FK to dim_status |
| amount_xlm | NUMERIC(20,7) | Escrow amount |
| released_amount_xlm | NUMERIC(20,7) | Released amount when available |
| created_at | TIMESTAMPTZ | Escrow creation time |
| released_at | TIMESTAMPTZ | Escrow release time |
| updated_at | TIMESTAMPTZ | Source update time |
| warehouse_loaded_at | TIMESTAMPTZ | Warehouse load timestamp |

---

## fact_payment

### Grain
One row per payment transaction.

### Purpose
Stores marketplace payment activity for financial and marketplace-health reporting.

### Columns

| Column | Type | Description |
|---|---|---|
| payment_key | BIGINT | Warehouse surrogate key |
| payment_id | TEXT | Source payment identifier |
| job_key | BIGINT | FK to fact_job when applicable |
| payer_key | BIGINT | FK to dim_user |
| payee_key | BIGINT | FK to dim_user |
| payment_date_key | INTEGER | FK to dim_date |
| status_key | BIGINT | FK to dim_status |
| amount | NUMERIC(20,7) | Payment amount |
| currency | TEXT | Payment currency |
| fee_amount | NUMERIC(20,7) | Platform/payment fee |
| transaction_reference | TEXT | Blockchain/payment reference |
| payment_timestamp | TIMESTAMPTZ | Payment timestamp |
| warehouse_loaded_at | TIMESTAMPTZ | Warehouse load timestamp |

### Source Note

The exact transactional source for payments must be confirmed from the repository before implementation. The payment source should not be inferred or duplicated from escrow records without establishing the source of truth.

---

# Historical Snapshots

## snapshot_job_daily

### Grain
One row per job per calendar day.

### Purpose
Preserves daily marketplace state so historical trends survive changes to the current transactional record.

### Columns

| Column | Type | Description |
|---|---|---|
| snapshot_date | DATE | Snapshot date |
| job_id | UUID | Source job |
| status | TEXT | Job status at snapshot time |
| applicant_count | INTEGER | Applicant count |
| view_count | INTEGER | View count |
| budget | NUMERIC(20,7) | Job budget |
| escrow_status | TEXT | Escrow state when available |
| captured_at | TIMESTAMPTZ | Snapshot creation time |

### Primary Key

```text
(snapshot_date, job_id)