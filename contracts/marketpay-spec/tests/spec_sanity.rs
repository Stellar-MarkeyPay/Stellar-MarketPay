//! Checks on the specification itself.
//!
//! A specification can fail in ways a checker running against it cannot
//! notice — most obviously by being vacuous. A property that no input can
//! violate passes every run and protects nothing, and it reads exactly like a
//! property that works. These tests exist so that the invariants stay
//! falsifiable.

use marketpay_spec::invariants::{check_all, check_authorisation, InvariantId};
use marketpay_spec::model::{CreateParams, Model};
use marketpay_spec::state::{Party, Status, SystemState};
use marketpay_spec::transitions::{Action, LEGAL_TRANSITIONS};

/// Every fund-moving action refuses at least one party.
///
/// This is what keeps the I4 check in `Model::pay` from being vacuous. An
/// action whose authorised set is all of `Party::ALL` would pass the
/// authorisation check for every caller, and the check would read like
/// enforcement while enforcing nothing.
#[test]
fn no_action_authorises_every_party() {
    let actions = [
        Action::StartWork { caller: Party::Client },
        Action::ReleaseEscrow { caller: Party::Client },
        Action::ReleaseWithConversion { caller: Party::Client },
        Action::RefundEscrow { caller: Party::Client },
        Action::TimeoutRefund { caller: Party::Client },
        Action::PartialRelease { caller: Party::Client, index: 0 },
        Action::VerifyMilestoneOracle { caller: Party::Oracle, index: 0 },
        Action::ApproveRelease { caller: Party::Client },
        Action::ApproveRefund { caller: Party::Client },
        Action::RaiseDispute { caller: Party::Client },
    ];

    for action in actions {
        let authorised = action.authorised_callers();
        assert!(
            !authorised.is_empty(),
            "{}: an action nobody may call is a specification mistake",
            action.name()
        );
        assert!(
            authorised.len() < Party::ALL.len(),
            "{}: authorises every party, so the I4 check on this path can \
             never fire — either the set is wrong or the check is theatre",
            action.name()
        );
        assert!(
            !authorised.contains(&Party::Outsider),
            "{}: authorises an address holding no role at all",
            action.name()
        );
    }
}

/// The authorisation predicate rejects something.
#[test]
fn the_authorisation_check_can_fail() {
    let v = check_authorisation(true, Party::Outsider, &[Party::Client]);
    assert_eq!(
        v.map(|v| v.id),
        Some(InvariantId::AuthorisedMovementOnly),
        "check_authorisation must reject a caller outside the authorised set"
    );

    assert!(
        check_authorisation(false, Party::Outsider, &[Party::Client]).is_none(),
        "a transition that moved no funds cannot violate I4"
    );
    assert!(
        check_authorisation(true, Party::Client, &[Party::Client]).is_none(),
        "an authorised caller must not be reported as a violation"
    );
}

/// The state invariants reject something.
///
/// Each is fed a state that breaks it, so a refactor that accidentally makes
/// one unfalsifiable fails here rather than passing quietly forever.
#[test]
fn every_state_invariant_can_fail() {
    // I1 — more paid out than deposited.
    let mut s = SystemState::uncreated();
    s.funds.deposited = 100;
    s.funds.held = 0;
    s.funds.paid_freelancer = 140;
    assert_eq!(
        check_all(&s).map(|v| v.id),
        Some(InvariantId::ValueConservation),
        "I1 must reject a state that paid out more than was deposited"
    );

    // I2 — settled with funds still held.
    let mut s = SystemState::uncreated();
    s.funds.deposited = 100;
    s.funds.held = 100;
    s.escrow.status = Status::Released;
    assert_eq!(
        check_all(&s).map(|v| v.id),
        Some(InvariantId::NoDustAfterSettlement),
        "I2 must reject dust left behind after settlement"
    );

    // I3 — settled twice.
    let mut s = SystemState::uncreated();
    s.settlements = 2;
    assert_eq!(
        check_all(&s).map(|v| v.id),
        Some(InvariantId::SingleSettlement),
        "I3 must reject a second settlement"
    );

    // I6 — an arbitrated escrow released on one approval.
    let mut s = SystemState::uncreated();
    s.escrow.has_arbitrator = true;
    s.escrow.status = Status::Released;
    s.escrow.release_votes = [true, false, false];
    s.settlements = 1;
    assert_eq!(
        check_all(&s).map(|v| v.id),
        Some(InvariantId::MultisigThreshold),
        "I6 must reject settlement below the 2-of-3 threshold"
    );

    // I7 — a negative balance.
    let mut s = SystemState::uncreated();
    s.funds.held = -1;
    assert_eq!(
        check_all(&s).map(|v| v.id),
        Some(InvariantId::NonNegativeBalances),
        "I7 must reject a negative balance"
    );

    // I8 — milestones that do not sum to the amount.
    let mut s = SystemState::uncreated();
    s.escrow.amount = 100;
    s.escrow.n_milestones = 2;
    s.escrow.milestones[0].amount = 40;
    s.escrow.milestones[1].amount = 40;
    s.funds.deposited = 100;
    s.funds.held = 100;
    assert_eq!(
        check_all(&s).map(|v| v.id),
        Some(InvariantId::MilestoneSumMatchesAmount),
        "I8 must reject milestones that do not sum to the escrow amount"
    );
}

/// A well-formed escrow satisfies every invariant.
///
/// The mirror of the test above: if the invariants rejected *everything* they
/// would also be useless, and the bounded checker would never get off the
/// ground.
#[test]
fn a_healthy_escrow_satisfies_every_invariant() {
    let mut m = Model::new(CreateParams::simple(1_000_000));
    assert!(m.step(Action::Create).is_ok());
    assert!(check_all(&m.state).is_none());
    assert!(m.step(Action::StartWork { caller: Party::Client }).is_ok());
    assert!(check_all(&m.state).is_none());
    assert!(m.step(Action::ReleaseEscrow { caller: Party::Client }).is_ok());
    assert!(check_all(&m.state).is_none());
    assert!(m.recorded_violation().is_none());
}

/// The transition relation is not degenerate.
#[test]
fn the_transition_relation_is_well_formed() {
    assert!(
        !LEGAL_TRANSITIONS.is_empty(),
        "an empty relation permits nothing and would make I9 unfalsifiable"
    );

    // Terminal statuses have no outgoing edges. I3 is the dynamic statement of
    // this; here it is checked structurally, so a stray table entry cannot
    // reintroduce a path out of a settled escrow.
    for t in LEGAL_TRANSITIONS {
        assert!(
            !t.from.is_settled(),
            "the relation permits leaving the settled status {:?}, which \
             contradicts I3",
            t.from
        );
    }

    // Every non-terminal status can reach a terminal one. A status with no
    // route to settlement is exactly finding F4: funds locked forever.
    for start in [Status::Locked, Status::InProgress, Status::Disputed] {
        let reaches_terminal = LEGAL_TRANSITIONS
            .iter()
            .any(|t| t.from == start && t.to.is_settled());
        assert!(
            reaches_terminal,
            "{start:?} has no edge to a settled status — an escrow that \
             reaches it can never pay anyone (see SPECIFICATION.md §6 F4)"
        );
    }
}
