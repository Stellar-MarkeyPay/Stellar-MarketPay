# Database query timeouts

The shared PostgreSQL pool in `pool.js` sets server-side timeouts for every
connection:

- `POSTGRES_STATEMENT_TIMEOUT_MS`, default `5000`: normal API query budget.
- `POSTGRES_LOCK_TIMEOUT_MS`, default `1000`: normal lock wait budget.

Known long-running work must opt in instead of raising the API default:

- `POSTGRES_ANALYTICS_STATEMENT_TIMEOUT_MS`, default `30000`, used through
  `pool.analyticsQuery(...)`.
- `POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS`, default `120000`, applied inside
  each migration transaction.
- `POSTGRES_MIGRATION_LOCK_TIMEOUT_MS`, default `5000`, applied inside each
  migration transaction so DDL cannot wait on application locks indefinitely.

Queries are logged at `warn` when their observed duration reaches
`POSTGRES_NEAR_TIMEOUT_RATIO` of the active statement timeout, default `0.8`.
Alert on `alert=db_query_near_statement_timeout` to catch work approaching the
budget. Terminated statements emit `alert=db_query_statement_timeout`; lock wait
terminations emit `alert=db_query_lock_timeout`.
