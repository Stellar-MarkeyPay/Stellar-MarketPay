# ADR-009: PostgreSQL Full-Text Search for Job & Freelancer Discovery

**Status:** Accepted
**Date:** 2026-08-22
**Author:** Stellar MarketPay Team
**Stakeholders:** Backend Team, Search/Discovery (issue #254)

## Context

Issue #254 is an epic to build full-text search and faceted discovery for
job listings (and later freelancer search): relevance ranking, typo
tolerance, stemming, synonyms, faceted filtering with live counts,
autocomplete, and search analytics — replacing the plain SQL filtering
currently in `jobService.js`'s `listJobs()`.

That "plain SQL filtering" already includes a partial full-text-search
layer. Migration `V11__query_optimization_indexes` (issue #340, merged
before this epic was opened) added a `job_search_vector tsvector` column,
a `BEFORE INSERT OR UPDATE` trigger (`update_job_search_vector()`) that
weights title (`'A'`) / description (`'B'`) / skills (`'C'`) via
`to_tsvector('simple', ...)`, a GIN index on that vector, and `pg_trgm`
trigram GIN indexes on lowercased `title`/`description` for fuzzy/substring
matching. `listJobs()` already queries
`job_search_vector @@ to_tsquery('simple', $n)` with a
`LOWER(title) LIKE` / `LOWER(description) LIKE` fallback.

So the "PostgreSQL FTS vs. dedicated engine" decision this ADR is asked to
record was, in effect, already made and partially implemented prior to
#254 being opened. This ADR formalizes that decision for the full scope of
#254 and records the trade-offs so a future maintainer scaling this out
doesn't have to rediscover them.

## Decision

Continue building the #254 epic on **PostgreSQL native full-text search**
(`tsvector`/`tsquery`, GIN indexes, `pg_trgm` for fuzzy matching) rather
than introducing a dedicated search engine (Elasticsearch, Typesense,
Meilisearch, Algolia, etc.), across all five suggested phases of the epic.

Phase 1 (this PR) extends the existing index rather than replacing it:

- `backend/src/db/migrations/V16__job_search_category_weighting.up.sql`
  adds `category` as a fourth weight tier (`'D'`) to
  `update_job_search_vector()`, so a search for a category name now
  matches via full-text search and not only via the separate
  `category = $n` equality filter.
- `backend/scripts/reindex-job-search-vector.js`
  (`pnpm --filter backend run reindex:job-search`) unconditionally
  recomputes `job_search_vector` for every row — the documented recovery
  path if the column ever drifts from the trigger's definition (e.g. a
  bulk import or restored backup that bypassed the trigger).

## Rationale

### Why PostgreSQL FTS over a dedicated search engine

- No new infrastructure: the app already depends on a single Postgres
  instance (`backend/src/db/pool.js`) for all its data; a dedicated search
  engine would be a second stateful service to provision, secure, back up,
  and keep available, for an app at this data volume.
- No dual-write / eventual-consistency problem: with an external index,
  every job write needs indexing kept in sync out-of-band (via CDC, an
  outbox, or worst-case a fire-and-forget indexing call after the DB
  write), and the epic explicitly requires the index to "stay
  synchronised with writes." Postgres's `BEFORE INSERT OR UPDATE` trigger
  keeps `job_search_vector` transactionally consistent with the row it's
  derived from — there is no window where a job exists but isn't
  searchable, or is searchable with stale data.
- The feature set the epic actually needs — weighted multi-field ranking,
  prefix search, typo tolerance (via `pg_trgm` `similarity()`), faceted
  counts (plain `GROUP BY` against the same filtered row set `listJobs()`
  already builds) — is reachable natively; nothing in #254's acceptance
  criteria requires an inverted-index feature Postgres lacks (it does not
  ask for cross-field semantic/vector search).
- The job write/query path already flows through raw `pg` (no ORM) in
  `jobService.js`; a dedicated engine would introduce a second query
  language and client library alongside SQL, not replace it, since
  transactional data still lives in Postgres either way.

### Why not a dedicated search engine

- **Elasticsearch/OpenSearch**: strongest ranking/analytics feature set,
  but the heaviest operational cost — a JVM cluster to run, monitor, and
  upgrade — for a marketplace whose entire dataset is a few SQL tables;
  not justified at current or reasonably-projected scale.
- **Typesense/Meilisearch (self-hosted)**: lighter than Elasticsearch and
  closer to this project's dependency footprint, but still a second
  service with its own persistence, backup, and failure mode, plus a sync
  pipeline to keep it current — solving a problem (index/DB drift) the
  Postgres trigger avoids by construction.
- **Algolia (hosted)**: removes the ops burden but adds a paid external
  dependency and a network hop into the request path for every job
  list/search, and puts a third party in the data path for what is
  otherwise a same-process Postgres query.
- All three would still require `jobService.js`'s existing SQL filters
  (budget, skills overlap, client rating, applicant count, visibility,
  keyset pagination) to run against Postgres regardless, since that data
  and logic isn't moving — so adopting one now would mean querying _two_
  systems and reconciling their results, not simplifying the query path.

### When to revisit this decision

Reconsider a dedicated engine if: (a) query latency at the p95 budget the
epic asks to measure (see acceptance criteria) can't be met by tuning
Postgres (better indexes, `pg_stat_statements`-guided query rewrites, read
replicas), (b) synonym/semantic matching needs grow beyond what `tsearch`
dictionaries and `pg_trgm` can express, or (c) job/freelancer volume grows
enough that GIN index maintenance cost becomes a write-path bottleneck.
None of these are true today.

## Consequences

### Positive

- ✅ Zero new infrastructure or deployment surface for #254's work.
- ✅ Search index cannot drift from source data on the normal write path —
  the trigger fires in the same transaction as the row write.
- ✅ Facets (Phase 3) can reuse `listJobs()`'s existing filter-building
  code as plain `GROUP BY` queries against the same table, rather than a
  separate facet API against a second system.
- ✅ A documented, tested recovery path (`pnpm --filter backend run reindex:job-search`)
  exists for the one case Postgres doesn't protect against automatically:
  writes that bypass the trigger.

### Negative

- ❌ Ranking quality (Phase 2) is bounded by what `tsearch` ranking
  functions (`ts_rank`, `ts_rank_cd`) and hand-blended business signals
  can express — no learned-relevance model without exporting data to
  something else.
- ❌ `to_tsvector('simple', ...)` (used throughout, including this
  migration) does no stemming — "developer" and "development" are
  distinct lexemes. Phase 4 ("Suggestions — autocomplete and typo
  tolerance") is where stemming/synonym handling should be added (e.g.
  switching to a language-specific `tsearch` config or a synonym
  dictionary); out of scope for this Phase 1 PR, which only adds the
  missing `category` weight to the existing `'simple'`-config vector.
- ❌ GIN index maintenance adds write-path cost on every job insert/update
  proportional to the indexed text size; acceptable at current volume,
  revisit per the "when to revisit" note above if write throughput
  becomes a concern.
- ❌ Full-text and faceted search both run on the same primary Postgres
  instance as transactional writes — no isolation between search load and
  transactional load. A read replica is the natural next step if that
  becomes contention, rather than a wholesale migration to a different
  engine.

## Implementation Details

- `backend/src/db/migrations/V11__query_optimization_indexes.up.sql` —
  pre-existing `job_search_vector`, trigger, GIN + trigram indexes (issue
  #340, prior to this epic).
- `backend/src/db/migrations/V16__job_search_category_weighting.up.sql` /
  `.down.sql` — this PR: adds `category` as weight `'D'`.
- `backend/scripts/reindex-job-search-vector.js` — this PR: documented
  reindex/recovery path (`pnpm --filter backend run reindex:job-search`).
- `backend/src/services/jobService.js` (`listJobs()`, search branch) —
  existing query against `job_search_vector`; unchanged by this PR.

## Related ADRs

None yet — this is the first ADR for the search/discovery epic (#254).
Phases 2–5 (ranking, facets, suggestions, operations) may warrant their
own ADRs as they introduce new decisions (e.g. a specific ranking formula,
a synonym dictionary source).

## References

- Issue #254 — "epic: build full-text search and faceted discovery"
- `V11__query_optimization_indexes` — issue #340 (pre-existing FTS
  foundation this ADR builds on)
