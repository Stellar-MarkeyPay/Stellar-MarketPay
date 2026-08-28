# marketpay-spec

The formal specification, executable reference model and verification harnesses
for the [MarketPay escrow contract](../marketpay-contract).

Start with [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md) for what the
escrow guarantees, and [`docs/VERIFICATION.md`](../../docs/VERIFICATION.md) for
how much of that has been established and within what bounds.

## Layout

| module              | role                                                          |
| ------------------- | ------------------------------------------------------------- |
| `state.rs`          | the abstract escrow state, free of `soroban_sdk` types        |
| `invariants.rs`     | the properties that must hold (I1–I9), stated once            |
| `transitions.rs`    | the legal state-machine edges, stated as data                 |
| `model.rs`          | an executable reference implementation of the specification   |
| `referral_model.rs` | the multi-level referral payout arithmetic                    |
| `bmc.rs`            | exhaustive bounded checking; runs on every pull request       |
| `kani_harnesses.rs` | symbolic proofs; run nightly                                  |
| `trace.rs`          | counterexamples that read as call sequences, not solver dumps |

The crate has **no dependencies**, deliberately. It is consumed by three things
with three different constraints: the contract's differential tests (which need
it `no_std`-compatible, because the contract is), the bounded model checker
(which needs stock stable Rust so CI can gate on it), and Kani (which needs no
host-function boundary it cannot see through).

## Running it

```sh
# Exhaustive bounded check — under a second.
cargo test --release -- --nocapture

# The deeper nightly sweep.
BMC_DEPTH=9 cargo test --release -- --ignored --nocapture

# Symbolic proofs. Needs `cargo install --locked kani-verifier && cargo kani setup`.
# Minutes per harness; one takes over six.
cargo kani --no-default-features --harness fee_split_is_exact
```

The differential tests that hold the _contract_ to this specification live in
[`../marketpay-contract/tests/`](../marketpay-contract/tests/):

```sh
cd ../marketpay-contract
cargo test --features std --test differential
cargo test --features std --test regressions
FUZZ_ROUNDS=5000 cargo test --release --features std --test invariant_fuzz
```

## The rule

**Changing a fund-moving entrypoint requires updating `model.rs`**, and — if the
change touches who may call it or which statuses it spans —
`transitions.rs`. This is enforced by the differential tests, not requested:
an implementation that moves while the specification stays put fails CI, and
the failure names the divergence.

Counterexamples are committed as regression tests in the same change that fixes
them. Nothing is closed on the strength of "the checker passes now".
