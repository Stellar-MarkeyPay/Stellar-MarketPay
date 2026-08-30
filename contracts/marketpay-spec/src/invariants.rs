//! The formal invariants.
//!
//! Each invariant is a total predicate over [`SystemState`]. They are stated
//! once, here, and consumed by every verification technique in this
//! subsystem — the bounded model checker, the Kani harnesses, the
//! differential tests and the invariant-oracle fuzzer all call
//! [`check_all`]. That is deliberate: an invariant that is only checked by
//! one technique is an invariant that silently stops being checked when that
//! technique is skipped.
//!
//! The prose statement of each invariant, and the argument for why it is the
//! right one, is in `docs/SPECIFICATION.md` §3. The identifiers (I1…I8) are
//! shared between the two documents.

use super::state::{
    Party, Status, SystemState, FEE_BPS_DENOMINATOR, MULTISIG_THRESHOLD, PLATFORM_FEE_BPS,
};

/// A violated invariant, carrying enough context to print without a solver.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Violation {
    pub id: InvariantId,
    /// The value the invariant expected.
    pub expected: i128,
    /// The value actually observed.
    pub actual: i128,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InvariantId {
    /// I1 — Value conservation.
    ValueConservation,
    /// I2 — No dust after settlement.
    NoDustAfterSettlement,
    /// I3 — An escrow settles exactly once.
    SingleSettlement,
    /// I4 — No fund movement without authorisation.
    AuthorisedMovementOnly,
    /// I5 — Payouts plus fees equal the escrowed amount exactly.
    PayoutsPlusFeesExact,
    /// I6 — A multisig escrow never settles below threshold.
    MultisigThreshold,
    /// I7 — No negative balances anywhere.
    NonNegativeBalances,
    /// I8 — Milestone amounts sum to the escrow amount.
    MilestoneSumMatchesAmount,
    /// I9 — Every reachable status change lies in the specified transition
    /// relation.
    TransitionRelation,
}

impl InvariantId {
    pub fn label(self) -> &'static str {
        match self {
            InvariantId::ValueConservation => "I1 value conservation",
            InvariantId::NoDustAfterSettlement => "I2 no dust after settlement",
            InvariantId::SingleSettlement => "I3 single settlement",
            InvariantId::AuthorisedMovementOnly => "I4 authorised movement only",
            InvariantId::PayoutsPlusFeesExact => "I5 payouts + fees exact",
            InvariantId::MultisigThreshold => "I6 multisig threshold",
            InvariantId::NonNegativeBalances => "I7 non-negative balances",
            InvariantId::MilestoneSumMatchesAmount => "I8 milestone sum matches amount",
            InvariantId::TransitionRelation => "I9 transition relation respected",
        }
    }

    /// One-line prose statement, used by the counterexample renderer so a CI
    /// failure explains itself without the reader opening the spec.
    pub fn statement(self) -> &'static str {
        match self {
            InvariantId::ValueConservation => {
                "everything deposited is either still held by the contract or has been paid out, \
                 and nothing else was ever created"
            }
            InvariantId::NoDustAfterSettlement => {
                "once an escrow reaches Released or Refunded the contract holds nothing further \
                 on its behalf"
            }
            InvariantId::SingleSettlement => {
                "an escrow enters a settled status at most once, so its funds are distributed \
                 exactly one time"
            }
            InvariantId::AuthorisedMovementOnly => {
                "no execution path moves funds without the authorisation the entrypoint's \
                 precondition demands"
            }
            InvariantId::PayoutsPlusFeesExact => {
                "the sum of every payout and every fee equals the amount released, with no \
                 remainder and no rounding slack"
            }
            InvariantId::MultisigThreshold => {
                "an escrow created with an arbitrator settles only after two of its three \
                 signers have approved that action"
            }
            InvariantId::NonNegativeBalances => {
                "no balance or payout total is ever negative"
            }
            InvariantId::MilestoneSumMatchesAmount => {
                "when milestones are present their amounts sum to exactly the escrow amount"
            }
            InvariantId::TransitionRelation => {
                "every status change the escrow makes is an edge the specified transition \
                 relation permits"
            }
        }
    }
}

/// I1 — Value conservation.
///
/// `deposited == held + total_out`. This is the invariant that a double-spend
/// breaks: paying a milestone out and then refunding the full amount makes
/// `total_out` exceed `deposited`, which shows up here as `held` going
/// negative and the equality failing.
pub fn i1_value_conservation(s: &SystemState) -> Option<Violation> {
    let accounted = s.funds.held + s.funds.total_out();
    if accounted != s.funds.deposited {
        return Some(Violation {
            id: InvariantId::ValueConservation,
            expected: s.funds.deposited,
            actual: accounted,
        });
    }
    None
}

/// I2 — No dust after settlement.
pub fn i2_no_dust_after_settlement(s: &SystemState) -> Option<Violation> {
    if s.escrow.status.is_settled() && s.funds.held != 0 {
        return Some(Violation {
            id: InvariantId::NoDustAfterSettlement,
            expected: 0,
            actual: s.funds.held,
        });
    }
    None
}

/// I3 — An escrow settles exactly once.
pub fn i3_single_settlement(s: &SystemState) -> Option<Violation> {
    if s.settlements > 1 {
        return Some(Violation {
            id: InvariantId::SingleSettlement,
            expected: 1,
            actual: s.settlements as i128,
        });
    }
    None
}

/// I5 — Payouts plus fees equal the escrowed amount exactly.
///
/// Only checkable once the escrow has settled; before that the split is still
/// in progress. The `Refunded` case is exact by construction (the whole
/// amount goes back to the client); the `Released` case is where the fee
/// arithmetic has to land on the nose.
pub fn i5_payouts_plus_fees_exact(s: &SystemState) -> Option<Violation> {
    if !s.escrow.status.is_settled() {
        return None;
    }
    let out = s.funds.total_out();
    if out != s.funds.deposited {
        return Some(Violation {
            id: InvariantId::PayoutsPlusFeesExact,
            expected: s.funds.deposited,
            actual: out,
        });
    }
    None
}

/// I6 — A multisig escrow never settles below the 2-of-3 threshold.
///
/// Stated over the *distinct signer* vote array rather than the approval
/// counter, so that a counter incremented twice by one signer cannot satisfy
/// it. That distinction is the whole point of the invariant.
pub fn i6_multisig_threshold(s: &SystemState) -> Option<Violation> {
    if !s.escrow.has_arbitrator || !s.escrow.status.is_settled() {
        return None;
    }
    let votes = match s.escrow.status {
        Status::Released => &s.escrow.release_votes,
        Status::Refunded => &s.escrow.refund_votes,
        _ => return None,
    };
    let distinct = votes.iter().filter(|v| **v).count() as u8;
    if distinct < MULTISIG_THRESHOLD {
        return Some(Violation {
            id: InvariantId::MultisigThreshold,
            expected: MULTISIG_THRESHOLD as i128,
            actual: distinct as i128,
        });
    }
    None
}

/// I7 — No negative balances anywhere.
pub fn i7_non_negative_balances(s: &SystemState) -> Option<Violation> {
    let f = &s.funds;
    for (value, _name) in [
        (f.held, "held"),
        (f.paid_freelancer, "paid_freelancer"),
        (f.paid_client, "paid_client"),
        (f.paid_referrer, "paid_referrer"),
        (f.paid_admin, "paid_admin"),
        (f.paid_tree, "paid_tree"),
        (f.deposited, "deposited"),
    ] {
        if value < 0 {
            return Some(Violation {
                id: InvariantId::NonNegativeBalances,
                expected: 0,
                actual: value,
            });
        }
    }
    None
}

/// I8 — Milestone amounts sum to the escrow amount.
pub fn i8_milestone_sum(s: &SystemState) -> Option<Violation> {
    if !s.escrow.has_milestones() {
        return None;
    }
    let mut total: i128 = 0;
    let mut i = 0usize;
    while i < s.escrow.n_milestones as usize {
        total += s.escrow.milestones[i].amount;
        i += 1;
    }
    if total != s.escrow.amount {
        return Some(Violation {
            id: InvariantId::MilestoneSumMatchesAmount,
            expected: s.escrow.amount,
            actual: total,
        });
    }
    None
}

/// Check every state invariant, returning the first violation found.
///
/// I4 is absent from this list on purpose: authorisation is a property of a
/// *transition*, not of a state, so it cannot be decided by looking at the
/// state afterwards. It is checked by [`check_authorisation`] at the point
/// each action is applied.
pub fn check_all(s: &SystemState) -> Option<Violation> {
    i7_non_negative_balances(s)
        .or_else(|| i1_value_conservation(s))
        .or_else(|| i8_milestone_sum(s))
        .or_else(|| i3_single_settlement(s))
        .or_else(|| i2_no_dust_after_settlement(s))
        .or_else(|| i5_payouts_plus_fees_exact(s))
        .or_else(|| i6_multisig_threshold(s))
}

/// I4 — No fund movement without authorisation.
///
/// `moved` says whether the transition being judged moved any funds; `caller`
/// is the party that invoked it; `authorised` is the set the entrypoint's
/// precondition permits. A transition that moves funds while the caller is
/// outside that set is the violation this catches.
pub fn check_authorisation(
    moved: bool,
    caller: Party,
    authorised: &[Party],
) -> Option<Violation> {
    if !moved {
        return None;
    }
    if authorised.contains(&caller) {
        return None;
    }
    Some(Violation {
        id: InvariantId::AuthorisedMovementOnly,
        expected: 1,
        actual: 0,
    })
}

/// The platform fee on a release, computed the way `release_escrow_core`
/// computes it: truncating integer division of basis points.
///
/// Exposed here rather than inlined so that the fee rule has exactly one
/// definition that both the model and the differential tests refer to. The
/// merge that silently changed this arithmetic is the reason it lives in one
/// place now.
pub fn platform_fee(release_amount: i128) -> i128 {
    release_amount
        .checked_mul(PLATFORM_FEE_BPS)
        .expect("fee overflow")
        / FEE_BPS_DENOMINATOR
}
