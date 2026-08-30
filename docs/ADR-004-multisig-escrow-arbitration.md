# ADR-004: 2-of-3 Multisig for Escrow Release Arbitration

**Status:** Accepted
**Date:** 2026-06-28
**Author:** Stellar MarketPay Team
**Stakeholders:** Smart Contract Team, Backend Team

## Context

ADR-001 gave the client unilateral authority to call `release_escrow` /
`refund_escrow` once work is submitted. That is a single point of failure: an
unresponsive or bad-faith client can withhold release indefinitely, and there
is no way to move funds if the client and freelancer disagree about whether
work was completed.

The escrow contract needed a way to settle a disputed job without falling
back to a fully centralized admin override, while still supporting the
common case (client and freelancer agree) without extra friction.

## Decision

For any escrow created with an optional `arbitrator` address, release and
refund require **2-of-3 multisig approval** from `{client, freelancer,
arbitrator}` instead of the client's unilateral signature. Escrows created
without an arbitrator keep the ADR-001 unilateral-client-release behavior
unchanged.

- `CreateEscrowParams.arbitrator: Option<Address>` — set once, at escrow
  creation; must be distinct from the client and the freelancer
  (`contracts/marketpay-contract/src/lib.rs:64-67`, `442-444`).
- `release_escrow` / `refund_escrow` reject multisig escrows outright
  (`"Escrow requires multisig approval — use approve_release()"`,
  `contracts/marketpay-contract/src/lib.rs:572-592`, `894-913`).
- `approve_release` / `approve_refund` accept a vote from any of the three
  parties, reject a second vote from the same signer, and trigger the
  underlying release/refund once 2 votes are recorded
  (`contracts/marketpay-contract/src/lib.rs:594-641`, `938-989`).
- Vote state is tracked per `(job_id, signer)` via
  `DataKey::MultisigReleaseVote` / `MultisigRefundVote`
  (`contracts/marketpay-contract/src/lib.rs:252-255`).

```
release_escrow(client)                 // no arbitrator set: unchanged, ADR-001
approve_release(signer) × 2 of {client, freelancer, arbitrator}  // arbitrator set: 2-of-3
```

## Rationale

### Why 2-of-3 multisig

- Removes the single-point-of-failure risk of unilateral client release —
  stated directly as the PR's goal: "improve security and trust by removing
  the single-point-of-failure risk present in the previous design" (PR
  [#60](https://github.com/Stellar-MarkeyPay/Stellar-MarketPay/pull/60),
  merged 2026-06-28).
- Any 2 of the 3 interested parties reaching agreement is enough — the
  freelancer and arbitrator can release without the client
  (`test_freelancer_and_arbitrator_can_release_without_client.1.json`), so an
  unresponsive client can no longer block a legitimately completed job.
- Opt-in per escrow (`arbitrator: Option<Address>`): jobs that don't need a
  third party keep the simpler ADR-001 flow with no added transaction
  overhead.

### Alternative found in the codebase, not used for this path

The contract also has an older, separate arbitration mechanism —
`register_arbitrator`, `open_arbitration`, `cast_arbitration_vote`,
`resolve_arbitration` (`contracts/marketpay-contract/src/lib.rs:2250-2388`,
introduced in commit `4707745`, April 2026). It maintains a global
admin-curated arbitrator pool, randomly selects 3 arbitrators per case on
`open_arbitration`, and resolves via a trimmed-median of 3 percentage votes.

This mechanism is never called from `backend/` or `frontend/` (verified by
searching both trees for its entry points) and is not wired to any fund
transfer — `resolve_arbitration` only records a `resolution` percentage. It
appears to have been superseded by the per-escrow 2-of-3 multisig model
above.

**Reconstructed — unconfirmed, needs author input:** no commit message or PR
explains a deliberate decision to abandon the arbitrator-pool mechanism in
favor of per-escrow multisig; the two coexisting, only one wired to fund
movement, is what the code shows. Whether it was an intentional replacement
or simply an earlier prototype that was never removed is not documented
anywhere found.

### Why not other alternatives

- **Fully centralized admin override**: reintroduces the trust assumption
  the escrow design (ADR-001) exists to avoid.
- **DAO-wide vote per dispute** (`backend/src/services/daoService.js`, which
  handles `treasury`/`platform`/`parameter`/`arbitration`-type proposals):
  exists for platform governance but operates at a much slower, proposal
  cadence — unsuited to resolving an individual job's fund release.

## Consequences

### Positive

- ✅ No single party can unilaterally block or force a settlement once an
  arbitrator is set.
- ✅ Escrows that don't need arbitration are unaffected (opt-in, no default
  overhead).
- ✅ Vote state is auditable on-chain per job and per signer.

### Negative

- ❌ Requires a trusted arbitrator to be chosen and set at escrow creation —
  there is no in-band way to add arbitration to an escrow after the fact.
- ❌ Two dormant arbitration code paths now exist in the contract
  (arbitrator-pool voting vs. per-escrow multisig); the unused one adds
  surface area for confusion and audit cost without providing value.
- ❌ A colluding arbitrator + one other party can still force an outcome
  against the third party's wishes (2-of-3 is a majority, not unanimity).

## Implementation Details

- `contracts/marketpay-contract/src/lib.rs` — `CreateEscrowParams`,
  `Escrow.arbitrator`/`release_approvals`/`refund_approvals`,
  `approve_release`, `approve_refund`, `get_arbitrator`.
- `contracts/marketpay-contract/test_snapshots/multisig_tests/` — coverage
  for unilateral-release rejection, duplicate-vote rejection, non-signer
  rejection, and the 2-of-3 threshold itself.
- `docs/contract-contributor-guide.md` — storage-compatibility and review-bar
  rules that apply to any change touching this path.

## Related ADRs

- ADR-001: Soroban Smart Contract for Escrow Management (the unilateral
  release path this extends)

## References

- PR #60 — `feat: Muilti-sign Escrow realease` (merged 2026-06-28)
