# Analytics Source-to-Target Mapping

## Profiles

### Source
- Table: profiles
- Primary Key: public_key
- Incremental Column: updated_at
- Important Columns:
  - public_key
  - role
  - created_at
  - updated_at
  - completed_jobs
  - total_earned_xlm
  - rating
  - last_login_at

### Target
- Dimension: dim_user
- Grain: One row per user version


---

## Jobs

### Source
- Table: jobs
- Primary Key: id
- Incremental Column: updated_at
- Important Columns:
  - id
  - client_address
  - freelancer_address
  - category
  - status
  - budget
  - currency
  - applicant_count
  - view_count
  - created_at
  - updated_at
  - deadline
  - disputed_at
  - expires_at
  - bidding_closed_at

### Target
- Fact: fact_job
- Grain: One row per job

---

## Applications

### Source
- Table: applications
- Primary Key: id
- Incremental Column: created_at
- Important Columns:
  - id
  - job_id
  - freelancer_address
  - bid_amount
  - currency
  - status
  - accepted_at
  - withdrawn_at
  - created_at
  - revealed_at

### Target
- Fact: fact_application
- Grain: One row per application

---

## Escrows

### Source
- Table: escrows
- Primary Key: id
- Incremental Column: updated_at
- Important Columns:
  - id
  - job_id
  - contract_id
  - amount_xlm
  - status
  - released_at
  - timeout_at
  - created_at
  - updated_at

### Target
- Fact: fact_escrow
- Grain: One row per escrow


---

## Payments

### Source
- Table: TBD
- Primary Key: TBD
- Incremental Column: TBD
- Important Columns:
  - TBD

### Target
- Fact: fact_payment
- Grain: One row per payment



## Repository Data Source Findings

The following source dependencies referenced by application code are not currently defined in the executable database schema:

- `escrow_releases`
- `contract_audit_log`
- `payment_records`
- `disputes`

These sources must not be treated as warehouse inputs until their actual persistence mechanism is confirmed.

Implemented sources currently confirmed include:

- `escrows`
- `jobs`
- `applications`
- `profiles`
- `dispute_evidence`

Dispute-related state is also stored on `jobs`.

### Implication

The warehouse design must be based on the actual transactional sources available in the repository rather than undocumented or missing tables.