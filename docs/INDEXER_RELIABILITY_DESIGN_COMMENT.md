# Indexer reliability hardening — design comment

**Date:** August 26, 2026  
**Scope:** `backend/src/services/indexerService.js` and its derived-state sinks  
**Goal:** make ledger ingestion replayable, idempotent, reorg-safe, observable, and testable without leaving `main` unreleasable between slices.

---

## 1. Why this needs to change

The current `indexerService.js` mixes transport, parsing, side effects, checkpointing, and derived-state writes in one process-local class. It has only a narrow CDN wiring test and no deterministic ingestion harness.

That creates four correctness risks:

1. **Replay is not effect-idempotent.** Some writes use `ON CONFLICT DO NOTHING`, but the downstream updates and broadcasts are not modeled as effect records, so we cannot prove “replaying the same ledgers yields identical derived state”.
2. **Reorg handling is absent.** The service treats Horizon streams as append-only and never stores enough lineage to detect or roll back a replaced ledger range.
3. **Checkpointing is not durable at the effect level.** The singleton `indexer_state` row advances in the same transaction as some derived writes, but there is no batch identity, no per-event application record, and no crash-recovery protocol for “half-applied batch, checkpoint not advanced” vs “checkpoint advanced, effect replayed”.
4. **There are undocumented schema dependencies.** `indexerService.js` writes to `payment_records` and `donor_stats`, but those tables are not declared alongside the indexer-owned migration set. That mismatch is itself a finding and must be corrected before we can claim recovery safety.

This subsystem should be treated as a database replication pipeline from on-chain truth into Postgres, not as an incidental background task.

---

## 2. Current-state findings to carry into implementation

These are concrete discrepancies between the current implementation and what the subsystem needs:

- `indexer_state` stores only one cursor (`last_processed_ledger`), which is insufficient for:
  - transaction stream vs contract-event stream separation
  - gap detection
  - reorg rollback windows
  - crash-recovery batch semantics
- `processTransaction()` and `processEvent()` update derived tables directly, but do not record a durable **applied effect identity**.
- `startEventStream()` always starts from `"now"` instead of a durable cursor, which means downtime can lose events.
- stream error handling reconnects, but there is no bounded backoff policy, no persisted retry position, and no recovery scan for missed ledger ranges.
- there is no reconciliation job comparing `escrows` / `jobs` / `contract_events` against on-chain state.
- there is no test harness for:
  - replaying a fixed ledger range
  - simulating a reorg
  - simulating a crash after partial effects
  - simulating gaps
  - schema-version upgrades

---

## 3. Proposed architecture

Split the subsystem into explicit stages:

```text
ledger source
  └── fetch range / stream
        └── normalize external records into canonical indexer events
              └── persist raw intake batch
                    └── apply canonical effects inside one DB transaction
                          └── advance durable checkpoint
                                └── emit non-durable side effects from recorded effect log
```

### 3.1 Components

1. **Source adapters**
   - `transaction_source`
   - `contract_event_source`
   - later: direct RPC source if Horizon lacks fields we need

2. **Normalizer**
   - converts Horizon/RPC payloads into a canonical event envelope:
     - `source`
     - `ledger_sequence`
     - `ledger_hash`
     - `tx_hash`
     - `op_id` or `event_id`
     - `contract_id`
     - `schema_version`
     - `event_type`
     - `job_id`
     - `payload`

3. **Raw intake store**
   - append-only record of what was seen from the chain
   - used for deterministic replay, crash recovery, and reorg rollback

4. **Effect applier**
   - pure-ish handler from canonical event → derived state changes
   - writes only through idempotent upserts keyed by canonical event identity

5. **Checkpoint manager**
   - advances only after the batch’s raw events and applied effects are committed

6. **Reconciliation worker**
   - independently compares on-chain escrow state to derived DB state
   - never mutates silently

7. **Side-effect dispatcher**
   - broadcasts, notifications, and CDN invalidation read from an effect log
   - replay can disable or suppress side-effect dispatch while still rebuilding state

### 3.2 Single-writer model

I recommend **single-writer ingestion with horizontal read/reconcile workers**.

Reason:

- reorg rollback plus exact-once effect application is materially simpler with one writer
- the acceptance criteria require deterministic replay and no double-application
- scaling the writer can come later only if ledger throughput proves insufficient

Implementation:

- use a PostgreSQL advisory lock for the active ingester
- additional replicas may run reconciliation and read-only lag reporting

If later benchmarking shows the single writer is the bottleneck, we can shard by ledger range during replay, but live ingestion should remain single-writer for this subsystem phase.

---

## 4. Data model changes

The current singleton `indexer_state` row is not enough. I propose adding indexer-owned tables with a clear separation of concerns.

### 4.1 Raw intake

`indexer_ledger_batches`

- `batch_id` UUID PK
- `source` TEXT
- `from_ledger` BIGINT
- `to_ledger` BIGINT
- `batch_kind` TEXT (`live`, `replay`, `reconcile_repair_scan`)
- `started_at`, `committed_at`
- `status` TEXT (`pending`, `applied`, `rolled_back`, `failed`)
- `replay_run_id` UUID nullable

`indexer_raw_events`

- `event_uid` TEXT PK  
  Canonical identity, e.g. `contract:{ledger}:{tx_hash}:{event_index}` or `payment:{ledger}:{op_id}`
- `batch_id` UUID FK
- `ledger_sequence` BIGINT
- `ledger_hash` TEXT
- `parent_ledger_hash` TEXT nullable
- `source` TEXT
- `tx_hash` TEXT nullable
- `event_kind` TEXT
- `schema_version` INTEGER
- `job_id` UUID/TEXT nullable
- `payload` JSONB
- `seen_at` TIMESTAMPTZ

### 4.2 Effect tracking

`indexer_applied_effects`

- `effect_uid` TEXT PK  
  Usually one effect per canonical event, but allows expansion if one event fans out
- `event_uid` TEXT FK
- `effect_type` TEXT
- `target_table` TEXT
- `target_key` TEXT
- `replay_safe` BOOLEAN NOT NULL DEFAULT true
- `applied_at` TIMESTAMPTZ

This table is the proof point for “exactly-once at the effect level”.

### 4.3 Checkpointing and lineage

Replace the singleton model with richer checkpoint state:

`indexer_checkpoints`

- `stream_name` TEXT PK (`transactions`, `contract_events`, `derived_state`)
- `last_ledger_sequence` BIGINT
- `last_ledger_hash` TEXT
- `last_event_uid` TEXT nullable
- `updated_at` TIMESTAMPTZ

`indexer_ledger_lineage`

- `ledger_sequence` BIGINT PK
- `ledger_hash` TEXT
- `parent_ledger_hash` TEXT
- `closed_at` TIMESTAMPTZ
- `observed_at` TIMESTAMPTZ

This is what enables reorg detection: if the same `ledger_sequence` reappears with a different hash, or a new ledger’s `parent_ledger_hash` no longer matches our stored tip, we have a fork.

### 4.4 Reorg journal

`indexer_reorg_journal`

- `reorg_id` UUID PK
- `detected_at`
- `old_tip_ledger`
- `new_tip_ledger`
- `rollback_from_ledger`
- `rollback_to_ledger`
- `status` (`detected`, `rolled_back`, `reapplied`, `failed`)
- `details` JSONB

### 4.5 Reconciliation

`indexer_reconciliation_runs`

- `run_id` UUID PK
- `mode` (`continuous`, `full`, `range`)
- `started_at`, `finished_at`
- `from_ledger`, `to_ledger`
- `status`
- `summary` JSONB

`indexer_reconciliation_findings`

- `finding_id` UUID PK
- `run_id` UUID FK
- `divergence_class` TEXT
- `job_id` UUID/TEXT nullable
- `ledger_sequence` BIGINT nullable
- `expected` JSONB
- `actual` JSONB
- `diagnostics` JSONB
- `created_at`

### 4.6 Existing table changes

Minimal additions to existing derived tables:

- `contract_events`
  - add canonical event identity columns if we keep the table as a public-facing projection
  - optionally convert it into a projection over `indexer_raw_events`
- `escrows`, `jobs`, and any downstream sink touched by the indexer
  - add `last_indexed_event_uid` nullable for debugging lineage
- **Document and migrate** `payment_records` and `donor_stats`
  - these are currently used by the service but not defined in the inspected indexer migration set
  - either formalize them in migrations or remove that responsibility from this service

---

## 5. Ingestion semantics

### 5.1 Canonical event identity

Every event must have a deterministic identity derived from chain facts, not local timing. That identity is the primary idempotency key for replay.

Examples:

- Soroban event: `soroban:{ledger}:{tx_hash}:{event_index}`
- payment op: `payment:{ledger}:{operation_id}`

### 5.2 Batch transaction boundaries

For a ledger batch:

1. insert `indexer_ledger_batches` row as `pending`
2. insert all `indexer_raw_events`
3. apply derived writes guarded by `indexer_applied_effects`
4. update checkpoints and lineage
5. mark batch `applied`
6. commit

If the process crashes before commit, none of the above is visible. If it crashes after commit but before side-effect dispatch, replay sees the effects already recorded and does not reapply them.

### 5.3 Side effects

Broadcasts, notifications, and CDN invalidation must be moved behind a durable outbox-style table or log view sourced from `indexer_applied_effects`.

Replay modes:

- `production-safe replay`: rebuild derived state, do **not** redispatch notifications/broadcasts
- `full local replay`: optional side effects disabled by default

---

## 6. Reorg handling

### 6.1 Detection

Detect reorg when either condition holds:

1. the stored tip ledger hash for `N` does not match the newly observed hash for `N`
2. the new ledger `N+1` has a `parent_ledger_hash` that does not match stored ledger `N`

### 6.2 Rollback model

Rollback must be **effect-driven**, not “best guess SQL”.

For each canonical event in the replaced ledger suffix:

- locate its `indexer_applied_effects`
- reverse the effect or rebuild affected derived rows from surviving raw events

Preferred approach:

- for simple projections (`escrows`, `jobs`, analytics counters), rebuild affected entities from raw canonical events for the rollback window rather than trying to hand-write inverse SQL for every case

Concretely:

1. identify common ancestor ledger
2. mark descendant batches/events as superseded
3. truncate/rebuild affected projections for impacted job IDs and aggregate buckets
4. ingest canonical events from the new branch

This is slower than “UPDATE status back”, but materially safer and easier to reason about.

### 6.3 Test requirement

The reorg harness must simulate:

- original branch ledgers `L..N`
- a competing branch replacing `N-k..N`
- detection
- rollback
- re-application
- final derived state matching the replacement branch only

---

## 7. Replay and backfill

We need three supported modes:

1. **Full replay from genesis**
   - rebuild projections from scratch
   - can target a shadow schema or production tables

2. **Range replay**
   - replay `[from_ledger, to_ledger]`
   - used after bug fixes and for partial recovery

3. **Entity-targeted rebuild**
   - rebuild affected `job_id`s from canonical events
   - mainly for reorg rollback and reconciliation diagnostics

### Replay safety

Replay against production must:

- suppress non-durable side effects
- still record metrics and audit trail that a replay occurred
- refuse to run concurrently with live writer unless explicitly in shadow mode

### Replay performance

For each replay run we should record:

- ledgers/sec
- events/sec
- rows touched/sec
- total wall-clock time

Phase 4 should ship at least one benchmark fixture and a documented “rebuild X ledgers on laptop / CI runner” figure.

---

## 8. Reconciliation

Reconciliation should be deterministic and external-audit-friendly.

### 8.1 Comparison targets

At minimum compare:

- escrow status
- escrow amount / milestone release totals
- release/refund timestamps when derivable
- contract event count per job
- checkpoint continuity

### 8.2 Divergence classes

Initial classes:

- `missing_raw_event`
- `duplicate_raw_event`
- `projection_missing_row`
- `projection_wrong_status`
- `projection_wrong_amount`
- `gap_detected`
- `reorg_not_applied`
- `unknown_schema_version`
- `onchain_lookup_failed`

### 8.3 Operating rule

Reconciliation **never silently fixes production state**.

It should:

- emit a metric
- persist a finding row
- page/alert when thresholds are crossed
- link to a documented remediation runbook

---

## 9. Metrics and operations

Expose:

- ingestion lag in ledgers
- ingestion lag in seconds
- events/sec
- ledgers/sec
- batch apply duration
- backoff / retry count
- reorg count
- gap count
- reconciliation divergence count by class
- oldest unresolved divergence age

Backoff policy:

- exponential with jitter for Horizon/RPC unavailability
- checkpoint never advances on fetch failure
- recovery scan after reconnect fills missed ranges instead of trusting the stream cursor blindly

---

## 10. Test strategy

Phase 1 must start with a deterministic fixture harness before production code changes spread further.

### 10.1 Harness layers

1. **pure canonical fixtures**
   - ledgers
   - events
   - branch/reorg shapes

2. **fake source adapter**
   - returns canonicalized range responses deterministically

3. **DB-backed integration harness**
   - migrates a fresh Postgres schema
   - runs the indexer batch applier
   - snapshots derived tables for byte-identical replay assertions

### 10.2 Required tests by acceptance criterion

- replaying a range twice yields byte-identical projection state
- crash after raw intake but before checkpoint commit yields no double-apply
- crash after commit but before side-effect dispatch yields no double-apply and no refired notification in replay mode
- simulated gap triggers range fill before checkpoint advance
- simulated reorg rolls back and reapplies correctly
- unknown schema version is classified and surfaced, not silently skipped

---

## 11. Migration plan

This should land as **independently mergeable slices**, each leaving `main` releasable.

### PR 1 — design + deterministic test harness

- add this design comment
- add canonical fixture format
- add initial `indexerService` test file(s)
- no behavior change yet except test-only seams

### PR 2 — data model foundations

- add new indexer-owned tables:
  - `indexer_ledger_batches`
  - `indexer_raw_events`
  - `indexer_applied_effects`
  - `indexer_checkpoints`
  - `indexer_ledger_lineage`
- formalize missing sink tables or remove undocumented writes
- dual-write compatibility kept behind feature flags if needed

### PR 3 — idempotent batch applier + durable checkpoints

- move live ingestion to batch transaction model
- prove replay identity
- add gap detection/fill logic

### PR 4 — reorg handling

- ledger lineage persistence
- simulated reorg tests
- rollback/reapply pipeline

### PR 5 — replay tooling

- full replay CLI/service entrypoint
- ranged replay
- side-effect suppression
- benchmark output

### PR 6 — reconciliation + alerting

- reconciliation tables
- metrics
- remediation docs/runbook

### Compatibility/migration notes

- the old `indexer_state` row can be left in place during transition, then read-through-compatible with `indexer_checkpoints`
- no destructive migration should happen before the new path is proven in tests
- if risk is high, run old and new ingestion in shadow mode against separate projection tables first

---

## 12. Open questions before PR 2

1. Should `contract_events` remain a public projection table, or become a view/materialized projection over canonical raw events?
2. Are `payment_records` and `donor_stats` truly owned by this subsystem, or should donation/payment ingestion be split into a separate projection worker?
3. Do we want replay into shadow tables first, with a cutover step, or direct rebuild into live tables under writer lock?
4. Is Horizon alone sufficient for ledger hash / parent hash lineage, or do we need Soroban RPC for reliable fork metadata?

---

## 13. Immediate next step

Implement **PR 1 only**:

- add the deterministic ledger fixture harness
- add the first real `indexerService` tests for replay idempotence, gap detection shape, and reorg simulation shape
- make only the minimal seams needed for testing

That keeps the first slice reviewable and leaves `main` releasable while setting up the much larger correctness work.
