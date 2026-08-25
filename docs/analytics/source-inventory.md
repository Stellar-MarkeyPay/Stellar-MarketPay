# Analytics Source Inventory

| Source Table | Exists in Schema | Primary Key | Incremental Field | Analytics Purpose |
|---|---|---|---|---|
| profiles | Yes | public_key | updated_at | User dimension |
| jobs | Yes | id | updated_at | Job fact |
| applications | Yes | id | created_at | Application fact |
| escrows | Yes | id | updated_at | Escrow fact |
| job_views | Yes | id | viewed_at | Job engagement/funnel |
| dispute_evidence | Yes | id | created_at | Supporting dispute evidence |
| disputes | No | — | — | Do not use until source is confirmed |
| escrow_releases | No | — | — | Do not use until source is confirmed |
| contract_audit_log | No | — | — | Do not use until source is confirmed |
| payment_records | No | — | — | Do not use until source is confirmed |

## Confirmed Source Relationships

profiles.public_key
    ↓
jobs.client_address / jobs.freelancer_address

jobs.id
    ↓
applications.job_id

jobs.id
    ↓
escrows.job_id

jobs.id
    ↓
job_views.job_id

jobs.id
    ↓
dispute_evidence.job_id

## Incremental Loading Notes

- profiles, jobs and escrows have updated_at and can support change-based extraction.
- applications does not have updated_at, so its incremental strategy requires special handling.
- job_views uses viewed_at and is naturally event-oriented.
- dispute_evidence uses created_at and is append-oriented.

## Unresolved Sources

The application references several tables that are not present in the executable schema:

- disputes
- escrow_releases
- contract_audit_log
- payment_records

These must be resolved before they are used as warehouse sources.