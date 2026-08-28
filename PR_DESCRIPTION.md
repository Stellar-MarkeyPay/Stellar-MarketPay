## Summary

This PR adds the compliance core needed for regulated value movement: tiered
identity verification, SEP-12 interoperability, sanctions/PEP screening,
transaction monitoring, explainable risk scoring, human case management, Travel
Rule exchange, effective-dated jurisdiction policy, regulatory reporting, and a
tamper-evident audit trail.

The implementation was designed before coding in
`docs/COMPLIANCE_DESIGN_COMMENT.md` and is split into independently reviewable
foundation, identity/screening, and monitoring/API commits.

## What was fixed

### Identity verification and privacy

- Added individual and corporate verification subjects with centrally checked
  state transitions and three configurable KYC tiers.
- Tier now gates rolling transaction limits instead of disabling unrelated
  platform access.
- Added provider-backed document, liveness, expiry, and re-verification flows.
- Added corporate directors and beneficial owners with their own screening
  status.
- Added SEP-12 `info` and `customer` endpoints backed by the same encrypted
  subject record, avoiding a second identity store.
- Added AES-256-GCM context-bound envelopes, key IDs for rotation, HMAC blind
  indexes, evidence hashes, data minimisation, retention rules, legal holds, and
  provider/local deletion workflows.

### Screening, monitoring, and risk

- Added sanctions, PEP, and adverse-media screening on onboarding, before
  transfers, and on a scheduled re-screening cycle.
- Added configurable structuring, velocity, new-counterparty concentration, and
  counterparty fan-out rules.
- Added explainable 0-100 risk assessments combining identity, behaviour,
  screening, on-chain exposure, and geography. Every score stores component
  values, reason codes, evidence hash, model version, and policy version.
- Added idempotent transfer evaluations with observe and enforcement modes.
- Mounted the existing fraud route, which was previously present but not
  reachable from the application server.

### Human case management

- Added alert-to-case creation and a central case state machine:
  `open -> triaged -> investigating -> decided -> closed`, with a controlled
  escalation loop.
- Automated rules may open alerts and hold the affected transfer, but they do
  not create a human disposition.
- Added analyst attribution, mandatory reasons, evidence links, disposition,
  and before/after state audit events for every triage decision.

### Travel Rule

- Added policy-controlled thresholds and required originator/beneficiary fields.
- Added institution discovery, protocol delivery, idempotency, receipt hashes,
  bounded retry/backoff, and manual-review handling for unreachable peers.
- Added a distinct self-hosted-wallet flow using signed challenge,
  microtransaction, or wallet-connection control evidence.
- Sensitive exchange payloads are encrypted; audit records retain references
  and hashes rather than plaintext identity data.

### Jurisdiction, geo, reporting, and audit

- Added versioned, effective-dated jurisdiction policies stored in PostgreSQL
  and refreshed through a short cache, so rule changes do not require a deploy.
- Added schema validation, monotonic tier validation, weight/threshold checks,
  immutable checksums, and four-eyes publication.
- Added geo decisions using coarse, trusted edge signals plus KYC/declared
  country. Client-supplied forwarding headers are ignored unless trusted-edge
  mode is explicitly enabled, and raw IP addresses are not stored.
- Added deterministic SAR JSON/XML generation, encrypted report storage,
  integrity hashes, filing references, and manual or provider submission.
- Added append-only, per-subject hash chains containing actor, action, object,
  correlation ID, policy version, reason, decision, and evidence hash. Database
  sequencing and transaction/advisory locks preserve a valid chain under
  concurrent writers.

### Database migration and operations

- Added additive migration `V21__compliance_core` with 15 normalized tables and
  an observe-only default policy.
- Fixed the migration journal to key migrations by `(version, name)`. The old
  version-only primary key silently skipped same-number migrations already
  present in this repository.
- Added exact named rollback and an automatic upgrade path for existing
  migration journals.
- Added provider configuration, encryption/key-rotation guidance, retention and
  deletion procedures, policy promotion, scheduler operations, migration, and
  rollback in `docs/COMPLIANCE_OPERATIONS.md`.
- The V21 down migration is appropriate only during the empty observation
  window. After decisions exist, rollback switches policy to observe mode,
  stops workers, preserves audit-bearing tables, and rolls the application back
  while a forward fix is prepared.

### CI integration fixes

- Synced the branch with the latest upstream `main` before final validation.
- Corrected the new escrow-reconciliation test's module paths so Jest resolves
  the database, contract client, metric, and logger from `src/__tests__`.
- Made `frontend/lib/i18n.d.ts` an actual external module matching the runtime
  default and named exports, restoring TypeScript validation for relative and
  alias imports.
- Explicitly enabled locale grouping for XLM display so Node 24 ICU formats
  Spanish four-digit values consistently with the application's tests.
- Normalized the upstream reconciliation, locale, URL-filter, server, and PR
  files with the repository's Prettier configuration.

## API surface

- Native compliance APIs under `/api/compliance` for identity sessions, tier
  limits, transfers, Travel Rule evidence/status, audit history, cases, policy,
  screening, reports, and worker execution.
- SEP-12 APIs under `/api/sep12`.
- JWT ownership checks protect subject endpoints and administrator middleware
  protects case, policy, reporting, screening, and worker actions.
- OpenAPI generation now reports 257 documented paths and 286 HTTP methods with
  no undocumented application routes.

## Type of change

- [x] New feature
- [x] Bug fix
- [x] Database migration
- [x] Backend/API
- [x] Documentation

## Related issue

Closes #<!-- add issue number -->

## Compatibility and rollout

- V21 is additive; existing profiles and money-movement APIs remain available.
- A legacy `profiles.is_kyc_verified` value is retained only as an evidence
  marker during lazy subject creation. It does not invent a v2 tier or copy
  plaintext data.
- The seeded policy is observe-only, so the first deployment records outcomes
  without introducing new transfer holds.
- Promote a separately reviewed, effective-dated enforcement policy only after
  observation results and provider credentials have been verified.
- Production must configure encryption, blind-index, provider, and webhook keys
  documented in `backend/.env.example` and the operations runbook.

## Validation

Validation completed locally against the latest upstream `main` on August 28,
2026:

- `npm run format:check`
- `npm run lint`
- `npm run type-check`
- `cd backend && npm run build`
  - 257 unique API paths
  - 286 HTTP methods
  - all routes documented
- `cd backend && npm test`
  - 62 suites passed
  - 560 tests passed
- Complete frontend CI sequence:
  - unit: 10 suites / 87 tests / 36 snapshots passed
  - accessibility: 5 tests passed
  - production build and Storybook build passed
  - Playwright E2E: 8 passed / 1 skipped
  - visual regression: 3 passed
- The PR's Soroban contract CI job passed after the upstream merge.
- PostgreSQL `migrate -> rollback V21 -> migrate` verified against a real local
  database.
- Manual database-backed scenarios verified:
  - individual tiering, expiry decision, limit gating, and onboarding screening
  - corporate verification and beneficial-owner screening
  - hot jurisdiction-policy publication without restart/deploy
  - observed transfer and self-hosted Travel Rule completion
  - alert triage through human decision and SAR filing
  - eight concurrent audit appends with a valid ordered hash chain
  - bounded worker cycle with no due work

## Reviewer guide

1. Review `docs/COMPLIANCE_DESIGN_COMMENT.md` for boundaries, state machines,
   storage, migration, and phased rollout.
2. Review V21 and the migration journal fix.
3. Review crypto, policy, state machine, and audit primitives.
4. Review identity/SEP-12 and continuous screening.
5. Review transfer monitoring, risk, cases, Travel Rule, reporting, routes, and
   the operational runbook.

## Screenshots

Not applicable; this PR is a backend compliance subsystem.
