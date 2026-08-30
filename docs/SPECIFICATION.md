# MarketPay Escrow — Formal Specification

**Status:** published for external audit
**Covers:** `contracts/marketpay-contract/src/lib.rs`, `src/referral.rs`, `src/oracle.rs`
**Machine-readable form:** [`contracts/marketpay-spec/`](../contracts/marketpay-spec/)

This document states what the escrow contract is supposed to do. It is
deliberately separate from how it does it, and it is written so that a reader
who has never seen the implementation can decide whether the guarantees are the
ones they want before trusting the contract with money.

Every clause here has an executable counterpart in `contracts/marketpay-spec/`.
Where a clause says "verified", §5 says by what technique and within what
bound. Where the specification and the implementation disagreed, §6 records the
disagreement — including the four that were live fund-safety defects.

---

## 1. Why this exists

The escrow holds user funds across sixty-odd entrypoints. Until this document
existed, the only thing standing behind those funds was a suite of
example-based tests.

Example tests pass on the cases someone thought of. They cannot fail on a case
nobody thought of, and that is the class of failure that costs money. Two had
already got through a green suite: a merge dropped struct fields without any
test noticing, and the platform fee arithmetic was silently wrong in a restored
test. Neither is a testing mistake exactly — they are the predictable
consequence of having no stated property for a test to be wrong _about_.

You cannot verify what you have not stated. §2–§4 state it.

---

## 2. The abstract state

Verification is done against an abstraction, not against storage layout. The
abstraction is in [`state.rs`](../contracts/marketpay-spec/src/state.rs).

### 2.1 Parties

The contract identifies parties by `Address`, a 32-byte opaque identifier.
Every authorisation check in the implementation compares an incoming address
against a _role_ stored on the escrow — never against a literal. The
specification therefore quantifies over roles:

| Role         | Meaning                                                       |
| ------------ | ------------------------------------------------------------- |
| `Client`     | funded the escrow; the counterparty who pays                  |
| `Freelancer` | performs the work; the counterparty who is paid               |
| `Arbitrator` | optional third signer; nominating one enables 2-of-3 multisig |
| `Referrer`   | optional; receives the platform fee instead of the protocol   |
| `Admin`      | protocol administrator; receives the fee by default           |
| `Oracle`     | optional per-milestone attestor                               |
| `Outsider`   | every address holding none of the above                       |

`Outsider` is what makes the authorisation properties meaningful: it stands for
the unbounded set of addresses an attacker controls. A property proved for
`Outsider` holds for all of them, because no check in the contract can
distinguish one from another.

### 2.2 Escrow

```
Escrow {
  amount            : i128          -- deposited at creation, never mutated
  status            : Status
  milestones        : [Milestone]   -- 0..5, amounts sum to `amount`
  has_arbitrator    : bool          -- 2-of-3 multisig required
  has_referrer      : bool          -- fee routing
  in_referral_tree  : bool          -- multi-level bonus replaces the flat fee
  release_votes     : [bool; 3]     -- per-signer, not a counter
  refund_votes      : [bool; 3]
}

Status = Locked | InProgress | Released | Refunded | Disputed
```

`release_votes` is an array of three booleans rather than an integer counter,
and that is load-bearing. A counter can be incremented twice by one party; an
array indexed by signer cannot. The multisig invariant (I6) is stated over the
array precisely so that "two approvals" cannot mean "one party, twice".

### 2.3 Funds

```
Funds {
  deposited        : i128   -- ground truth
  held             : i128   -- still in the contract for this escrow
  paid_freelancer  : i128
  paid_client      : i128
  paid_referrer    : i128
  paid_admin       : i128
  paid_tree        : i128   -- multi-level referral bonuses, aggregated
}
```

Everything else partitions `deposited`. Value conservation is a statement about
this struct alone, which is what makes it checkable without knowing anything
about token contracts.

---

## 3. The invariants

Stated once in
[`invariants.rs`](../contracts/marketpay-spec/src/invariants.rs); every
verification technique in the subsystem calls the same predicates. An invariant
checked by only one technique stops being checked the moment that technique is
skipped.

### I1 — Value conservation

> Everything deposited is either still held by the contract or has been paid
> out, and nothing else was ever created.

```
deposited == held + paid_freelancer + paid_client
                  + paid_referrer + paid_admin + paid_tree
```

This is the invariant a double-spend breaks. Because the contract holds every
escrow's balance in one account, an escrow that pays out more than it took in
does not fail — it succeeds, using another escrow's money. I1 is what makes
that visible.

### I2 — No dust after settlement

> Once an escrow reaches `Released` or `Refunded`, the contract holds nothing
> further on its behalf.

```
status ∈ {Released, Refunded}  ⟹  held == 0
```

### I3 — An escrow settles exactly once

> An escrow enters a settled status at most once, so its funds are distributed
> exactly one time.

Stated as a counter over transitions into `{Released, Refunded}`, not as a
status check, because the question is how many times the _distribution_ ran.

### I4 — No fund movement without authorisation

> No execution path moves funds without the authorisation the entrypoint's
> precondition demands.

I4 is a property of a _transition_, not of a state: you cannot decide it by
looking at what the state became. It is checked at the point each action is
applied, against the authorised-caller set in §4.2.

### I5 — Payouts plus fees are exact

> The sum of every payout and every fee equals the amount released, with no
> remainder and no rounding slack.

```
fee              == release_amount * 100 / 10000     (truncating)
to_freelancer    == release_amount - fee
fee + to_freelancer == release_amount
```

The fee truncates downward, so the freelancer absorbs the remainder. That
direction is deliberate and is the reason there is no dust: rounding the fee
_up_ would take more than 1% and, on an escrow smaller than the basis-point
denominator, would take the entire payment.

### I6 — Multisig threshold

> An escrow created with an arbitrator settles only after two of its three
> signers have approved that action.

Stated over `release_votes` / `refund_votes` — distinct signers — not over the
approval counter.

**This binds every fund-moving path, not only `approve_release`.** Nominating
an arbitrator is a statement that no single party moves this escrow's funds. An
entrypoint that pays out while exempting itself from I6 has not found a
loophole; it has broken the invariant. Two such entrypoints existed (§6 F1, F5).

### I7 — Non-negative balances

> No balance or payout total is ever negative.

### I8 — Milestone sum

> When milestones are present, their amounts sum to exactly the escrow amount.

### I9 — Transition relation

> Every status change the escrow makes is an edge the relation in §4 permits.

---

## 4. The transition relation

### 4.1 Legal edges

The complete relation, as data, is
[`LEGAL_TRANSITIONS`](../contracts/marketpay-spec/src/transitions.rs). Anything
absent from it is a specification violation by definition.

```
                    ┌──────────────────────────────────┐
                    │                                  │
   create           ▼          start_work              │
  ──────────►  ╔════════╗ ──────────────► ╔════════════╗
               ║ Locked ║                 ║ InProgress ║
               ╚════════╝ ◄─────────────  ╚════════════╝
                 │  │  │    (no edge back)   │      │
       refund /  │  │  │ raise_dispute       │      │ raise_dispute
       timeout   │  │  └──────────┐          │      └────────┐
                 │  │             ▼          │               ▼
                 │  │        ╔══════════╗    │        ╔══════════╗
                 │  │        ║ Disputed ║◄───┘        ║ Disputed ║
                 │  │        ╚══════════╝             ╚══════════╝
                 │  │              │  resolve_arbitration │
                 │  │ release      │  / final milestone   │
                 ▼  └──────────────┼──────────────────────┘
          ╔══════════╗             ▼
          ║ Refunded ║       ╔══════════╗
          ╚══════════╝       ║ Released ║
                             ╚══════════╝
```

Written out, with the action class that may take each edge:

| From       | To         | Via                                                 |
| ---------- | ---------- | --------------------------------------------------- |
| Locked     | Locked     | `Create`, `PartialPayout`, `ApprovalBelowThreshold` |
| Locked     | InProgress | `StartWork`                                         |
| Locked     | Released   | `Release`, `FinalMilestonePayout`                   |
| Locked     | Refunded   | `Refund`                                            |
| Locked     | Disputed   | `Dispute`                                           |
| InProgress | InProgress | `PartialPayout`, `ApprovalBelowThreshold`           |
| InProgress | Released   | `Release`, `FinalMilestonePayout`                   |
| InProgress | Disputed   | `Dispute`                                           |
| Disputed   | Disputed   | `PartialPayout`                                     |
| Disputed   | Released   | `FinalMilestonePayout`, arbitration resolution      |

Two absences are intentional and worth stating explicitly:

- **`InProgress → Refunded` is not an edge.** A refund is specified only before
  work starts. Once the freelancer has begun, the exit is a release, a
  milestone settlement, or arbitration.
- **`Released`/`Refunded` have no outgoing edges.** They are terminal. I3 is
  the formal statement of this.

### 4.2 Authorised callers

| Entrypoint                                | Authorised                     | Notes                                   |
| ----------------------------------------- | ------------------------------ | --------------------------------------- |
| `create_escrow`                           | Client                         | funds move _in_                         |
| `start_work`                              | Client                         |                                         |
| `release_escrow`                          | Client                         | refused when `has_arbitrator`           |
| `release_with_conversion`                 | Client                         | refused when `has_arbitrator` (§6 F1)   |
| `refund_escrow`                           | Client                         | refused when `has_arbitrator`           |
| `timeout_refund`                          | Client                         | refused when `has_arbitrator` (§6 F2)   |
| `partial_release`                         | Client                         | refused when `has_arbitrator` (§6 F5)   |
| `verify_milestone_oracle`                 | the configured Oracle          | refused when `has_arbitrator`           |
| `approve_release` / `approve_refund`      | Client, Freelancer, Arbitrator | one vote each                           |
| `raise_dispute`                           | Client, Freelancer             | refused when already `Disputed` (§6 F7) |
| `cast_arbitration_vote`                   | a seated panel arbitrator      | one vote each (§6 F6)                   |
| `resolve_arbitration`                     | permissionless                 | the three votes are the authorisation   |
| `open_arbitration`, `register_arbitrator` | Admin                          |                                         |

`resolve_arbitration` being permissionless is a deliberate choice, not an
oversight: the panel's votes are what authorise the settlement, and requiring a
further signature to _execute_ an already-decided outcome would give whoever
holds that signature a veto the design never intended them to have.

### 4.3 Per-entrypoint contracts

Full pre/postconditions are the executable
[`model.rs`](../contracts/marketpay-spec/src/model.rs); the fund-moving ones in
prose:

**`create_escrow(job_id, client, params)`**

- **Pre:** client authorises; `amount > 0`; milestones ≤ 5, each positive,
  summing to `amount`; referrer ∉ {client, freelancer}; arbitrator ∉ {client,
  freelancer}; no escrow exists for `job_id`.
- **Post:** `held = deposited = amount`; `status = Locked`; all milestones
  unpaid; escrow count incremented.

**`release_escrow(job_id, client)`**

- **Pre:** caller is the escrow's client; `¬has_arbitrator`;
  `status ∈ {Locked, InProgress}`.
- **Post:** `fee = release_amount·100/10000` routed to referrer if set, else
  admin (or, in the referral tree, up to 3.00% across ancestors);
  `release_amount − fee` to the freelancer; `held = 0`; `status = Released`;
  `settlements` incremented by exactly 1.

**`approve_release(job_id, signer)`**

- **Pre:** `has_arbitrator`; signer ∈ {client, freelancer, arbitrator};
  `status ∈ {Locked, InProgress}`; signer has not already approved release.
- **Post:** signer's vote recorded. If two _distinct_ signers have now approved,
  the `release_escrow` postcondition holds; otherwise the status is unchanged
  and no funds move.

**`refund_escrow(job_id, client)` / `timeout_refund(job_id, client)`**

- **Pre:** caller is the client; `¬has_arbitrator`; `status = Locked`;
  for `timeout_refund`, the deadline has passed.
- **Post:** the client receives **what the contract still holds for this
  escrow** — not `escrow.amount`. `held = 0`; `status = Refunded`.

  The distinction is the whole of §6 F2. After a milestone payout the two
  figures differ, and refunding the larger one takes the difference from
  another escrow.

**`partial_release(job_id, index, client)`**

- **Pre:** caller is the client; `¬has_arbitrator`;
  `status ∈ {Locked, InProgress, Disputed}`; `index` valid and unpaid.
- **Post:** `milestones[index].amount` to the freelancer; that milestone marked
  paid. If it was the last, `status = Released` and `held = 0`; otherwise the
  status is unchanged.

**`resolve_arbitration(case_id)`**

- **Pre:** three votes from three distinct seated arbitrators; the case is open.
- **Post:** `resolution` = the median vote. The escrow's remaining balance is
  split `resolution`% to the client and the residual to the freelancer — the
  freelancer's share computed as a subtraction, not a second percentage, so the
  two reconstruct the balance exactly however the division truncates.
  `status = Released`; `held = 0`.

---

## 5. What is verified, and within what bound

Full detail, including why each tool was chosen and what it cannot do, is in
[VERIFICATION.md](./VERIFICATION.md). In summary:

| Property                       | Technique                        | Bound                                                         |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------- |
| I1, I2, I3, I5, I6, I7, I8, I9 | exhaustive bounded model check   | 7 calls deep, 4 amounts × 17 escrow shapes, all interleavings |
| I5 fee exactness               | Kani (symbolic)                  | all `i128` up to 2^100                                        |
| I5 no dust from truncation     | Kani (symbolic)                  | all `i128` up to 2^40                                         |
| referral bonus ≤ release       | Kani (symbolic)                  | all `i128` up to 2^100                                        |
| I1, I2 over a settlement       | Kani (symbolic)                  | all `i128` up to 2^100, fixed 3-call sequence                 |
| I4 authorisation               | Kani (symbolic)                  | all parties × 6 fund-moving entrypoints                       |
| I6 multisig threshold          | Kani (symbolic)                  | all signer pairs, all orders                                  |
| I1–I9 vs. the real contract    | differential + invariant fuzzing | 4 000 random schedules × 8 calls                              |

**Nothing here is an unbounded proof.** Every claim is bounded and the bound is
written down. Saying otherwise would be worse than the bound itself.

---

## 6. Findings: where the design and the implementation disagreed

Each was found by the technique named, is fixed, and has a committed regression
test in
[`tests/regressions.rs`](../contracts/marketpay-contract/tests/regressions.rs).

### F1 — `release_with_conversion` bypassed the multisig _(critical)_

**Found by:** differential testing.

`release_escrow` refuses an arbitrated escrow and directs the caller to
`approve_release`. `release_with_conversion` performed the same settlement and
carried no such guard. On a 2-of-3 escrow the client alone could move the
entire balance to the freelancer, with zero approvals recorded. Converting the
payout asset is not a reason to dissolve the arbitrator's stake in the outcome.

**Fixed:** the conversion path now carries `release_escrow`'s preconditions and
settles through the same core.

### F2 — a refund could pay out more than was deposited _(critical)_

**Found by:** differential testing, confirmed by the bounded model checker.

`partial_release` pays a milestone out and, while milestones remain, leaves the
status at `Locked`. `refund_escrow_core` accepted `Locked` and transferred
`escrow.amount` — the _original_ deposit. The pair paid out 1400 against a 1000
deposit.

Because the contract holds every escrow's balance in one account, the excess did
not fail for lack of funds. It came out of an unrelated escrow:

```
escrow A (victim):   2000 deposited, untouched
escrow B (attacker): 1000 deposited, milestones [400, 600]

  partial_release(B, 0)  → freelancer +400, contract holds 2600
  refund_escrow(B)       → client     +1000  ← escrow.amount, not the remainder
                           contract holds 1600

  B deposited 1000 and paid out 1400. A is now 400 short.
```

`timeout_refund` carried the same defect, so the drain was also reachable by
waiting rather than asking.

**Fixed:** both paths refund `unpaid_remainder()` — what the contract still
holds — rather than `escrow.amount`.

### F3 — `release_with_conversion` charged no platform fee

**Found by:** differential testing.

It settled in full and paid 100% to the freelancer. Every other release path
charges 1%. Asking for a different payout asset was a way to opt out of the fee
schedule entirely, which also broke I5: payouts plus fees did not reconstruct
the escrowed amount.

**Fixed:** by the same delegation that fixed F1.

### F4 — a disputed escrow had no settlement path _(critical)_

**Found by:** specification review; confirmed by differential testing.

`raise_dispute` moves an escrow to `Disputed`. Every settlement path except the
milestone one refuses that status, and `resolve_arbitration` computed a split
percentage and moved no funds at all. A disputed non-milestone escrow therefore
had **no reachable terminal state** — the funds were locked permanently, and
either participant could put them there with a single unilateral call.

Arbitration was, in effect, decorative: it seated a panel, collected votes,
computed a median, and did nothing with it.

**Fixed:** `resolve_arbitration` now settles the escrow according to the panel's
median vote, splitting the remaining balance between client and freelancer.

### F5 — milestone payouts bypassed the multisig _(critical)_

**Found by:** the bounded model checker, at depth 7. Not found by hand, and not
by any example test.

On an arbitrated escrow with milestones, the client could call
`partial_release` for each milestone in turn and drive the escrow all the way
to `Released` having collected no approvals at all. `verify_milestone_oracle`
was the same bypass under a different authorisation — and the client nominates
the oracle.

This is the finding that justifies the whole subsystem. It needed a checker
willing to try every interleaving, because the sequence is only wrong when read
as a whole: each individual call looks correct.

**Fixed:** both milestone payout paths refuse arbitrated escrows.

### F6 — one arbitrator could cast the whole panel's vote

**Found by:** specification review.

`cast_arbitration_vote` checked that the caller was a seated arbitrator and
that fewer than three votes had been cast, but recorded nothing about _who_ had
voted. A single panel member could call three times and set the median alone.
The `DisputeCase` struct already had a `voters` field; `ArbitrationCase`, the
one actually used, did not.

**Fixed:** `ArbitrationCase` records voters and rejects a repeat.

### F7 — an already-disputed escrow could be disputed again

**Found by:** invariant fuzzing, seed 45.

Benign for funds, but it emitted a second `escrow_ds` event, so anything reading
the event stream — indexers, the notification path — saw a dispute that had not
happened.

**Fixed:** rejected.

### F8 — `src/insurance.rs` is not compiled _(open, non-blocking)_

455 lines defining a second `#[contract]` with its own premium and payout
logic, including a `token.transfer`. `lib.rs` declares `referral`, `oracle` and
`reputation` as modules; it does not declare `insurance`. The file has never
been compiled, tested, or deployed.

**Not fixed here.** Wiring it in would add an unspecified fund-moving surface,
which is the opposite of this change's purpose. It is recorded so the next
person does not mistake its presence for coverage. It needs either a
specification of its own or deletion.

### F9 — duplicated storage key definitions _(open, cosmetic)_

`DataKey` in `lib.rs` declares `ReferralParent`, `ReferralChildren` and
`ReferralDepth`, but `referral.rs` stores under its own `ReferralKey` enum. The
`DataKey` variants are unreachable. Harmless today; a trap for anyone who reads
`DataKey` as the storage schema.

### F10 — `open_arbitration` panel selection is predictable _(open, design)_

Panel members are chosen by `ledger().sequence() % pool.len()`. The ledger
sequence is public and predictable, so a party who can choose when to open a
case can choose the panel. Fixing this needs a randomness source the contract
does not currently have; recorded rather than papered over.

---

## 7. The rule this specification imposes

**Changing a fund-moving entrypoint requires updating this specification.**

Concretely, a change to any entrypoint in §4.2 must also update
[`model.rs`](../contracts/marketpay-spec/src/model.rs), and — if it changes who
may call it or which statuses it spans —
[`transitions.rs`](../contracts/marketpay-spec/src/transitions.rs).

This is enforced, not requested. The differential tests drive the contract and
the model through identical sequences and compare status, contract balance and
every party's balance. An implementation that moves while the specification
stays put fails CI, and the failure names the divergence.

Counterexamples are committed as regression tests in the same change that fixes
them. Nothing is closed on the strength of "the checker passes now".
