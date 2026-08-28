//! The executable reference model.
//!
//! This is an *independent* implementation of the escrow, written from
//! `docs/SPECIFICATION.md` rather than from `lib.rs`. Independence is the
//! whole value: a model transcribed from the implementation reproduces the
//! implementation's bugs and agrees with it perfectly, which proves nothing.
//! Where this model and `lib.rs` disagree, one of them is wrong, and the
//! differential tests in `tests/differential.rs` force that question to be
//! answered rather than deferred.
//!
//! The model is total: every action either applies and returns [`Step::Ok`]
//! or is refused with a [`Reject`] reason. It never panics, so a fuzzer can
//! drive it with arbitrary garbage and compare refusals against the
//! contract's panics.

use super::invariants::{check_authorisation, platform_fee, InvariantId, Violation};
use super::state::{
    Escrow, Funds, Milestone, Party, Status, SystemState, MAX_MILESTONES, MULTISIG_THRESHOLD,
    N_SIGNERS,
};
use super::transitions::{is_legal, Action, TransitionKind};

/// Why an action was refused. These correspond one-to-one with the `panic!`
/// messages in `lib.rs`; the mapping is asserted by the differential tests.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Reject {
    NotCreated,
    AlreadyCreated,
    AmountNotPositive,
    MilestoneSumMismatch,
    TooManyMilestones,
    ArbitratorNotDistinct,
    ReferrerNotDistinct,
    NotAuthorised,
    WrongStatus,
    RequiresMultisig,
    NotAMultisigEscrow,
    NotASigner,
    DuplicateApproval,
    InvalidMilestoneIndex,
    MilestoneAlreadyCompleted,
    TimeoutNotExpired,
    NoOracleConfigured,
    InvalidResolution,
    /// The action is authorised and its preconditions hold, but taking it
    /// would leave the specified transition relation. This is never expected
    /// from the model itself — it is what the model returns when asked to do
    /// something the relation forbids, and it is how the state-machine
    /// property is enforced rather than merely documented.
    IllegalTransition,
}

/// Outcome of applying one action.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Step {
    Ok,
    Rejected(Reject),
}

impl Step {
    pub fn is_ok(self) -> bool {
        matches!(self, Step::Ok)
    }
}

/// Escrow shape chosen at creation time.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CreateParams {
    pub amount: i128,
    pub milestones: [i128; MAX_MILESTONES],
    pub n_milestones: u8,
    pub with_arbitrator: bool,
    pub with_referrer: bool,
    pub freelancer_in_referral_tree: bool,
}

impl CreateParams {
    /// A plain single-payment escrow, the shape most tests want.
    pub fn simple(amount: i128) -> Self {
        CreateParams {
            amount,
            milestones: [0; MAX_MILESTONES],
            n_milestones: 0,
            with_arbitrator: false,
            with_referrer: false,
            freelancer_in_referral_tree: false,
        }
    }

    pub fn with_milestones(amounts: &[i128]) -> Self {
        let mut milestones = [0i128; MAX_MILESTONES];
        let n = amounts.len().min(MAX_MILESTONES);
        let mut total = 0i128;
        let mut i = 0;
        while i < n {
            milestones[i] = amounts[i];
            total += amounts[i];
            i += 1;
        }
        CreateParams {
            amount: total,
            milestones,
            n_milestones: amounts.len() as u8,
            with_arbitrator: false,
            with_referrer: false,
            freelancer_in_referral_tree: false,
        }
    }

    pub fn arbitrated(mut self) -> Self {
        self.with_arbitrator = true;
        self
    }

    pub fn referred(mut self) -> Self {
        self.with_referrer = true;
        self
    }
}

/// The reference model: abstract state plus the rules that move it.
#[derive(Clone, Copy, Debug)]
pub struct Model {
    pub state: SystemState,
    pub created: bool,
    pub params: CreateParams,
    /// Set when an authorisation check would have been bypassed. Recorded
    /// rather than panicked so a checker can report it as a violation with
    /// the full trace attached.
    pub authorisation_violation: Option<Violation>,
    /// Set when the model was asked to take an edge outside the specified
    /// transition relation.
    pub transition_violation: Option<Violation>,
    /// The action currently being applied. `pay` consults it so the I4 check
    /// at the point of transfer is made against the entrypoint's real
    /// authorised set — checking against "every party" would be a check that
    /// can never fire, which is worse than no check at all because it reads
    /// like one.
    current_action: Option<Action>,
}

impl Model {
    pub fn new(params: CreateParams) -> Self {
        Model {
            state: SystemState::uncreated(),
            created: false,
            params,
            authorisation_violation: None,
            transition_violation: None,
            current_action: None,
        }
    }

    /// Any violation the model recorded while stepping.
    pub fn recorded_violation(&self) -> Option<Violation> {
        self.authorisation_violation.or(self.transition_violation)
    }

    /// Apply one action, returning whether it was permitted.
    pub fn step(&mut self, action: Action) -> Step {
        // I4 is decided before anything moves: an unauthorised caller must
        // not reach a transfer, so the check happens on the way in, not as a
        // post-hoc audit of what the transfer did.
        if let Some(caller) = action.caller() {
            let authorised = action.authorised_callers();
            if !authorised.contains(&caller) {
                // The action is refused, so no funds move and I4 holds. The
                // interesting case is the opposite one — an action that moves
                // funds for an unauthorised caller — which is what
                // `record_authorised_movement` below guards.
                return Step::Rejected(Reject::NotAuthorised);
            }
        }

        self.current_action = Some(action);
        match action {
            Action::Create => self.create(),
            Action::StartWork { .. } => self.start_work(),
            Action::ReleaseEscrow { caller } => self.release_escrow(caller),
            Action::ReleaseWithConversion { caller } => self.release_with_conversion(caller),
            Action::ApproveRelease { caller } => self.approve_release(caller),
            Action::RefundEscrow { caller } => self.refund_escrow(caller),
            Action::ApproveRefund { caller } => self.approve_refund(caller),
            Action::TimeoutRefund { caller } => self.timeout_refund(caller),
            Action::PartialRelease { caller, index } => self.milestone_payout(caller, index),
            Action::VerifyMilestoneOracle { caller, index } => {
                if !self.created {
                    return Step::Rejected(Reject::NotCreated);
                }
                if index as usize >= MAX_MILESTONES
                    || index >= self.state.escrow.n_milestones
                {
                    return Step::Rejected(Reject::InvalidMilestoneIndex);
                }
                if !self.state.milestone_oracle[index as usize] {
                    return Step::Rejected(Reject::NoOracleConfigured);
                }
                self.milestone_payout(caller, index)
            }
            Action::RaiseDispute { .. } => self.raise_dispute(),
            Action::ResolveArbitration { caller, client_percent } => {
                self.resolve_arbitration(caller, client_percent)
            }
            Action::AdvancePastTimeout => {
                self.state.timed_out = true;
                Step::Ok
            }
        }
    }

    /// Configure an oracle for a milestone. Not a fund-moving action, so it
    /// is a plain setter rather than an `Action`.
    pub fn set_milestone_oracle(&mut self, index: u8) {
        if (index as usize) < MAX_MILESTONES {
            self.state.milestone_oracle[index as usize] = true;
        }
    }

    // ── Entrypoint contracts ─────────────────────────────────────────────

    fn create(&mut self) -> Step {
        if self.created {
            return Step::Rejected(Reject::AlreadyCreated);
        }
        let p = self.params;
        if p.amount <= 0 {
            return Step::Rejected(Reject::AmountNotPositive);
        }
        if p.n_milestones as usize > MAX_MILESTONES {
            return Step::Rejected(Reject::TooManyMilestones);
        }
        let mut milestones = [Milestone { amount: 0, is_completed: false }; MAX_MILESTONES];
        if p.n_milestones > 0 {
            let mut total = 0i128;
            let mut i = 0usize;
            while i < p.n_milestones as usize {
                if p.milestones[i] <= 0 {
                    return Step::Rejected(Reject::AmountNotPositive);
                }
                total = match total.checked_add(p.milestones[i]) {
                    Some(t) => t,
                    None => return Step::Rejected(Reject::MilestoneSumMismatch),
                };
                milestones[i] = Milestone { amount: p.milestones[i], is_completed: false };
                i += 1;
            }
            if total != p.amount {
                return Step::Rejected(Reject::MilestoneSumMismatch);
            }
        }

        self.state.escrow = Escrow {
            amount: p.amount,
            status: Status::Locked,
            milestones,
            n_milestones: p.n_milestones,
            has_arbitrator: p.with_arbitrator,
            has_referrer: p.with_referrer,
            in_referral_tree: p.freelancer_in_referral_tree,
            release_approvals: 0,
            refund_approvals: 0,
            release_votes: [false; N_SIGNERS],
            refund_votes: [false; N_SIGNERS],
        };
        self.state.funds = Funds {
            deposited: p.amount,
            held: p.amount,
            ..Funds::default()
        };
        self.created = true;
        Step::Ok
    }

    fn start_work(&mut self) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        if self.state.escrow.status != Status::Locked {
            return Step::Rejected(Reject::WrongStatus);
        }
        self.transition_to(Status::InProgress, TransitionKind::StartWork);
        self.state.work_started = true;
        Step::Ok
    }

    fn release_escrow(&mut self, caller: Party) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        // An escrow that nominated an arbitrator has given up unilateral
        // settlement. This guard is what makes I6 hold.
        if self.state.escrow.has_arbitrator {
            return Step::Rejected(Reject::RequiresMultisig);
        }
        self.settle_release(caller)
    }

    /// `release_with_conversion` is specified as a release that happens to
    /// swap the payout asset. Swapping the asset changes nothing about who
    /// may authorise it or what the escrow owes, so it carries the same
    /// preconditions and the same fee obligation as `release_escrow`.
    fn release_with_conversion(&mut self, caller: Party) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        if self.state.escrow.has_arbitrator {
            return Step::Rejected(Reject::RequiresMultisig);
        }
        self.settle_release(caller)
    }

    fn approve_release(&mut self, caller: Party) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        if !self.state.escrow.has_arbitrator {
            return Step::Rejected(Reject::NotAMultisigEscrow);
        }
        let slot = match caller.signer_slot() {
            Some(s) => s,
            None => return Step::Rejected(Reject::NotASigner),
        };
        if !matches!(self.state.escrow.status, Status::Locked | Status::InProgress) {
            return Step::Rejected(Reject::WrongStatus);
        }
        if self.state.escrow.release_votes[slot] {
            return Step::Rejected(Reject::DuplicateApproval);
        }
        self.state.escrow.release_votes[slot] = true;
        self.state.escrow.release_approvals += 1;

        let distinct = self.state.escrow.release_votes.iter().filter(|v| **v).count() as u8;
        if distinct >= MULTISIG_THRESHOLD {
            return self.settle_release(caller);
        }
        // Sub-threshold: the vote is recorded, the status does not move.
        let status = self.state.escrow.status;
        self.assert_legal(status, status, TransitionKind::ApprovalBelowThreshold);
        Step::Ok
    }

    fn refund_escrow(&mut self, caller: Party) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        if self.state.escrow.has_arbitrator {
            return Step::Rejected(Reject::RequiresMultisig);
        }
        self.settle_refund(caller)
    }

    fn approve_refund(&mut self, caller: Party) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        if !self.state.escrow.has_arbitrator {
            return Step::Rejected(Reject::NotAMultisigEscrow);
        }
        let slot = match caller.signer_slot() {
            Some(s) => s,
            None => return Step::Rejected(Reject::NotASigner),
        };
        if self.state.escrow.status != Status::Locked {
            return Step::Rejected(Reject::WrongStatus);
        }
        if self.state.escrow.refund_votes[slot] {
            return Step::Rejected(Reject::DuplicateApproval);
        }
        self.state.escrow.refund_votes[slot] = true;
        self.state.escrow.refund_approvals += 1;

        let distinct = self.state.escrow.refund_votes.iter().filter(|v| **v).count() as u8;
        if distinct >= MULTISIG_THRESHOLD {
            return self.settle_refund(caller);
        }
        let status = self.state.escrow.status;
        self.assert_legal(status, status, TransitionKind::ApprovalBelowThreshold);
        Step::Ok
    }

    /// The timeout path refunds a client whose freelancer never started. It
    /// is still a refund, so on a multisig escrow it still owes the
    /// threshold — a timeout does not dissolve the arbitrator's stake in the
    /// outcome.
    fn timeout_refund(&mut self, caller: Party) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        if !self.state.timed_out {
            return Step::Rejected(Reject::TimeoutNotExpired);
        }
        if self.state.escrow.has_arbitrator {
            return Step::Rejected(Reject::RequiresMultisig);
        }
        self.settle_refund(caller)
    }

    fn milestone_payout(&mut self, caller: Party, index: u8) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        // Nominating an arbitrator is a statement that no single party moves
        // this escrow's funds. A milestone payout moves funds, so it is bound
        // by that statement too. Exempting it would make the multisig
        // trivially bypassable on any escrow that happens to have milestones:
        // the client would simply pay every milestone out in turn and reach
        // `Released` having collected no approvals at all. The bounded model
        // checker found exactly that sequence, and it is finding F5 in
        // `docs/SPECIFICATION.md`.
        if self.state.escrow.has_arbitrator {
            return Step::Rejected(Reject::RequiresMultisig);
        }
        if !matches!(
            self.state.escrow.status,
            Status::Locked | Status::InProgress | Status::Disputed
        ) {
            return Step::Rejected(Reject::WrongStatus);
        }
        if index >= self.state.escrow.n_milestones {
            return Step::Rejected(Reject::InvalidMilestoneIndex);
        }
        let i = index as usize;
        if self.state.escrow.milestones[i].is_completed {
            return Step::Rejected(Reject::MilestoneAlreadyCompleted);
        }

        let amount = self.state.escrow.milestones[i].amount;
        self.state.escrow.milestones[i].is_completed = true;
        self.pay(caller, PayTo::Freelancer, amount);

        let all_done = (0..self.state.escrow.n_milestones as usize)
            .all(|k| self.state.escrow.milestones[k].is_completed);

        let from = self.state.escrow.status;
        if all_done {
            self.transition_to(Status::Released, TransitionKind::FinalMilestonePayout);
        } else {
            self.assert_legal(from, from, TransitionKind::PartialPayout);
        }
        Step::Ok
    }

    fn raise_dispute(&mut self) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        if self.state.escrow.status.is_settled() {
            return Step::Rejected(Reject::WrongStatus);
        }
        if self.state.escrow.status == Status::Disputed {
            return Step::Rejected(Reject::WrongStatus);
        }
        self.transition_to(Status::Disputed, TransitionKind::Dispute);
        Step::Ok
    }

    /// The arbitration panel's decision settles the escrow.
    ///
    /// The split is taken over what the contract still holds, and the
    /// freelancer's share is the *residual* rather than a second percentage,
    /// so the two reconstruct the balance exactly however the division
    /// truncates. Computing both as percentages would leave `100 - p` of a
    /// truncated remainder stranded in the contract, breaking I2.
    fn resolve_arbitration(&mut self, caller: Party, client_percent: u8) -> Step {
        if !self.created {
            return Step::Rejected(Reject::NotCreated);
        }
        if self.state.escrow.status.is_settled() {
            return Step::Rejected(Reject::WrongStatus);
        }
        if client_percent > 100 {
            return Step::Rejected(Reject::InvalidResolution);
        }

        let remaining = self.state.funds.held;
        if remaining > 0 {
            let client_share = remaining * client_percent as i128 / 100;
            let freelancer_share = remaining - client_share;
            if client_share > 0 {
                self.pay(caller, PayTo::Client, client_share);
            }
            if freelancer_share > 0 {
                self.pay(caller, PayTo::Freelancer, freelancer_share);
            }
        }

        let mut i = 0usize;
        while i < self.state.escrow.n_milestones as usize {
            self.state.escrow.milestones[i].is_completed = true;
            i += 1;
        }

        self.transition_to(Status::Released, TransitionKind::ArbitrationSettlement);
        Step::Ok
    }

    // ── Settlement ───────────────────────────────────────────────────────

    /// Pay out everything the escrow still owes on the release path, split
    /// between the freelancer and whoever the fee is owed to.
    fn settle_release(&mut self, caller: Party) -> Step {
        if !matches!(self.state.escrow.status, Status::Locked | Status::InProgress) {
            return Step::Rejected(Reject::WrongStatus);
        }

        let release_amount = self.state.escrow.release_amount();

        // Mark every milestone paid — a full release discharges them all.
        let mut i = 0usize;
        while i < self.state.escrow.n_milestones as usize {
            self.state.escrow.milestones[i].is_completed = true;
            i += 1;
        }

        if release_amount > 0 {
            // I5 lives here: the fee and the freelancer's share are computed
            // from one number and must sum back to it exactly. Truncating
            // division makes the fee the smaller side, so the freelancer
            // absorbs the remainder and nothing is left behind.
            let fee = if self.state.escrow.in_referral_tree {
                super::referral_model::tree_bonus_total(release_amount)
            } else {
                platform_fee(release_amount)
            };
            let to_freelancer = release_amount - fee;

            if fee > 0 {
                if self.state.escrow.in_referral_tree {
                    self.pay(caller, PayTo::Tree, fee);
                } else if self.state.escrow.has_referrer {
                    self.pay(caller, PayTo::Referrer, fee);
                } else {
                    self.pay(caller, PayTo::Admin, fee);
                }
            }
            if to_freelancer > 0 {
                self.pay(caller, PayTo::Freelancer, to_freelancer);
            }
        }

        self.transition_to(Status::Released, TransitionKind::Release);
        Step::Ok
    }

    /// Refund whatever the contract still holds — not the original amount.
    ///
    /// Refunding `escrow.amount` after a milestone has already been paid out
    /// would pay out more than was ever deposited. The specification says the
    /// client gets back what is left, which is the only reading consistent
    /// with I1.
    fn settle_refund(&mut self, caller: Party) -> Step {
        if self.state.escrow.status != Status::Locked {
            return Step::Rejected(Reject::WrongStatus);
        }
        let remaining = self.state.funds.held;
        if remaining > 0 {
            self.pay(caller, PayTo::Client, remaining);
        }
        self.transition_to(Status::Refunded, TransitionKind::Refund);
        Step::Ok
    }

    // ── Bookkeeping ──────────────────────────────────────────────────────

    fn pay(&mut self, caller: Party, to: PayTo, amount: i128) {
        // Every fund movement passes through here, so I4's transition-level
        // check has exactly one place to live: no transfer can happen without
        // passing it, however the entrypoint reached this point.
        let authorised = self
            .current_action
            .map(|a| a.authorised_callers())
            .unwrap_or(&[]);
        if let Some(v) = check_authorisation(true, caller, authorised) {
            self.authorisation_violation = Some(v);
        }
        self.state.funds.held -= amount;
        match to {
            PayTo::Freelancer => self.state.funds.paid_freelancer += amount,
            PayTo::Client => self.state.funds.paid_client += amount,
            PayTo::Referrer => self.state.funds.paid_referrer += amount,
            PayTo::Admin => self.state.funds.paid_admin += amount,
            PayTo::Tree => self.state.funds.paid_tree += amount,
        }
    }

    fn transition_to(&mut self, to: Status, kind: TransitionKind) {
        let from = self.state.escrow.status;
        self.assert_legal(from, to, kind);
        if to.is_settled() && !from.is_settled() {
            self.state.settlements += 1;
        }
        self.state.escrow.status = to;
    }

    /// Record, rather than panic on, an edge outside the relation. The
    /// bounded model checker turns this into a readable counterexample, which
    /// is more useful than a panic that unwinds the trace that produced it.
    fn assert_legal(&mut self, from: Status, to: Status, kind: TransitionKind) {
        if !is_legal(from, to, kind) {
            self.transition_violation = Some(Violation {
                id: InvariantId::TransitionRelation,
                expected: 1,
                actual: 0,
            });
        }
    }
}

#[derive(Clone, Copy)]
enum PayTo {
    Freelancer,
    Client,
    Referrer,
    Admin,
    Tree,
}
