Claiming the indexer reliability hardening task.

I’ve posted the design comment in `docs/INDEXER_RELIABILITY_DESIGN_COMMENT.md` covering:

- proposed architecture
- data model changes
- reorg, replay, and reconciliation strategy
- migration plan
- independently mergeable PR slices

Planned landing order:

1. deterministic test harness + design slice
2. indexer-owned schema foundations
3. idempotent ingestion + durable checkpoints + gap detection
4. reorg detection / rollback / reapply
5. replay + backfill tooling
6. reconciliation + alerting + remediation docs

I’ll keep each PR mergeable and leave `main` releasable between slices.
