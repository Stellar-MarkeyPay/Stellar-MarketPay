# ADR-006: On-Chain Platform Fee with Referrer-or-Admin Routing

**Status:** Accepted
**Date:** 2026-06-28
**Author:** Stellar MarketPay Team
**Stakeholders:** Smart Contract Team, Backend Team

## Context

ADR-005 rewards a freelancer's referral-tree ancestors on release, but only
when the freelancer signed up through a registered tree referral. Many
escrows have no tree registration at all — either the freelancer joined
without a referral link, or their referrer relationship predates the tree
(ADR-005 shipped after the escrow-level `referrer` field already existed on
`CreateEscrowParams`, carried over from the earlier off-chain referral
design). The platform still needed a revenue mechanism for these escrows,
and a way to keep rewarding the simple, single-level case without requiring
tree registration.

## Decision

A flat **1% platform fee (100 basis points)** is deducted from every escrow
release that does **not** have a tree-registered freelancer. The fee is
routed entirely to the escrow's `referrer` address if one was set at job
creation (from the frontend's `?ref=` link), otherwise it defaults to the
protocol admin.

```rust
// contracts/marketpay-contract/src/lib.rs:47-52
const PLATFORM_FEE_BPS: i128 = 100;          // 1%
const FEE_BPS_DENOMINATOR: i128 = 10_000;
```

```rust
// contracts/marketpay-contract/src/lib.rs:716-766 (paraphrased)
let total_bonus = if get_parent(&env, &escrow.freelancer).is_some() {
    distribute_tree_rewards(...)              // ADR-005 path
} else {
    let fee = release_amount * PLATFORM_FEE_BPS / FEE_BPS_DENOMINATOR;
    match escrow.referrer {
        Some(referrer) => transfer(fee, to: referrer),   // entire fee to referrer
        None           => transfer(fee, to: admin),      // entire fee to platform
    }
};
```

- `backend/src/db/migrations/V14__platform_fee_referral.up.sql` —
  `escrows.referrer_address` (captured at job-posting time) and
  `platform_fee_payouts` (audit row per payout, `recipient_type` ∈
  `{referrer, admin}`).
- The two paths (this ADR and ADR-005) are mutually exclusive per escrow,
  decided by `get_parent()` at release time (`lib.rs:716`).

## Rationale

### Why a percentage fee, and why route it to the referrer first

- On-chain, atomic computation and routing at release time keeps the same
  trustless-execution guarantee as the rest of the escrow design (ADR-001) —
  there is no off-chain step that could compute a different amount than what
  actually gets transferred.
- Routing the fee to a referrer, when one exists, keeps a monetary incentive
  for the simple single-level referral case without requiring the referred
  freelancer to have gone through full tree registration — directly stated
  as the goal of PR
  [#61](https://github.com/Stellar-MarkeyPay/Stellar-MarketPay/pull/61)
  ("automatically distributing a fixed percentage of platform fees to
  referrers when a referred user successfully completes a job," closes
  issue #17, merged 2026-06-28).
- Falling back to the admin when there is no referrer gives the platform a
  baseline revenue mechanism on every non-tree escrow, rather than the fee
  simply going unclaimed.

### Why 1% specifically

**Reconstructed — unconfirmed, needs author input.** No commit, PR, issue,
or doc found explains why 100 basis points was chosen over another rate, or
against a flat (non-percentage) fee. The only related figures on record are
ADR-005's tree percentages (2.00% / 0.75% / 0.25%), which this fee is
structured similarly to (basis points of the release amount) but is not
documented as having been derived from.

Note also that `docs/FAQ.md:130` currently states "Platform fee: 0% (we
don't take a cut)," which predates this fee and has not been updated to
match the code — flagged here as a documentation gap, not something this
ADR set corrects (out of scope for this change).

### Why not other alternatives

- **A flat XLM fee per job** rather than a percentage: would scale poorly
  across the wide range of job sizes the platform supports; not found
  discussed anywhere, so listed here as the evident alternative rather than
  a sourced rejection.
- **Always routing the fee to the admin, with referrer rewards paid from a
  separate treasury allocation**: would decouple the referral incentive from
  the escrow's own atomic release, reintroducing an off-chain trust step
  ADR-001 was designed to avoid.
- **Extending the ADR-005 tree mechanism to cover this case too** (i.e., no
  separate flat-fee path): would require every referrer relationship to go
  through tree registration, which is not true for escrows whose `referrer`
  was set before the tree existed or without a tree signup.

## Consequences

### Positive

- ✅ Every non-tree escrow release has a defined, atomic fee outcome — no
  ambiguity about whether or how much the platform or a referrer is paid.
- ✅ Full audit trail via `platform_fee_payouts`, distinguishing
  referrer-routed vs. admin-routed fees.
- ✅ Backward-compatible with the pre-tree `referrer` field on
  `CreateEscrowParams` — no migration of existing escrow data needed.

### Negative

- ❌ The fee rate is a hardcoded contract constant
  (`PLATFORM_FEE_BPS`) — changing it requires a contract upgrade (see
  `docs/contract-contributor-guide.md`'s storage-compatibility rules), not a
  config change.
- ❌ `docs/FAQ.md` now contradicts the actual fee behavior (see above) —
  user-facing documentation drift that predates this ADR set.
- ❌ Two similarly-shaped but independently-implemented reward mechanisms
  (this ADR and ADR-005) exist side by side; a reader needs both ADRs to
  understand what a given escrow release actually pays out.

## Implementation Details

- `contracts/marketpay-contract/src/lib.rs:47-52` (constants),
  `:708-766` (fee computation and routing)
- `backend/src/db/migrations/V14__platform_fee_referral.up.sql`
- `contracts/marketpay-contract/test_snapshots/regression_tests/test_platform_fee_routed_to_referrer.1.json`

## Related ADRs

- ADR-005: Multi-Level Referral Tree with 3-Tier Reward Split (the path this
  one defers to when the freelancer has tree registration)

## References

- PR #61 — `feature: Referral systems` (merged 2026-06-28, closes #17)
