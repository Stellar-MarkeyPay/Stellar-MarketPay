/**
 * scripts/load-test/cdn-latency-k6.js
 *
 * Measures job/profile page latency against a target host — run once
 * against the *origin* (CDN bypassed) and once against the *CDN edge* from
 * each of >= 3 geographic regions, before and after the multi-CDN rollout,
 * to quantify the global latency improvement (#91 acceptance criterion).
 *
 * Usage (single region):
 *   k6 run -e BASE_URL=https://app.example.com -e REGION=us-east scripts/load-test/cdn-latency-k6.js
 *
 * Usage (k6 Cloud, distributed across regions in one run):
 *   k6 cloud scripts/load-test/cdn-latency-k6.js
 *   # configure execution.distribution in k6 Cloud, or pass
 *   # --tag region=<name> per-run when driving separate regional runners
 *   # (e.g. GCP Cloud Run jobs in us-east1 / eu-west1 / ap-southeast1).
 *
 * See docs/CDN_STRATEGY.md#load-testing-methodology for the full before/after
 * comparison protocol and how to read the summary this script prints.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const REGION = __ENV.REGION || "unspecified";

// A handful of representative job/profile ids — replace with real seeded
// ids for the target environment before running.
const JOB_IDS = (__ENV.JOB_IDS || "job-1,job-2,job-3").split(",");
const PROFILE_KEYS = (__ENV.PROFILE_KEYS || "GDEMO1,GDEMO2").split(",");

const jobListLatency = new Trend(`job_list_latency_${REGION}`, true);
const jobDetailLatency = new Trend(`job_detail_latency_${REGION}`, true);
const profileLatency = new Trend(`profile_latency_${REGION}`, true);

export const options = {
  tags: { region: REGION },
  scenarios: {
    steady_state: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "2m", target: 50 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    // Global-latency-improvement gate: p95 under 300ms at the edge.
    // Compare this run's summary against the pre-CDN baseline run's.
    [`job_list_latency_${REGION}`]: ["p(95)<300"],
    [`job_detail_latency_${REGION}`]: ["p(95)<300"],
    [`profile_latency_${REGION}`]: ["p(95)<300"],
  },
};

export default function cdnLatencyScenario() {
  const jobId = JOB_IDS[Math.floor(Math.random() * JOB_IDS.length)];
  const profileKey = PROFILE_KEYS[Math.floor(Math.random() * PROFILE_KEYS.length)];

  const listRes = http.get(`${BASE_URL}/api/jobs?limit=20`, { tags: { name: "job_list" } });
  jobListLatency.add(listRes.timings.duration);
  check(listRes, { "job list 200": (r) => r.status === 200 });

  const detailRes = http.get(`${BASE_URL}/api/jobs/${jobId}`, { tags: { name: "job_detail" } });
  jobDetailLatency.add(detailRes.timings.duration);
  check(detailRes, { "job detail 200 or 404": (r) => r.status === 200 || r.status === 404 });

  const profileRes = http.get(`${BASE_URL}/api/profiles/${profileKey}`, {
    tags: { name: "profile" },
  });
  profileLatency.add(profileRes.timings.duration);
  check(profileRes, { "profile 200 or 404": (r) => r.status === 200 || r.status === 404 });

  sleep(1);
}
