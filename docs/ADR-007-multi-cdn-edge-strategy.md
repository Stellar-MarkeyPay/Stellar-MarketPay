# ADR-007: Multi-CDN Edge Strategy with Event-Driven Cache Invalidation

**Status:** Accepted
**Date:** 2026-07-29
**Author:** Stellar MarketPay Team
**Stakeholders:** Backend Team, DevOps Team

## Context

Job listings and profile pages are read far more often than they change, so
they benefit from aggressive edge caching for global latency. But on-chain
state changes — an escrow releases, a dispute is raised, work starts — need
to invalidate cached views quickly, or users see stale state (e.g. bidding
on a job that's already closed). A single CDN vendor is also a single point
of failure for the entire public surface of the app (job board, profiles,
static assets).

## Decision

An **ordered multi-CDN provider chain** (Cloudflare primary, Fastly
secondary, automatic failover) fronts the public read paths, paired with an
**event-driven invalidation pipeline** that turns Soroban contract events
into targeted purges — not a full-cache flush and not reliance on TTL expiry
alone.

```
Soroban contract event ──► Horizon event stream ──► indexerService.processEvent()
                                                            │
                                                            ▼
                              CdnInvalidationService.handleContractEvent()
                                                            │
                                            ┌───────────────┴───────────────┐
                                            ▼                               ▼
                                  bust origin Redis cache        CdnService.purge({urls, tags})
                                                                            │
                                                              ┌─────────────┴─────────────┐
                                                              ▼                           ▼
                                                     Cloudflare (primary)        Fastly (secondary,
                                                                                  only on failure/timeout)
```

- `backend/src/services/cdn/providers.js` / `cdnService.js` — per-vendor
  adapters, ordered failover chain with a per-provider circuit breaker, and
  a mock provider used automatically when no vendor credentials are
  configured. `purge()` throws if called without explicit `urls`/`tags` —
  an unscoped full flush is structurally impossible through this path.
- `backend/src/services/cdn/invalidationService.js` — maps each contract
  event type to exactly the affected job-detail page, job-list surrogate
  group, and both parties' profile pages; non-blocking (fire-and-forget)
  from `indexerService.js` so a slow/failed purge never adds latency to
  ledger event processing.
- `backend/src/services/cdn/cacheStrategy.js` +
  `backend/src/middleware/edgeCacheControl.js` — per-content-type
  cache-key/TTL policy (static assets: 1 year immutable; semi-dynamic job/
  profile pages: 30s edge TTL + event purge; personalized content: no CDN
  caching).
- `backend/src/middleware/requestCoalescer.js` — single-flight request
  coalescing on the three cached hot read paths, so a cache-miss stampede
  right after a purge collapses to one origin fetch.
- `backend/src/routes/cdn.js` — `GET /api/cdn/health` (per-provider circuit
  status) and `POST /api/cdn/webhook` (external pub-sub invalidation
  trigger).

## Rationale

### Why an ordered provider chain, not active-active multi-CDN

- A single vendor is a single point of failure for the whole public surface
  of the app; an ordered chain with failover removes that without the
  operational complexity of active-active DNS steering across vendors —
  "simpler to operate, and sufficient because purge/serve correctness
  matters more here than doubling edge capacity" (`docs/CDN_STRATEGY.md`,
  "Why multi-CDN, not a single vendor").

### Why event-driven invalidation instead of TTL-only or a full flush

- A full-cache flush on every contract event would defeat the purpose of
  caching at all for a platform-wide-popular job list.
- The existing `event_tests` module in
  `contracts/marketpay-contract/src/lib.rs` already emits and tests every
  lifecycle event this pipeline needs; no new contract events were required
  — the pipeline hooks into that existing typed event flow rather than
  inventing a parallel one (`docs/CDN_STRATEGY.md`, "Event-driven
  invalidation pipeline").
- Stated directly as the PR's goal: purge "exactly the affected URLs within
  a documented <5s SLA — instead of relying on TTL expiry alone or a
  full-cache flush" (PR
  [#93](https://github.com/Stellar-MarkeyPay/Stellar-MarketPay/pull/93),
  merged 2026-07-29, closes issue #91).

### Why keep origin Redis purge alongside CDN purge

Deliberately redundant: a cache-miss request that reaches the origin during
CDN propagation still needs fresh data instead of the origin's own stale
copy for the rest of its TTL window (`docs/CDN_STRATEGY.md`, "Cache-key /
TTL strategy per content type").

### Why not other alternatives

- **Active-active multi-CDN DNS steering**: explicitly rejected in favor of
  the ordered-chain approach above — more edge capacity, but not needed here
  and more operationally complex.
- **TTL-only invalidation** (no event pipeline): would leave a window of up
  to the full TTL (30s, per `cacheStrategy.js`) where users see stale
  escrow/job state after a release, dispute, or closure — rejected per the
  PR goal above.
- **Full cache flush per event**: rejected — `CdnService.purge()` is
  structurally prevented from doing this (throws without explicit
  `urls`/`tags`); flushing globally on every job event would erase the
  benefit of caching for all other unaffected jobs.

## Consequences

### Positive

- ✅ Documented and CI-gated <5s invalidation SLA
  (`backend/tests/cdnInvalidationSla.test.js`), including under simulated
  primary-provider failover.
- ✅ No live vendor credentials needed for CI or local dev — the mock
  provider keeps the whole pipeline exercisable.
- ✅ Stampede protection is layered (per-process coalescing + the CDN's own
  per-object collapsing) rather than relying on either alone.

### Negative

- ❌ Live, real-vendor verification (actual Cloudflare/Fastly accounts,
  ≥3-region latency measurement) is **not** part of CI — it requires
  external credentials and geographically distributed compute this repo's
  CI doesn't have, and is instead a manual/scheduled-pipeline step
  (`scripts/load-test/README.md`).
- ❌ `Surrogate-Key`/`Cache-Tag` purge only works natively on Fastly; on
  Cloudflare it requires an Enterprise plan (harmless no-op otherwise, since
  the URL-based purge still fires, but it's a real capability gap between
  providers).
- ❌ Adds operational surface (two vendor integrations, a circuit breaker,
  a webhook endpoint) versus a single-CDN or TTL-only design.

## Implementation Details

- `backend/src/services/cdn/providers.js`, `cdnService.js`,
  `invalidationService.js`, `cacheStrategy.js`
- `backend/src/middleware/edgeCacheControl.js`,
  `backend/src/middleware/requestCoalescer.js`
- `backend/src/routes/cdn.js`
- `backend/src/services/indexerService.js` (event source)
- `backend/tests/cdnInvalidationSla.test.js`,
  `scripts/load-test/cdn-latency-k6.js`, `scripts/load-test/stampede-k6.js`
- Full design writeup: `docs/CDN_STRATEGY.md`

## Related ADRs

- ADR-002: Horizon API for Transaction Indexing (the event stream this
  pipeline consumes via `indexerService.js`)

## References

- PR #93 — `Multi-CDN edge strategy with event-driven cache invalidation on
contract events` (merged 2026-07-29, closes #91)
- `docs/CDN_STRATEGY.md`
