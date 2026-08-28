//! Central lifecycle transition relation for both legacy and v2 escrows.
//!
//! Entry points authenticate actors and validate domain data; this module is
//! the only component that decides whether the requested lifecycle edge is
//! legal.  Keeping the relation total and side-effect free also makes it easy
//! to exhaustively test.

use soroban_sdk::contracttype;

use crate::EscrowStatus;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LifecycleState {
    Locked,
    Active,
    Paused,
    Disputed,
    Released,
    Refunded,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LifecycleAction {
    Start,
    Release,
    ReleaseMilestone,
    Refund,
    TimeoutRefund,
    Pause,
    Resume,
    Dispute,
    Cancel,
    ResolveRelease,
    ResolveRefund,
}

/// Return the next state for every legal edge in the escrow lifecycle.
///
/// `None` is the single, central representation of an illegal transition.
pub const fn try_transition(
    from: LifecycleState,
    action: LifecycleAction,
) -> Option<LifecycleState> {
    use LifecycleAction as A;
    use LifecycleState as S;

    match (from, action) {
        (S::Locked, A::Start) => Some(S::Active),
        (S::Locked, A::Release) => Some(S::Released),
        (S::Locked, A::ReleaseMilestone) => Some(S::Locked),
        (S::Locked, A::Refund | A::TimeoutRefund) => Some(S::Refunded),
        (S::Locked, A::Dispute) => Some(S::Disputed),
        (S::Locked, A::ResolveRelease) => Some(S::Released),

        (S::Active, A::Release) => Some(S::Released),
        (S::Active, A::ReleaseMilestone) => Some(S::Active),
        (S::Active, A::Pause) => Some(S::Paused),
        (S::Active, A::Dispute) => Some(S::Disputed),
        (S::Active, A::Cancel) => Some(S::Cancelled),
        (S::Active, A::ResolveRelease) => Some(S::Released),

        (S::Paused, A::Resume) => Some(S::Active),
        (S::Paused, A::Dispute) => Some(S::Disputed),
        (S::Paused, A::Cancel) => Some(S::Cancelled),
        (S::Paused, A::ResolveRelease) => Some(S::Released),

        (S::Disputed, A::ResolveRelease) => Some(S::Released),
        (S::Disputed, A::ResolveRefund) => Some(S::Refunded),
        // Compatibility edge: v1 explicitly allowed already-accepted work to
        // be paid milestone-by-milestone during a dispute.
        (S::Disputed, A::ReleaseMilestone) => Some(S::Disputed),

        _ => None,
    }
}

/// Checked transition used by contract entrypoints.
pub fn transition(from: LifecycleState, action: LifecycleAction) -> LifecycleState {
    try_transition(from, action).expect("Illegal escrow state transition")
}

pub fn from_legacy(status: EscrowStatus) -> LifecycleState {
    match status {
        EscrowStatus::Locked => LifecycleState::Locked,
        EscrowStatus::InProgress => LifecycleState::Active,
        EscrowStatus::Released => LifecycleState::Released,
        EscrowStatus::Refunded => LifecycleState::Refunded,
        EscrowStatus::Disputed => LifecycleState::Disputed,
    }
}

pub fn to_legacy(state: LifecycleState) -> EscrowStatus {
    match state {
        LifecycleState::Locked => EscrowStatus::Locked,
        LifecycleState::Active | LifecycleState::Paused => EscrowStatus::InProgress,
        LifecycleState::Released => EscrowStatus::Released,
        LifecycleState::Refunded | LifecycleState::Cancelled => EscrowStatus::Refunded,
        LifecycleState::Disputed => EscrowStatus::Disputed,
    }
}

pub fn transition_legacy(status: EscrowStatus, action: LifecycleAction) -> EscrowStatus {
    to_legacy(transition(from_legacy(status), action))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_states_have_no_outgoing_edges() {
        let actions = [
            LifecycleAction::Start,
            LifecycleAction::Release,
            LifecycleAction::ReleaseMilestone,
            LifecycleAction::Refund,
            LifecycleAction::TimeoutRefund,
            LifecycleAction::Pause,
            LifecycleAction::Resume,
            LifecycleAction::Dispute,
            LifecycleAction::Cancel,
            LifecycleAction::ResolveRelease,
            LifecycleAction::ResolveRefund,
        ];
        for state in [
            LifecycleState::Released,
            LifecycleState::Refunded,
            LifecycleState::Cancelled,
        ] {
            for action in actions.iter().cloned() {
                assert_eq!(try_transition(state.clone(), action), None);
            }
        }
    }
}
