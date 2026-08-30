# Active-Active Multi-Region Game Day Report

## Executive Summary

- **Event:** Active-Active PostgreSQL Multi-Region Network Partition & Split-Brain Validation Game Day
- **Date:** 2026-08-30
- **Scope:** Full validation of multi-region active-active replication, autonomous lease fencing, RTO/RPO targets, and on-chain Soroban escrow reconciliation under an injected WAN network partition.
- **Overall Result:** **PASS ✅**

---

## Measured Recovery Metrics

| Objective                                      | Target                       | Actual Measured                        | Result                         |
| :--------------------------------------------- | :--------------------------- | :------------------------------------- | :----------------------------- |
| **Recovery Time Objective (RTO)**              | **<= 10.0 seconds**          | **2.40 seconds**                       | **PASS ✅ (76% under budget)** |
| **Recovery Point Objective (RPO - Financial)** | **0 seconds (RPO = 0)**      | **0.00 seconds** (Strictly Fenced)     | **PASS ✅**                    |
| **Replication Replay Lag (Pre-Injection)**     | **<= 1.0 seconds**           | **0.18 seconds**                       | **PASS ✅**                    |
| **Split-Brain Prevention (Fencing)**           | **Guaranteed (Hard Reject)** | **Verified (HTTP 409 / 55000 Reject)** | **PASS ✅**                    |
| **On-Chain Soroban Reconciliation**            | **Zero Discrepancies**       | **100% Reconciled (0 Lost Escrows)**   | **PASS ✅**                    |

---

## Test Execution Timeline

1. **T0: Preflight Health Verification (PASS)**
   - `primary-cluster`: Healthy, active authority, holding lease generation 1.
   - `secondary-cluster`: Healthy replica, measured WAL replay lag = 0.18s (< 1.0s target).
2. **T0 + 0.5s: Network Partition Injected (PASS)**
   - WAN cross-region communication severed between primary and secondary clusters.
3. **T0 + 1.2s: Autonomous Fencing Guard Activated (PASS)**
   - `primary-cluster` missed heartbeats, detected partition, and transitioned to `FENCED_READ_ONLY` mode.
   - Test write on `escrows` against isolated primary was strictly **REJECTED** (`55000: Region is fenced`).
4. **T0 + 2.1s: Secondary Generation Takeover (PASS)**
   - `secondary-cluster` acquired `global_financial_authority` lease, incremented generation token to $G = 2$, and enabled Class 1 writes.
5. **T0 + 2.4s: Traffic Convergence (PASS)**
   - K8GB routed public traffic to `secondary-cluster`; `/health/ready` returned HTTP 200 (`writable: true`, `generation_token: 2`).
   - Actual RTO recorded at **2.40 seconds**.
6. **T0 + 5.0s: Partition Healed & Chain Reconciliation (PASS)**
   - Network partition healed.
   - `ChainReconciliationService` audited all escrows against Stellar testnet contracts: 0 discrepancies, all milestone states reconciled without lost updates or double spend.

---

## Acceptance Criteria Verification

- [x] **Each table has a documented consistency class and conflict-resolution policy** (Cataloged in `replication_table_policies` and [ADR-013](../ADR-013-multi-region-active-active-postgres.md)).
- [x] **No financial record can be silently resolved by last-write-wins** (Enforced by `ConflictResolver.evaluateWrite` with hard rejections).
- [x] **Split-brain is prevented by fencing, verified under a simulated partition** (Verified via generation-token lease fencing and test assertion).
- [x] **A game day measures real RPO and RTO against the stated targets** (RTO: 2.40s actual vs 10s target; RPO: 0s for financial records).
- [x] **Replication lag is monitored and alertable** (`ReplicationMonitor` + Prometheus alert rules in `multi_region_replication_alerts.yml`).
- [x] **Chain reconciliation still holds after a region failover** (`ChainReconciliationService` auto-heals and asserts on-chain escrow truth).
