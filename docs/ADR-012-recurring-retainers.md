# ADR-012: Recurring Retainers and Subscription Billing

## Context

Issue #321. The platform currently models work as one-off jobs: a client
posts a job, a freelancer is hired, an escrow funds a fixed budget or a set
of milestones, and the engagement ends when the job is marked complete.
`time_entries` / `time_invoices` (Issue #346) extended this with hourly
billing, but billing is always a one-shot invoice the freelancer raises and
the client reviews by hand.

A large share of real freelance income is retainer work: a fixed monthly
fee for ongoing availability, or a recurring, capped hourly arrangement
("up to 20 hours/month"). Nothing in the schema represents an _ongoing_
commercial relationship — there is no construct that bills itself every
period without a human re-triggering it, and no concept of a "period" at
all.

This ADR covers a backend-only slice: the recurring-agreement data model,
scheduled release, underfunding behaviour, time-tracking integration
(approval, disputes, capped usage, rollover), lifecycle management
(renewal, amendment, pause, notice periods, price re-acceptance), the
proposal/acceptance surface, forecasting, and reporting. All of it is
reachable through `/api/retainers` and is independent of the job/escrow
code path — a retainer is not a job, and does not require one.

### Explicitly out of scope for this PR

- **On-chain Soroban settlement.** Exactly like the existing
  `time_invoices` flow (`contract_tx_hash` is recorded, not produced, by
  the backend — see `timeTrackingService.reviewInvoice`), this PR records
  _decisions_ (release, top-up, cancellation) and their tx hashes; it does
  not submit Soroban transactions itself. Wiring a `retainer` contract
  that custodies funds on-chain is a natural follow-up once this data
  model is stable — see "Future work" below.
- **Frontend UI** for the proposal/acceptance and forecast surfaces. The
  API is designed to be consumed directly; a UI PR can follow.
- **PDF generation** for statements/invoices. A statement is a structured,
  queryable record (`retainer_statements`); rendering it as a PDF is a
  presentation concern that can be layered on later the same way an
  invoice-epic PDF renderer would be layered onto `time_invoices`.

Each of these is independently mergeable follow-up work and does not
block the acceptance criteria in #321, all of which are testable at the
API/data layer.

## Decision

### Data model

Seven new tables (migration `V20__recurring_retainers`, after a V19 that backfills two missing pre-existing tables — see below), plus three
nullable columns added to the existing `time_entries` table so retainer
work reuses the same logging path as job work.

```
retainer_proposals ──accepted──▶ retainers ──1:N──▶ retainer_periods ──1:1──▶ retainer_statements
                                     │  ▲                  │
                                     │  │ pending_amendment │ 1:N
                                     ▼  │                   ▼
                              retainer_amendments      time_entries (retainer_id, retainer_period_id)
                                     │
                                     ▼
                            retainer_funding_events
```

- **`retainer_proposals`** — the commercial surface, distinct from job
  applications. Either party proposes terms (period type, billing model,
  amount, cap hours, auto-renew, notice period, rollover policy); the
  counterparty accepts or declines. Acceptance creates the `retainers`
  row and its first `retainer_periods` row atomically.

- **`retainers`** — the live agreement. Carries the current terms
  (a price/terms change is applied only after both an amendment and its
  acceptance — see below, so the _live_ row always reflects the
  last-agreed terms, never a pending proposal), a `balance_xlm` funded
  pool the client tops up via `retainer_funding_events`, and lifecycle
  state (`active | paused | pending_cancellation | cancelled`).

- **`retainer_periods`** — one row per billing cycle. Accumulates
  `logged_hours` / `approved_hours` / `disputed_hours` as time entries
  come in, and is the unit the scheduler releases against. Status
  (`open | released | underfunded | held_paused | settled_prorata |
cancelled`) is what makes underfunding and pausing _visible_ rather
  than a silent failure to release.

- **`retainer_amendments`** — every proposed change to a live retainer
  (price change, other terms, pause, resume, renewal terms, a
  cancellation's notice) is a row here, requiring the counterparty's
  explicit accept before it takes effect. This is the mechanism behind
  "price change requires explicit re-acceptance" and "renewal, amendment
  and pause with both parties' consent" — there is exactly one path for
  changing a live retainer's terms, and it always needs two signatures.

- **`retainer_funding_events`** — an append-only ledger of client top-ups
  (mirrors how `escrow_releases` records escrow's audit trail). This is
  the source of truth for `retainers.balance_xlm`.

- **`retainer_statements`** — the per-period reconciling document:
  logged vs. approved vs. disputed vs. forfeited hours, amount due,
  amount actually released, shortfall. One per period, created when the
  period is released or settled. This is the "invoice" this PR produces;
  see "Explicitly out of scope" for why it stops at a structured record.

- **`time_entries` (altered)** — `job_id` becomes nullable and
  `retainer_id` / `retainer_period_id` / approval columns
  (`approval_status`, `approved_by`, `approved_at`, `dispute_reason`,
  `resolved_by`, `resolved_at`) are added, guarded by
  `CHECK (job_id IS NOT NULL OR (retainer_id IS NOT NULL AND
retainer_period_id IS NOT NULL))`. Every existing query against
  `time_entries` filters by `job_id` explicitly, so this is additive:
  retainer-linked rows are invisible to job-billing code and vice versa.
  This is the "connect the existing time tracking to retainer billing"
  requirement — one log-time code path, two billing constructs.

### Scheduled release, without a human re-triggering each cycle

Following the existing pattern for background work in this codebase
(`startWeeklyDigestScheduler`, the notification-queue poller — both in
`server.js`, both plain `setInterval`, no new job-queue dependency), a
`startRetainerBillingScheduler()` polls every 15 minutes and calls
`retainerService.runBillingCycle()`, which:

1. **Releases** every `open` period whose `period_end` has passed
   (`releasePeriod`).
2. **Finalizes** every retainer whose `cancel_effective_at` has passed
   (`finalizeCancellation` — pro-rata settlement, see below).
3. **Warns** ahead of each period's release if the funded balance won't
   cover the projected amount (`warnUpcomingUnderfunding`) — "communicated
   before it bites," not after.
4. **Notifies** both parties of the upcoming charge for periods ending
   within the notice window (`notifyUpcomingBilling`) — a forecast sent
   ahead of the period, not a receipt after.

Each step is independently idempotent (guarded by
`released_at` / `underfunding_warned_at` / `upcoming_notice_sent_at`
timestamps), so a crashed or overlapping run cannot double-release or
double-notify.

### Underfunding: degrade predictably, don't fail silently

`releasePeriod` computes `amount_due` from the billing model (see below),
then:

- If `balance_xlm >= amount_due`: release in full, period → `released`.
- If `balance_xlm < amount_due`: release **only what's funded**
  (`min(balance_xlm, amount_due)`), record the `shortfall_xlm`, period →
  `underfunded`, and notify both parties of the degraded release with the
  shortfall amount. The retainer itself stays `active` — a client can top
  up and the next period releases normally — but the degraded period is
  a permanent, queryable record, never a silently-skipped release.

### Usage-capped retainers

`billing_model = 'capped_hourly'` retainers carry `hourly_rate_xlm` and
`cap_hours`. `amount_due` for a period is
`min(approved_hours, effective_cap_hours) * hourly_rate_xlm`, where
`effective_cap_hours = cap_hours + rollover_hours_in`. Only
**approved** hours count toward the amount — logged-but-not-yet-approved
or disputed hours never inflate a release (see below).

Unused capacity (`effective_cap_hours - approved_hours`, when positive)
is handled per the agreement's `rollover_policy`:

- `forfeit` (default): recorded on the statement as forfeited, dropped.
- `rollover`: added to the next period's `rollover_hours_in`, raising its
  effective cap.

`fixed`-model retainers ignore hours for billing entirely — the period
always bills `amount_xlm` — but still track logged/approved hours on the
statement for transparency (the freelancer's time is still visible to
the client even though it doesn't gate payment).

### Time approval and disputes that don't block the retainer

Every retainer time entry starts `approval_status = 'pending'`. The
client calls `approveRetainerTimeEntry` (approve/reject) or
`disputeRetainerTimeEntry` (open a dispute with a reason); a dispute can
later be resolved by either party via `resolveRetainerTimeEntryDispute`,
which re-decides it as approved or rejected.

Critically, `releasePeriod` sums only `approval_status = 'approved'`
hours into `approved_hours` — `pending` and `disputed` entries are
simply excluded from _this_ release. There is no retainer-wide or
period-wide lock: a dispute over one entry never prevents the rest of
the period's approved hours from billing and releasing on schedule. Once
a disputed entry resolves, it is picked up by the _next_ statement
computation (a period's statement is a live read over its entries, not a
frozen snapshot, until the period itself is released).

### Lifecycle: renewal, amendment, pause — with consent

All of these reuse `retainer_amendments`:

- **Pause/resume**: proposed by either party as an amendment of type
  `pause` / `resume`; on acceptance, `retainers.status` flips to
  `paused` / `active`. A period is released only while its retainer is
  `active`, so a paused retainer degrades to `held_paused` for its
  open period rather than releasing — a manual re-check on resume closes
  it out.
- **Price / terms change**: proposed as `price_change` / `terms_change`
  with the new terms in `payload`; on acceptance, the new terms are
  applied to `retainers` and take effect for the _next_ period (the
  currently-open period keeps its already-committed terms — you cannot
  retroactively change what's already accruing). This is what makes
  re-acceptance explicit rather than silent: there is no code path that
  mutates `amount_xlm` / `hourly_rate_xlm` / `cap_hours` except accepting
  an amendment.
- **Renewal**: `auto_renew = true` (the default) simply means
  `runBillingCycle` creates the next `retainer_periods` row when the
  current one closes, unless a `pending_cancellation` is in effect.
  `auto_renew = false` means the retainer becomes `pending_cancellation`
  automatically at the end of the current period (no next period is
  created) — the client still explicitly agreed to this by setting
  `auto_renew = false` in the first place, or via a `terms_change`
  amendment.
- **Notice periods**: `requestCancellation` does not cancel immediately —
  it sets `cancel_effective_at = now + notice_period_days` and status →
  `pending_cancellation`. The retainer keeps billing normally until that
  date. `runBillingCycle` finalizes it once the date has passed.

### Cancellation and pro-rata settlement

`finalizeCancellation` (and its dry-run counterpart
`previewCancellationSettlement`, used by the forecast endpoint) computes
the current open period's pro-rata share as of the effective date:

```
fraction = (effective_date − period_start) / (period_end − period_start)
prorated_due = fixed         ? amount_xlm * fraction
             : capped_hourly ? min(approved_hours, cap_hours) * hourly_rate_xlm
```

(For the capped model, hours already worked are hours already worked —
pro-ration by _time elapsed_ would either overpay or underpay a
freelancer who front- or back-loaded their hours, so the capped model
settles on actual approved hours rather than a time fraction. This
mirrors how the period bills normally; cancellation just closes the
window early.)

The period is released for `min(balance_xlm, prorated_due)` (same
underfunding degrade path as a normal release) and marked
`settled_prorata`; the retainer moves to `cancelled`.

### Commercial surface and forecasting

`GET /api/retainers/forecast/:retainerId` returns the projected charge
for the _next_ release: amount due under the current terms and current
approved-hours-to-date, current funded balance, and whether that balance
covers it — the same numbers `warnUpcomingUnderfunding` uses internally,
exposed directly so a UI can show it before the scheduler ever fires.

### Reporting

- `getFreelancerRecurringRevenue(freelancerAddress)` — released amounts
  from `retainer_statements`, bucketed by month, plus current
  monthly-run-rate across active retainers.
- `getClientCommittedSpend(clientAddress)` — sum of `amount_xlm` (fixed)
  or `cap_hours * hourly_rate_xlm` (capped, i.e. worst-case) across the
  client's `active` retainers — "committed spend" is a forward-looking
  ceiling, not a trailing actual.

## Consequences

### Positive

- One time-logging code path serves both one-off jobs and retainers;
  no duplicated `time_entries`-like table.
- Every state transition that matters (underfund, dispute, pause,
  price change, cancellation) is a persisted row, not an in-memory or
  silent decision — auditable and independently queryable.
- The scheduler is inert until periods actually exist and never touches
  job/escrow tables, so this ships with zero risk to the existing job
  flow.

### Negative

- No on-chain settlement yet (see "Explicitly out of scope") — a
  retainer's `balance_xlm` is an off-chain ledger the client funds by
  recording a `contract_tx_hash` the same way `time_invoices` does
  today, not an escrowed on-chain balance. This is an accepted, explicit
  gap, not an oversight — it is the same trust model the rest of the
  billing surface already uses.
- `runBillingCycle` is a single polling loop; at very large scale this
  would want to move to a per-retainer job queue. Given the codebase's
  existing scale (a single `setInterval` poller for all notifications),
  this is consistent with current practice and can be revisited if it
  becomes a bottleneck.

## Migration plan

**`V19__time_entries_backfill`** ships first and is unrelated to
retainers on its face, but this ADR's `time_entries` alteration
depends on it: `time_entries` / `time_invoices` (Issue #346) were only
ever added to `db/schema.sql` — a reference snapshot `migrate.js` does
not read — and never to an actual migration file, so neither table
exists in any database built from a clean `migrate()` run, including
CI's. `V20` was the first migration to touch `time_entries` and
surfaced this by failing outright (`relation "time_entries" does not
exist`). `V19` creates both tables verbatim from `schema.sql` (with
`IF NOT EXISTS`, so it's a no-op against any environment where they
were somehow created out-of-band) so the actual migration chain
matches what the application has always assumed was there.

`V20__recurring_retainers.up.sql` / `.down.sql`, additive-only against
existing tables: `time_entries` gains nullable columns and its `job_id`
`NOT NULL` is relaxed (with a `CHECK` replacing it), no existing rows are
touched, no existing query's result set changes. Safe to deploy without a
maintenance window; safe to roll back (down migration drops the new
tables and columns, re-imposing `job_id NOT NULL` — a no-op as long as no
retainer time entries exist yet, which is guaranteed for a rollback of an
unreleased migration).

## Future work

- Soroban `retainer` contract mirroring the existing escrow contract:
  custody `balance_xlm` on-chain, emit a release event the indexer picks
  up (reusing `indexerService` / `contractAuditService`), the same way
  escrow release already works.
- Frontend: proposal composer, forecast widget, statement/invoice viewer.
- Invoicing-epic integration: once a dedicated invoicing subsystem
  exists, `retainer_statements` is already shaped to hand off to it
  (it's the same reconciling-document concept `time_invoices` uses).

## Related ADRs

- ADR-001 (Soroban escrow design) — the on-chain model a future retainer
  contract would follow.
- ADR-003 (database schema for escrow) — the off-chain ledger pattern
  (`escrows`, `escrow_releases`) this ADR's `retainers` /
  `retainer_funding_events` mirrors.
