# Multi-cluster disaster-recovery architecture

## Decision

MarketPay uses an **active-passive, two-region topology**. PostgreSQL is the
authoritative mutable store and the current application is not designed for
conflict resolution, so active-active writes would create an unacceptable
split-brain risk for escrow and marketplace records.

Each region has a warm Kubernetes cluster with two frontend and two backend
replicas. K8GB publishes only healthy Ingress targets and uses a failover
strategy with `primary-cluster` as the preferred geo tag. DNS TTL is 30 seconds.
The passive cluster runs continuously. `/health/standby` lets its Rollouts and
Pods prove dependencies are reachable while PostgreSQL is read-only. A separate
traffic-gate Deployment calls `/health/ready`; it has no Ready endpoints until
PostgreSQL is writable. The gate is part of the GSLB Ingress host, so K8GB
cannot advertise the cluster before database promotion.

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

K8GB uses native Pod readiness when deciding which regional Ingress addresses
are eligible. Database promotion is owned by the managed PostgreSQL control
plane. The secondary cannot receive traffic until promotion makes its regional
endpoint writable and `/health/ready` returns 200.

## Recovery objectives

| Objective | Target         | Budget and justification                                                                                                                                                  |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RTO       | **10 minutes** | 5 minutes for managed-DB detection/promotion, 2 minutes for application readiness, 1 minute for K8GB detection/reconciliation, and up to 2 minutes for DNS/client caching |
| RPO       | **60 seconds** | Asynchronous cross-region PostgreSQL replay must remain below 60 seconds; alert at 30 seconds and block planned game-day injection above 60 seconds                       |

These are service objectives, not guarantees. A production game day is required
quarterly, and a result outside either target blocks releases until the gap has
an owner and remediation date.

## State and configuration

| Dependency       | DR treatment                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL       | Provider-managed cross-region asynchronous replica, continuous WAL/PITR backup, automatic promotion, deletion protection, and a regional endpoint per cluster. Enable synchronous durability within each region.                               |
| Redis            | Per-cluster, non-persistent cache. No replication is required; all entries must be reconstructable from PostgreSQL or external APIs.                                                                                                           |
| Secrets          | A regionally replicated vault is the source of truth. External Secrets refreshes `marketpay/production/backend` and `marketpay/production/frontend` every five minutes in both clusters. Kubernetes Secrets are never copied between clusters. |
| IPFS evidence    | CIDs are stored in PostgreSQL. Pinata credentials come from the replicated vault. Production must pin each CID with a second independent pinning account/provider; game day verifies retrieval through both gateways.                          |
| Container images | Immutable tags in GHCR. The same digest must be pullable by both regions before promotion.                                                                                                                                                     |
| Stellar state    | Escrow funds and contract state remain on Stellar and are not cluster-local. Contract IDs and network selection are replicated configuration.                                                                                                  |

Required backend secret keys include `DATABASE_URL`, `JWT_SECRET`,
`CONTRACT_ID`, `PINATA_API_KEY`, and `PINATA_SECRET_KEY`. The secondary
`DATABASE_URL` must resolve to its regional replica and remain stable when that
replica is promoted.

## Failure safety

- Liveness checks only process health; dependency failures do not cause restart
  loops.
- Warm-standby readiness checks PostgreSQL and Horizon reachability.
- The GSLB traffic gate additionally requires database writability.
- K8GB shifts traffic only to a cluster with Ready application Pods.
- DNS failover is automatic; DNS failback is deliberately manual.
- If neither regional database is known to be the writer, both regions remain
  unavailable. Operators must establish database authority before changing DNS.
- A promoted former secondary is never reattached as a replica without
  rebuilding the old primary from the new writer.

## Blue-green releases

Argo Rollouts maintains active and preview Services for both applications.
Every new immutable image:

1. starts on the preview ReplicaSet;
2. passes three smoke-test Jobs against preview frontend and backend;
3. switches the active Service selector without replacing the stable pods;
4. passes six post-cutover checks over one minute;
5. becomes stable only after analysis succeeds.

Failed pre-promotion analysis prevents cutover. Failed post-promotion analysis
aborts the rollout and switches the active Service back to the previous stable
ReplicaSet. Stable pods are retained for five minutes, and three revisions are
kept in the fast rollback window.
