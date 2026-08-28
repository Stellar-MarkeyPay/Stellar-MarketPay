# GraphQL gateway contributor guide

The GraphQL gateway is an additive API over MarketPay's existing services. The
REST API remains supported and unchanged. The contract is being delivered in
independently mergeable slices so `main` stays releasable throughout issue
[#318](https://github.com/Stellar-MarkeyPay/Stellar-MarketPay/issues/318).

## Current status

The schema-foundation slice defines and publishes the contract, but does **not**
mount a `/graphql` endpoint. Runtime resolvers, request-scoped batching and the
safety pipeline land next; the endpoint remains disabled until depth,
complexity, field-authorisation and persisted-query controls are present.

The design and migration plan are recorded in
[GRAPHQL_DESIGN_COMMENT.md](./GRAPHQL_DESIGN_COMMENT.md).

## Contract locations

- Authored SDL: `backend/src/graphql/schema/sdl/*.graphql`
- Custom scalar implementations: `backend/src/graphql/schema/scalars.js`
- Canonical registry snapshot: `backend/src/graphql/schema/schema.graphql`
- Registry and compatibility CLI: `backend/scripts/graphql-schema-registry.js`

Run these commands from `backend/`:

```bash
pnpm --filter backend run graphql:schema:write
pnpm --filter backend run graphql:schema:check
pnpm --filter backend run graphql:schema:breaking -- --base upstream/main
```

The first command regenerates the committed snapshot. The second fails when
the authored SDL and snapshot differ. The third uses GraphQL's compatibility
rules to fail on field/type removals, nullability tightening and other breaking
changes relative to a Git commit. CI runs both checks for every pull request.

## Schema conventions

1. **Model domain edges, not route names.** A screen starts at `Job` and
   traverses to `Application`, `Profile`, `Escrow`, `Dispute` and `Rating`.
2. **Use one pagination shape.** Entity collections expose Relay-style
   `edges`, opaque cursors, `pageInfo` and an exact `totalCount`. `first` is
   bounded to 100.
3. **Make expected failures data.** Lookups use result unions and mutations
   return `[MutationError!]!`. Malformed documents and unexpected service
   failures remain top-level GraphQL errors.
4. **Evolve additively.** Add optional fields and enum values deliberately.
   Deprecate before removal and include the replacement, deadline and migration
   note in the reason.
5. **Declare policy beside the field.** `@auth`, `@cost` and `@cacheControl`
   stay in SDL so their intent is visible in reviews and in the registry. Their
   runtime enforcement arrives before the endpoint is enabled.
6. **Use lossless money values.** `Decimal` is a string-backed scalar; do not
   expose monetary values as GraphQL `Float`.

## Deprecations

`Job.escrowContractId` is retained until **2027-02-01** for early clients that
used the REST-shaped field. New operations must traverse `Job.escrow.contractId`.

Removing a deprecated field is still a breaking change and therefore fails the
registry check until the baseline no longer contains it.

## When GraphQL is the right interface

Use the graph when a first-party screen needs several related domain objects in
one response or when request-scoped batching materially reduces N+1 work. The
job detail screen is the first planned consumer.

Keep REST for:

- file upload and download;
- webhook receivers;
- SEP-12, health and other externally specified endpoint shapes;
- third-party integrations already built against REST; and
- resources whose CDN identity must be a stable URL.

Resolvers must call the same services as REST routes. Business rules and SQL do
not belong in the GraphQL layer.
