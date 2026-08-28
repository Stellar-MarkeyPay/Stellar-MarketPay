//! Differential testing: the contract against the reference model.
//!
//! Each test drives `marketpay-contract` and `marketpay-spec`'s [`Model`]
//! through the *same* call sequence and compares what came out — status,
//! contract balance, and every party's balance. A divergence means one of the
//! two is wrong, and the test names which, rather than leaving it to the
//! reader.
//!
//! The tests that currently document a divergence are marked `DIVERGENCE Fn`
//! and cross-reference `docs/SPECIFICATION.md` §6. They assert the *specified*
//! behaviour, so they fail until the implementation is brought into line —
//! which is the point of writing them.

mod harness;

use harness::Harness;
use marketpay_spec::model::{CreateParams, Model};
use marketpay_spec::state::{Party, Status};
use marketpay_spec::transitions::Action;
use marketpay_spec::{check_all, invariants::platform_fee};

/// Assert that the contract's observable state matches the model's.
///
/// Balances are compared rather than internal fields on purpose: the model has
/// no notion of storage layout, and comparing what the *token contract* thinks
/// happened is what makes the comparison meaningful.
fn assert_agrees(h: &Harness, job: &soroban_sdk::String, m: &Model, context: &str) {
    let contract_status = h.status(job);
    let model_status = if m.created { Some(m.state.escrow.status) } else { None };
    assert_eq!(
        contract_status, model_status,
        "{context}: status diverged — contract says {contract_status:?}, \
         specification says {model_status:?}"
    );

    assert_eq!(
        h.held(),
        m.state.funds.held,
        "{context}: contract balance diverged — contract holds {}, \
         specification says it should hold {}",
        h.held(),
        m.state.funds.held
    );

    assert_eq!(
        h.balance(Party::Freelancer),
        m.state.funds.paid_freelancer,
        "{context}: freelancer payout diverged"
    );

    // Fees land on whichever party the escrow's configuration routes them to;
    // compare the total so the test does not have to re-derive the routing.
    let contract_fees = h.balance(Party::Referrer) + h.balance(Party::Admin);
    let model_fees = m.state.funds.paid_referrer + m.state.funds.paid_admin;
    assert_eq!(
        contract_fees, model_fees,
        "{context}: fee routing diverged"
    );

    assert!(
        check_all(&m.state).is_none(),
        "{context}: the model itself broke an invariant"
    );
}

// ─── Agreement on the paths that work ────────────────────────────────────

#[test]
fn plain_release_agrees_with_the_specification() {
    for amount in [1i128, 99, 10_001, 1_000_000] {
        let h = Harness::new(amount);
        let job = h.job("job");
        let mut m = Model::new(CreateParams::simple(amount));

        h.contract
            .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));
        assert!(m.step(Action::Create).is_ok());
        assert_agrees(&h, &job, &m, &format!("after create, amount={amount}"));

        h.contract.start_work(&job, &h.client);
        assert!(m.step(Action::StartWork { caller: Party::Client }).is_ok());
        assert_agrees(&h, &job, &m, &format!("after start_work, amount={amount}"));

        h.contract.release_escrow(&job, &h.client);
        assert!(m
            .step(Action::ReleaseEscrow { caller: Party::Client })
            .is_ok());
        assert_agrees(&h, &job, &m, &format!("after release, amount={amount}"));

        // I5 restated concretely: the fee and the payout reconstruct the whole.
        let fee = platform_fee(amount);
        assert_eq!(
            h.balance(Party::Freelancer) + h.balance(Party::Admin),
            amount,
            "I5: payouts plus fees must equal the escrowed amount exactly \
             (amount={amount}, fee={fee})"
        );
    }
}

#[test]
fn refund_agrees_with_the_specification() {
    let amount = 10_001i128;
    let h = Harness::new(amount);
    let job = h.job("job");
    let mut m = Model::new(CreateParams::simple(amount));

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));
    assert!(m.step(Action::Create).is_ok());

    h.contract.refund_escrow(&job, &h.client);
    assert!(m
        .step(Action::RefundEscrow { caller: Party::Client })
        .is_ok());

    assert_agrees(&h, &job, &m, "after refund");
    assert_eq!(h.balance(Party::Client), amount, "the whole deposit returns");
}

#[test]
fn multisig_release_agrees_with_the_specification() {
    let amount = 1_000_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");
    let mut m = Model::new(CreateParams::simple(amount).arbitrated());

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, true, false));
    assert!(m.step(Action::Create).is_ok());

    h.contract.approve_release(&job, &h.client);
    assert!(m
        .step(Action::ApproveRelease { caller: Party::Client })
        .is_ok());
    assert_agrees(&h, &job, &m, "after one approval");
    assert_eq!(h.held(), amount, "I6: one approval must not move funds");

    h.contract.approve_release(&job, &h.arbitrator);
    assert!(m
        .step(Action::ApproveRelease { caller: Party::Arbitrator })
        .is_ok());
    assert_agrees(&h, &job, &m, "after the threshold approval");
}

#[test]
fn milestone_payouts_agree_with_the_specification() {
    let h = Harness::new(1_000);
    let job = h.job("job");
    let mut m = Model::new(CreateParams::with_milestones(&[400, 600]));

    h.contract.create_escrow(
        &job,
        &h.client,
        &h.create_params(1_000, Some(&[400, 600]), false, false),
    );
    assert!(m.step(Action::Create).is_ok());

    h.contract.partial_release(&job, &0, &h.client);
    assert!(m
        .step(Action::PartialRelease { caller: Party::Client, index: 0 })
        .is_ok());
    assert_agrees(&h, &job, &m, "after the first milestone");

    h.contract.partial_release(&job, &1, &h.client);
    assert!(m
        .step(Action::PartialRelease { caller: Party::Client, index: 1 })
        .is_ok());
    assert_agrees(&h, &job, &m, "after the final milestone");
    assert_eq!(h.held(), 0, "I2: no dust after the last milestone settles");
}

// ─── Authorisation: I4, over every party ─────────────────────────────────

#[test]
fn no_party_but_the_client_can_release_or_refund() {
    for party in [
        Party::Freelancer,
        Party::Arbitrator,
        Party::Referrer,
        Party::Admin,
        Party::Oracle,
        Party::Outsider,
    ] {
        let amount = 1_000i128;
        let h = Harness::new(amount);
        let job = h.job("job");
        let caller = h.address_of(party);

        h.contract
            .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));

        assert!(
            h.contract.try_release_escrow(&job, &caller).is_err(),
            "I4: {party:?} must not be able to release the escrow"
        );
        assert!(
            h.contract.try_refund_escrow(&job, &caller).is_err(),
            "I4: {party:?} must not be able to refund the escrow"
        );
        assert!(
            h.contract.try_partial_release(&job, &0, &caller).is_err(),
            "I4: {party:?} must not be able to release a milestone"
        );
        assert_eq!(
            h.held(),
            amount,
            "I4: an unauthorised call must leave the balance untouched"
        );
    }
}

// ─── Divergences the verification found ──────────────────────────────────

/// DIVERGENCE F1 — `release_with_conversion` must not bypass the multisig.
///
/// `release_escrow` refuses an arbitrated escrow and directs the caller to
/// `approve_release`. `release_with_conversion` performs the same settlement
/// and carries no such guard, so on an arbitrated escrow the client alone can
/// move the entire balance to the freelancer. Converting the payout asset is
/// not a reason to dissolve the arbitrator's stake in the outcome.
///
/// See `docs/SPECIFICATION.md` §6 F1.
#[test]
fn f1_release_with_conversion_respects_the_multisig() {
    let amount = 1_000_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, true, false));

    let outcome = h
        .contract
        .try_release_with_conversion(&job, &h.client, &h.token.address, &0);

    assert!(
        outcome.is_err(),
        "F1/I6: release_with_conversion settled a 2-of-3 escrow on the \
         client's signature alone, with zero approvals recorded"
    );
    assert_eq!(
        h.held(),
        amount,
        "F1/I6: the arbitrated escrow's funds must be untouched"
    );
}

/// DIVERGENCE F2 — a refund must return what the contract still holds, not
/// the original deposit.
///
/// `partial_release` pays a milestone out and, while milestones remain,
/// leaves the status at `Locked`. `refund_escrow_core` accepts `Locked` and
/// transfers `escrow.amount` — the *original* figure — so the pair pays out
/// more than was ever deposited. With a single escrow the second transfer
/// simply fails for lack of funds; with the contract holding other escrows'
/// balances it succeeds, and drains them.
///
/// See `docs/SPECIFICATION.md` §6 F2.
#[test]
fn f2_refund_after_a_milestone_payout_conserves_value() {
    // Two escrows share the contract's balance, which is what makes the
    // over-payment land on someone else's money rather than simply failing.
    let h = Harness::new(3_000);
    let victim = h.job("victim");
    let attacker = h.job("attacker");

    h.contract.create_escrow(
        &victim,
        &h.client,
        &h.create_params(2_000, None, false, false),
    );
    h.contract.create_escrow(
        &attacker,
        &h.client,
        &h.create_params(1_000, Some(&[400, 600]), false, false),
    );
    assert_eq!(h.held(), 3_000);

    // Take one milestone. The escrow stays Locked because 600 is outstanding.
    h.contract.partial_release(&attacker, &0, &h.client);
    assert_eq!(h.balance(Party::Freelancer), 400);
    assert_eq!(h.held(), 2_600);

    // Now refund it. The specification says the client gets back the 600 the
    // contract still holds on this escrow's behalf.
    let _ = h.contract.try_refund_escrow(&attacker, &h.client);

    let paid_out_for_attacker = h.balance(Party::Freelancer) + h.balance(Party::Client);
    assert!(
        paid_out_for_attacker <= 1_000,
        "F2/I1: the escrow deposited 1000 but has paid out {paid_out_for_attacker}; \
         the excess came out of the other escrow's balance"
    );
    assert!(
        h.held() >= 2_000,
        "F2/I1: the untouched 2000 escrow must still be fully funded, but the \
         contract now holds only {}",
        h.held()
    );
}

/// DIVERGENCE F5 — milestone payouts must respect the multisig too.
///
/// Found by the bounded model checker, not by hand: on an arbitrated escrow
/// with milestones, the client can call `partial_release` for each milestone
/// in turn and drive the escrow all the way to `Released` having collected no
/// approvals at all. The arbitrator is bypassed entirely.
///
/// See `docs/SPECIFICATION.md` §6 F5.
#[test]
fn f5_milestone_payouts_respect_the_multisig() {
    let amount = 1_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract.create_escrow(
        &job,
        &h.client,
        &h.create_params(amount, Some(&[400, 600]), true, false),
    );

    let outcome = h.contract.try_partial_release(&job, &0, &h.client);
    assert!(
        outcome.is_err(),
        "F5/I6: the client paid out a milestone on a 2-of-3 escrow \
         unilaterally; repeating it for every milestone reaches Released with \
         zero approvals"
    );
    assert_eq!(h.held(), amount, "F5/I6: the funds must be untouched");
}

/// DIVERGENCE F3 — `release_with_conversion` must charge the platform fee.
///
/// It settles the escrow in full and pays 100% to the freelancer, charging
/// nothing. Every other release path charges 1%. Either the fee is owed on a
/// release or it is not; routing around it by asking for a different payout
/// asset is not a distinction the fee schedule makes.
///
/// See `docs/SPECIFICATION.md` §6 F3.
#[test]
fn f3_release_with_conversion_charges_the_platform_fee() {
    let amount = 1_000_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));
    h.contract.start_work(&job, &h.client);
    h.contract
        .release_with_conversion(&job, &h.client, &h.token.address, &0);

    let expected_fee = platform_fee(amount);
    assert_eq!(
        h.balance(Party::Admin),
        expected_fee,
        "F3/I5: a release through the conversion path charged no platform fee, \
         so payouts plus fees ({}) do not reconstruct the escrowed amount ({amount})",
        h.balance(Party::Freelancer) + h.balance(Party::Admin)
    );
}

/// F4 — a disputed escrow must remain settleable, and the panel's decision
/// must be what moves the funds.
///
/// `raise_dispute` moves the escrow to `Disputed`, and every settlement path
/// except the milestone one refuses that status. Before arbitration actually
/// paid out, a disputed non-milestone escrow had no path to any terminal
/// state: either participant could strand the funds permanently with one
/// call, and `resolve_arbitration` only recorded a percentage.
///
/// See `docs/SPECIFICATION.md` §6 F4.
#[test]
fn f4_a_disputed_escrow_is_settled_by_the_arbitration_panel() {
    let amount = 1_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));
    h.contract.start_work(&job, &h.client);
    // The freelancer alone can move it into dispute.
    h.contract.raise_dispute(&job, &h.freelancer);

    assert!(
        h.contract.try_release_escrow(&job, &h.client).is_err(),
        "a disputed escrow must not settle outside the arbitration panel"
    );

    let panel = h.seat_arbitration_panel();
    let case_id = h.contract.open_arbitration(&job, &h.admin);

    // A 30/70 split in the freelancer's favour: median of three votes.
    h.contract.cast_arbitration_vote(&case_id, &panel[0], &10);
    h.contract.cast_arbitration_vote(&case_id, &panel[1], &30);
    h.contract.cast_arbitration_vote(&case_id, &panel[2], &90);
    h.contract.resolve_arbitration(&case_id);

    assert_eq!(
        h.status(&job),
        Some(Status::Released),
        "F4: the escrow must reach a terminal state once arbitration resolves"
    );
    assert_eq!(
        h.held(),
        0,
        "F4/I2: arbitration must leave no dust behind"
    );
    assert_eq!(
        h.balance(Party::Client) + h.balance(Party::Freelancer),
        amount,
        "F4/I1: the split must reconstruct the escrowed amount exactly"
    );
    assert_eq!(
        h.balance(Party::Client),
        300,
        "F4: the client receives the median vote's share"
    );
}

/// F6 — one arbitrator must not be able to cast the whole panel's vote.
///
/// The resolution is the median of three votes, which is only a panel
/// decision if the three come from three different people. Nothing recorded
/// who had voted, so a single selected arbitrator could call three times and
/// set the split alone.
///
/// See `docs/SPECIFICATION.md` §6 F6.
#[test]
fn f6_one_arbitrator_cannot_cast_the_whole_panel_vote() {
    let amount = 1_000i128;
    let h = Harness::new(amount);
    let job = h.job("job");

    h.contract
        .create_escrow(&job, &h.client, &h.create_params(amount, None, false, false));
    h.contract.raise_dispute(&job, &h.client);

    let panel = h.seat_arbitration_panel();
    let case_id = h.contract.open_arbitration(&job, &h.admin);

    h.contract.cast_arbitration_vote(&case_id, &panel[0], &100);
    assert!(
        h.contract
            .try_cast_arbitration_vote(&case_id, &panel[0], &100)
            .is_err(),
        "F6: a second vote from the same arbitrator must be refused —          otherwise the median of three is one person's decision"
    );
}
