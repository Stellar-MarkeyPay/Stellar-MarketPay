# Compliance core — architecture, data model, and migration design comment

I am claiming this work. This design comment is committed before implementation
so the subsystem can be reviewed and landed as independently releasable changes.

## Goals and boundaries

The compliance core makes identity assurance, screening, monitoring, Travel
Rule exchange, jurisdiction policy, reporting, and human review explicit
platform capabilities. It does not silently decide guilt or permanently block
an account from a provider response. Automated controls can restrict a specific
transaction, lower a limit, or open a case; a recorded human decision resolves
the case.

The initial implementation is provider-neutral. Production vendors are bound
through narrow adapters, while deterministic adapters support local development
and contract tests. No vendor response is trusted as an authorization decision:
the platform normalizes it, evaluates versioned policy, records the evidence,
and writes an immutable decision event.

## Architecture

`routes/compliance.js` is the authenticated HTTP facade. SEP-12 has its own
standards-compatible facade in `routes/sep12.js`. Business decisions live in
services rather than route handlers:

- `compliance/identityService.js`: individual/corporate verification sessions,
  tier calculation, document/liveness requirements, expiry, re-verification,
  transaction-limit checks, retention, and deletion.
- `compliance/providers.js`: KYC, screening, on-chain analysis, and Travel Rule
  protocol interfaces. Provider references and normalized results are retained;
  raw identity documents remain at the KYC provider.
- `compliance/cryptoVault.js`: authenticated envelope encryption for the small
  amount of personal data that must be retained. Ciphertext includes a key ID;
  keys come from deployment secrets/KMS and are never stored in PostgreSQL.
- `compliance/screeningService.js`: onboarding screening, scheduled re-screening,
  provider-result normalization, material-change detection, and alert creation.
- `compliance/monitoringService.js`: configurable structuring, velocity, and
  unusual-counterparty rules evaluated against normalized transfer facts.
- `compliance/riskService.js`: an explainable 0–100 score combining identity,
  screening, behavior, geography, and on-chain counterparty signals.
- `compliance/caseService.js`: analyst queue, assignment, evidence, notes, and a
  state machine requiring a human disposition for generated alerts.
- `compliance/travelRuleService.js`: threshold decision, originator/beneficiary
  payload exchange, counterparty-institution discovery, self-hosted-wallet
  evidence, retries, receipts, and audit history.
- `compliance/jurisdictionService.js`: effective-dated, versioned rule bundles
  loaded from the database and refreshed without a deployment.
- `compliance/reportingService.js`: suspicious-activity report drafts and
  jurisdiction-specific renderer adapters. Filing remains an explicit analyst
  action and every exported version is retained by content hash.
- `compliance/auditService.js`: append-only decision trail with actor, policy
  version, input/evidence hashes, prior/new state, reason code, correlation ID,
  and a per-subject hash chain.
- `compliance/worker.js`: lease-protected batches for continuous re-screening,
  verification expiry, retention deletion, Travel Rule retries, and monitoring
  replay. The same handlers are callable directly by a scheduler in production.

The existing `routes/verification.js` email/phone APIs remain available during
migration. New KYC APIs are additive and do not overload email verification.
`routes/fraud.js` remains the bid-fraud facade; transaction monitoring consumes
shared normalized signals without changing existing bid-analysis behavior.

## State models

### Identity

```text
unverified -> pending -> verified -> expired
                   |         |          |
                   v         v          v
                needs_input  rejected   pending (re-verification)
```

Tier is separate from state and monotonically follows satisfied evidence:

| Tier | Typical evidence                                         | Capability                      |
| ---: | -------------------------------------------------------- | ------------------------------- |
|    0 | account possession                                       | browse and prepare transactions |
|    1 | verified contact + basic identity                        | low transaction limits          |
|    2 | government ID + liveness + screening                     | standard limits                 |
|    3 | enhanced due diligence or corporate beneficial ownership | high limits                     |

The limit decision returns `allowed`, `remaining`, `requiredTier`, and policy
version. A low tier restricts the requested movement of value; it does not
disable unrelated access.

Corporate subjects use the same outer lifecycle but have distinct evidence:
registration, operating address, directors, beneficial owners, ownership
percentages, and authority-to-act. Every beneficial owner is independently
screened and linked to the corporate verification.

### Cases

```text
open -> triaged -> investigating -> decided -> closed
                                  \-> escalated
```

Automation may create/open a case and recommend a control. Only an authenticated
analyst can record `cleared`, `monitor`, `restrict`, `reject`, or `file_report`.
Every transition requires a reason code and is appended to the audit trail.

### Travel Rule

```text
not_required | pending -> sent -> acknowledged
                        \-> failed -> pending
                        \-> self_hosted_verified
```

The policy at transaction time determines the threshold and required fields.
Self-hosted wallets do not receive institution-to-institution messages; the
record instead captures wallet-control evidence and the policy decision that
accepted or rejected it.

## Data minimisation and encryption

PostgreSQL stores subject identifiers, workflow state, country codes, dates,
provider/customer references, last-four/masked display values, normalized
screening results, policy versions, and hashes needed for audit. It does not
store raw document images, selfies, or full provider payloads.

The narrow retained PII envelope contains only fields required for SEP-12 and
Travel Rule exchange. Encryption is AES-256-GCM with a fresh nonce per write,
authenticated context binding the ciphertext to subject, record type, and
schema version. Searchable identifiers use a keyed HMAC blind index rather than
deterministic ciphertext.

Default retention policy:

- incomplete verification sessions: 30 days after last activity;
- provider document references: provider-controlled, deleted after completion
  unless jurisdiction policy requires longer retention;
- verification and transaction compliance records: 5 years after account
  closure or transaction, overridable by effective jurisdiction policy;
- cases/reports/audit metadata: policy-defined legal retention, with a hold flag
  that prevents deletion while an investigation or filing obligation exists.

Deletion is a workflow, not a direct cascade. A request is recorded, legal holds
and required retention are evaluated, provider deletion is requested, local PII
is cryptographically erased/redacted, and a non-PII tombstone plus evidence hash
is appended to the audit trail.

## Storage model

The additive migration creates:

- `compliance_subjects`: individual/corporate identity, tier, status, country,
  expiry, provider references, encrypted PII envelope, retention dates.
- `compliance_verification_sessions`: requirements, provider session/status,
  liveness/document state, expiry, and normalized provider decisions.
- `compliance_corporate_parties`: directors and beneficial owners linked by
  role and ownership percentage; PII is encrypted independently.
- `compliance_screenings` and `compliance_screening_matches`: screening runs,
  list versions, match scores, normalized categories, disposition, and next run.
- `compliance_transactions`: idempotent normalized transfer facts used by
  monitoring, limits, Travel Rule, risk, and reporting.
- `compliance_alerts`, `compliance_cases`, and `compliance_case_events`: immutable
  rule hits and the human-review workflow.
- `compliance_risk_assessments`: component scores, reasons, evidence hashes,
  final score/band, and model/policy version.
- `travel_rule_exchanges`: threshold result, encrypted payload, protocol
  reference, self-hosted evidence, status, attempts, and receipt hashes.
- `jurisdiction_rule_sets`: effective-dated JSON rule configuration, version,
  schema version, checksum, publication state, and author/reviewer.
- `compliance_reports`: report type, jurisdiction, case, encrypted report body,
  renderer version, status, filing reference, and content hash.
- `compliance_audit_events`: append-only actor/action/subject/object records,
  policy and evidence hashes, correlation ID, timestamps, and hash-chain links.
- `compliance_deletion_requests`: request, retention/hold decision, provider and
  local deletion progress, completion, and tombstone hash.

Foreign keys use restrictive deletion for audit-bearing records. Idempotency
keys are unique per event type. Indexes cover screening due dates, open alert
queues, case status/assignee, transaction subject/time, Travel Rule retry time,
and rule-set jurisdiction/effective date.

## Jurisdiction rules and geo controls

Rules are versioned JSON validated against a strict schema before publication.
A published bundle includes tier limits, prohibited/allowed territories,
screening cadence, verification evidence, Travel Rule thresholds/fields,
retention, monitoring thresholds, report types, and geo confidence policy.
Activation is effective-dated and atomic; services record the exact version used
for every decision. Cache invalidation occurs on publication, so changes take
effect without a code deployment.

Geo enforcement combines declared residence, KYC country, IP-derived country,
provider risk signals, and request confidence. Raw IP is discarded after a
salted/HMAC audit token and coarse country are derived. Conflicts or uncertain
VPN/proxy signals produce a review control rather than pretending precision.
The decision record stores method version, signals, confidence, policy rule,
and outcome, making the method explainable and reproducible.

## Monitoring and risk

Normalized transactions are evaluated idempotently. Initial configurable rules:

- structuring: repeated sub-threshold transfers whose rolling sum exceeds the
  configured threshold;
- velocity: count or amount exceeds a window limit;
- unusual counterparties: new-counterparty concentration or fan-in/fan-out
  exceeds subject baseline;
- on-chain exposure: provider-normalized sanctions, mixer, stolen-funds, or
  high-risk-service proximity.

Rules emit explainable evidence and a score contribution. The risk service uses
configured weights and caps, never opaque arithmetic embedded in routes. A high
score opens a case and may place a transaction-specific hold. It is not silently
converted into a permanent account action.

## SEP-12 and provider portability

The SEP-12 facade exposes customer information requirements and customer status
using the same compliance subject/session records as native KYC. Anchor-specific
field aliases map to canonical fields; the encrypted canonical record is reused
only with subject authorization and purpose logging. Provider webhooks are
signature-verified and idempotent. Return values expose required fields and
status, not stored secrets.

## Migration and rollout

Migration is additive and has no destructive rewrite:

1. Create the compliance tables, indexes, constraints, and a disabled default
   rule bundle.
2. Deploy services/routes with transaction controls in observe-only mode.
3. Lazily create `compliance_subjects` from authenticated profile public keys.
   Existing `profiles.is_kyc_verified = true` becomes a legacy evidence marker,
   not an invented tier or copied PII; re-verification policy decides the tier.
4. Backfill transaction references in bounded, restartable batches identified by
   idempotency keys. No raw historical IP or identity data is synthesized.
5. Enable onboarding screening, then scheduled re-screening, monitoring, Travel
   Rule controls, and jurisdiction enforcement one independently reversible
   stage at a time.

The database rollback removes only empty/new compliance structures during the
observation window. After compliance decisions exist, rollback is operational:
disable enforcement through the active rule set, preserve audit records, and
deploy a forward fix. Audit-bearing data is never dropped to make a code rollback
look successful.

## Merge sequence

1. **Design and schema** — this comment, additive migration, encryption/audit
   primitives, and disabled default configuration.
2. **Identity** — provider adapter, tiered KYC, SEP-12, corporate parties,
   expiry/re-verification, retention, and deletion workflow.
3. **Screening** — onboarding and continuous sanctions/PEP screening with
   material-change cases.
4. **Monitoring** — normalized transactions, configurable rules, explainable
   risk scoring, alerts, and analyst cases.
5. **Travel Rule** — threshold exchange, institution discovery, retries,
   receipts, and self-hosted-wallet evidence.
6. **Jurisdiction/reporting** — live rule publication, geo decisions, report
   renderers, end-to-end audit, and staged enforcement.

Each step keeps existing routes working, has a down migration for observation-
window rollback, and leaves `main` releasable.

## Verification plan

- Unit tests for encryption context binding, policy schema/version selection,
  tier limits, lifecycle transitions, risk component bounds, and report output.
- Provider contract tests for webhook signatures, retries, idempotency, and
  normalized failures.
- Integration tests for individual/corporate KYC, SEP-12 reuse, onboarding and
  scheduled re-screening, monitoring-to-case-to-human-decision, institution and
  self-hosted Travel Rule paths, rule hot reload, deletion/hold behavior, and
  complete audit reconstruction.
- Authorization-negative tests for every analyst, rule publication, report,
  deletion, and subject-data endpoint.
- Migration tests against an existing profile/transaction fixture, plus up/down
  validation while the new tables are empty.
- Data-minimisation assertions that raw documents, full IP addresses, provider
  payloads, and plaintext PII never enter logs or database columns.
