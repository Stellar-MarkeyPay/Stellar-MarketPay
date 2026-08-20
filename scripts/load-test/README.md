# CDN load & invalidation testing (#91)

Two [k6](https://k6.io/) scripts back the acceptance criteria for the
multi-CDN edge strategy:

| Script              | Verifies                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| `cdn-latency-k6.js` | Global latency improvement across >= 3 regions, before/after the CDN rollout |
| `stampede-k6.js`    | Origin survives a cache-stampede traffic spike right after an invalidation   |

The automated, CI-enforced SLA gate (event → targeted purge < 5s, using the
in-memory mock CDN provider) lives in
[`backend/tests/cdnInvalidationSla.test.js`](../../backend/tests/cdnInvalidationSla.test.js)
and runs on every `npm test` — no k6 or live vendor account required. The
scripts here are for validating the _real_ numbers against live CDN vendors
and real geographic distance, which can't be done from a single CI runner.

## 1. Multi-region latency, before/after

**Goal:** quantify the latency win from putting Cloudflare/Fastly in front
of the origin, from at least 3 geographically distinct regions.

1. Pick 3+ regions that roughly bracket your user base, e.g. `us-east`,
   `eu-west`, `ap-southeast`. Run k6 from a compute instance in each region
   (a small VM/Cloud Run job is enough — the point is network distance, not
   CPU), or use [k6 Cloud](https://k6.io/docs/cloud/) which distributes
   `k6 cloud` runs across its own regional load zones.
2. **Baseline (before):** point `BASE_URL` directly at the origin, bypassing
   the CDN (e.g. the backend's internal/direct hostname, or a
   `Cache-Control: no-cache` override), and run from each region:
   ```bash
   k6 run -e BASE_URL=https://origin-direct.example.com -e REGION=us-east cdn-latency-k6.js
   k6 run -e BASE_URL=https://origin-direct.example.com -e REGION=eu-west cdn-latency-k6.js
   k6 run -e BASE_URL=https://origin-direct.example.com -e REGION=ap-southeast cdn-latency-k6.js
   ```
3. **After:** repeat with `BASE_URL` pointed at the public CDN-fronted
   hostname, same regions.
4. Compare each region's `job_list_latency_<region>` / `job_detail_latency_<region>`
   / `profile_latency_<region>` p95 between the two runs. Record the deltas
   in the PR/release notes — this is the "before/after" evidence the
   acceptance criteria ask for.

The `thresholds` block in the script (p95 < 300ms) is a starting gate for
the _after_ run; tune it once you have a real baseline for your regions.

## 2. Stampede / cache-miss-storm protection

**Goal:** confirm that a purge doesn't turn into a thundering herd against
the database.

1. Seed a job id that's cheap to identify traffic for, e.g. `job-1`.
2. Trigger an invalidation for it — either let a real contract event fire,
   or simulate one directly:
   ```bash
   curl -X POST https://app.example.com/api/cdn/webhook \
     -H "Content-Type: application/json" \
     -d '{"eventType":"escrow_released","jobId":"job-1"}'
   ```
3. Immediately (within the same second) fire the burst:
   ```bash
   k6 run -e BASE_URL=https://app.example.com -e JOB_ID=job-1 stampede-k6.js
   ```
4. Watch `marketpay_db_connections` and `marketpay_http_request_duration_seconds`
   on the Grafana dashboard (`monitoring/grafana`) during the run. Latency
   should stay close to a single cold fetch's cost even at 300 concurrent
   VUs; if it scales up with VU count, request coalescing
   (`backend/src/middleware/requestCoalescer.js`) has regressed.

## Interpreting results

Neither script asserts real vendor numbers in CI — they're meant to be run
manually (or from a scheduled pipeline with real regional runners and CDN
credentials) and the results attached to the rollout PR/issue as evidence.
The `cdnInvalidationSla.test.js` Jest suite is what actually gates merges,
since it exercises the same purge/failover/latency-measurement code paths
without depending on external infrastructure.
