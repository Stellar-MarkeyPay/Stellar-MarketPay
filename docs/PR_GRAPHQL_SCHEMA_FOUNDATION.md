# PR: GraphQL domain schema and compatibility registry

## Summary

This is the first independently mergeable slice of #318. It establishes a
domain-modelled GraphQL contract without mounting an endpoint or changing any
REST route.

## What was fixed

- Added SDL for jobs, applications, profiles, escrows, disputes, ratings,
  mutations and future subscriptions, linked through domain edges rather than
  REST-shaped root operations.
- Standardised entity collections on opaque Relay-style connections with
  bounded `first`, `PageInfo` and exact `totalCount` semantics.
- Added typed lookup results and mutation error values for expected failures.
- Added lossless `Decimal`, strict `DateTime`, `PublicKey`, `Cursor` and `JSON`
  scalar implementations, plus typed opaque global IDs.
- Declared field-level `@auth`, `@cost` and `@cacheControl` policy metadata in
  the contract for the safety and caching slices to enforce before exposure.
- Added a committed canonical schema snapshot and CI compatibility check that
  rejects breaking changes against the PR base.
- Documented the architecture, migration sequence, deprecation policy and the
  boundary between GraphQL and REST.

## Scope boundary

The gateway is not mounted in this PR. Resolvers/DataLoader, safety controls,
subscriptions/caching and frontend adoption remain separate follow-up PRs, as
required by the issue's migration plan. Existing REST behaviour is unchanged.

## Validation

- `pnpm --filter backend run graphql:schema:check`
- `pnpm --filter backend run graphql:schema:breaking -- --base upstream/main`
- `npx jest src/graphql --runInBand --coverage=false`
- `pnpm lint`
- `pnpm build`
- root `pnpm format:check`
- root `pnpm policy:test`
- root `pnpm policy:integrity`
- full backend test suite with PostgreSQL 16 and Redis 7

## Issue

Part of #318.
