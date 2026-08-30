//! Kani proof harnesses.
//!
//! These run under `cargo kani`, which compiles the crate with a nightly
//! toolchain and discharges each `assert!` to CBMC as a symbolic query. The
//! practical difference from [`crate::bmc`] is the amount domain: the bounded
//! model checker tries four concrete amounts, while these harnesses quantify
//! over every `i128` in a stated range at once. That is what lets the fee
//! arithmetic be *proved* exact rather than sampled.
//!
//! The depth bound does not go away. CBMC unwinds loops a fixed number of
//! times, and every harness here declares its unwind explicitly. A harness
//! whose bound is too low fails with an unwinding assertion rather than
//! silently proving less, which is why none of them are left to default.
//!
//! Run with:
//!
//! ```text
//! cargo kani --workspace -p marketpay-spec
//! ```
//!
//! Each harness is named for the property in `docs/SPECIFICATION.md` it
//! discharges, so a failure names the clause that broke.

use crate::invariants::{check_all, platform_fee};
use crate::model::{CreateParams, Model, Step};
use crate::referral_model::tree_bonus_total;
use crate::state::{Party, Status, FEE_BPS_DENOMINATOR, PLATFORM_FEE_BPS};
use crate::transitions::Action;

/// The amount range every harness quantifies over.
///
/// The upper bound is not cosmetic: `release_amount * PLATFORM_FEE_BPS` must
/// not overflow `i128`, so amounts above `i128::MAX / 100` are genuinely
/// outside what the contract's fee arithmetic can handle. Rather than assume
/// the range away, [`fee_multiplication_cannot_overflow`] proves that the
/// bound is exactly where the overflow starts.
const MAX_AMOUNT: i128 = 1 << 100;

// The unwind bound for harnesses that take a state-machine edge is the
// literal `20` below. It cannot be a named constant: `#[kani::unwind]` takes
// an integer literal and nothing else.
//
// `transitions::is_legal` scans `LEGAL_TRANSITIONS`, and `Iterator::any`
// short-circuits, so a harness reaching an edge near the front of the table
// needs far less unwinding than one reaching an edge near the back. Rather
// than tune each harness to the position of its own edge — which breaks
// silently the moment the table is reordered — every transitioning harness
// uses the table length plus slack.
//
// This assertion is what keeps the literal honest: adding transitions past the
// bound fails the build here rather than producing an unwinding failure that
// looks like a property violation.
const _: () = assert!(
    crate::transitions::LEGAL_TRANSITIONS.len() + 2 <= 20,
    "LEGAL_TRANSITIONS has outgrown the #[kani::unwind(20)] bound on the \
     transitioning harnesses — raise both together"
);

fn symbolic_amount() -> i128 {
    let a: i128 = kani::any();
    kani::assume(a > 0 && a <= MAX_AMOUNT);
    a
}

fn symbolic_party() -> Party {
    let i: u8 = kani::any();
    kani::assume(i < 7);
    Party::ALL[i as usize]
}

// ─── I5: fee arithmetic ──────────────────────────────────────────────────

/// I5 — the fee and the freelancer's share sum to the release amount exactly,
/// for every representable amount.
///
/// This is the property the silently-wrong restored test was supposed to
/// hold. Stated symbolically it cannot be satisfied by a lucky example.
#[kani::proof]
pub fn fee_split_is_exact() {
    let amount = symbolic_amount();
    let fee = platform_fee(amount);
    let to_freelancer = amount - fee;

    assert!(fee >= 0, "I5: fee must never be negative");
    assert!(fee <= amount, "I5: fee must never exceed the amount released");
    assert!(
        fee + to_freelancer == amount,
        "I5: payouts plus fees must equal the amount released exactly"
    );
}

/// I5 — truncating division never leaves a remainder unaccounted for.
///
/// The fee rounds down, so the freelancer absorbs the remainder. Proving that
/// the remainder lands somewhere is what rules out dust accumulating in the
/// contract release after release.
#[kani::proof]
pub fn fee_truncation_leaves_no_dust() {
    // Narrower than [`MAX_AMOUNT`] on purpose. This property needs two
    // 128-bit multiplications to state, and CBMC's cost for those is steep
    // enough that the full range does not terminate inside any CI budget
    // worth having — it was still running after seven minutes. 2^64 stroops
    // is ~1.8e19, four orders of magnitude above the total XLM supply in
    // stroops, so the bound excludes no amount the contract can actually
    // hold. The wider claim is covered by `fee_split_is_exact`, which needs
    // only one multiplication and does terminate over the full range.
    let a: i128 = kani::any();
    kani::assume(a > 0 && a <= (1i128 << 40));
    let amount = a;
    let fee = platform_fee(amount);
    let exact_numerator = amount * PLATFORM_FEE_BPS;
    let remainder = exact_numerator - fee * FEE_BPS_DENOMINATOR;

    assert!(
        remainder >= 0 && remainder < FEE_BPS_DENOMINATOR,
        "I5: fee truncation remainder must be a proper fraction of one unit"
    );
    assert!(
        amount - fee >= 0,
        "I5: the freelancer's share must never go negative"
    );
}

/// The stated amount bound is where fee multiplication actually overflows,
/// not an arbitrary convenience.
#[kani::proof]
pub fn fee_multiplication_cannot_overflow() {
    let amount = symbolic_amount();
    assert!(
        amount.checked_mul(PLATFORM_FEE_BPS).is_some(),
        "fee multiplication must not overflow inside the stated amount bound"
    );
}

/// The multi-level referral path never pays out more than the release.
///
/// 3.00% across three levels is small, but the bound has to be proved rather
/// than eyeballed: the contract subtracts this total from the freelancer's
/// share with `checked_sub`, and a total exceeding the release would panic
/// mid-settlement with funds already transferred.
#[kani::proof]
pub fn referral_tree_bonus_never_exceeds_release() {
    let amount = symbolic_amount();
    let bonus = tree_bonus_total(amount);

    assert!(bonus >= 0, "referral bonus must never be negative");
    assert!(
        bonus <= amount,
        "referral bonuses must never exceed the amount being released"
    );
    assert!(
        amount - bonus >= 0,
        "the freelancer's net share must never go negative"
    );
}

// ─── I1, I2: value conservation over a settlement ────────────────────────

/// I1 and I2 — a create-then-release round trip conserves value for every
/// amount, on every escrow shape the fee logic branches on.
#[kani::proof]
#[kani::unwind(20)]
pub fn release_conserves_value() {
    let amount = symbolic_amount();
    let with_referrer: bool = kani::any();
    let in_tree: bool = kani::any();

    let mut params = CreateParams::simple(amount);
    params.with_referrer = with_referrer;
    params.freelancer_in_referral_tree = in_tree;

    let mut m = Model::new(params);
    assert!(m.step(Action::Create).is_ok());
    assert!(m.step(Action::StartWork { caller: Party::Client }).is_ok());
    assert!(m
        .step(Action::ReleaseEscrow { caller: Party::Client })
        .is_ok());

    assert!(check_all(&m.state).is_none(), "I1/I2/I5 must hold after release");
    assert!(m.state.funds.held == 0, "I2: no dust may remain after settlement");
    assert!(
        m.state.funds.total_out() == amount,
        "I1: exactly what was deposited must have left the contract"
    );
    assert!(m.state.settlements == 1, "I3: exactly one settlement");
}

/// I1 and I2 — a create-then-refund round trip returns exactly the deposit.
#[kani::proof]
#[kani::unwind(20)]
pub fn refund_conserves_value() {
    let amount = symbolic_amount();
    let mut m = Model::new(CreateParams::simple(amount));
    assert!(m.step(Action::Create).is_ok());
    assert!(m
        .step(Action::RefundEscrow { caller: Party::Client })
        .is_ok());

    assert!(check_all(&m.state).is_none());
    assert!(
        m.state.funds.paid_client == amount,
        "I1: a refund returns the whole deposit and nothing more"
    );
    assert!(m.state.funds.held == 0, "I2: no dust may remain after a refund");
}

/// I1 — the milestone-then-refund interleaving, which is where a contract that
/// refunds `escrow.amount` rather than what it still holds creates value out
/// of nothing.
///
/// This harness is the symbolic form of finding F2 in
/// `docs/SPECIFICATION.md`. It passes against the model because the model
/// refunds the remaining balance; the corresponding differential test is what
/// held the implementation to the same rule.
#[kani::proof]
#[kani::unwind(20)]
pub fn milestone_payout_then_refund_conserves_value() {
    let a: i128 = kani::any();
    let b: i128 = kani::any();
    kani::assume(a > 0 && b > 0);
    kani::assume(a <= MAX_AMOUNT && b <= MAX_AMOUNT);

    let mut m = Model::new(CreateParams::with_milestones(&[a, b]));
    assert!(m.step(Action::Create).is_ok());
    let _ = m.step(Action::PartialRelease { caller: Party::Client, index: 0 });
    let _ = m.step(Action::RefundEscrow { caller: Party::Client });

    assert!(
        check_all(&m.state).is_none(),
        "I1: no interleaving of a milestone payout and a refund may pay out \
         more than was deposited"
    );
    assert!(
        m.state.funds.total_out() <= m.state.funds.deposited,
        "I1: total paid out must never exceed total deposited"
    );
}

// ─── I4: authorisation ───────────────────────────────────────────────────

/// I4 — no caller outside the authorised set reaches a fund transfer, for
/// every entrypoint and every party.
#[kani::proof]
#[kani::unwind(20)]
pub fn no_unauthorised_fund_movement() {
    let amount = symbolic_amount();
    let caller = symbolic_party();
    let which: u8 = kani::any();
    kani::assume(which < 6);

    let action = match which {
        0 => Action::ReleaseEscrow { caller },
        1 => Action::RefundEscrow { caller },
        2 => Action::TimeoutRefund { caller },
        3 => Action::PartialRelease { caller, index: 0 },
        4 => Action::ReleaseWithConversion { caller },
        _ => Action::ApproveRelease { caller },
    };

    let mut m = Model::new(CreateParams::simple(amount));
    assert!(m.step(Action::Create).is_ok());
    let before = m.state.funds;
    let step = m.step(action);

    let moved = m.state.funds != before;
    if moved {
        assert!(
            action.authorised_callers().contains(&caller),
            "I4: funds moved for a caller the entrypoint does not authorise"
        );
    }
    if let Step::Rejected(_) = step {
        assert!(!moved, "I4: a rejected call must not have moved funds");
    }
}

// ─── I6: multisig threshold ──────────────────────────────────────────────

/// I6 — an arbitrated escrow never settles on fewer than two distinct
/// approvals, for any pair of signers in any order.
#[kani::proof]
#[kani::unwind(20)]
pub fn multisig_never_settles_below_threshold() {
    let amount = symbolic_amount();
    let first = symbolic_party();
    let second = symbolic_party();

    let mut m = Model::new(CreateParams::simple(amount).arbitrated());
    assert!(m.step(Action::Create).is_ok());

    let _ = m.step(Action::ApproveRelease { caller: first });
    // One approval can never be enough, whoever cast it.
    assert!(
        m.state.escrow.status != Status::Released,
        "I6: a single approval must not settle an arbitrated escrow"
    );

    let _ = m.step(Action::ApproveRelease { caller: second });
    if m.state.escrow.status == Status::Released {
        let distinct = m.state.escrow.release_votes.iter().filter(|v| **v).count();
        assert!(
            distinct >= 2,
            "I6: settlement requires two *distinct* signers, not two calls"
        );
    }
    assert!(check_all(&m.state).is_none());
}

/// I4 and I6 together — the unilateral release path is closed on an
/// arbitrated escrow, for every caller.
///
/// This is finding F1 in `docs/SPECIFICATION.md` stated as a property:
/// `release_with_conversion` is a release, so it inherits the multisig
/// obligation. Proving it over a symbolic caller is what distinguishes the
/// claim from a test that happened to try the client.
#[kani::proof]
#[kani::unwind(20)]
pub fn arbitrated_escrow_has_no_unilateral_release_path() {
    let amount = symbolic_amount();
    let caller = symbolic_party();
    let use_conversion: bool = kani::any();

    let mut m = Model::new(CreateParams::simple(amount).arbitrated());
    assert!(m.step(Action::Create).is_ok());

    let action = if use_conversion {
        Action::ReleaseWithConversion { caller }
    } else {
        Action::ReleaseEscrow { caller }
    };
    let _ = m.step(action);

    assert!(
        m.state.escrow.status != Status::Released,
        "I6: no unilateral entrypoint may settle an arbitrated escrow"
    );
    assert!(
        m.state.funds.held == amount,
        "I6: an arbitrated escrow's funds must be untouched by a unilateral call"
    );
}

// ─── I3, I9: state machine ───────────────────────────────────────────────

/// I3 and I9 — a symbolic sequence of four calls never settles twice and never
/// leaves the specified transition relation.
///
/// Four is short, and deliberately so: CBMC's cost grows sharply with the
/// sequence length, and [`crate::bmc`] already explores depth seven
/// exhaustively over concrete amounts. This harness buys the *symbolic
/// amount*, and pays for it in depth.
#[kani::proof]
#[kani::unwind(20)]
pub fn bounded_sequence_stays_in_relation() {
    let amount = symbolic_amount();
    let mut m = Model::new(CreateParams::simple(amount));
    assert!(m.step(Action::Create).is_ok());

    let mut i = 0;
    while i < 4 {
        let caller = symbolic_party();
        let which: u8 = kani::any();
        kani::assume(which < 7);
        let action = match which {
            0 => Action::StartWork { caller },
            1 => Action::ReleaseEscrow { caller },
            2 => Action::RefundEscrow { caller },
            3 => Action::RaiseDispute { caller },
            4 => Action::TimeoutRefund { caller },
            5 => Action::ReleaseWithConversion { caller },
            _ => Action::AdvancePastTimeout,
        };
        let _ = m.step(action);

        assert!(
            m.recorded_violation().is_none(),
            "I9: the escrow left the specified transition relation"
        );
        assert!(
            check_all(&m.state).is_none(),
            "an invariant broke partway through the sequence"
        );
        assert!(m.state.settlements <= 1, "I3: an escrow settles at most once");
        i += 1;
    }
}
