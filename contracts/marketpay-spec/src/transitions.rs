//! The legal transition relation for the escrow state machine.
//!
//! `lib.rs` encodes its state machine as scattered `if status != ... panic!`
//! guards spread over sixty-odd entrypoints. There is no single place that
//! says which transitions are legal, which is precisely why an illegal one
//! (`Disputed` becoming unsettleable, a milestone payout leaving the status
//! at `Locked` so a full refund is still permitted) can be introduced without
//! anything noticing.
//!
//! This module states the relation once, as data. [`legal_transitions`]
//! returns the complete set; the reference model consults it; the bounded
//! model checker proves that no reachable state lies outside it.

use super::state::{Party, Status};

/// An entrypoint invocation, abstracted to the parameters that affect the
/// state machine. Amounts that do not influence control flow are omitted.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    /// `create_escrow` / `create_escrow_with_deliverable`.
    Create,
    /// `start_work(job_id, client)`.
    StartWork { caller: Party },
    /// `release_escrow(job_id, client)` — the unilateral path.
    ReleaseEscrow { caller: Party },
    /// `approve_release(job_id, signer)` — the 2-of-3 multisig path.
    ApproveRelease { caller: Party },
    /// `refund_escrow(job_id, client)` — the unilateral path.
    RefundEscrow { caller: Party },
    /// `approve_refund(job_id, signer)` — the 2-of-3 multisig path.
    ApproveRefund { caller: Party },
    /// `timeout_refund(job_id, client)`.
    TimeoutRefund { caller: Party },
    /// `partial_release(job_id, milestone_index, client)`.
    PartialRelease { caller: Party, index: u8 },
    /// `verify_milestone_oracle(job_id, milestone_index, oracle, proof)`.
    VerifyMilestoneOracle { caller: Party, index: u8 },
    /// `release_with_conversion(job_id, client, target_token, min_out)`.
    ReleaseWithConversion { caller: Party },
    /// `raise_dispute(job_id, caller)`.
    RaiseDispute { caller: Party },
    /// `resolve_arbitration(case_id)` — the panel's median vote settles the
    /// escrow, splitting the remaining balance `client_percent` to the client
    /// and the residual to the freelancer.
    ResolveArbitration { caller: Party, client_percent: u8 },
    /// Ledger time advancing past the escrow's timeout. Not an entrypoint,
    /// but a transition the environment can take, and one the state machine
    /// has to account for.
    AdvancePastTimeout,
}

impl Action {
    pub fn caller(self) -> Option<Party> {
        match self {
            Action::Create | Action::AdvancePastTimeout => None,
            Action::StartWork { caller }
            | Action::ReleaseEscrow { caller }
            | Action::ApproveRelease { caller }
            | Action::RefundEscrow { caller }
            | Action::ApproveRefund { caller }
            | Action::TimeoutRefund { caller }
            | Action::PartialRelease { caller, .. }
            | Action::VerifyMilestoneOracle { caller, .. }
            | Action::ReleaseWithConversion { caller }
            | Action::ResolveArbitration { caller, .. }
            | Action::RaiseDispute { caller } => Some(caller),
        }
    }

    /// Short name used by the counterexample renderer.
    pub fn name(self) -> &'static str {
        match self {
            Action::Create => "create_escrow",
            Action::StartWork { .. } => "start_work",
            Action::ReleaseEscrow { .. } => "release_escrow",
            Action::ApproveRelease { .. } => "approve_release",
            Action::RefundEscrow { .. } => "refund_escrow",
            Action::ApproveRefund { .. } => "approve_refund",
            Action::TimeoutRefund { .. } => "timeout_refund",
            Action::PartialRelease { .. } => "partial_release",
            Action::VerifyMilestoneOracle { .. } => "verify_milestone_oracle",
            Action::ReleaseWithConversion { .. } => "release_with_conversion",
            Action::RaiseDispute { .. } => "raise_dispute",
            Action::ResolveArbitration { .. } => "resolve_arbitration",
            Action::AdvancePastTimeout => "<ledger advances past timeout>",
        }
    }

    /// The parties whose authorisation the entrypoint's precondition accepts.
    ///
    /// This is the specification side of I4. Where it disagrees with `lib.rs`
    /// that disagreement is a finding, not a reason to weaken the spec — see
    /// `docs/SPECIFICATION.md` §6.
    pub fn authorised_callers(self) -> &'static [Party] {
        match self {
            Action::Create => &[Party::Client],
            Action::StartWork { .. } => &[Party::Client],
            // Unilateral settlement is the client's alone, and only on an
            // escrow that never nominated an arbitrator.
            Action::ReleaseEscrow { .. } => &[Party::Client],
            Action::RefundEscrow { .. } => &[Party::Client],
            Action::TimeoutRefund { .. } => &[Party::Client],
            Action::PartialRelease { .. } => &[Party::Client],
            // `release_with_conversion` is a release. It is specified to
            // carry exactly the authorisation a release carries.
            Action::ReleaseWithConversion { .. } => &[Party::Client],
            // Any of the three signers may cast a multisig approval.
            Action::ApproveRelease { .. } | Action::ApproveRefund { .. } => &Party::SIGNERS,
            Action::VerifyMilestoneOracle { .. } => &[Party::Oracle],
            Action::RaiseDispute { .. } => &[Party::Client, Party::Freelancer],
            // Permissionless to *call*, but not permissionless to decide: the
            // three panel votes are the authorisation, and `Party::Panel`
            // stands for them.
            Action::ResolveArbitration { .. } => &[Party::Panel],
            Action::AdvancePastTimeout => &[],
        }
    }
}

/// A single edge of the specified state machine.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Transition {
    pub from: Status,
    pub to: Status,
    /// Discriminant of the action that may take this edge.
    pub via: TransitionKind,
}

/// Coarse classification of an action, used to key the transition table
/// without having to enumerate every caller.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TransitionKind {
    Create,
    StartWork,
    Release,
    Refund,
    /// A milestone payout that did *not* complete the final milestone.
    PartialPayout,
    /// A milestone payout that completed the final milestone, settling the
    /// escrow.
    FinalMilestonePayout,
    Dispute,
    /// A multisig approval that did not yet reach the threshold, so the
    /// status is unchanged.
    ApprovalBelowThreshold,
    /// The arbitration panel's decision settling the escrow.
    ArbitrationSettlement,
}

/// The complete legal transition relation.
///
/// Read this table as the answer to "what is this escrow allowed to do next".
/// Anything absent from it is, by definition, a specification violation.
pub const LEGAL_TRANSITIONS: &[Transition] = &[
    // Creation.
    Transition { from: Status::Locked, to: Status::Locked, via: TransitionKind::Create },
    // Work begins.
    Transition { from: Status::Locked, to: Status::InProgress, via: TransitionKind::StartWork },
    // Release, from either pre-settlement status.
    Transition { from: Status::Locked, to: Status::Released, via: TransitionKind::Release },
    Transition { from: Status::InProgress, to: Status::Released, via: TransitionKind::Release },
    // Refund is specified only before work starts.
    Transition { from: Status::Locked, to: Status::Refunded, via: TransitionKind::Refund },
    // Milestone payouts that leave work outstanding do not change the status.
    Transition { from: Status::Locked, to: Status::Locked, via: TransitionKind::PartialPayout },
    Transition { from: Status::InProgress, to: Status::InProgress, via: TransitionKind::PartialPayout },
    Transition { from: Status::Disputed, to: Status::Disputed, via: TransitionKind::PartialPayout },
    // The payout that completes the last milestone settles the escrow.
    Transition { from: Status::Locked, to: Status::Released, via: TransitionKind::FinalMilestonePayout },
    Transition { from: Status::InProgress, to: Status::Released, via: TransitionKind::FinalMilestonePayout },
    Transition { from: Status::Disputed, to: Status::Released, via: TransitionKind::FinalMilestonePayout },
    // Either participant may dispute before settlement.
    Transition { from: Status::Locked, to: Status::Disputed, via: TransitionKind::Dispute },
    Transition { from: Status::InProgress, to: Status::Disputed, via: TransitionKind::Dispute },
    // The arbitration panel can settle from any unsettled status. This is the
    // edge whose absence was finding F4: without it a disputed escrow had no
    // route to a terminal state at all.
    Transition { from: Status::Disputed, to: Status::Released, via: TransitionKind::ArbitrationSettlement },
    Transition { from: Status::Locked, to: Status::Released, via: TransitionKind::ArbitrationSettlement },
    Transition { from: Status::InProgress, to: Status::Released, via: TransitionKind::ArbitrationSettlement },
    // A sub-threshold approval records a vote and nothing else.
    Transition { from: Status::Locked, to: Status::Locked, via: TransitionKind::ApprovalBelowThreshold },
    Transition { from: Status::InProgress, to: Status::InProgress, via: TransitionKind::ApprovalBelowThreshold },
];

/// Whether `from -> to` via `kind` appears in the specified relation.
pub fn is_legal(from: Status, to: Status, kind: TransitionKind) -> bool {
    LEGAL_TRANSITIONS
        .iter()
        .any(|t| t.from == from && t.to == to && t.via == kind)
}

/// All transitions leaving `from`, for reachability reporting.
pub fn legal_transitions(from: Status) -> impl Iterator<Item = &'static Transition> {
    LEGAL_TRANSITIONS.iter().filter(move |t| t.from == from)
}
