# GraphQL gateway — design comment

**Date:** August 28, 2026
**Scope:** a new `backend/src/graphql/` subsystem, additive over the existing 49 REST route modules
**Goal:** let a client state what a screen needs in one request, without rewriting the REST API and without turning a public endpoint into a denial-of-service vector.

---

## 1. The problem, measured

`frontend/pages/jobs/[id].tsx` renders the job detail screen. To fill it, the browser makes this sequence:

```text
GET /api/jobs/:id                       ── the job
GET /api/applications/job/:id           ── the applications          (parallel with the above)
GET /api/escrow/:jobId                  ── escrow state              (needs job.escrowContractId → serialised)
GET /api/disputes/:jobId                ── dispute, when disputed    (needs job.status      → serialised)
GET /api/profiles/:publicKey            ── ×N, one per applicant     (needs applications    → serialised)
GET /api/ratings/:publicKey             ── ×N, one per applicant     (needs applications    → serialised)
GET /api/proposal-templates             ── ApplicationForm mounts
```

Two properties make this worse than the request count suggests:

1. **It is a waterfall, not a fan-out.** The profile and rating calls cannot start until the applications response lands, and the escrow call cannot start until the job response lands. On a connection with 200 ms RTT the screen costs four sequential round trips minimum, regardless of bandwidth.
2. **The per-applicant calls are an N+1 in the browser.** A job with 12 applicants issues 24 requests that the client must fan out itself, each paying TLS and rate-limit overhead.

The exact baseline is measured by `backend/scripts/measure-roundtrips.js` against a running server and published in `docs/GRAPHQL_ROUNDTRIPS.md`, rather than asserted here.

A gateway addresses this because the _shape of the screen_ is known to the client and unknown to the server. Adding `/api/jobs/:id/full` would work for exactly one screen and would be wrong for the next one.

---

## 2. What this is not

Three things this deliberately does not do, because each is how a gateway becomes a liability:

- **It does not replace REST.** Every existing route keeps working, unchanged and untouched. Resolvers call the same service functions the routes call. If the gateway is deleted, nothing else breaks.
- **It does not mirror REST one-for-one.** A `Query.getJobById` / `Query.getApplicationsForJob` schema is the REST API with extra syntax and none of the benefit — the client still walks the same waterfall, just inside one request. The schema models the domain and its edges.
- **It does not become a second place where business logic lives.** A resolver's job is to translate graph coordinates into service calls and back. Any rule that a resolver enforces and a route does not is a rule that a REST client can bypass.

---

## 3. Schema design

### 3.1 Domain, not endpoints

The graph is edges between five entities, and traversal is the point:

```text
Job ──────┬── client:      Profile
          ├── freelancer:  Profile
          ├── applications: ApplicationConnection ── applicant: Profile ── ratings: RatingConnection
          ├── escrow:      Escrow ── milestones: [Milestone!]!
          └── dispute:     Dispute ── evidence: [Evidence!]!

Profile ──┬── ratings:     RatingConnection
          ├── jobsAsClient / jobsAsFreelancer: JobConnection
          └── stats:       ProfileStats
```

The job detail screen becomes one traversal from `Query.job(id:)`. So does every other screen that starts from a job.

### 3.2 Pagination

Every collection is a Relay-style connection: `edges { node cursor }`, `pageInfo { hasNextPage hasPreviousPage startCursor endCursor }`, `totalCount`. One convention, applied without exception, so a client that can page one collection can page all of them.

`jobService` already implements opaque cursor encoding (`encodeCursor` / `decodeCursor`); connections reuse it rather than inventing a second scheme. Collections whose service layer only offers offset paging get a cursor that encodes the offset — opaque to the client, so the service can be upgraded to keyset paging later without a schema change. That is the point of an opaque cursor and it is worth saying out loud: the convention buys the migration.

### 3.3 Errors in the schema

Expected failures are data, not exceptions. The top-level `errors` array stays for what it is for — bugs, timeouts, malformed queries — and everything a client should handle is a type:

```graphql
interface Error {
  message: String!
}
type NotFoundError implements Error {
  message: String!
  id: ID!
}
type ForbiddenError implements Error {
  message: String!
  requiredRole: String
}
type ValidationError implements Error {
  message: String!
  field: String
  code: String!
}

union JobResult = Job | NotFoundError

type ReleaseEscrowPayload {
  escrow: Escrow
  errors: [MutationError!]!
}
```

This matters more in a graph than in REST. A partial failure deep in a traversal produces a `null` and a top-level error whose `path` the client must correlate by hand; a union makes the failure a value at the position it belongs to, and makes it impossible to forget to handle.

**Nullability follows from this.** A field is non-null only when the server can always produce it. Making everything non-null is tempting and wrong: one failure then nulls out its whole ancestor chain up to the nearest nullable field, and a single unavailable rating can blank an entire screen.

### 3.4 Versioning

No `/v2`. Additive change and `@deprecated(reason:)` with a date and a migration note. The schema registry (§7) is what makes this safe rather than aspirational: a breaking change fails CI, so "additive only" is enforced rather than remembered.

---

## 4. Resolvers over existing services

Resolvers are thin. `Query.job` calls `jobService.getJob`. `Job.applications` calls `applicationService.getApplicationsForJob`. No SQL in the graph layer — if a resolver needs a query the service does not have, the query goes in the service, where the REST routes can use it too.

**DataLoader is not optional here.** The graph shape actively encourages N+1: `applications { applicant { ratings } }` calls the profile resolver once per application by construction. Every entity gets a batch loader keyed on its identifier, created **per request** — a process-lifetime loader would serve one user's data to another, which is a data-leak bug wearing a performance optimisation's clothes.

The loaders also carry the authorisation-relevant caching boundary: because they live on the request context alongside the viewer, a cached entity can never outlive the identity it was loaded for.

---

## 5. Safety

An unbounded public graph endpoint is a denial-of-service vector, and the attack needs no credentials.

- **Depth limit.** `job { applications { edges { node { applicant { jobsAsClient { … } } } } } }` recurses without bound. A depth ceiling is checked as a validation rule, before execution.
- **Complexity limit.** Depth alone does not stop `first: 10000` at three levels. Each field carries a cost; connection fields multiply their children by the requested page size; the total is checked before execution. Cost is declared in the schema via `@cost`, so it is reviewed alongside the field it describes.
- **Field-level authorisation.** A graph makes it far easier to expose a field through a path nobody considered. `Profile.email` is private, but `job.applications.edges.node.applicant.email` reaches it from a public job. Authorisation is therefore enforced **on the field**, by an `@auth` directive that wraps the resolver at schema-build time — not in the top-level query resolver, which only sees the entry point. The tests target the traversal paths specifically, not just the direct ones.
- **Persisted queries.** Production clients send a hash; arbitrary query documents are rejected. This bounds the attack surface to operations that have been through review, and it shrinks the request body. Development keeps arbitrary queries, because a graph you cannot explore is a graph nobody adopts.

Order matters: persisted-query lookup, then depth, then complexity, then execution with field auth. Each stage is cheaper than the one after it.

---

## 6. Real-time and caching

**Subscriptions** ride the existing `ws` server in `server.js` via `noServer` upgrade handling on a new path, so there is one WebSocket server and one connection lifecycle. The existing `broadcastRealtime` becomes one publisher into a small in-process pub/sub; the subscription resolvers are consumers. No new transport, no second Redis.

**Caching** uses per-field hints — `@cacheControl(maxAge:, scope:)`. The response's policy is the _minimum_ over every field touched, which is the only safe composition: one private field must make the whole response private.

**Authenticated data is never served from a shared cache.** Any request carrying credentials, and any response touching a `PRIVATE` field, gets `Cache-Control: no-store` with no `Surrogate-Key`. This is stated as an invariant with a test rather than a convention, because the failure mode is serving one user's escrow to another.

---

## 7. Adoption

- **Generated types.** TypeScript types are generated from the SDL and committed, so the frontend is typed end to end and a schema change that breaks the frontend shows up as a type error in the same pull request. Generation is a small purpose-built script over the `graphql` AST rather than the codegen toolchain — this repository's CI should not depend on a hundred-package resolve to type-check.
- **Screen-by-screen migration.** The job detail screen first, because it has the worst waterfall and the measurement is unambiguous. The REST helpers in `frontend/lib/api.ts` stay until the last screen using them is migrated.
- **Schema registry with breaking-change detection.** The printed schema is committed as a snapshot. CI compares the pull request's schema against the base branch's using `findBreakingChanges` from `graphql` core, and fails on any breaking change. `findDangerousChanges` is reported as a warning. This is the mechanism that makes §3.4 real.
- **Documentation of when _not_ to use it.** REST remains correct for file upload and download, for webhook receivers, for anything a CDN must cache by URL, for third-party integrations that expect REST, and for the SEP-12 and health endpoints whose shape is dictated externally. A gateway that claims to replace all of that is a gateway that will be worked around.

---

## 8. Migration plan

Five slices, each independently mergeable, each leaving `main` releasable:

| #   | Slice                                                                 | Leaves main releasable because                                |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Schema, scalars, error and pagination conventions, registry snapshot  | Nothing is mounted; the schema is data plus tests             |
| 2   | Resolvers over existing services, DataLoader batching, context        | The endpoint is mounted but feature-flagged off by default    |
| 3   | Depth and complexity limits, field authorisation, persisted queries   | The flag stays off until this lands; safety precedes exposure |
| 4   | Subscriptions, cache hints, round-trip measurement                    | Additive to a gated endpoint                                  |
| 5   | Generated types, job detail screen migration, CI registry check, docs | The frontend change is behind the same flag                   |

The ordering is deliberate: **the endpoint is not enabled by default until slice 3 lands.** Exposing a graph before its limits exist is the mistake this design is most concerned with avoiding.

---

## 9. Risks and how each is bounded

| Risk                                                  | Bound                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Resolver logic diverges from route logic              | Resolvers call services only; no SQL in the graph layer                                       |
| A private field is exposed through an unexpected path | Field-level `@auth`, plus tests that traverse _to_ the field rather than querying it directly |
| A slow query takes the API down                       | Depth + complexity limits, checked before execution; persisted queries in production          |
| Authenticated data leaks into a shared cache          | `no-store` invariant, tested                                                                  |
| The schema ossifies around today's screens            | Domain modelling, additive-only changes, CI-enforced                                          |
| One request's loader cache serves another request     | Loaders constructed per request, on the context                                               |
