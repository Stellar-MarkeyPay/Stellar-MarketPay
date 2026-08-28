//! Counterexamples, committed.
//!
//! Every entry here is a concrete sequence that a verification technique found
//! and that the implementation got wrong. They are kept separate from
//! `differential.rs` — which states the *property* — because a property and
//! the specific trace that broke it fail differently, and a reader chasing a
//! regression wants the trace.
//!
//! The rule: a counterexample lands here in the same change that fixes it.
//! Nothing is closed on the strength of "the checker passes now".
//!
//! Each test names the technique that found it, so the record shows which
//! techniques are earning their keep.

mod harness;

use harness::Harness;
use marketpay_spec::invariants::platform_fee;
use marketpay_spec::state::{Party, Status};

/// Found by: differential testing (`f2_refund_after_a_milestone_payout…`).
///
/// A milestone payout leaves the status at `Locked` while milestones remain.
/// `refund_escrow` accepted `Locked` and returned `escrow.amount` — the
/// original deposit — so the pair paid out 1400 against a 1000 deposit, and
/// the extra 400 came out of an unrelated escrow's balance.
///
/// Fixed by `unpaid_remainder()`: a refund returns what the contract still
/// holds, not what was put in.
#[test]
fn regression_refund_after_milestone_does_not_drain_other_escrows() {
    let h = Harness::new(3_000);
    let victim = h.job("victim");
    let attacker = h.job("attacker");

    h.contract
        .create_escrow(&victim, &h.client, &h.create_params(2_000, None, false, false));
    h.contract.create_escrow(
        &attacker,
        &h.client,
        &h.create_params(1_000, Some(&[400, 600]), false, false),
    );

    h.contract.partial_release(&attacker, &0, &h.client);
    h.contract.refund_escrow(&attacker, &h.client);

    assert_eq!(
        h.balance(Party::Freelancer),
        400,
        "the freelancer keeps the milestone that was actually released"
    );
    assert_eq!(
        h.balance(Party::Client),
        600,
        "the client gets back only what was still held on their escrow"
    );
    assert_eq!(
        h.held(),
        2_000,
        "the unrelated escrow must still be fully funded"
    );
}

/// Found by: differential testing (`f2_…`), timeout variant.
///
/// `timeout_refund` carried the same `escrow.amount` refund as
/// `refund_escrow`, so the drain was reachable by waiting instead of asking.
#[test]
fn regression_timeout_refund_after_milestone_does_not_overpay() {
    let h = Harness::new(3_000);
    let victim = h.job("victim");
    let attacker = h.job("attacker");

    h.contract
        .create_escrow(&victim, &h.client, &h.create_params(2_000, None, false, false));
    h.contract.create_escrow(
        &attacker,
        &h.client,
        &h.create_params(1_000, Some(&[400, 600]), false, false),
    );

    h.contract.partial_release(&attacker, &0, &h.client);
    h.advance_past_timeout();
    h.contract.timeout_refund(&attacker, &h.client);

    assert_eq!(h.balance(Party::Client), 600);
    assert_eq!(h.held(), 2_000, "the unrelated escrow must be untouched");
}

/// Found by: differential testing (`f1_release_with_conversion_respects…`).
///
/// `release_escrow` refuses an arbitrated escrow; `release_with_conversion`
/// settled one on the client's signature alone, with zero approvals recorded.
#[test]
fn regression_conversion_release_cannot_bypass_multisig() {
    let amount = 1_000_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, true, false));

    assert!(h
        .contract
        .try_release_with_conversion(&job, &h.client, &h.token.address, &0)
        .is_err());
    assert_eq!(h.held(), amount);
    assert_eq!(h.status(&job), Some(Status::Locked));

    // The multisig path still works, and settles to the same place a plain
    // release would.
    h.contract.approve_release(&job, &h.client);
    h.contract.approve_release(&job, &h.arbitrator);
    assert_eq!(h.status(&job), Some(Status::Released));
    assert_eq!(h.held(), 0);
}

/// Found by: differential testing (`f3_release_with_conversion_charges…`).
///
/// The conversion path paid 100% to the freelancer and charged no platform
/// fee, so asking for a different payout asset was a way to opt out of the
/// fee schedule entirely.
#[test]
fn regression_conversion_release_charges_the_platform_fee() {
    let amount = 1_000_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));
    h.contract.start_work(&job, &h.client);
    h.contract
        .release_with_conversion(&job, &h.client, &h.token.address, &0);

    let fee = platform_fee(amount);
    assert_eq!(h.balance(Party::Admin), fee, "the fee is charged");
    assert_eq!(h.balance(Party::Freelancer), amount - fee);
    assert_eq!(
        h.balance(Party::Admin) + h.balance(Party::Freelancer),
        amount,
        "I5: payouts plus fees reconstruct the escrowed amount"
    );
}

/// Found by: bounded model checking (`bmc::check_all_configs`, depth 7).
///
/// Not found by hand and not by the example tests. On an arbitrated escrow
/// with milestones the client could call `partial_release` for each milestone
/// in turn and reach `Released` having collected no approvals at all — the
/// checker produced the seven-call sequence that does it.
#[test]
fn regression_milestone_payouts_cannot_bypass_multisig() {
    let amount = 1_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract.create_escrow(
        &job,
        &h.client,
        &h.create_params(amount, Some(&[400, 600]), true, false),
    );

    // The exact sequence the checker reported, minus the steps that only
    // shuffle the status around.
    assert!(h.contract.try_partial_release(&job, &0, &h.client).is_err());
    assert!(h.contract.try_partial_release(&job, &1, &h.client).is_err());
    assert_eq!(h.held(), amount, "no milestone may be paid out unilaterally");
    assert_eq!(h.status(&job), Some(Status::Locked));
}

/// Found by: bounded model checking, oracle variant.
///
/// `verify_milestone_oracle` is the same payout under a different
/// authorisation, so it was the same bypass. A client who can nominate the
/// oracle can nominate themselves.
#[test]
fn regression_oracle_milestone_payout_cannot_bypass_multisig() {
    let amount = 1_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract.create_escrow(
        &job,
        &h.client,
        &h.create_params(amount, Some(&[400, 600]), true, false),
    );
    h.contract.set_milestone_oracle(
        &job,
        &0,
        &h.oracle,
        &h.job("delivered"),
        &h.client,
    );

    let proof = soroban_sdk::Bytes::from_slice(&h.env, b"delivered");
    assert!(h
        .contract
        .try_verify_milestone_oracle(&job, &0, &h.oracle, &proof)
        .is_err());
    assert_eq!(h.held(), amount);
}

/// Found by: invariant fuzzing (seed 45, step 4).
///
/// `raise_dispute` accepted a call on an escrow that was already disputed. It
/// moved no funds, but it emitted a second `escrow_ds` event, so anything
/// reading the event stream saw a dispute that had not happened.
#[test]
fn regression_cannot_redispute_an_already_disputed_escrow() {
    let h = Harness::new(1_000);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(1_000, None, false, false));
    h.contract.raise_dispute(&job, &h.client);

    assert!(
        h.contract.try_raise_dispute(&job, &h.freelancer).is_err(),
        "a second dispute on the same escrow must be refused"
    );
    assert_eq!(h.status(&job), Some(Status::Disputed));
}

/// Found by: specification review (§6 F4), confirmed by differential testing.
///
/// A disputed non-milestone escrow had no reachable terminal state: every
/// settlement path refused `Disputed`, and `resolve_arbitration` only recorded
/// a percentage. Either participant could strand the funds permanently.
#[test]
fn regression_disputed_escrow_has_a_settlement_path() {
    let amount = 1_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));
    h.contract.start_work(&job, &h.client);
    h.contract.raise_dispute(&job, &h.freelancer);

    let panel = h.seat_arbitration_panel();
    let case_id = h.contract.open_arbitration(&job, &h.admin);
    h.contract.cast_arbitration_vote(&case_id, &panel[0], &0);
    h.contract.cast_arbitration_vote(&case_id, &panel[1], &50);
    h.contract.cast_arbitration_vote(&case_id, &panel[2], &100);
    h.contract.resolve_arbitration(&case_id);

    assert_eq!(h.status(&job), Some(Status::Released));
    assert_eq!(h.held(), 0, "no dust left behind");
    assert_eq!(h.balance(Party::Client), 500, "median vote is 50%");
    assert_eq!(h.balance(Party::Freelancer), 500);
}

/// Found by: specification review (§6 F6).
///
/// Nothing recorded which arbitrators had voted, so one member of the panel
/// could cast all three votes and set the median alone.
#[test]
fn regression_arbitrator_cannot_vote_twice() {
    let h = Harness::new(1_000);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(1_000, None, false, false));
    h.contract.raise_dispute(&job, &h.client);

    let panel = h.seat_arbitration_panel();
    let case_id = h.contract.open_arbitration(&job, &h.admin);
    h.contract.cast_arbitration_vote(&case_id, &panel[0], &100);

    assert!(h
        .contract
        .try_cast_arbitration_vote(&case_id, &panel[0], &100)
        .is_err());

    // A full panel still resolves normally.
    h.contract.cast_arbitration_vote(&case_id, &panel[1], &0);
    h.contract.cast_arbitration_vote(&case_id, &panel[2], &0);
    h.contract.resolve_arbitration(&case_id);
    assert_eq!(h.balance(Party::Freelancer), 1_000, "median of 100/0/0 is 0%");
}

/// Found by: Kani (`fee_split_is_exact`), confirmed concretely here.
///
/// The fee truncates, so for amounts below the basis-point denominator it is
/// zero and the freelancer must receive everything. An implementation that
/// rounded the fee up instead would silently take the entire payment on a
/// 1-stroop escrow.
#[test]
fn regression_tiny_escrows_pay_the_freelancer_in_full() {
    for amount in [1i128, 2, 50, 99] {
        let h = Harness::new(amount);
        let job = h.job("job");

        h.contract
            .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));
        h.contract.release_escrow(&job, &h.client);

        assert_eq!(platform_fee(amount), 0, "the fee truncates to zero here");
        assert_eq!(
            h.balance(Party::Freelancer),
            amount,
            "amount={amount}: the freelancer receives the whole payment"
        );
        assert_eq!(h.held(), 0, "I2: no dust");
    }
}
