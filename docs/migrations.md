# Database migration rollback policy

Every SQL migration under `backend/src/db/migrations` has an accompanying
`*.down.sql` file and is covered by the `up -> down -> up` verification job.
The migration ledger uses the migration filename as its identity because this
repository contains historical migrations with the same numeric version.

## Irreversible migrations

There are currently no deliberately irreversible migrations. A migration that
cannot be reversed must state the reason in this document and must be excluded
explicitly from the round-trip verifier before it can be merged.

## Destructive rollbacks

Rollbacks that drop a table or column are destructive: they remove the data
introduced by that migration. Each is marked with a
`-- rollback: destructive` comment at the beginning of its down migration.
Operators should take a backup before executing one outside a disposable
environment. Index-only and constraint-only rollbacks are non-destructive.

Run the same check locally against a scratch database:

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/marketpay_migrations npm --prefix backend run test:migrations
```
