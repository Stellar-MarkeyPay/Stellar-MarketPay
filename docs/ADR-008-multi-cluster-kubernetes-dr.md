# ADR-008: Active-Passive Multi-Cluster Kubernetes Disaster Recovery

**Status:** Accepted
**Date:** 2026-07-30
**Author:** Stellar MarketPay Team
**Stakeholders:** DevOps Team, Backend Team

## Context

The original Kubernetes deployment (PR #52, merged 2026-06-16) was a single
in-cluster stack: one namespace, a single-node PostgreSQL `StatefulSet`,
Redis, and NGINX ingress with autoscaling — a solid production foundation
but with no region-loss tolerance: the cluster and its database were both
single points of failure. PostgreSQL is the authoritative mutable store for
escrow and marketplace records, and the application is not designed for
conflict resolution, so any DR design also had to rule out active-active
writes.

## Decision

An **active-passive, two-region topology**: each region runs a warm
Kubernetes cluster (2 frontend + 2 backend replicas), with a
provider-managed PostgreSQL cross-region async replica as the only
authoritative writer at any time, K8GB-driven DNS failover (30s TTL), and
Argo Rollouts blue-green deployments in both regions.

```text
                          marketpay.example.com
                                   |
                      K8GB authoritative DNS (TTL 30s)
                         /                         \
             primary-cluster                 secondary-cluster
            NGINX -> active Service          NGINX -> active Service
               Argo Rollouts                    Argo Rollouts
                         \                         /
                 managed PostgreSQL global database
                  writer          async regional replica
```

- `k8s/base/` + `k8s/overlays/{primary,secondary}/` (kustomize) replace the
  single-cluster manifests from PR #52.
- `backend/src/routes/health.js` — layered health: `/health/live` (process
  only), `/health/standby` (dependencies reachable, DB may be read-only —
  used for normal Kubernetes/Rollout readiness so passive-region pods stay
  Ready), `/health/ready` (also requires a writable DB).
- A dedicated `traffic-gate` Deployment probes `/health/ready` on the active
  backend and is the only thing K8GB's Ingress health check depends on, so a
  cluster can never receive live traffic before its database is writable
  (`docs/dr/architecture.md`, "Decision").
- `k8s/base/rollouts.yaml` — Argo Rollouts blue-green with pre-promotion
  smoke analysis (3 checks) gating cutover and post-promotion analysis
  (6 checks over 60s) that automatically restores the previous stable
  ReplicaSet on failure.
- `scripts/k8s/deploy-blue-green.sh` — deploys secondary first, then
  primary; refuses mutable/placeholder image tags; never touches database
  storage.
- **RTO 10 minutes / RPO 60 seconds**, broken down and justified against the
  actual mechanism (managed-DB promotion + application readiness + K8GB
  detection + DNS caching), not aspirational round numbers
  (`docs/dr/architecture.md`, "Recovery objectives").

## Rationale

### Why active-passive, not active-active

- PostgreSQL is the authoritative mutable store for escrow and marketplace
  records, and "the current application is not designed for conflict
  resolution, so active-active writes would create an unacceptable
  split-brain risk" (`docs/dr/architecture.md`, "Decision" — this is the
  ADR's own already-recorded reasoning, carried into this file for
  cross-linking).
- A single managed-PostgreSQL writer with async cross-region replication
  and automatic promotion avoids building or operating custom
  conflict-resolution logic.

### Why K8GB + DNS failover rather than a service mesh / anycast approach

- Health-check-driven DNS failover with a 30s TTL is directly measurable in
  the RTO budget (`docs/dr/architecture.md`'s RTO breakdown: 5 min DB
  promotion + 2 min app readiness + 1 min K8GB detection + up to 2 min
  DNS/client caching = 10 min), and composes with the existing NGINX
  ingress per cluster without introducing a cross-region service mesh.
- **Reconstructed — unconfirmed, needs author input:** no PR or doc found
  explicitly compares K8GB/DNS failover against a service-mesh or anycast
  alternative; it is documented as the chosen mechanism, not as a decision
  among named alternatives.

### Why the traffic-gate is separate from normal Kubernetes readiness

Normal Kubernetes/Rollout readiness (`/health/standby`) must stay Ready even
while the regional database is read-only, so passive-region pods aren't
killed or excluded from the Rollout — but K8GB must never see a cluster as
eligible for traffic until its database is actually writable. Splitting
this into two separate probes (and a dedicated `traffic-gate` Deployment
that only the GSLB Ingress depends on) keeps those two different notions of
"ready" from being conflated into one signal (`docs/dr/architecture.md`,
"Decision"; `docs/dr/runbook.md`, "Automated regional failover").

### Why blue-green (Argo Rollouts) instead of rolling updates, on top of DR

Rolling updates give no atomic, verifiable cutover point and no automatic
rollback on a failed post-deploy check; blue-green's pre/post-promotion
analysis gates give both, in both regions, independent of the DR failover
mechanism itself (`docs/dr/architecture.md`, "Blue-green releases"; PR
[#94](https://github.com/Stellar-MarkeyPay/Stellar-MarketPay/pull/94)'s
summary).

### Why not other alternatives

- **Single-cluster with only backups** (the PR #52 baseline this replaces):
  no region-loss tolerance at all — a regional outage is full downtime until
  a manual restore.
- **Active-active multi-region writes**: rejected outright per the
  split-brain reasoning above.
- **Automatic failback**: explicitly rejected — "DNS failover is automatic;
  DNS failback is deliberately manual" (`docs/dr/architecture.md`, "Failure
  safety"), because an automatic failback race could promote a
  not-yet-caught-up region back to writer.

## Consequences

### Positive

- ✅ RTO/RPO targets are broken down against the actual mechanism, not
  asserted as round numbers, and are backed by an executed (if
  simulation-only) game-day run: 8.06s RTO / 4.0s RPO against mock
  endpoints, well within the 600s/60s targets
  (`docs/dr/game-day-report.md`).
- ✅ The pre-injection RPO-safety refusal was verified for real (not just in
  unit tests) — the tool exits 1 and never runs the failure command when
  replay lag exceeds target (`docs/dr/game-day-report.md`).
- ✅ Failback is deliberately manual and gated by a 30-minute low-replication-lag
  window, reducing the risk of flapping between regions.

### Negative

- ❌ **Not yet proven in production**: the only game-day evidence to date is
  a control-plane simulation against local mock HTTP endpoints, not a real
  two-cluster region-loss test — a live `--mode live` game day against real
  primary/secondary clusters is the documented required next step before
  the RTO/RPO objectives are treated as proven
  (`docs/dr/game-day-report.md`, "Qualification").
- ❌ Requires two warm, continuously-running clusters (4 replicas total per
  service across regions) rather than one — ongoing infrastructure cost for
  a passive region that (by design) serves no traffic under normal
  operation.
- ❌ Manual failback means an extended period running on the secondary after
  a failover, until an operator completes the documented failback procedure.

## Implementation Details

- `k8s/base/`, `k8s/overlays/primary/`, `k8s/overlays/secondary/`
  (including `gslb.yaml`, `rollouts.yaml`, `external-secrets.yaml`)
- `backend/src/routes/health.js`
- `scripts/k8s/deploy-blue-green.sh`
- `scripts/dr/gameday.py`, `scripts/dr/tests/`
- `docs/dr/architecture.md`, `docs/dr/runbook.md`, `docs/dr/game-day-report.md`

## Related ADRs

- ADR-003: Database Schema for Escrow State Management (the PostgreSQL
  store whose cross-region replication and promotion this ADR depends on)

## References

- PR #94 — `Add multi-cluster DR (K8GB failover) and Argo Rollouts
blue-green deployment` (merged 2026-07-30)
- PR #52 — `Add Kubernetes scalable deployment setup` (the single-cluster
  design this superseded)
- `docs/dr/architecture.md`, `docs/dr/runbook.md`, `docs/dr/game-day-report.md`
