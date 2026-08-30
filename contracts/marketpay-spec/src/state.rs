//! Abstract state of the MarketPay escrow subsystem.
//!
//! This module is deliberately free of every `soroban_sdk` type. It models an
//! escrow with plain `core` types and fixed-size arrays so that the same
//! definitions can be consumed by
//!
//!   * the executable reference model (`super::model`),
//!   * the bounded model checker (`super::bmc`), which runs under plain
//!     `cargo test`, and
//!   * the Kani proof harnesses (`super::kani_harnesses`), which need types
//!     that a symbolic executor can enumerate without a host environment.
//!
//! Keeping the abstract state `no_std` and allocation-free is what makes the
//! third consumer possible at all: Kani cannot see through Soroban's host
//! function boundary, so anything it verifies has to be expressible without
//! one. See `docs/VERIFICATION.md` for why that boundary forces a model-based
//! approach rather than direct verification of `lib.rs`.

/// Upper bound on milestones per escrow. Mirrors the `Maximum 5 milestones
/// allowed` check in `create_escrow_internal`.
pub const MAX_MILESTONES: usize = 5;

/// Number of parties that can hold a multisig signing slot.
pub const N_SIGNERS: usize = 3;

/// Platform fee in basis points. Mirrors `PLATFORM_FEE_BPS` in `lib.rs`.
pub const PLATFORM_FEE_BPS: i128 = 100;

/// Basis-point denominator. Mirrors `FEE_BPS_DENOMINATOR` in `lib.rs`.
pub const FEE_BPS_DENOMINATOR: i128 = 10_000;

/// Multisig approval threshold: 2 of 3.
pub const MULTISIG_THRESHOLD: u8 = 2;

/// The distinguishable actors in the model.
///
/// The concrete contract uses `Address`, an opaque 32-byte identifier. For
/// verification purposes only the *role* matters — the authorisation checks in
/// `lib.rs` all compare an incoming address against a role stored on the
/// escrow, never against a literal. Collapsing addresses to roles is what keeps
/// the state space finite; `Outsider` stands for every address holding none of
/// the named roles.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Party {
    Client,
    Freelancer,
    Arbitrator,
    Referrer,
    Admin,
    Oracle,
    /// The arbitration panel acting collectively.
    ///
    /// Not an address: `resolve_arbitration` is permissionless, and the three
    /// arbitrators' votes are what authorise the settlement. Modelling that
    /// as a distinct party keeps the I4 check meaningful on this path — the
    /// alternative, an empty authorised set, would say nobody may settle an
    /// arbitration, and a set containing everyone would say the check is
    /// theatre.
    Panel,
    Outsider,
}

impl Party {
    /// Every party, in a fixed order, for exhaustive enumeration.
    pub const ALL: [Party; 8] = [
        Party::Client,
        Party::Freelancer,
        Party::Arbitrator,
        Party::Referrer,
        Party::Admin,
        Party::Oracle,
        Party::Panel,
        Party::Outsider,
    ];

    /// The three parties that may hold a multisig signing slot.
    pub const SIGNERS: [Party; N_SIGNERS] =
        [Party::Client, Party::Freelancer, Party::Arbitrator];

    /// Index into the multisig vote arrays, or `None` for a non-signer.
    pub fn signer_slot(self) -> Option<usize> {
        match self {
            Party::Client => Some(0),
            Party::Freelancer => Some(1),
            Party::Arbitrator => Some(2),
            _ => None,
        }
    }
}

/// Escrow status. Mirrors `EscrowStatus` in `lib.rs` exactly.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Locked,
    InProgress,
    Released,
    Refunded,
    Disputed,
}

impl Status {
    /// A status from which no further fund movement is specified.
    ///
    /// Note that `Disputed` is *not* terminal in the implementation even
    /// though no entrypoint settles a disputed non-milestone escrow; see
    /// finding F4 in `docs/SPECIFICATION.md`.
    pub fn is_settled(self) -> bool {
        matches!(self, Status::Released | Status::Refunded)
    }
}

/// One milestone: an amount and whether it has been paid out.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Milestone {
    pub amount: i128,
    pub is_completed: bool,
}

/// The abstract escrow record.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Escrow {
    /// Total amount deposited at creation. Never mutated after creation.
    pub amount: i128,
    pub status: Status,
    pub milestones: [Milestone; MAX_MILESTONES],
    pub n_milestones: u8,
    /// Set when the escrow was created with an arbitrator, which is what
    /// switches settlement onto the 2-of-3 multisig path.
    pub has_arbitrator: bool,
    /// Set when the escrow was created with a referrer, which redirects the
    /// platform fee away from the admin.
    pub has_referrer: bool,
    /// Set when the freelancer is registered in the referral tree, which
    /// replaces the flat platform fee with multi-level bonuses.
    pub in_referral_tree: bool,
    pub release_approvals: u8,
    pub refund_approvals: u8,
    pub release_votes: [bool; N_SIGNERS],
    pub refund_votes: [bool; N_SIGNERS],
}

impl Escrow {
    /// Sum of the amounts of milestones not yet paid out.
    pub fn unpaid_milestone_total(&self) -> i128 {
        let mut total: i128 = 0;
        let mut i = 0usize;
        while i < self.n_milestones as usize {
            if !self.milestones[i].is_completed {
                total += self.milestones[i].amount;
            }
            i += 1;
        }
        total
    }

    /// Sum of the amounts of milestones already paid out.
    pub fn paid_milestone_total(&self) -> i128 {
        let mut total: i128 = 0;
        let mut i = 0usize;
        while i < self.n_milestones as usize {
            if self.milestones[i].is_completed {
                total += self.milestones[i].amount;
            }
            i += 1;
        }
        total
    }

    pub fn has_milestones(&self) -> bool {
        self.n_milestones > 0
    }

    /// The amount a full release would pay out, per `release_escrow_core`:
    /// the whole escrow when there are no milestones, otherwise whatever
    /// milestones remain unpaid.
    pub fn release_amount(&self) -> i128 {
        if self.has_milestones() {
            self.unpaid_milestone_total()
        } else {
            self.amount
        }
    }
}

/// Where the money is. Every fund movement in the model is recorded here, so
/// that value conservation is a statement about this struct alone.
///
/// `deposited` is the ground truth: the amount the client transferred in at
/// creation. Everything else partitions it.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Funds {
    /// Total transferred into the contract for this escrow.
    pub deposited: i128,
    /// Still held by the contract on this escrow's behalf.
    pub held: i128,
    pub paid_freelancer: i128,
    pub paid_client: i128,
    pub paid_referrer: i128,
    pub paid_admin: i128,
    /// Multi-level referral bonuses, aggregated across all ancestor levels.
    pub paid_tree: i128,
}

impl Funds {
    /// Everything that has left the contract.
    pub fn total_out(&self) -> i128 {
        self.paid_freelancer
            + self.paid_client
            + self.paid_referrer
            + self.paid_admin
            + self.paid_tree
    }
}

/// The complete verification state: one escrow plus its funds plus the audit
/// counters the invariants are stated over.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SystemState {
    pub escrow: Escrow,
    pub funds: Funds,
    /// Number of times the escrow has entered a settled status. The
    /// single-settlement invariant is `settlements <= 1`.
    pub settlements: u32,
    /// Whether `start_work` has been called. Tracked separately from `status`
    /// because `raise_dispute` overwrites the status and would otherwise erase
    /// the fact.
    pub work_started: bool,
    /// Ledger time has advanced past the escrow's timeout.
    pub timed_out: bool,
    /// Whether an oracle has been configured for each milestone.
    pub milestone_oracle: [bool; MAX_MILESTONES],
}

impl SystemState {
    /// The state before `create_escrow` has been called.
    pub fn uncreated() -> Self {
        SystemState {
            escrow: Escrow {
                amount: 0,
                status: Status::Locked,
                milestones: [Milestone {
                    amount: 0,
                    is_completed: false,
                }; MAX_MILESTONES],
                n_milestones: 0,
                has_arbitrator: false,
                has_referrer: false,
                in_referral_tree: false,
                release_approvals: 0,
                refund_approvals: 0,
                release_votes: [false; N_SIGNERS],
                refund_votes: [false; N_SIGNERS],
            },
            funds: Funds::default(),
            settlements: 0,
            work_started: false,
            timed_out: false,
            milestone_oracle: [false; MAX_MILESTONES],
        }
    }
}
