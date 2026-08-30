# PR Description — Indexer reliability hardening

## Summary

This PR hardens `backend/src/services/indexerService.js` so ledger ingestion is replayable, idempotent, reorg-aware, checkpointed durably, observable, and covered by deterministic tests.

## What changed

### Service rewrite

- rewrote `backend/src/services/indexerService.js`
- separated canonical event normalization from effect application
- added durable checkpoint loading/saving for contract-event and transaction streams
- added canonical raw-event ingestion with idempotent event identities
- added effect tracking so replay does not double-apply derived state changes
- added outbox-backed side-effect dispatch for broadcasts / CDN invalidation
- added replay APIs for full rebuild and ranged replay
- added deterministic reconciliation against on-chain escrow state
- added gap detection/fill and reorg detection / rollback / re-apply flow
- added backoff/reconnect handling and health reporting

### Schema / migrations

Added `V19__indexer_reliability` migration pair to support:

- `payment_records`
- `donor_stats`
- `indexer_ledger_batches`
- `indexer_reorg_journal`
- `indexer_raw_events`
- `indexer_applied_effects`
- `indexer_checkpoints`
- `indexer_ledger_lineage`
- `indexer_outbox`
- `indexer_reconciliation_runs`
- `indexer_reconciliation_findings`
- canonical/event identity columns on `contract_events`
- richer checkpoint fields on `indexer_state`

### Server wiring

- passed `metricsRegistry` into `IndexerService` from `backend/src/server.js`

### Tests

Added a new deterministic unit suite in `backend/src/services/indexerService.test.js` covering:

- replaying the same ledger range yields byte-identical derived state
- simulated reorg detection, rollback, and re-application
- crash mid-batch does not lose or double-apply events
- gap detection and backfill instead of silent skips
- production-safe replay suppresses side effects
- unsupported schema versions are retained and surfaced as findings
- reconciliation classifies divergence instead of silently correcting it

Updated `backend/src/services/indexerService.cdn.test.js` so CDN invalidation behavior remains covered with the new outbox-based flow.

## Why

Before this change, the indexer mixed transport, parsing, direct writes, and side effects with no dedicated test harness and no durable replay/reorg model. That made silent divergence possible if events were missed, duplicated, reorganized, or partially applied during a crash.

This PR moves the indexer closer to a replication pipeline from on-chain truth into Postgres with deterministic recovery behavior.

## Acceptance criteria mapping

- **Idempotent ingestion:** canonical event IDs + applied-effect tracking + replay tests
- **Reorg handling:** lineage tracking + rollback journal + simulated reorg test
- **Exactly-once effect semantics:** transactional batch apply + checkpoints + crash test
- **Gap detection/fill:** explicit gap detection with recovery fetch path + test
- **Schema versioning:** schema version capture + unsupported-version findings
- **Replay/backfill:** full rebuild / ranged replay entrypoints with side-effect suppression
- **Reconciliation:** deterministic comparison + divergence classification + finding persistence
- **Operations:** metrics for lag, throughput, errors, gaps, reorgs, divergence

## Files of interest

- `backend/src/services/indexerService.js`
- `backend/src/services/indexerService.test.js`
- `backend/src/services/indexerService.cdn.test.js`
- `backend/src/db/migrations/V19__indexer_reliability.up.sql`
- `backend/src/db/migrations/V19__indexer_reliability.down.sql`
- `backend/src/server.js`
- `docs/INDEXER_RELIABILITY_DESIGN_COMMENT.md`
- `docs/INDEXER_RELIABILITY_CLAIM_COMMENT.md`

## Validation run

Passed targeted validation:

- `npx jest src/services/indexerService.test.js src/services/indexerService.cdn.test.js --runInBand`
- `npx eslint src/services/indexerService.js src/services/indexerService.test.js src/services/indexerService.cdn.test.js src/server.js`

## Notes

Repo-wide pre-push checks still contain unrelated existing failures outside this PR's changeset:

- plugin sandbox tests currently run under a Node binary that does not support `--permission`
- DB-backed assessment integration tests fail with local test database authentication

Those were not introduced by this branch; the indexer-specific implementation and validation above are green.
