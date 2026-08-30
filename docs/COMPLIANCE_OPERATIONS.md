# Compliance core operations

This runbook covers provider binding, policy publication, data handling,
continuous jobs, reporting, migration, and rollback for the compliance core.
The architecture and data model are in
[`COMPLIANCE_DESIGN_COMMENT.md`](./COMPLIANCE_DESIGN_COMMENT.md).

## Provider binding

The default adapters are deterministic reference adapters for local development
and tests. Bind production providers with deployment secrets:

```text
KYC_PROVIDER_NAME / KYC_PROVIDER_URL / KYC_PROVIDER_API_KEY
KYC_PROVIDER_WEBHOOK_SECRET
SCREENING_PROVIDER_NAME / SCREENING_PROVIDER_URL / SCREENING_PROVIDER_API_KEY
ONCHAIN_RISK_PROVIDER_NAME / ONCHAIN_RISK_PROVIDER_URL / ONCHAIN_RISK_PROVIDER_API_KEY
TRAVEL_RULE_PROVIDER_NAME / TRAVEL_RULE_PROVIDER_URL / TRAVEL_RULE_PROVIDER_API_KEY
REGULATORY_REPORTING_URL / REGULATORY_REPORTING_API_KEY
```

Provider calls have timeouts, normalized responses, and idempotency keys. The
database retains provider references and evidence hashes, not raw responses.
KYC webhooks use `X-Provider-Signature`, an HMAC-SHA256 of the raw body using
`KYC_PROVIDER_WEBHOOK_SECRET`.

## Encryption and key rotation

Configure a keyring and separate blind-index key:

```text
COMPLIANCE_ENCRYPTION_KEYS={"2026-q3":"<32-byte base64>","2026-q2":"<32-byte base64>"}
COMPLIANCE_ENCRYPTION_KEY_ID=2026-q3
COMPLIANCE_BLIND_INDEX_KEY=<at-least-32-byte base64>
```

Production encrypted-data access fails closed without a 32-byte key. Envelopes
identify their key, allowing rotation by adding a key, selecting it for new
writes, and retaining old keys until rewrap finishes. AES-256-GCM authenticated
context binds each envelope to its subject/transaction, record type, and schema
version, so moving ciphertext between records fails authentication.

## Data minimisation, retention, and deletion

Raw documents and liveness media remain with the KYC provider. Local storage
contains masked names, ISO country, tier/status/expiry, provider references,
evidence hashes, and minimum SEP-12/Travel Rule fields in encrypted envelopes.
Raw IP addresses and full provider payloads are not retained. Geo records contain
only coarse country, confidence, proxy signal, and method version.

The default retention is 1,825 days and can be changed per effective policy.
Incomplete sessions expire after 30 days. `DELETE /api/compliance/identity` and
`DELETE /api/sep12/customer` create deletion workflows. Legal hold and required
retention are evaluated first. Eligible requests delete at the provider, clear
local encrypted PII/blind indexes, and append a non-PII tombstone hash to the
audit chain.

## Tiered identity and SEP-12

`POST /api/compliance/identity/sessions` starts individual or corporate KYC.
Tier 1 collects basic identity evidence; tier 2 adds document/liveness and
screening; tier 3 adds enhanced diligence or corporate beneficial ownership.

`POST /api/compliance/limits/check` returns policy version, tier, rolling usage,
limit, remaining amount, required tier, and reason. A low tier restricts value
movement rather than unrelated platform access.

SEP-12 is exposed at `/api/sep12/info` and `/api/sep12/customer`. Anchor field
names map to the same encrypted subject/session used by native KYC, preventing a
duplicate identity database.

## Continuous screening worker

Successful KYC triggers onboarding sanctions/PEP/adverse-media screening.
`next_screening_at` comes from the effective policy. The 15-minute worker handles
verification expiry, due re-screening, and Travel Rule retries with bounded
backoff. Operations can invoke a bounded cycle at
`POST /api/compliance/admin/worker/run`. Potential/confirmed matches create cases
for recorded human review.

## Monitoring, risk, and human decisions

Transfers require a unique idempotency key. Rules evaluate rolling structuring,
count/amount velocity, new-counterparty concentration/fan-out, tier limits, geo,
and on-chain exposure. Risk stores five bounded components, configured weights,
reason codes, model/policy versions, and an evidence hash.

Observe mode records alerts/cases while leaving transfers `observed`. Enforcement
mode holds only the affected transfer for a limit breach, prohibited geography,
high/critical risk, or incomplete required Travel Rule exchange. Automation can
open a case but never records a human disposition.

Case lifecycle is centrally checked:

```text
open -> triaged -> investigating -> decided -> closed
                         |-> escalated -> investigating
```

Every analyst action requires a reason. Decisions are `cleared`, `monitor`,
`restrict`, `reject`, or `file_report`, with actor and before/after state audited.

## Travel Rule

Policy provides threshold and required fields. Institutional beneficiaries are
discovered and sent encrypted originator/beneficiary data through the configured
protocol, retaining only references and receipt hashes. Self-hosted wallets use
signed-challenge, microtransaction, or wallet-connection control evidence; only
method and evidence hash remain. Unknown/unreachable counterparties create cases
and are held in enforcement mode.

## Policy hot updates and geo method

Policies follow `backend/src/config/compliance-policy.schema.json`. Publish with
`POST /api/compliance/admin/rules` and a different `reviewedBy` identity. The
service checks bounds, monotonic tiers, weight sums, ISO countries, and threshold
order, assigns the next version atomically, then invalidates its short cache.
Effective-dated changes therefore require no code deployment.

Promote policy in observe mode, review outcomes, then publish a separately
reviewed enforcement version. Old versions remain for decision reconstruction.

Geo combines KYC country, declared country, and IP-derived country above a
confidence floor. Proxy/VPN, low-confidence, and conflicting signals produce
review unless an enforcing policy explicitly requires denial. Each outcome
retains method version, coarse signals, confidence, policy, and reason.

## Reporting and audit

After human disposition, analysts generate deterministic `SAR_JSON` or `SAR_XML`
formats enabled by jurisdiction policy. Content is encrypted; SHA-256,
renderer/policy versions, access, generation, and filing reference are audited.

Audit events are append-only and hash-chained per subject. Each stores actor,
action, object, correlation ID, policy jurisdiction/version, reason, decision,
evidence hash, previous hash, and event hash. `GET /api/compliance/audit` verifies
and returns the authenticated subject's chain.

## Migration and rollback

Apply with `cd backend && npm run migrate`. `V21__compliance_core.up.sql` is
additive and seeds observe mode only. Legacy `profiles.is_kyc_verified` becomes
an evidence marker during lazy subject creation; it does not invent a tier or
copy plaintext.

During the empty observation window, `npm run migrate:rollback` removes V21.
After decisions exist, operational rollback is:

1. publish a reviewed observe-mode policy effective immediately;
2. stop the compliance worker;
3. retain all compliance/audit tables;
4. deploy the previous application build; and
5. deploy a forward database/application fix.

Audit-bearing tables are not dropped after compliance decisions or filings.
