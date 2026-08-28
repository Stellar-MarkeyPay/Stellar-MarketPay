# Analytics Metric Definitions

## Purpose

This document is the canonical definition of marketplace analytics metrics.
All dashboards, API endpoints, SQL views and reports must use these definitions.

## Data Source

Analytical metrics are calculated from the PostgreSQL warehouse
`marketplace_warehouse`, primarily from the `analytics` schema.

The transactional PostgreSQL database is the operational source and must
not be queried directly by analytical services.

---

## Marketplace Health

### Total Jobs

**Definition:** Number of rows in `analytics.fact_job`.

```sql
COUNT(*)