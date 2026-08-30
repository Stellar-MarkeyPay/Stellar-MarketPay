# ADR-005: Multi-Level Referral Tree with 3-Tier Reward Split

**Status:** Accepted
**Date:** 2026-06-19
**Author:** Stellar MarketPay Team
**Stakeholders:** Smart Contract Team, Backend Team, Frontend Team

## Context

Stellar MarketPay's earliest referral feature (`PULL_REQUEST_JOB_REFERRAL.md`,
commit `0c6f350`, April 2026) rewarded referrers with 5 off-chain reputation
points when a referred freelancer completed a job — no monetary payout, and
only the direct referrer was credited.

The platform wanted referrals to compound — a freelancer who signs up
through a referral link, and who then goes on to refer others themselves,
should let the original referrer keep earning from that sub-network — while
guarding against the standard attacks on referral systems: self-referral and
circular referral chains (Sybil-style reward farming).

## Decision

Freelancer signups are recorded in an explicit **parent → child referral
tree**, and job-completion rewards are distributed **on-chain** to up to 3
ancestor levels of the completing freelancer, at decreasing percentages:

| Level | Relationship                   | Bonus                   |
| ----- | ------------------------------ | ----------------------- |
| 1     | direct referrer                | 2.00% of release amount |
| 2     | referrer's referrer            | 0.75%                   |
| 3     | referrer's referrer's referrer | 0.25%                   |

- `contracts/marketpay-contract/src/referral.rs` — `register_referral()`
  (cycle detection + self-referral rejection), `calculate_tree_rewards()`,
  `distribute_tree_rewards()` (token transfers + event emission per level).
- `contracts/marketpay-contract/src/lib.rs:716-724` — on release, funds
  route through `distribute_tree_rewards()` when the freelancer has a tree
  parent registered; this takes priority over the flat single-referrer
  platform-fee split in ADR-006.
- `backend/src/db/migrations/V13__referral_tree.up.sql` — `referral_tree`
  (one row per child, `PRIMARY KEY (child_address)` enforces exactly one
  parent; `CHECK (child_address <> parent_address)` blocks self-referral),
  `multi_level_payouts` (audit log per level per payout), and the
  `referral_tree_stats` view joining up to 3 levels for the dashboard.
- `backend/src/services/referralService.js` — `registerReferral()` (adds a
  database-level cycle check alongside the contract's), `getReferralTree()`
  (recursive CTE for the full subtree).
- `frontend/components/ReferralDashboard.tsx` — "Referral Tree" tab with
  expandable, level-badged tree visualization.

## Rationale

### Why a tree instead of only direct-referral rewards

- Rewards the recruiting effort behind the whole downstream network a
  referrer helped grow, not just their first-degree referrals, which is the
  stated goal of the change ("hierarchical referral tree with up to 3 levels
  of rewards" — commit `b819710` / PR
  [#57](https://github.com/Stellar-MarkeyPay/Stellar-MarketPay/pull/57),
  merged 2026-06-19).
- Decreasing percentages per level (2.00% → 0.75% → 0.25%) keep the total
  payout bounded and weight the reward toward the closer, more directly
  responsible referrer.

### Why cap at 3 levels

Bounding tree walk depth keeps `distribute_tree_rewards()` a fixed-cost,
constant-number-of-transfers operation on every escrow release, rather than
an unbounded walk up an arbitrarily long chain. **Reconstructed —
unconfirmed, needs author input:** no commit or PR explains why 3 was chosen
specifically (vs. 2 or 4); the depth constraint itself is enforced in code
(`referrals.depth CHECK (depth >= 1 AND depth <= 3)`,
`backend/src/db/migrations/V13__referral_tree.up.sql:18`) but the choice of
3 as the cutoff is not documented.

### Why not the alternatives

- **Off-chain reputation points only** (the original April 2026 design): no
  monetary incentive to keep referring past the first hire, and gave no
  credit for growing a multi-level network.
- **Unlimited-depth tree walk**: unbounded gas/compute cost per release and
  a payout that could shrink to economically meaningless fractions many
  levels deep, for no clear benefit over a fixed 3-level cap.
- **Off-chain reward calculation with on-chain payout batching**: rejected
  implicitly in favor of computing and transferring every level's reward
  atomically inside `release_escrow`, so a reward can never be computed
  without immediately, verifiably paying out — same trustless-execution
  reasoning as ADR-001.

## Consequences

### Positive

- ✅ Referrers are rewarded for the compounding effect of their network, not
  just direct referrals.
- ✅ Self-referral and cycles are rejected at both the contract layer
  (`register_referral`) and the database layer (`referralService.js`),
  independently.
- ✅ Full audit trail per payout, per level, in `multi_level_payouts`.

### Negative

- ❌ A freelancer's referral parent is permanent once registered
  (`PRIMARY KEY (child_address)` — one parent, no re-parenting path).
- ❌ Adds up to 3 extra token transfers to every escrow release that has a
  tree-registered freelancer, on top of the base payout.
- ❌ Coexists with, and takes priority over, the simpler single-level
  referrer-fee-split path from ADR-006 — a freelancer can only benefit from
  one mechanism at a time (tree, if registered; otherwise the flat fee
  split), which is easy to describe but adds a branch a reader must
  understand in both ADRs to get the full picture.

## Implementation Details

- `contracts/marketpay-contract/src/referral.rs`
- `contracts/marketpay-contract/src/lib.rs:716-724` (dispatch between tree
  rewards and the ADR-006 flat fee split)
- `backend/src/db/migrations/V13__referral_tree.up.sql`
- `backend/src/services/referralService.js`,
  `backend/src/services/referralService.test.js`
- `backend/src/routes/referrals.js`
- `frontend/components/ReferralDashboard.tsx`

## Related ADRs

- ADR-006: On-Chain Platform Fee with Referrer Routing (the fallback path
  used when no tree registration exists)

## References

- PR #57 — `feat: implement multi-level referral tree with 3-tier rewards`
  (merged 2026-06-19)
- `PULL_REQUEST_JOB_REFERRAL.md` — the earlier off-chain reputation-point
  referral design this superseded for monetary rewards
