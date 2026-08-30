# Verification Approach, Results and Limitations

**Companion to:** [SPECIFICATION.md](./SPECIFICATION.md)
**Subject:** `contracts/marketpay-contract` — the escrow that holds user funds

This document is the honest half of the pair. SPECIFICATION.md says what the
contract is supposed to do; this one says how much of that has actually been
established, by what means, and — at length — what has not.

An unbounded proof is rarely achievable, and pretending otherwise is worse than
stating the bound. Every bound in this subsystem is written down, and §5 is the
part to read before relying on any of it.

---

## 1. Why not verify `lib.rs` directly

The obvious approach is to point a verifier at the contract. It does not work,
for a reason worth stating precisely because it shapes everything else here.

A Soroban contract does not compute in the ordinary sense. Almost every line of
`lib.rs` is a call across a host boundary:

```rust
env.storage().instance().get(&DataKey::Escrow(job_id))   // host call
token_client.transfer(&from, &to, &amount)               // cross-contract call
client.require_auth()                                    // host call
env.crypto().sha256(&payload)                            // host call
```

`Env` is a handle to the Soroban host. `soroban_sdk::Vec`, `String` and `Bytes`
are handles to objects _inside_ that host, not Rust data structures. On the
`wasm32` target these compile to `extern` imports with no bodies at all.

A symbolic execution engine reaching one of these has three options: refuse,
treat it as returning an unconstrained value, or execute the whole host. The
first stops the proof. The second discards every guarantee the storage layer
provides — an unconstrained `get` means the escrow you just wrote is not the
escrow you read back, and no invariant survives that. The third means verifying
`soroban-env-host` as well, which is a five-figure line count of `unsafe`,
budget metering and XDR, none of which is the contract's logic.

So: verifying the deployed artefact end-to-end is not on the table. What
follows is what _is_.

---

## 2. Tooling evaluated

### Kani — **chosen**, for arithmetic and authorisation

[Kani](https://model-checking.github.io/kani) compiles Rust to CBMC's goto
language and discharges assertions as SMT queries. It handles `i128` natively,
which matters: the fee arithmetic _is_ `i128` arithmetic, and a verifier that
models it as anything narrower proves the wrong thing.

- **Why:** first-class `i128`; a real bounded model checker rather than a
  linter; unwinding assertions that fail loudly when a bound is too low
  rather than silently proving less.
- **Cost:** a nightly toolchain and a ~1 GB solver bundle. Minutes per harness.
- **Limitation:** cannot see through the host boundary (§1), so it is pointed
  at the reference model rather than at `lib.rs`.

### Creusot / Prusti — **rejected**

Deductive verifiers with richer specification languages. Both need every
function on a call path annotated, including the ones inside `soroban-sdk`.
Annotating a dependency you do not own is not a maintenance position anyone can
hold, and neither tool tracks `soroban-sdk`'s release cadence.

### MIRAI — **rejected**

Abstract interpretation over MIR. Cheaper than Kani and it does run on real
crates, but its abstract domains are aimed at panics and taint. "The sum of
payouts plus fees equals the escrowed amount" is not expressible in them.

### `cargo fuzz` / `proptest` — **adopted as a complement, not a substitute**

Neither proves anything. Both are excellent at driving the _real_ contract
through sequences nobody wrote down. The change made here is the oracle: the
existing fuzz tests checked for absence of panics, which is a weak question —
a contract that pays the wrong party the wrong amount does not panic. They now
check the invariants. See §4.4.

### An SMT encoding by hand — **rejected**

Most faithful in principle; a second implementation to keep in sync in
practice. The differential tests already give a second implementation that
_executes_, and an executable model can be checked against the contract
mechanically. A hand-written SMT encoding cannot.

---

## 3. The approach that was chosen

```
   ┌──────────────────────────┐         ┌──────────────────────────┐
   │  marketpay-spec          │         │  marketpay-contract      │
   │                          │         │                          │
   │  invariants.rs   I1..I9  │         │  lib.rs   66 entrypoints │
   │  transitions.rs  δ       │         │  referral.rs             │
   │  model.rs        exec    │         │  oracle.rs               │
   └───────────┬──────────────┘         └────────────┬─────────────┘
               │                                     │
       ┌───────┴────────┐                            │
       │                │                            │
       ▼                ▼                            │
  ┌─────────┐    ┌──────────────┐                    │
  │  Kani   │    │  bmc.rs      │                    │
  │ symbolic│    │  exhaustive  │                    │
  │ amounts │    │  concrete    │                    │
  └─────────┘    └──────────────┘                    │
                                                     │
               ┌─────────────────────────────────────┘
               ▼
   ┌────────────────────────────────────────┐
   │  differential.rs / invariant_fuzz.rs   │
   │  same call sequence → both sides       │
   │  compare status, balances, acceptance  │
   └────────────────────────────────────────┘
```

The model is written **from the specification, not from the contract**. That
independence is the entire value. A model transcribed from the implementation
reproduces the implementation's bugs, agrees with it perfectly, and proves
nothing. Where the two disagree, one is wrong and somebody has to decide which
— which is how F1 through F7 in SPECIFICATION.md §6 were found.

---

## 4. What each technique establishes

### 4.1 Bounded model checking — `marketpay-spec/src/bmc.rs`

Exhaustive depth-first exploration of every interleaving of every entrypoint,
over 17 escrow shapes and 4 amounts, checking all state invariants after every
call.

**The reachable state space is closed.** Exploring to depth 8 finds 1673
distinct states; so does exploring to 9, 10, 12 and 14. No sequence of further
calls reaches a state the first eight had not already reached.

| depth | distinct states |
| ----- | --------------- |
| 6     | 1633            |
| 7     | 1667            |
| **8** | **1673**        |
| 9     | 1673            |
| 12    | 1673            |
| 14    | 1673            |

This makes the call-depth bound _vacuous for this abstraction_: the check is
exhaustive over reachable states, not merely bounded in the usual sense. The
bounds that remain real are the amount domain and the abstraction itself (§5).

The fixpoint is re-established on every run by
`saturation_is_reached_by_the_default_depth`, so it fails loudly rather than
going stale if the state machine grows.

Runtime: **under a second.** This is why it gates pull requests.

### 4.2 Kani symbolic proofs — `marketpay-spec/src/kani_harnesses.rs`

What the bounded checker cannot do is quantify over amounts: it tries four.
Kani quantifies over every `i128` in a stated range at once, which is what
turns "the fee was right for 1 000 000" into "the fee is right".

Results are in §6.

### 4.3 Differential testing — `marketpay-contract/tests/differential.rs`

Drives the real contract and the model through identical sequences, comparing
status, contract balance, and every party's balance after each call. Balances
are read from the _token contract_, not from the escrow record, so the
comparison measures what actually moved rather than what the contract believes
moved.

This is what caught F1, F2 and F3.

### 4.4 Invariant fuzzing — `marketpay-contract/tests/invariant_fuzz.rs`

Random call schedules against both sides, with four oracles:

1. the model's invariants;
2. **value conservation measured on the real token balances**, which does not
   go through the model at all and would have caught the cross-escrow drain
   even if the model had been wrong too;
3. contract and model agree on whether a call is accepted;
4. contract and model agree on the resulting status and balances.

Seeded deterministically, so a failure reproduces from the seed in the message.
Randomness that cannot be replayed turns a finding into a rumour. This is what
caught F7.

---

## 5. Limitations — what is _not_ verified

This is the section that matters. Read it before relying on anything above.

### 5.1 The deployed WASM is not what was verified

Everything here verifies a model, plus a differential correspondence between
that model and the contract _as executed by the Soroban test host_. It does not
verify the compiled `wasm32-unknown-unknown` artefact. A miscompilation, a
`soroban-sdk` bug, or a host-version behaviour change would not be caught.

### 5.2 The differential correspondence is tested, not proved

§4.3 and §4.4 are extremely good at finding divergences. They do not establish
that none remain. The properties proved about the model transfer to the
contract only as far as that correspondence holds, and the correspondence has
the strength of a test suite, not of a proof.

**This is the single largest gap in the subsystem.** Closing it would need
either a verifier that can reason about the host (§1) or a formal refinement
argument nobody has written.

### 5.3 The abstraction hides things

The model collapses `Address` to seven roles. That is sound for the
authorisation checks as written — every one compares against a role — but it
would stop being sound the moment a check compared against something else.
Nothing detects that automatically.

The model also treats one escrow at a time. Cross-escrow effects are visible
only where a test constructs them explicitly, as the F2 regression test does.
**A bug requiring three interacting escrows would not be found by the bounded
checker.**

Also outside the model entirely: storage TTL and archival, gas and budget
exhaustion, event payloads (except where a test asserts on them), contract
upgrade semantics, and the sealed-bid, reputation, certificate, governance and
messaging entrypoints. This subsystem covers the _fund-moving_ surface.

### 5.4 The amount domain is bounded even under Kani

The harnesses assume `0 < amount ≤ 2^100`, and `fee_truncation_leaves_no_dust`
assumes `≤ 2^40` because two 128-bit multiplications do not terminate over a
wider range inside any CI budget worth having.

2^100 is above any physically meaningful token supply. 2^40 stroops is about
110 000 XLM — comfortably above a single escrow, but _not_ above the whole
supply, and it is the narrowest bound in the suite. It is the first one to
widen if solvers get cheaper.

### 5.5 The sequence length under Kani is short

`bounded_sequence_stays_in_relation` explores four symbolic calls. CBMC's cost
grows sharply with sequence length, so this harness buys the symbolic amount
and pays for it in depth. The exhaustive coverage of _sequences_ comes from
§4.1, over concrete amounts. Neither gives both at once.

### 5.6 Findings recorded but not fixed

SPECIFICATION.md §6 lists three open items — F8 (`insurance.rs` is dead code
containing a `token.transfer`), F9 (duplicated storage-key definitions) and F10
(predictable arbitration panel selection). They are recorded rather than fixed
because each needs a decision this change is not the right place to make.

### 5.7 Verification is not an audit

Nothing here says the specification is the _right_ specification. It says the
implementation matches it, within the bounds above. Whether 2-of-3 multisig,
median-vote arbitration and a 1% truncating fee are the correct design is a
question for a human reviewer, which is why the specification is published.

---

## 6. Results

Kani harnesses, on a stock GitHub-hosted runner class:

| Harness                                            | Property          | Verdict          | Time |
| -------------------------------------------------- | ----------------- | ---------------- | ---- |
| `fee_split_is_exact`                               | I5                | SUCCESSFUL       | 3s   |
| `fee_multiplication_cannot_overflow`               | I5, no overflow   | SUCCESSFUL       | 1s   |
| `referral_tree_bonus_never_exceeds_release`        | I1, referral path | SUCCESSFUL       | 2s   |
| `refund_conserves_value`                           | I1, I2            | SUCCESSFUL       | 26s  |
| `release_conserves_value`                          | I1, I2, I3, I5    | see `kani-logs/` | —    |
| `milestone_payout_then_refund_conserves_value`     | I1 (F2)           | see `kani-logs/` | —    |
| `no_unauthorised_fund_movement`                    | I4                | see `kani-logs/` | —    |
| `multisig_never_settles_below_threshold`           | I6                | see `kani-logs/` | —    |
| `arbitrated_escrow_has_no_unilateral_release_path` | I4, I6 (F1)       | see `kani-logs/` | —    |
| `fee_truncation_leaves_no_dust`                    | I5, no dust       | see `kani-logs/` | —    |
| `bounded_sequence_stays_in_relation`               | I3, I9            | see `kani-logs/` | —    |

The nightly workflow uploads a per-harness log as the `kani-logs` artifact, with
a 900-second timeout each. A harness that exceeds it is reported as `TIMEOUT`
and pointed back at §5.4 — it is not silently recorded as a pass.

Bounded model check: 1673 states, 6295 accepted calls, 89 849 rejected calls,
1480 settlements, all invariants held, under a second.

Invariant fuzzing: 4 000 schedules × 8 calls, all four oracles held, 107s.

---

## 7. Where verification runs

Configured in [`.github/workflows/verification.yml`](../.github/workflows/verification.yml).

| Job                   | Trigger                                                                         | Cost              |
| --------------------- | ------------------------------------------------------------------------------- | ----------------- |
| `bounded-model-check` | every PR and push                                                               | seconds           |
| `differential`        | every PR and push                                                               | ~1 min            |
| `kani`                | nightly, `workflow_dispatch`, push to main, or a PR labelled `run-verification` | up to 90 min      |
| `deep-fuzz`           | nightly                                                                         | 100 000 schedules |
| `deep-bmc`            | nightly                                                                         | depth 9           |

The split is by cost. Gating pull requests on Kani would mean either a long
wait on every change or a lowered bound, and a lowered bound is the worse
trade. A pull request that wants the full treatment before merging asks for it
with the `run-verification` label.

---

## 8. Counterexamples

A verification failure that prints a solver dump costs more time than it saves.
Every checker in this subsystem produces a
[`Counterexample`](../contracts/marketpay-spec/src/trace.rs) instead:

```
╭─ SPECIFICATION VIOLATION ──────────────────────────────
│ I6 multisig threshold
│
│ an escrow created with an arbitrator settles only after two of its three
│ signers have approved that action
│
│ expected: 2
│ actual:   1
│
│ Reproducing call sequence:
│    1. create_escrow                by -           [ok      ] held=1000
│    2. <ledger advances past timeout> by -          [ok      ] held=1000
│    3. start_work                   by client      [ok      ] held=1000
│    4. approve_release              by client      [ok      ] held=1000
│    5. raise_dispute                by client      [ok      ] held=1000
│    6. partial_release              by client      [ok      ] held=600
│    7. partial_release              by client      [ok      ] held=0
│
│ Final state:
│   status            Released
│   multisig          yes (2-of-3)
│   release votes     client=true freelancer=false arbitrator=false
│   milestones        [400 paid] [600 paid]
│   deposited         1000
│   still held        0
│   → freelancer      1000
╰────────────────────────────────────────────────────────
```

That is the actual output that found F5. It says what broke, what the property
was, and exactly which seven calls to replay.

---

## 9. Maintenance

**Changing a fund-moving entrypoint requires updating the specification.** See
SPECIFICATION.md §7. It is enforced by the differential tests, not requested.

**Every counterexample is committed as a regression test**, in
[`tests/regressions.rs`](../contracts/marketpay-contract/tests/regressions.rs),
in the same change that fixes it. Nothing is closed on the strength of "the
checker passes now".
