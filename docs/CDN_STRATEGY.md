# Global Multi-CDN Edge Strategy & Event-Driven Cache Invalidation

Tracks issue #91 — Global Multi-CDN Edge Strategy with Event-Driven Cache
Invalidation on Contract Events.

## Overview

Job listings and profile pages are read far more often than they change, so
they benefit from aggressive CDN caching for global latency. But on-chain
state changes — a job's escrow releases, a dispute gets raised, work starts
— need to invalidate cached views quickly, or users see stale state (e.g.
bidding on a job that's already closed).

This document describes:

1. The multi-CDN architecture and its failover behavior.
2. The event-driven invalidation pipeline that turns contract events into
   targeted purges.
3. The cache-key/TTL strategy per content type.
4. Cache-stampede protection (request coalescing).
5. How the < 5s invalidation SLA and multi-region latency improvement are
   verified.

## Why multi-CDN, not a single vendor

A single CDN vendor is a single point of failure for the entire public
surface of the app (job board, profiles, static assets). The strategy here
is an **ordered provider chain** with automatic failover, not
active-active multi-CDN DNS steering — simpler to operate, and sufficient
because purge/serve correctness matters more here than doubling edge
capacity.

```
Contract event ──► CdnInvalidationService.handleContractEvent()
                          │
                          ▼
                    CdnService.purge({ urls, tags })
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
        Provider #1 (Cloudflare)  Provider #2 (Fastly)
        [configured primary]      [configured secondary]
              │ success                 │
              ▼                         │
          done                          │ (tried only if #1
                                         │  errors/times out/
                                         │  circuit is open)
```

Implementation:

- `backend/src/services/cdn/providers.js` — one adapter per vendor
  (`createCloudflareProvider`, `createFastlyProvider`), plus
  `createMockProvider` used automatically in dev/CI when no vendor
  credentials are configured, so the pipeline is always exercisable.
- `backend/src/services/cdn/cdnService.js` — orchestrates the ordered
  chain: tries each provider in turn, times out a hung call (`timeoutMs`,
  default 4s), and **never issues an unscoped purge** — `purge()` throws if
  called without explicit `urls`/`tags`, so a full-cache flush is
  structurally impossible through this path.

### Provider order & failover configuration

```bash
CDN_PROVIDER_ORDER=cloudflare,fastly   # try Cloudflare first, Fastly second
CLOUDFLARE_ZONE_ID=...
CLOUDFLARE_API_TOKEN=...
FASTLY_SERVICE_ID=...
FASTLY_API_TOKEN=...
```

A provider is only added to the chain if its credentials are present, so
partial configuration (e.g. Fastly only) degrades gracefully to a
single-provider chain rather than crashing on boot.

### Failover / circuit breaker

Each provider has a small circuit breaker (`cdnService.js`):

- After `failureThreshold` (default 3) consecutive failures, the provider's
  circuit opens for `cooldownMs` (default 30s) — subsequent purges skip it
  immediately rather than paying its timeout on every call.
- A successful purge resets the failure count.
- `GET /api/cdn/health` exposes `{ provider, circuitOpen, failures }` per
  vendor for dashboards/alerting.

### Tested failover scenario

`backend/src/services/cdn/cdnService.test.js` covers:

- Primary provider errors → purge succeeds via the secondary
  (`"fails over to the secondary provider when the primary errors"`).
- Primary provider hangs past `timeoutMs` → purge succeeds via the
  secondary (`"fails over on a provider timeout"`).
- Repeated primary failures open its circuit, and subsequent purges skip it
  entirely without re-attempting (`"opens the circuit after repeated
failures..."`).
- All providers down → `CdnPurgeError` with a per-provider attempt log, so
  the failure is observable rather than silently swallowed.

`backend/tests/cdnInvalidationSla.test.js` additionally verifies that a
failover still completes **within the invalidation SLA** (see below), not
just eventually.

## Event-driven invalidation pipeline

```
Soroban contract event (escrow_created, work_started, escrow_released,
escrow_refunded, escrow_disputed, milestone_released)
        │  Horizon event stream
        ▼
indexerService.processEvent()          [backend/src/services/indexerService.js]
        │  (existing: updates jobs/escrows tables, broadcasts over WS)
        ▼
CdnInvalidationService.handleContractEvent(eventType, jobId)
        │  [backend/src/services/cdn/invalidationService.js]
        ├─► bust origin Redis cache: job detail, job list, both profiles
        └─► CdnService.purge({ urls, tags })   — targeted, not a full flush
```

- **Extends the existing `event_tests` pattern.** The Rust contract
  (`contracts/marketpay-contract/src/lib.rs`, `mod event_tests`) already
  emits and tests `escrow_cr`/`work_strt`/`escrow_rl`/`escrow_rf`/`escrow_ds`/`ms_rel`
  for every lifecycle transition; `indexerService.js` already maps these to
  `escrow_created` / `work_started` / `escrow_released` / `escrow_refunded`
  / `dispute_opened` / `milestone_released`. No new contract events were
  needed — "job created" is `escrow_created`, "job closed" is
  `escrow_released` / `escrow_refunded`, "dispute raised" is
  `dispute_opened`. This pipeline hooks into that existing typed event flow
  rather than inventing a parallel one.
- **Targeted, not a full flush.** `CdnInvalidationService.buildTargets()`
  resolves exactly: the job's detail page, the job-list surrogate group,
  and the client's and freelancer's profile pages (whichever addresses
  exist for that job) — see
  `backend/src/services/cdn/invalidationService.test.js`,
  `"purges only the affected job + both parties' profile URLs, not a full
flush"`.
- **Non-blocking.** `indexerService.js` calls `handleContractEvent()`
  fire-and-forget (`.catch(...)` logs failures) so a slow/failed CDN purge
  never adds latency to ledger event processing.
- **External pub-sub entrypoint.** `POST /api/cdn/webhook` (`backend/src/routes/cdn.js`)
  drives the same `handleContractEvent()` call, HMAC-signed with
  `CDN_WEBHOOK_SECRET`. This is for deployments that run event ingestion as
  a separate worker/queue consumer instead of in-process with the API
  server — same invalidation logic, different trigger.
- **Observable.** `CdnInvalidationService` is an `EventEmitter`
  (`invalidation:completed` / `invalidation:failed`) and records
  `marketpay_cdn_invalidation_latency_seconds` (histogram, labeled by
  `event_type`) and `marketpay_cdn_invalidation_failures_total` on the
  shared Prometheus registry — visible at `/metrics` alongside the existing
  HTTP/DB metrics.

## Cache-key / TTL strategy per content type

Defined in `backend/src/services/cdn/cacheStrategy.js`, applied via the
`edgeCacheControl` middleware (`backend/src/middleware/edgeCacheControl.js`):

| Content type               | Examples                                                                                                     | Edge TTL                                                                         | Cache-Control                                                                   | Invalidation                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Static asset**           | Next.js build output (`/_next/static/*`, hashed filenames)                                                   | 1 year                                                                           | `public, max-age=31536000, immutable`                                           | Never — a new deploy ships a new filename, so nothing to purge          |
| **Semi-dynamic**           | Job list (`GET /api/jobs`), job detail (`GET /api/jobs/:id`), profile pages (`GET /api/profiles/:publicKey`) | 30s edge (`s-maxage`), plus `stale-while-revalidate=60` and `stale-if-error=300` | `public, max-age=0, s-maxage=30, stale-while-revalidate=60, stale-if-error=300` | Event-driven purge (this doc) on the contract events that make it stale |
| **Dynamic / personalized** | Dashboard, spending analytics, notifications, anything keyed to the viewer's JWT                             | 0 (no CDN caching)                                                               | `private, no-store`                                                             | N/A                                                                     |

Cache keys / surrogate tags:

- `jobs:list:<sorted-query-params>` — Redis key (existing `cacheService.jobListKey`);
  CDN surrogate tag `jobs-list` groups every list-view variant so one purge
  drops all of them.
- `job:detail:<jobId>` — Redis key (`cacheService.jobDetailKey`, added for
  this issue — `GET /api/jobs/:id` was previously uncached); CDN surrogate
  tag `job-<jobId>`.
- `profile:<publicKey>` — Redis key (existing `cacheService.profileKey`);
  CDN surrogate tag `profile-<publicKey>`.

Two invalidation mechanisms per resource, deliberately redundant:

1. **CDN edge purge** by explicit URL (works on every vendor plan) and by
   `Surrogate-Key`/`Cache-Tag` header (Fastly natively; Cloudflare only on
   Enterprise — harmless no-op otherwise since the URL purge still fires).
2. **Origin Redis purge** (`cacheService.del` / `delPattern`) so a
   cache-miss request that reaches the origin during CDN propagation still
   gets fresh data instead of the origin's own stale copy for the rest of
   its 30s/300s TTL window.

## Cache-stampede protection (request coalescing)

`backend/src/middleware/requestCoalescer.js` implements single-flight
request coalescing: when N concurrent requests miss the cache for the same
key (the classic scenario right after a purge — everyone viewing a popular
job page gets a cache miss at the same instant), only the **first** caller
runs the origin fetch; every other concurrent caller awaits that same
in-flight promise instead of independently hitting the database.

Wired into the three cached, publicly-hot read paths:

- `GET /api/jobs` (job list)
- `GET /api/jobs/:id` (job detail — previously uncached entirely; now
  cached with `cache.TTL.JOB_DETAIL` (30s) + coalescing, matching the list's
  volatility)
- `GET /api/profiles/:publicKey`

Scope: per-process, in-memory. That's sufficient for the origin API tier
here — each instance still collapses its own concurrent misses from N down
to 1 DB query. The CDN's own per-object request collapsing is the outer
layer of defense for a fleet of origin instances; see
`scripts/load-test/stampede-k6.js` for how to validate the two layers
together against a real deployment.

**Tested:** `backend/src/middleware/requestCoalescer.test.js` simulates a
50-concurrent-request post-invalidation spike hitting a single origin call;
`scripts/load-test/stampede-k6.js` is the corresponding load-test script for
validating it against a real deployment (300 concurrent VUs against one job
id immediately after a purge).

## SLA verification (< 5s, event → targeted purge)

- **Metric:** `marketpay_cdn_invalidation_latency_seconds` (Prometheus
  histogram, labeled `event_type`), recorded by
  `CdnInvalidationService.handleContractEvent()` from the on-chain
  `ledger_closed_at` timestamp (falling back to indexer-receipt time if
  unavailable) to purge completion.
- **CI-enforced gate:** `backend/tests/cdnInvalidationSla.test.js` asserts
  end-to-end latency (including a simulated primary-provider failover)
  stays under 5s using the real `CdnService`/`CdnInvalidationService` code
  paths against the in-memory mock provider — this is what actually blocks
  merges, since it needs no live CDN vendor account.
- **Production verification:** point `CDN_PROVIDER_ORDER` at real vendor
  credentials, trigger a real (or simulated via `POST /api/cdn/webhook`)
  contract event, and read `marketpay_cdn_invalidation_latency_seconds` off
  `/metrics` / Grafana. Alert if p95 exceeds 5s for 3+ consecutive
  intervals.

## Load testing methodology (>= 3 regions)

See [`scripts/load-test/README.md`](../scripts/load-test/README.md) for the
full before/after protocol. Summary:

1. Run `scripts/load-test/cdn-latency-k6.js` from 3+ geographically
   distinct regions (e.g. `us-east`, `eu-west`, `ap-southeast`), once
   against the origin directly (baseline) and once against the CDN-fronted
   hostname (after).
2. Compare per-region p95 latency between the two runs — that delta is the
   "global latency improvement" evidence for the acceptance criteria.
3. Run `scripts/load-test/stampede-k6.js` immediately after triggering an
   invalidation, to validate stampede protection under real network
   conditions (not just the unit-level 50-VU simulation in
   `requestCoalescer.test.js`).

This repo's CI can't itself rent compute in 3 regions or hold live CDN
vendor credentials, so these two scripts are the manual/scheduled-pipeline
half of verification; the SLA and targeted-purge-only guarantees are the
half that's automated (previous section).

## Operational endpoints

| Endpoint                | Purpose                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `GET /api/cdn/health`   | Per-provider circuit-breaker status (`{ provider, circuitOpen, failures }[]`)               |
| `POST /api/cdn/webhook` | External pub-sub trigger for `handleContractEvent()`, HMAC-signed with `CDN_WEBHOOK_SECRET` |

## Environment variables

See `backend/.env.example` for the full list:

```bash
CDN_PROVIDER_ORDER=cloudflare,fastly
CLOUDFLARE_ZONE_ID=
CLOUDFLARE_API_TOKEN=
FASTLY_SERVICE_ID=
FASTLY_API_TOKEN=
CDN_WEBHOOK_SECRET=
PUBLIC_BASE_URL=https://app.stellar-marketpay.example
```

None are required to boot the app — with none configured, `CdnService`
falls back to an in-memory mock provider so the invalidation pipeline stays
fully exercisable in dev/CI.
