# ADR-013: Multi-Region Active-Active PostgreSQL with Conflict Resolution and Fencing

**Status:** Accepted  
**Date:** 2026-08-30  
**Author:** Stellar MarketPay Team  
**Stakeholders:** DevOps Team, Backend Team, Infrastructure Team, Security Team

---

## 1. Context and Problem Statement

Stellar MarketPay operates across multiple geographic regions (e.g. `primary-cluster` in `us-east-1` and `secondary-cluster` in `eu-west-1`). Previously (per ADR-008), MarketPay employed an active-passive disaster-recovery topology where only one region was writable at any given time, and all traffic in the secondary region remained dormant until a full database promotion occurred.

While active-passive prevented split-brain, it suffered from critical operational drawbacks:

1. **Underutilized Regional Infrastructure:** The secondary cluster compute and read capacity sat idle while users in distant regions suffered cross-continent latency.
2. **Disaster Recovery Gap at Data Tier:** A sudden loss of the primary database region resulted in complete platform write unavailability until manual or semi-automated failover completed (RTO up to 10 minutes).
3. **Escrow and Financial Safety:** Marketplace operations involve high-stakes financial escrows, dispute settlements, and on-chain Soroban contract interactions. Simple multi-master active-active setups risk silent Last-Write-Wins (LWW) data corruption or split-brain if not carefully partitioned and fenced.

This ADR evaluates multi-region database topologies, defines the CAP position, establishes RTO/RPO targets, details table-by-table consistency classifications, specifies conflict-free data models (ULIDs, CRDTs), and details automated lease fencing and on-chain escrow reconciliation.

---

## 2. Topology Evaluation and Decision

We evaluated three architectural options for multi-region data storage:

### Option A: Streaming Physical Replication with Regional Failover (Baseline Active-Passive)

- **Mechanism:** Asynchronous or semi-synchronous PostgreSQL WAL streaming to a passive replica with automated promoter.
- **Pros:** Native PostgreSQL support; zero application-level conflict handling required.
- **Cons:** High write latency for remote users; complete downtime during database promotion; failover can cause split-brain if the old primary is not fenced.
- **Verdict:** Insufficient for active-active multi-region utilization.

### Option B: Distributed SQL Engine (CockroachDB / YugabyteDB / Google Spanner)

- **Mechanism:** Shared-nothing distributed consensus (Raft/Paxos) across geographic regions at the storage engine level.
- **Pros:** Transparent multi-region ACID transactions; automatic linearizable reads and writes.
- **Cons:** Every write requires WAN round-trip consensus (100–250ms p99 latency); high operational complexity and resource consumption; incompatible with PostgreSQL extensions (e.g., specific PL/pgSQL triggers, `pg_trgm` full-text search tuning).
- **Verdict:** Latency overhead unacceptable for standard interactive operations; over-engineered for our read/write distribution.

### Option C (Selected): Hybrid Active-Active with Bidirectional Logical Replication, Table Consistency Tiers, and Lease Fencing

- **Mechanism:** PostgreSQL with bidirectional logical replication, application-level connection routing, monotonic ULIDs, CRDT counters, per-table conflict policies, distributed fencing leases, and on-chain Soroban reconciliation.
- **Pros:**
  - Zero cross-region latency for local/eventual operations (notifications, job views, drafts, analytics).
  - Strict linearizability (CP) preserved for financial records (escrows, ratings, disputes, payouts) via Authority Region Fencing Leases.
  - Conflict-free convergence via Positive-Negative (PN) Counter CRDTs and Add-Wins OR-Sets.
  - Transparent read-your-writes routing in the application database pool.
  - Guaranteed split-brain prevention via generation-token lease fencing.
- **Cons:** Requires explicit table categorization and conflict-handling code in the application layer.

**Decision:** We choose **Option C: Hybrid Active-Active PostgreSQL with Table Consistency Classification and Distributed Fencing Leases**.

---

## 3. Recovery Objectives (RPO and RTO Targets)

| Operation / Consistency Class                                            | RTO Target                                  | RPO Target              | Justification                                                                                                                                                                     |
| :----------------------------------------------------------------------- | :------------------------------------------ | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Class 1: Strict Financial (Escrows, Payouts, Disputes)**               | **<= 10 seconds** (auto-fence + DNS switch) | **0 seconds (RPO = 0)** | Escrowed funds, releases, and dispute evidence must never suffer data loss. Strictly serialized on the active lease authority with synchronous replication & fencing token check. |
| **Class 2: Causal Marketplace State (Jobs, Applications, Profiles)**     | **<= 5 seconds**                            | **<= 1 second**         | Asynchronous bidirectional replay; causal version vectors ensure deterministic conflict merge without silent loss.                                                                |
| **Class 3: Eventual Marketplace Data (Views, Notifications, Analytics)** | **<= 2 seconds**                            | **<= 5 seconds**        | Conflict-free CRDTs (PN-Counters) converge independently; non-critical state survives network partitions gracefully.                                                              |

---

## 4. Formal CAP Position

Under the CAP theorem (Consistency, Availability, Partition Tolerance):

When a network partition occurs between Region A (`primary-cluster`) and Region B (`secondary-cluster`):

```
                                  WAN Partition
                ┌─────────────────────────────────────────┐
                │                                         │
       [Region A: us-east-1]                     [Region B: eu-west-1]
   +------------------------------+          +------------------------------+
   | Fencing Lease Holder (Gen N) |          | Non-Lease Holder (Standby)   |
   |                              |          |                              |
   | - Class 1 (Financial): WRITABLE         | - Class 1 (Financial): FENCED |
   | - Class 2 (Causal):    WRITABLE         | - Class 2 (Causal):    BUFFER |
   | - Class 3 (Eventual):  LOCAL  |          | - Class 3 (Eventual):  LOCAL  |
   +------------------------------+          +------------------------------+
```

1. **Class 1 Tables (Financial & Security) — CP (Consistency + Partition Tolerance):**
   - The region holding the valid `region_fencing_leases` generation token continues to accept writes.
   - The partitioned/isolated region is immediately **fenced** (switched to read-only) upon lease heartbeat failure.
   - **Split-brain is mathematically impossible:** a node without an active fencing lease aborts all Class 1 writes.
   - **Zero silent Last-Write-Wins (LWW):** Any concurrent modification to financial records requires explicit lease authority; silent overwrites are forbidden.

2. **Class 2 Tables (Marketplace Entities) — Causal Consistency (Read-Your-Writes):**
   - Writes are tagged with node ULIDs and version vectors.
   - During partition, each region processes local updates; on partition resolution, version vectors detect concurrent modifications and execute deterministic state-machine reconciliation (no blind LWW).

3. **Class 3 Tables (Counters, Analytics, Notifications) — AP (Availability + Partition Tolerance):**
   - Both regions accept local writes concurrently.
   - Counters use Positive-Negative (PN) CRDTs where increments and decrements commute (`A + B = B + A`).
   - On partition heal, deltas merge cleanly without coordinate locks or lost updates.

---

## 5. Table Consistency Classification and Conflict Resolution Matrix

Every table in the Stellar MarketPay schema is classified into one of three consistency tiers:

| Table Name                   | Consistency Class | Conflict Resolution Strategy | Routing Target    | Silent LWW Allowed?                   |
| :--------------------------- | :---------------- | :--------------------------- | :---------------- | :------------------------------------ |
| `escrows`                    | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `referral_payouts`           | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `platform_fee_payouts`       | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `multi_level_payouts`        | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `insurance_claims`           | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `insurance_premiums_paid`    | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `sla_violations`             | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `ratings`                    | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `dispute_evidence`           | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `reputation_commitments`     | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `reputation_revocations`     | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `reputation_epochs`          | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `frozen_wallets`             | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `api_keys`                   | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `admin_profiles`             | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `webauthn_credentials`       | `STRICT_CP`       | `REJECT_UNLESS_LEASE_HOLDER` | Authority Region  | **NO (Hard Reject)**                  |
| `jobs`                       | `CAUSAL_RYW`      | `STATE_MACHINE_VALIDATED`    | Local / Authority | **NO (Validated Transition)**         |
| `applications`               | `CAUSAL_RYW`      | `STATE_MACHINE_VALIDATED`    | Local / Authority | **NO (Unique (job, freelancer))**     |
| `profiles`                   | `CAUSAL_RYW`      | `VERSION_VECTOR_MERGE`       | Local / Authority | **NO (Field-level merge)**            |
| `dao_proposals`              | `CAUSAL_RYW`      | `STATE_MACHINE_VALIDATED`    | Local / Authority | **NO (Validated Transition)**         |
| `dao_votes`                  | `CAUSAL_RYW`      | `APPEND_ONLY`                | Local / Authority | **NO (Unique (proposal, voter))**     |
| `private_messages`           | `CAUSAL_RYW`      | `APPEND_ONLY`                | Local / Authority | **NO (Unique nonce)**                 |
| `messages`                   | `CAUSAL_RYW`      | `APPEND_ONLY`                | Local / Authority | **NO (Monotonic ULID)**               |
| `referrals`                  | `CAUSAL_RYW`      | `APPEND_ONLY`                | Local / Authority | **NO (Unique referrer/referee)**      |
| `referral_tree`              | `CAUSAL_RYW`      | `STATE_MACHINE_VALIDATED`    | Local / Authority | **NO (Acyclic check)**                |
| `contract_events`            | `CAUSAL_RYW`      | `APPEND_ONLY`                | Local / Authority | **NO (Unique tx hash + event index)** |
| `skill_certificates`         | `CAUSAL_RYW`      | `APPEND_ONLY`                | Local / Authority | **NO (Unique cert hash)**             |
| `audit_logs`                 | `CAUSAL_RYW`      | `APPEND_ONLY`                | Local / Authority | **NO (Append-only)**                  |
| `plugins`                    | `CAUSAL_RYW`      | `VERSION_VECTOR_MERGE`       | Local / Authority | **NO (Version tagged)**               |
| `plugin_versions`            | `CAUSAL_RYW`      | `APPEND_ONLY`                | Local / Authority | **NO (Immutable versions)**           |
| `plugin_installations`       | `CAUSAL_RYW`      | `STATE_MACHINE_VALIDATED`    | Local / Authority | **NO (Validated state)**              |
| `assessment_skills`          | `CAUSAL_RYW`      | `VERSION_VECTOR_MERGE`       | Local / Authority | **NO**                                |
| `assessment_questions`       | `CAUSAL_RYW`      | `VERSION_VECTOR_MERGE`       | Local / Authority | **NO**                                |
| `crdt_pn_counters`           | `EVENTUAL_CRDT`   | `CRDT_PN_COUNTER`            | Any Region        | **NO (Commutative Delta Sum)**        |
| `job_views`                  | `EVENTUAL_CRDT`   | `APPEND_ONLY`                | Local Region      | Yes (Loss tolerant)                   |
| `notifications`              | `EVENTUAL_CRDT`   | `LWW_TIMESTAMP_TIEBREAK`     | Local Region      | Yes (Read-flag updates)               |
| `notification_preferences`   | `EVENTUAL_CRDT`   | `LWW_TIMESTAMP_TIEBREAK`     | Local Region      | Yes (User preference)                 |
| `job_drafts`                 | `EVENTUAL_CRDT`   | `LWW_TIMESTAMP_TIEBREAK`     | Local Region      | Yes (Draft content)                   |
| `saved_searches`             | `EVENTUAL_CRDT`   | `LWW_TIMESTAMP_TIEBREAK`     | Local Region      | Yes (Search queries)                  |
| `scope_sessions`             | `EVENTUAL_CRDT`   | `LWW_TIMESTAMP_TIEBREAK`     | Local Region      | Yes (Live session state)              |
| `ml_ranking_shadow_events`   | `EVENTUAL_CRDT`   | `APPEND_ONLY`                | Local Region      | Yes (Analytics)                       |
| `plugin_invocation_logs`     | `EVENTUAL_CRDT`   | `APPEND_ONLY`                | Local Region      | Yes (Telemetry)                       |
| `availability_check_history` | `EVENTUAL_CRDT`   | `APPEND_ONLY`                | Local Region      | Yes (Health telemetry)                |
| `oracle_proofs`              | `EVENTUAL_CRDT`   | `APPEND_ONLY`                | Local Region      | Yes (Oracle telemetry)                |
| `api_key_usage_daily`        | `EVENTUAL_CRDT`   | `CRDT_PN_COUNTER`            | Any Region        | **NO (CRDT Delta Sum)**               |

---

## 6. Conflict-Free Construction: ULIDs and CRDT Counters

### 6.1 Monotonic ULIDs (Universally Unique Lexicographically Sortable Identifiers)

To eliminate collision vulnerabilities of sequential integer IDs and database sequence coordination across regions, all new entity identifiers use 128-bit Monotonic ULIDs:

- 48-bit UNIX millisecond timestamp (lexicographically sortable).
- 10-bit Region & Node ID prefix.
- 70-bit cryptographic entropy with monotonic increment per millisecond.
- Encoded in 26 Crockford Base32 characters (`0-9, A-Z except I, L, O, U`).

### 6.2 Positive-Negative (PN) Counter CRDT

Read-modify-write patterns (`UPDATE profiles SET completed_jobs = completed_jobs + 1`) cause lost updates when executed concurrently in multiple regions.
We introduce a PN-Counter CRDT system backed by `crdt_pn_counters`:

- Each region maintains independent `positive_delta` and `negative_delta` rows per entity.
- The true counter value is computed as `SUM(positive_delta - negative_delta)`.
- Updates are purely commutative delta inserts/upserts:
  $$\text{Value}(e) = \sum_{r \in \text{Regions}, n \in \text{Nodes}} (P_{r,n} - N_{r,n})$$
- Zero coordination or cross-region locking required.

---

## 7. Distributed Fencing Leases and Automated Failover

To prevent split-brain during regional partitions:

1. **Fencing Lease Record (`region_fencing_leases`):**
   - Holds the current authority region, holder node, `generation_token` (monotonically increasing integer), and `expires_at` timestamp.
   - Heartbeat interval: **2 seconds**. Lease TTL: **6 seconds**.
2. **Autonomous Fencing on Lease Loss:**
   - If the active authority misses heartbeats or loses database quorum for > 6 seconds, the local fencing manager automatically switches the node to `FENCED_READ_ONLY` mode.
   - All incoming write queries to Class 1 tables are immediately rejected with `409 Conflict: Region Fenced`.
3. **Failover & Generation Promotion:**
   - A healthy secondary node claims the lease by incrementing the `generation_token` ($G_{new} = G_{old} + 1$).
   - Database connection router validates `assert_valid_fencing_lease(region, generation_token)` prior to committing Class 1 financial transactions.
4. **Connection Draining:**
   - During failover/switchover, the database pool drains in-flight write connections within a 5-second grace window, rolling back uncommitted non-fenced transactions cleanly.
5. **Deliberate Failback:**
   - Failback is never automatic. Operators verify replication replay lag is < 1s for at least 15 minutes before executing a controlled lease handover.

---

## 8. On-Chain Soroban Escrow Reconciliation

To guarantee that off-chain database state never drifts from on-chain truth after a regional failover:

1. The `ChainReconciliationService` continuously compares the on-chain Soroban contract storage (via Stellar Horizon / RPC) with off-chain `escrows` and `contract_events`.
2. Any discrepancy (e.g. escrow released on-chain during failover before DB replication caught up) is detected and healed deterministically:
   - On-chain status is the immutable authoritative root of truth for all fund movements.
   - Off-chain state transitions are caught up, milestone statuses updated, and audit logs recorded.
   - Double-payouts and duplicate release triggers are blocked by idempotency keys and on-chain contract state assertions.

---

## 9. Consequences

### Positive

- ✅ True multi-region active-active capability: reads and eventual writes served locally with low latency.
- ✅ Split-brain completely eliminated through generation-token lease fencing.
- ✅ Zero financial data loss (RPO = 0 for escrows, RTO <= 10s for failover).
- ✅ Conflict-free counters and sortable ULIDs eliminate lock contention and write collisions.
- ✅ Automated continuous replication lag monitoring and Prometheus alerting.
- ✅ On-chain Soroban reconciliation guarantees contract/DB convergence post-failover.

### Negative

- ❌ Slight increase in application-level connection pool complexity (`backend/src/db/pool.js` and `router.js`).
- ❌ Background heartbeat traffic between regions (~1KB every 2s).

---

## 10. References

- ADR-003: Database Schema for Escrow State Management
- ADR-008: Active-Passive Multi-Cluster Kubernetes Disaster Recovery (Superseded in part by this ADR)
- Issue #313: epic: multi-region active-active PostgreSQL with conflict resolution
