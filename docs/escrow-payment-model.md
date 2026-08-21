# Escrow and payment model (end to end)

This document traces a MarketPay payment from job creation to settlement as the
repository stands today: **frontend** (`frontend/`), **API** (`backend/src`),
**indexer** (`backend/src/services/indexerService.js`), and **Soroban contract**
(`contracts/marketpay-contract`).

Amounts on-chain are **token smallest units** (stroops for native XLM). The
contract tests below use `amount: 1000` of a mock Stellar asset, not 1000 XLM.

---

## Components

| Layer | Role in a payment |
| --- | --- |
| Freighter + `frontend/lib/stellar.ts` | Builds, signs, and submits Soroban transactions |
| `frontend/components/PostJobForm.tsx`, `pages/jobs/[id].tsx` | Job create, hire, release, refund, dispute UI |
| Express API (`backend/src/routes/jobs.js`, `escrow.js`, `applications.js`) | Off-chain job/application records, audit logs, notifications |
| PostgreSQL (`jobs`, `escrows`, `referrals`, `referral_tree`, `platform_fee_payouts`) | Queryable copy of lifecycle state |
| Horizon / Soroban RPC indexer | Writes `contract_events` and updates `jobs` / `escrows` from on-chain events |
| `MarketPayContract` | Locks tokens, enforces status, moves funds |

The backend **does not** hold the budget. Tokens move only through
`token::Client::transfer` in the contract. API payout helpers
(`referralService.js`) record **audit rows** that mirror the on-chain split.

---

## Happy path: job creation → release

On-chain status lives in `EscrowStatus`. Off-chain job status is a parallel
enum (`open` → `in_progress` → `completed` / `cancelled` / `disputed`).

```
Locked ──start_work──► InProgress ──release_escrow──► Released
   │                         │
   │                         └──raise_dispute──► Disputed
   ├──refund_escrow──► Refunded
   └──timeout_refund──► Refunded
```

### 1. Client posts a job and locks escrow

1. Wallet connects (`frontend/pages/_app.tsx`, Freighter, SEP-0010 JWT).
2. `PostJobForm` `POST /api/jobs` creates a job (`status: open`, budget, skills).
3. Frontend calls `createEscrowOnChain` → contract `create_escrow`.
4. Contract:
   - requires `client.require_auth()`
   - transfers `amount` from client → contract
   - stores `Escrow { status: Locked, timeout_ledger / TimeoutTimestamp, optional milestones, referrer, arbitrator }`
   - emits `escrow_cr`
5. Frontend `PATCH /api/jobs/:id/escrow` stores `escrowContractId` (and optional
   `referrerAddress` from `?ref=` / `smp_referrer`).
6. Indexer records `escrow_created` and keeps the `escrows` row funded.

**Who holds the money:** the contract. Client balance decreased by `amount`.
No fee is taken at lock.

### 2. Freelancer applies; client hires and starts work

1. Freelancer `POST /api/applications`.
2. Client `POST /api/applications/:id/accept` → `assignFreelancer` sets
   `jobs.status = in_progress` and `freelancer_address`.
3. Client signs `start_work` (only the escrow client; only from `Locked`).
4. Contract sets `InProgress`, emits `work_strt`.
5. Indexer sets `escrows.status = in_progress`.

Funds still sit in the contract. Timeout refund is **no longer** available
(`timeout_refund` panics unless status is `Locked`).

### 3. Client releases

1. Client signs `release_escrow` (or two of three `approve_release` votes when
   an arbitrator was set at creation).
2. `release_escrow_core`:
   - rejects unless status is `InProgress` or `Locked`
   - if milestones exist, pays only **uncompleted** milestone amounts; otherwise pays `escrow.amount`
   - marks remaining milestones complete
   - sets status `Released`
   - splits `release_amount` (see [Fee model](#fee-model))
   - emits `escrow_rl`
3. API `POST /api/escrow/:jobId/release` updates job to `completed` and calls
   `processReferralPayout` (DB audit only).
4. Indexer also sets `jobs.status = completed` and `escrows.status = released`.

---

## Fee model

Constants in `contracts/marketpay-contract/src/lib.rs`:

```text
PLATFORM_FEE_BPS        = 100      // 1.00%
FEE_BPS_DENOMINATOR     = 10_000
```

Fee is charged **only in `release_escrow_core`**, and **only when the freelancer
has no multi-level referral-tree parent**. Arithmetic is checked integer math:

```text
fee = release_amount * 100 / 10_000
freelancer_amount = release_amount - fee
```

Truncation is toward zero (`i128` division). For `release_amount = 1000`:
`1000 * 100 / 10_000 = 10`.

### Who receives the 1% platform fee

| Condition at release | Fee recipient | Freelancer |
| --- | --- | --- |
| Freelancer **has** a `ReferralParent` (tree registered) | **No 1% platform fee.** Tree bonuses apply instead (next section). | `amount − tree bonuses` |
| No tree parent, escrow `referrer` **is set** | Entire 1% to that **escrow referrer** (`ref_bon` event) | 99% |
| No tree parent, escrow `referrer` **is None** | Entire 1% to contract **admin** (`fee_adm` event) | 99% |
| `fee == 0` (amount too small) | Nobody | 100% of `release_amount` |

The 1% is **not split** between admin and referrer. It is winner-take-all.

### Paths that do **not** take the 1% fee

| Path | Transfer |
| --- | --- |
| `create_escrow` | client → contract (full amount) |
| `refund_escrow` / `approve_refund` / `timeout_refund` | contract → client (full amount) |
| `partial_release` | contract → freelancer (that milestone’s amount, **gross**) |
| `raise_dispute` | none |

So a 1000-unit job released through two milestones of 400 and 600 pays the
freelancer **1000** with **no** platform fee (`test_partial_release`). A single
`release_escrow` of 1000 with no tree parent pays 990 / 10.

---

## Referral rewards and interaction with the platform fee

Two referral mechanisms exist. **They are mutually exclusive on a given
release.** `release_escrow_core` checks `get_parent(freelancer)` first.

### A. Multi-level referral tree (takes priority)

On-chain: `register_referral_tree` / `referral.rs`. Off-chain mirror:
`POST /api/referrals/register` when a user connects with `?ref=`.

Walk up to **3** ancestors of the **freelancer**:

| Level | Recipient | BPS | Percent |
| --- | --- | --- | --- |
| 1 | Direct parent | 200 | 2.00% |
| 2 | Parent’s parent | 75 | 0.75% |
| 3 | Next ancestor | 25 | 0.25% |

Missing levels pay nothing. Maximum tree take is **3.00%**. The freelancer
receives the remainder. The 1% platform fee is **skipped** on this branch
(admin and escrow-level `referrer` get 0 from that release).

```text
bonus_L = release_amount * LEVEL_BPS[L-1] / 10_000
freelancer = release_amount - sum(bonus_L)
```

Backend `processMultiLevelPayout` writes `multi_level_payouts` using the same
BPS table. The DB helper only records a tree payout on the freelancer’s
**first** released job; the **contract pays tree bonuses on every release**
once a parent is registered. Treat the chain as source of truth.

### B. Legacy / ISSUE-17 escrow referrer (fallback)

If the freelancer has **no** tree parent, the 1% platform fee applies. If
`CreateEscrowParams.referrer` was set (job posted via a referral link), that
address receives the **whole** 1%. Otherwise the admin does.

This is **not** the 2% level-1 tree bonus. The `Escrow.referrer` comment that
mentions 2% is stale; `PLATFORM_FEE_BPS` is 100 (1%).

---

## Worked examples (aligned with contract tests)

Token units match `contracts/marketpay-contract/src/lib.rs` tests. The client
is minted `1000` and locks `1000`.

### Example 1 — Full release, no referrer, no tree

Source: `test_release_escrow_state_consistency_regression`

```text
release_amount = 1000
fee            = 1000 * 100 / 10_000 = 10
freelancer     = 1000 - 10           = 990
admin          = 10
referrer       = (none)
```

Assertions: `balance(freelancer) == 990`, `balance(admin) == 10`.

### Example 2 — Full release, escrow referrer, no tree

Source: `test_platform_fee_routed_to_referrer`

```text
release_amount = 1000
fee            = 10
freelancer     = 990
escrow referrer = 10
admin          = 0
```

Assertions: `balance(freelancer) == 990`, `balance(referrer) == 10`,
`balance(admin) == 0`.

### Example 3 — Milestone partial releases (no platform fee)

Source: `test_partial_release`  
Milestones `[400, 600]`, total lock `1000`.

```text
partial_release(0) → freelancer += 400   status still Disputed in that test
partial_release(1) → freelancer += 600   status Released
freelancer total   = 1000
admin / referrer   = 0
```

Assertions: after first call `balance(freelancer) == 400`; after second
`balance(freelancer) == 1000`.

If the same 1000 were released in one `release_escrow` with no tree parent,
the freelancer would receive **990**, not 1000.

### Example 4 — Full three-level tree (integer BPS, amount 1000)

There is no separate balance test for a three-level tree; the numbers follow
`LEVEL_BPS` in `referral.rs` (`[200, 75, 25]`) and `calculate_tree_rewards`.

```text
release_amount = 1000
L1 = 1000 * 200 / 10_000 = 20     // 2.00%
L2 = 1000 *  75 / 10_000 = 7      // 0.75% truncates (75_000 / 10_000)
L3 = 1000 *  25 / 10_000 = 2      // 0.25% truncates (25_000 / 10_000)
tree total               = 29
freelancer               = 971
admin / escrow referrer  = 0      // platform-fee branch not taken
```

With only a level-1 parent: L1 = 20, freelancer = 980.

With `release_amount = 10_000` the percents are exact: 200 + 75 + 25 = 300
to the tree, 9_700 to the freelancer (3.00% / 97.00%).

Invariant on every `release_escrow_core` path:

```text
freelancer_amount + fees_or_tree_bonuses == release_amount
```

---

## Failure paths

### Timeout refund

- **When:** status is still `Locked` (freelancer never `start_work`) **and**
  the timeout has elapsed.
- **Clock:** new escrows use `TimeoutTimestamp` (default 7 days /
  `DEFAULT_TIMEOUT_SECONDS`). Older records fall back to
  `timeout_ledger` (`DEFAULT_TIMEOUT_LEDGERS = 120_960`).
- **Who:** escrow client (`timeout_refund`).
- **Money:** full `amount` client ← contract. **No fee.**
- **State:** `Refunded`. Indexer: `jobs.status = cancelled`,
  `escrows.status = refunded`.
- **API:** `POST /api/escrow/:jobId/timeout-refund` (audit + notifications).
- Tests: `test_timeout_refund_success`,
  `test_timeout_refund_before_timeout_panics`,
  `test_timeout_refund_after_start_work_panics`.

### Unilateral refund (before work)

- **When:** `Locked`, no arbitrator (or 2-of-3 `approve_refund` when there is one).
- **Who:** client.
- **Money:** full amount back to client. **No fee.**
- **Blocked after** `start_work` (`Can only refund before work has started`).
- Test: `test_refund_escrow_happy_path`,
  `test_refund_escrow_after_in_progress_rejected`.

### Dispute

- **On-chain `raise_dispute`:** client or freelancer; not if already
  `Released` or `Refunded`. Sets `Disputed`. Emits `escrow_ds`. **No token
  movement.**
- **Partial releases** are still allowed while `Disputed` so completed
  milestones can be paid (`test_partial_release` raises a dispute first).
- **Off-chain:** `POST` dispute APIs + IPFS evidence. Indexer sets
  `jobs.status = disputed`.
- **Admin resolution (API only today):** `disputeService.resolveDispute`
  with `release_funds` or `refund_client` updates **Postgres**
  (`escrows.status`, dispute row). It does **not** call the contract. Actual
  token movement still requires an on-chain release, refund, milestone pay,
  or emergency/admin path if one is invoked separately.

### Arbitration

Two related mechanisms:

1. **Optional 2-of-3 escrow arbitrator** (`CreateEscrowParams.arbitrator`).
   Unilateral `release_escrow` / `refund_escrow` panic. Client, freelancer, or
   arbitrator each `approve_release` / `approve_refund` once; at **2**
   approvals the corresponding core transfer runs (same fee rules as a normal
   release).
2. **Admin-opened panel** (`open_arbitration`): admin picks 3 pool members;
   each votes a `client_percent` 0–100; `resolve_arbitration` stores the
   **median** vote as `resolution` and closes the case. That function
   **does not transfer tokens**. Settlement after a median split still has to
   go through a fund-moving entrypoint.

---

## State cheat sheet

| Event | Contract status | Typical job status | Tokens |
| --- | --- | --- | --- |
| `create_escrow` | Locked | open | client → contract |
| `start_work` | InProgress | in_progress | none |
| `release_escrow` | Released | completed | contract → freelancer (+ fee or tree) |
| `partial_release` (not last) | unchanged | in_progress / disputed | contract → freelancer (gross) |
| last `partial_release` | Released | completed (indexer) | contract → freelancer (gross) |
| `refund_escrow` / `timeout_refund` | Refunded | cancelled | contract → client |
| `raise_dispute` | Disputed | disputed | none |

---

## Related docs

- [ADR-001 Soroban escrow design](./ADR-001-soroban-escrow-design.md)
- [ADR-003 database schema](./ADR-003-database-schema-escrow.md)
- [Contract contributor guide](./contract-contributor-guide.md) (fund-moving review bar)
- [Architecture overview](./architecture.md)
