//! Escrow v2 storage representation and accounting helpers.

use soroban_sdk::{contracttype, Address, Bytes, String, Vec};

use crate::milestones::NamedMilestone;
use crate::state_machine::LifecycleState;

pub const ESCROW_SCHEMA_V2: u32 = 2;

/// ABI-compatible parameters for the original discrete escrow entrypoints.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CreateEscrowParams {
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    pub milestones: Option<Vec<i128>>,
    pub timeout_ledgers: Option<u32>,
    pub referrer: Option<Address>,
    pub arbitrator: Option<Address>,
}

/// Original public status type. It stays exported while v2 uses the richer
/// lifecycle internally.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Locked,
    InProgress,
    Released,
    Refunded,
    Disputed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub amount: i128,
    pub is_completed: bool,
}

/// Exact legacy storage shape retained for ABI compatibility and rollback.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub job_id: String,
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    pub status: EscrowStatus,
    pub created_at: u32,
    pub timeout_ledger: u32,
    pub milestones: Vec<Milestone>,
    pub referrer: Option<Address>,
    pub deliverable_hash: Option<Bytes>,
    pub arbitrator: Option<Address>,
    pub release_approvals: u32,
    pub refund_approvals: u32,
}

/// Named alias used by migration fixtures and documentation.
pub type EscrowV1 = Escrow;

impl Escrow {
    pub fn release_amount(&self) -> i128 {
        if self.milestones.is_empty() {
            return self.amount;
        }
        let mut remaining = 0i128;
        for milestone in self.milestones.iter() {
            if !milestone.is_completed {
                remaining = remaining
                    .checked_add(milestone.amount)
                    .expect("Arithmetic overflow");
            }
        }
        remaining
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SettlementMode {
    Discrete,
    Streaming,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MigrationStatus {
    Migrated,
    RolledBack,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowV2 {
    pub schema_version: u32,
    pub job_id: String,
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    pub state: LifecycleState,
    pub settlement_mode: SettlementMode,
    pub paid_to_freelancer: i128,
    pub paid_as_fees: i128,
    pub refunded_to_client: i128,
    pub template_id: Option<String>,
    pub milestones: Vec<NamedMilestone>,
    /// True only when this record was derived from and can potentially be
    /// rolled back to a preserved legacy record.
    pub migrated_from_v1: bool,
    /// Set once a v2-only mutation makes projection back to v1 unsafe.
    pub v2_features_used: bool,
}

impl EscrowV2 {
    pub fn settled_total(&self) -> i128 {
        self.paid_to_freelancer
            .checked_add(self.paid_as_fees)
            .and_then(|n| n.checked_add(self.refunded_to_client))
            .expect("Escrow accounting overflow")
    }

    pub fn liability(&self) -> i128 {
        self.amount
            .checked_sub(self.settled_total())
            .expect("Escrow accounting invariant violated")
    }

    pub fn assert_conservation(&self) {
        if self.amount < 0
            || self.paid_to_freelancer < 0
            || self.paid_as_fees < 0
            || self.refunded_to_client < 0
            || self.settled_total() > self.amount
        {
            panic!("Escrow accounting invariant violated");
        }
    }
}
