# Multi-region Active-Active Disaster Recovery Architecture

## 1. Architecture Overview

MarketPay uses an **active-active multi-region topology** with PostgreSQL bidirectional logical replication, table-by-table consistency classifications, monotonic ULIDs, Positive-Negative (PN) Counter CRDTs, distributed fencing leases, and on-chain Soroban escrow reconciliation (decision recorded in [ADR-013](../ADR-013-multi-region-active-active-postgres.md), superseding the legacy active-passive baseline from ADR-008).

Both regions (`primary-cluster` and `secondary-cluster`) run active application tiers and regional database nodes, serving local reads and writes with sub-millisecond query performance:

```text
                          marketpay.example.com
                                   |
                     K8GB Authoritative Geo-DNS (TTL 30s)
                         /                      \
            primary-cluster                    secondary-cluster
          (e.g., us-east-1)                    (e.g., eu-west-1)
       NGINX Ingress Controller             NGINX Ingress Controller
                  |                                    |
          Backend App Tier                     Backend App Tier
      (Pool + Router + Fencing)            (Pool + Router + Fencing)
                  \                                    /
          +----------------------------------------------------+
          |      PostgreSQL Bidirectional Replication Mesh     |
          |                                                    |
          | - Class 1 (Financial): Authority Lease Fenced (CP) |
          | - Class 2 (Causal):    Version Vector Merged       |
          | - Class 3 (Eventual):  CRDT PN-Counters (AP)       |
          +----------------------------------------------------+
```

---

## 2. Table Consistency Classification and CAP Position

| Consistency Tier                       | Consistency Level             | Table Coverage                                                                                                                                                                                                                                                                                                                                | Conflict Resolution Policy                         | Routing Target         | Silent LWW Allowed?                   |
| :------------------------------------- | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------- | :--------------------- | :------------------------------------ |
| **Class 1: Financial & Security (CP)** | **Strict Linearizability**    | `escrows`, `referral_payouts`, `platform_fee_payouts`, `multi_level_payouts`, `insurance_claims`, `insurance_premiums_paid`, `sla_violations`, `ratings`, `dispute_evidence`, `reputation_commitments`, `reputation_revocations`, `reputation_epochs`, `frozen_wallets`, `api_keys`, `admin_profiles`, `webauthn_credentials`                 | `REJECT_UNLESS_LEASE_HOLDER`                       | Authority Writer Pool  | **NO (Hard Reject)**                  |
| **Class 2: Core Marketplace (Causal)** | **Causal / Read-Your-Writes** | `jobs`, `applications`, `profiles`, `dao_proposals`, `dao_votes`, `private_messages`, `messages`, `progress_updates`, `referrals`, `referral_tree`, `contract_events`, `skill_certificates`, `audit_logs`, `plugins`, `plugin_versions`, `plugin_installations`, `assessment_skills`, `assessment_questions`, `insured_files`, `fraud_alerts` | `STATE_MACHINE_VALIDATED` / `VERSION_VECTOR_MERGE` | Local / Authority Pool | **NO (Validated State Progression)**  |
| **Class 3: Telemetry & Counters (AP)** | **Eventual Consistency**      | `crdt_pn_counters`, `job_views`, `notifications`, `notification_preferences`, `job_drafts`, `saved_searches`, `scope_sessions`, `ml_ranking_shadow_events`, `plugin_invocation_logs`, `availability_check_history`, `oracle_proofs`, `api_key_usage_daily`                                                                                    | `CRDT_PN_COUNTER` / `LWW_TIMESTAMP_TIEBREAK`       | Any Local Pool         | Yes (Loss-tolerant telemetry / CRDTs) |

---

## 3. Recovery Objectives (RTO & RPO Targets)

| Operation Class                                    | RTO Target        | RPO Target              | Budget and Justification                                                                                      |
| :------------------------------------------------- | :---------------- | :---------------------- | :------------------------------------------------------------------------------------------------------------ |
| **Class 1 Financial (Escrows, Disputes, Payouts)** | **<= 10 seconds** | **0 seconds (RPO = 0)** | Fencing lease mutual exclusion ensures zero lost writes or double payouts. Hard rejection on un-leased nodes. |
| **Class 2 Causal Marketplace State**               | **<= 5 seconds**  | **<= 1 second**         | Asynchronous bidirectional replay; deterministic state-machine conflict resolution.                           |
| **Class 3 Eventual CRDTs & Telemetry**             | **<= 2 seconds**  | **<= 5 seconds**        | Conflict-free PN-counters and Add-Wins OR-Sets merge cleanly post-partition.                                  |

---

## 4. Split-Brain Prevention and Lease Fencing

1. **Generation-Token Leases (`region_fencing_leases`):**
   - Active authority holds lease `global_financial_authority` with monotonic generation token $G$.
   - Heartbeat interval: **2 seconds**; Lease TTL: **6 seconds**.
2. **Autonomous Partition Fencing:**
   - If the active authority loses WAN connection or misses 3 consecutive heartbeats, it enters `FENCED_READ_ONLY` mode.
   - All Class 1 financial write queries are immediately rejected with HTTP 409 (`55000: Object not in prerequisite state`).
3. **Lease Promotion & Takeover:**
   - Secondary node promotes to active authority by incrementing generation token ($G_{new} = G_{old} + 1$).
   - In-flight writes are drained with a 5-second timeout (`pool.drainWrites()`).
4. **Post-Failover On-Chain Escrow Reconciliation:**
   - `ChainReconciliationService` continuously compares off-chain database rows with on-chain Soroban contract events and Stellar ledger sequences, auto-healing any lagged state transitions.

---

## 5. Failure Safety and Health Probes

- `/health/live`: Process liveness only (independent of external dependencies).
- `/health/standby`: Database and Horizon reachability (passes on read-only replicas).
- `/health/ready`: Database connectivity + writability + fencing status (`fenced=false`).
- `/api/replication/status`: Live telemetry for replication replay lag, cross-region RTT, fencing lease status, and pool connection counts.
- `/api/replication/conflicts`: Structured audit log of all detected replication conflicts and applied resolution strategies.
