/*
 * contracts/marketpay-contract/src/lib.rs
 *
 * Stellar MarketPay — Soroban Escrow Contract
 *
 * This contract manages trustless escrow between a client and freelancer:
 *
 *   1. Client calls create_escrow() — locks XLM in the contract
 *   2. Freelancer does the work
 *   3. Client calls release_escrow() — funds sent to freelancer
 *      OR client calls refund_escrow() before work starts — funds returned
 *
 * Build:
 *   cargo build --target wasm32-unknown-unknown --release
 *
 * Deploy:
 *   stellar contract deploy \
 *     --wasm target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
 *     --source alice --network testnet
 */

#![no_std]
#![allow(
    clippy::too_many_arguments,
    clippy::manual_range_contains,
    unused_variables
)]

// Needed by src/reputation.rs for dynamic Fiat-Shamir transcript labels and
// JSON encoding of statement public parameters (`format!`, `alloc::string`,
// `alloc::vec`) — the rest of this crate has no allocation-heavy code, so
// this was never linked before.
extern crate alloc;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, BytesN, Env, String,
    Vec,
};

pub mod arbitration;
pub mod certificates;
pub mod escrow;
pub mod migration;
pub mod milestones;
pub mod multisig;
pub mod ratings;
pub mod state_machine;
pub mod streaming;
pub mod bridge;

pub use arbitration::{ArbitrationCase, DisputeCase};
pub use certificates::Certificate;
pub use escrow::{
    CreateEscrowParams, Escrow, EscrowStatus, EscrowV1, EscrowV2, MigrationStatus, Milestone,
    SettlementMode, ESCROW_SCHEMA_V2,
};
pub use milestones::{
    MilestoneAmendment, MilestoneTemplate, MilestoneTemplateItem, NamedMilestone,
    MAX_TEMPLATE_MILESTONES,
};
pub use ratings::{FreelancerRatingStats, Rating};
pub use state_machine::{LifecycleAction, LifecycleState};
pub use streaming::StreamSchedule;

pub use bridge::{
    BridgeChain, BridgeFeeConfig, BridgeTransfer, BridgeTransferStatus, EvmProof,
    assert_finalized, default_fee_config,
};

pub mod referral;
use referral::{distribute_tree_rewards, get_children, get_depth, get_parent, register_referral};
pub mod referrals;

pub mod oracle;
use oracle::MilestoneOracleConfig;

pub mod reputation;
use reputation::ReputationProofArgs;

// ─── Storage keys ─────────────────────────────────────────────────────────────

/// Default timeout: 7 days in seconds.
const DEFAULT_TIMEOUT_SECONDS: u32 = 7 * 24 * 60 * 60;
/// Legacy fallback used by the older ledger-sequence timeout path.
const DEFAULT_TIMEOUT_LEDGERS: u32 = 120_960;

/// ISSUE-17: Platform fee charged on release, in basis points (1%).
/// Routed entirely to the escrow's `referrer` when one is set; otherwise it
/// goes to the protocol admin. Only applies when the freelancer has no
/// multi-level referral tree registration (that path has its own bonus model).
const PLATFORM_FEE_BPS: i128 = 100;
const FEE_BPS_DENOMINATOR: i128 = 10_000;

/// Budget commitment for sealed-bid system (Issue #108)
#[contracttype]
#[derive(Clone, Debug)]
pub struct BudgetCommitment {
    pub job_id: String,
    pub client: Address,
    pub budget_amount: i128,
    pub is_revealed: bool,
}

/// Deliverable hash for oracle verification (Issue #105)
#[contracttype]
#[derive(Clone, Debug)]
pub struct DeliverableSubmission {
    pub job_id: String,
    pub client_hash_submitted: bool,
    pub freelancer_hash_submitted: bool,
    pub hashes_match: bool,
}

/// Freelancer sealed-bid commitment entry.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BidCommitment {
    pub job_id: String,
    pub freelancer: Address,
    pub commitment: BytesN<32>,
    pub submitted_at_ledger: u32,
    pub bid_revealed: bool,
}

/// Bidding lifecycle state for a job.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BiddingState {
    pub job_id: String,
    pub client: Address,
    pub is_closed: bool,
    pub closed_at_ledger: u32,
    pub reveal_deadline_ledger: u32,
}

/// A successfully revealed bid.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RevealedBid {
    pub freelancer: Address,
    pub amount: i128,
    pub revealed_at_ledger: u32,
}

/// Storage key per job
#[contracttype]
pub enum DataKey {
    Admin,
    Escrow(String),
    /// Additive v2 record. The legacy key remains untouched during the
    /// compatibility and rollback window.
    EscrowV2(String),
    MigrationBackup(String),
    V2MigrationStatus(String),
    MilestoneTemplate(String),
    MilestoneAmendment(String),
    StreamSchedule(String),
    EscrowCount,
    Proposal(u32),
    ProposalCount,
    HasVoted(Address, u32),
    CompletedJobs(Address),
    DefaultTimeoutSeconds,
    TimeoutTimestamp(String),
    BudgetCommitment(String),
    DeliverableSubmission(String),
    BidCommitment(String, Address),
    BiddingState(String),
    RevealedBids(String),
    Certificate(String),
    FreelancerCertificates(Address),
    ClientRating(String),
    FreelancerRating(String),
    FreelancerRatingStats(Address),
    Arbitrator(Address),
    /// Multisig: (job_id, signer) → bool, whether `signer` has approved release
    MultisigReleaseVote(String, Address),
    /// Multisig: (job_id, signer) → bool, whether `signer` has approved refund
    MultisigRefundVote(String, Address),
    ArbitratorPool,
    ArbitrationCase(u32),
    ArbitrationCaseCount,
    DisputeCase(String),
    Version,
    /// Stores list of IPFS CIDs for messages in a job thread
    MessageCid(String),
    /// Referral tree: child → parent address
    ReferralParent(Address),
    /// Referral tree: parent → Vec<Address> of direct children
    ReferralChildren(Address),
    /// Referral tree: user → depth in the tree (u32)
    ReferralDepth(Address),
    /// Config for milestone-based oracle auto-verification: job_id, milestone_index
    MilestoneOracle(String, u32),
    /// Cross-chain bridge: transfer_id → BridgeTransfer
    BridgeTransfer(BytesN<32>),
    /// Cross-chain bridge: nonce → bool (replay protection)
    BridgeNonce(u64),
    /// Cross-chain bridge: chain_id → BytesN<32>
    BridgeChainId(BytesN<32>),
    /// Cross-chain bridge: nonce → transfer_id
    BridgeNonceToTransfer(BytesN<32>),
    /// Cross-chain bridge: hourly volume tracking
    BridgeVolume(u32),
    /// Cross-chain bridge: circuit breaker state
    BridgeCircuitBreaker,
}

/// Reveal phase is open for roughly 24 hours after client closes bidding.
const REVEAL_WINDOW_LEDGERS: u32 = 1000;

/// A governance proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u32,
    pub title: String,
    pub description: String,
    pub votes_for: u32,
    pub votes_against: u32,
    pub deadline_ledger: u32,
    pub resolved: bool,
    pub result: bool,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct MarketPayContract;

#[allow(clippy::too_many_arguments)]
#[contractimpl]
impl MarketPayContract {
    fn compute_bid_commitment(env: &Env, amount: i128, nonce: BytesN<32>) -> BytesN<32> {
        let mut payload = Bytes::new(env);
        for byte in amount.to_be_bytes().iter() {
            payload.push_back(*byte);
        }
        for byte in nonce.to_array().iter() {
            payload.push_back(*byte);
        }
        env.crypto().sha256(&payload).into()
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    /// Initialize with an admin address (called once after deployment).
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EscrowCount, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::DefaultTimeoutSeconds, &DEFAULT_TIMEOUT_SECONDS);
        env.storage().instance().set(&DataKey::Version, &1u32);
    }

    // ─── Upgrade & versioning ─────────────────────────────────────────────────

    /// Upgrade the contract WASM. Restricted to admin.
    ///
    /// `new_wasm_hash` is the 32-byte hash of the new WASM blob already
    /// uploaded to the network via `stellar contract install`.
    /// All existing storage (escrows, proposals, ratings, …) is preserved
    /// because Soroban upgrades only replace the executable, not the state.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        // Bump version so callers can detect the upgrade
        let version: u32 = env.storage().instance().get(&DataKey::Version).unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &(version + 1));

        env.events()
            .publish((symbol_short!("upgraded"), admin), version + 1);
    }

    /// Return the current contract version (starts at 1, increments on each upgrade).
    pub fn get_version(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Version).unwrap_or(1)
    }

    // ─── Escrow v2: templates, streams, and migration ───────────────────────

    /// Publish an immutable, reusable named milestone template.
    pub fn create_milestone_template(
        env: Env,
        template_id: String,
        client: Address,
        name: String,
        items: Vec<MilestoneTemplateItem>,
    ) {
        client.require_auth();
        if name.is_empty() || template_id.is_empty() {
            panic!("Template id and name must not be empty");
        }
        let key = DataKey::MilestoneTemplate(template_id.clone());
        if env.storage().instance().has(&key) {
            panic!("Milestone template already exists");
        }
        let total = Self::template_total(&items);
        milestones::validate_items(&items, total);
        let template = MilestoneTemplate {
            template_id: template_id.clone(),
            owner: client.clone(),
            name,
            items,
            revision: 1,
        };
        env.storage().instance().set(&key, &template);
        env.events().publish(
            (symbol_short!("tpl_new"), template_id),
            (client, template.revision, template.items.len()),
        );
    }

    pub fn get_milestone_template(env: Env, template_id: String) -> MilestoneTemplate {
        env.storage()
            .instance()
            .get(&DataKey::MilestoneTemplate(template_id))
            .expect("Milestone template not found")
    }

    /// Create a discrete escrow from a reusable template. The template is
    /// snapshotted so later engagements and amendments are independent.
    pub fn create_escrow_from_template(
        env: Env,
        job_id: String,
        client: Address,
        template_id: String,
        params: CreateEscrowParams,
    ) {
        let mut params = params;
        let template: MilestoneTemplate = env
            .storage()
            .instance()
            .get(&DataKey::MilestoneTemplate(template_id.clone()))
            .expect("Milestone template not found");
        let expected_amount = Self::template_total(&template.items);
        if params.amount != expected_amount {
            panic!("Escrow amount must equal template total");
        }
        if params.milestones.is_some() {
            panic!("Template escrow cannot include legacy milestones");
        }
        let mut amounts = Vec::new(&env);
        for item in template.items.iter() {
            amounts.push_back(item.amount);
        }
        params.milestones = Some(amounts);

        Self::create_escrow_internal(
            env.clone(),
            job_id.clone(),
            client,
            params.freelancer,
            params.token,
            params.amount,
            params.milestones,
            params.timeout_ledgers,
            params.referrer,
            params.arbitrator,
            None,
            MAX_TEMPLATE_MILESTONES,
        );
        let legacy: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found after creation");
        let v2 = EscrowV2 {
            schema_version: ESCROW_SCHEMA_V2,
            job_id: job_id.clone(),
            client: legacy.client,
            freelancer: legacy.freelancer,
            token: legacy.token,
            amount: legacy.amount,
            state: LifecycleState::Locked,
            settlement_mode: SettlementMode::Discrete,
            paid_to_freelancer: 0,
            paid_as_fees: 0,
            refunded_to_client: 0,
            template_id: Some(template_id.clone()),
            milestones: milestones::instantiate(&env, &template.items, env.ledger().sequence()),
            migrated_from_v1: false,
            v2_features_used: false,
        };
        migration::store(&env, &v2);
        env.events().publish(
            (symbol_short!("tpl_use"), template_id),
            (job_id, template.revision),
        );
    }

    /// Client proposes a replacement for the unpaid milestone set. Proposal
    /// creation is the client's explicit approval; activation still requires
    /// the freelancer's independent authorization.
    pub fn propose_milestone_amendment(
        env: Env,
        job_id: String,
        client: Address,
        replacement_items: Vec<MilestoneTemplateItem>,
    ) {
        client.require_auth();
        let escrow = migration::load_or_migrate(&env, &job_id);
        if escrow.client != client {
            panic!("Only the client can propose a milestone amendment");
        }
        if escrow.settlement_mode != SettlementMode::Discrete {
            panic!("Streaming escrows do not use milestone amendments");
        }
        if escrow.state != LifecycleState::Locked && escrow.state != LifecycleState::Active {
            panic!("Milestones can only be amended on an unsettled escrow");
        }
        milestones::validate_items(&replacement_items, escrow.liability());
        let amendment = MilestoneAmendment {
            replacement_items,
            client_approved: true,
            freelancer_approved: false,
            proposed_at_ledger: env.ledger().sequence(),
        };
        env.storage()
            .instance()
            .set(&DataKey::MilestoneAmendment(job_id.clone()), &amendment);
        env.events().publish(
            (symbol_short!("ms_prop"), job_id),
            (client, amendment.replacement_items.len()),
        );
    }

    /// Freelancer authorises and atomically activates the pending amendment.
    pub fn approve_milestone_amendment(env: Env, job_id: String, freelancer: Address) {
        freelancer.require_auth();
        let mut escrow = migration::load_or_migrate(&env, &job_id);
        if escrow.freelancer != freelancer {
            panic!("Only the freelancer can approve a milestone amendment");
        }
        let key = DataKey::MilestoneAmendment(job_id.clone());
        let mut amendment: MilestoneAmendment = env
            .storage()
            .instance()
            .get(&key)
            .expect("Milestone amendment not found");
        if amendment.freelancer_approved {
            panic!("Milestone amendment already approved");
        }
        milestones::validate_items(&amendment.replacement_items, escrow.liability());
        amendment.freelancer_approved = true;

        let mut updated_named = Vec::new(&env);
        let mut updated_legacy = Vec::new(&env);
        for item in escrow.milestones.iter() {
            if item.is_completed {
                updated_legacy.push_back(Milestone {
                    amount: item.amount,
                    is_completed: true,
                });
                updated_named.push_back(item);
            }
        }
        let replacement =
            milestones::instantiate(&env, &amendment.replacement_items, env.ledger().sequence());
        for item in replacement.iter() {
            updated_legacy.push_back(Milestone {
                amount: item.amount,
                is_completed: false,
            });
            updated_named.push_back(item);
        }
        if updated_named.len() > MAX_TEMPLATE_MILESTONES {
            panic!("Amended milestone set exceeds maximum size");
        }

        let mut legacy: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");
        legacy.milestones = updated_legacy;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &legacy);

        escrow.milestones = updated_named;
        escrow.v2_features_used = true;
        migration::store(&env, &escrow);
        env.storage().instance().remove(&key);
        env.events().publish(
            (symbol_short!("ms_amend"), job_id),
            (freelancer, escrow.milestones.len()),
        );
    }

    pub fn get_milestone_amendment(env: Env, job_id: String) -> Option<MilestoneAmendment> {
        env.storage()
            .instance()
            .get(&DataKey::MilestoneAmendment(job_id))
    }

    /// Lock funds into a stream that accrues linearly over active ledgers.
    pub fn create_streaming_escrow(
        env: Env,
        job_id: String,
        client: Address,
        params: CreateEscrowParams,
        start_ledger: u32,
        end_ledger: u32,
    ) {
        if params.milestones.is_some() {
            panic!("Streaming escrow cannot include discrete milestones");
        }
        if start_ledger < env.ledger().sequence() {
            panic!("Stream cannot start in the past");
        }
        let schedule = StreamSchedule::new(params.amount, start_ledger, end_ledger);
        Self::create_escrow(env.clone(), job_id.clone(), client, params);

        let mut legacy: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found after creation");
        legacy.status = state_machine::transition_legacy(legacy.status, LifecycleAction::Start);
        let v2 = EscrowV2 {
            schema_version: ESCROW_SCHEMA_V2,
            job_id: job_id.clone(),
            client: legacy.client.clone(),
            freelancer: legacy.freelancer.clone(),
            token: legacy.token.clone(),
            amount: legacy.amount,
            state: LifecycleState::Active,
            settlement_mode: SettlementMode::Streaming,
            paid_to_freelancer: 0,
            paid_as_fees: 0,
            refunded_to_client: 0,
            template_id: None,
            milestones: Vec::new(&env),
            migrated_from_v1: false,
            v2_features_used: true,
        };
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &legacy);
        env.storage()
            .instance()
            .set(&DataKey::StreamSchedule(job_id.clone()), &schedule);
        migration::store(&env, &v2);
        env.events().publish(
            (symbol_short!("strm_new"), job_id),
            (start_ledger, end_ledger, v2.amount),
        );
    }

    pub fn get_escrow_v2(env: Env, job_id: String) -> EscrowV2 {
        migration::load_or_migrate(&env, &job_id)
    }

    pub fn get_stream(env: Env, job_id: String) -> StreamSchedule {
        let escrow = migration::load_or_migrate(&env, &job_id);
        if escrow.settlement_mode != SettlementMode::Streaming {
            panic!("Escrow is not streaming");
        }
        env.storage()
            .instance()
            .get(&DataKey::StreamSchedule(job_id))
            .expect("Stream schedule missing")
    }

    /// Withdraw all value accrued so far without terminating the stream.
    pub fn withdraw_stream(env: Env, job_id: String, freelancer: Address) -> i128 {
        freelancer.require_auth();
        let mut escrow = migration::load_or_migrate(&env, &job_id);
        if escrow.freelancer != freelancer {
            panic!("Only the freelancer can withdraw a stream");
        }
        if escrow.settlement_mode != SettlementMode::Streaming {
            panic!("Escrow is not streaming");
        }
        let accruing = match escrow.state {
            LifecycleState::Active => true,
            LifecycleState::Paused => false,
            _ => panic!("Stream is not withdrawable in its current state"),
        };
        let amount = Self::settle_stream_accrued(&env, &mut escrow, accruing);
        if escrow.paid_to_freelancer == escrow.amount {
            escrow.state = state_machine::transition(escrow.state, LifecycleAction::Release);
            Self::sync_legacy_state(&env, &job_id, EscrowStatus::Released);
            env.storage()
                .instance()
                .remove(&DataKey::TimeoutTimestamp(job_id.clone()));
        }
        migration::store(&env, &escrow);
        env.events().publish(
            (symbol_short!("strm_pay"), job_id),
            (freelancer, amount, escrow.paid_to_freelancer),
        );
        amount
    }

    /// Either participant may stop accrual. Accrued value is settled first.
    pub fn pause_stream(env: Env, job_id: String, caller: Address) -> i128 {
        caller.require_auth();
        let mut escrow = migration::load_or_migrate(&env, &job_id);
        Self::require_participant(&escrow, &caller);
        if escrow.settlement_mode != SettlementMode::Streaming {
            panic!("Escrow is not streaming");
        }
        let mut schedule: StreamSchedule = env
            .storage()
            .instance()
            .get(&DataKey::StreamSchedule(job_id.clone()))
            .expect("Stream schedule missing");
        schedule.checkpoint(env.ledger().sequence());
        env.storage()
            .instance()
            .set(&DataKey::StreamSchedule(job_id.clone()), &schedule);
        let amount = Self::settle_stream_accrued(&env, &mut escrow, false);
        if escrow.paid_to_freelancer == escrow.amount {
            escrow.state = state_machine::transition(escrow.state, LifecycleAction::Release);
            Self::sync_legacy_state(&env, &job_id, EscrowStatus::Released);
        } else {
            escrow.state = state_machine::transition(escrow.state, LifecycleAction::Pause);
        }
        migration::store(&env, &escrow);
        env.events().publish(
            (symbol_short!("strm_ps"), job_id),
            (caller, amount, escrow.paid_to_freelancer),
        );
        amount
    }

    pub fn resume_stream(env: Env, job_id: String, caller: Address) {
        caller.require_auth();
        let mut escrow = migration::load_or_migrate(&env, &job_id);
        Self::require_participant(&escrow, &caller);
        if escrow.settlement_mode != SettlementMode::Streaming {
            panic!("Escrow is not streaming");
        }
        escrow.state = state_machine::transition(escrow.state, LifecycleAction::Resume);
        let mut schedule: StreamSchedule = env
            .storage()
            .instance()
            .get(&DataKey::StreamSchedule(job_id.clone()))
            .expect("Stream schedule missing");
        schedule.resume(env.ledger().sequence());
        env.storage()
            .instance()
            .set(&DataKey::StreamSchedule(job_id.clone()), &schedule);
        migration::store(&env, &escrow);
        env.events()
            .publish((symbol_short!("strm_rs"), job_id), caller);
    }

    /// Client cancels after paying all value accrued at the cancellation
    /// checkpoint; the exact residual returns to the client.
    pub fn cancel_stream(env: Env, job_id: String, client: Address) -> i128 {
        client.require_auth();
        let mut escrow = migration::load_or_migrate(&env, &job_id);
        if escrow.client != client {
            panic!("Only the client can cancel a stream");
        }
        if escrow.settlement_mode != SettlementMode::Streaming {
            panic!("Escrow is not streaming");
        }
        if escrow.state == LifecycleState::Active {
            let mut schedule: StreamSchedule = env
                .storage()
                .instance()
                .get(&DataKey::StreamSchedule(job_id.clone()))
                .expect("Stream schedule missing");
            schedule.checkpoint(env.ledger().sequence());
            env.storage()
                .instance()
                .set(&DataKey::StreamSchedule(job_id.clone()), &schedule);
        }
        Self::settle_stream_accrued(&env, &mut escrow, false);
        let refund = escrow.liability();
        if refund > 0 {
            token::Client::new(&env, &escrow.token).transfer(
                &env.current_contract_address(),
                &escrow.client,
                &refund,
            );
            escrow.refunded_to_client = escrow
                .refunded_to_client
                .checked_add(refund)
                .expect("Escrow accounting overflow");
        }
        if escrow.paid_to_freelancer == escrow.amount {
            escrow.state = state_machine::transition(escrow.state, LifecycleAction::Release);
            Self::sync_legacy_state(&env, &job_id, EscrowStatus::Released);
        } else {
            escrow.state = state_machine::transition(escrow.state, LifecycleAction::Cancel);
            Self::sync_legacy_state(&env, &job_id, EscrowStatus::Refunded);
        }
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));
        migration::store(&env, &escrow);
        env.events().publish(
            (symbol_short!("strm_cn"), job_id),
            (client, escrow.paid_to_freelancer, refund),
        );
        refund
    }

    /// Explicit form of the lazy read, useful to migration operators.
    pub fn migrate_escrow_v2(env: Env, job_id: String) -> EscrowV2 {
        migration::load_or_migrate(&env, &job_id)
    }

    /// Restore the exact preserved v1 record before any v2-only mutation.
    pub fn rollback_escrow_v2(env: Env, job_id: String, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only admin can roll back a migration");
        }
        let escrow: EscrowV2 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowV2(job_id.clone()))
            .expect("Escrow has not been migrated");
        if !escrow.migrated_from_v1 || escrow.v2_features_used {
            panic!("Escrow is no longer representable by its v1 backup");
        }
        let backup: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::MigrationBackup(job_id.clone()))
            .expect("Migration backup missing");
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &backup);
        env.storage()
            .instance()
            .remove(&DataKey::EscrowV2(job_id.clone()));
        env.storage().instance().set(
            &DataKey::V2MigrationStatus(job_id.clone()),
            &MigrationStatus::RolledBack,
        );
        env.events()
            .publish((symbol_short!("v2_roll"), job_id), admin);
    }

    pub fn get_v2_migration_status(env: Env, job_id: String) -> Option<MigrationStatus> {
        env.storage()
            .instance()
            .get(&DataKey::V2MigrationStatus(job_id))
    }

    fn template_total(items: &Vec<MilestoneTemplateItem>) -> i128 {
        let mut total = 0i128;
        for item in items.iter() {
            total = total
                .checked_add(item.amount)
                .expect("Milestone amount overflow");
        }
        total
    }

    fn require_participant(escrow: &EscrowV2, caller: &Address) {
        if &escrow.client != caller && &escrow.freelancer != caller {
            panic!("Only escrow participants may perform this action");
        }
    }

    fn settle_stream_accrued(env: &Env, escrow: &mut EscrowV2, accruing: bool) -> i128 {
        let mut schedule: StreamSchedule = env
            .storage()
            .instance()
            .get(&DataKey::StreamSchedule(escrow.job_id.clone()))
            .expect("Stream schedule missing");
        let amount = schedule.withdrawable_at(env.ledger().sequence(), accruing);
        if amount > 0 {
            token::Client::new(env, &escrow.token).transfer(
                &env.current_contract_address(),
                &escrow.freelancer,
                &amount,
            );
            schedule.record_withdrawal(amount);
            escrow.paid_to_freelancer = escrow
                .paid_to_freelancer
                .checked_add(amount)
                .expect("Escrow accounting overflow");
        }
        env.storage()
            .instance()
            .set(&DataKey::StreamSchedule(escrow.job_id.clone()), &schedule);
        escrow.assert_conservation();
        amount
    }

    fn sync_legacy_state(env: &Env, job_id: &String, status: EscrowStatus) {
        if let Some(mut legacy) = env
            .storage()
            .instance()
            .get::<_, Escrow>(&DataKey::Escrow(job_id.clone()))
        {
            legacy.status = status;
            env.storage()
                .instance()
                .set(&DataKey::Escrow(job_id.clone()), &legacy);
        }
    }

    fn require_discrete_if_v2(env: &Env, job_id: &String) {
        if let Some(v2) = env
            .storage()
            .instance()
            .get::<_, EscrowV2>(&DataKey::EscrowV2(job_id.clone()))
        {
            if v2.settlement_mode == SettlementMode::Streaming {
                panic!("Streaming escrow must use streaming settlement entrypoints");
            }
        }
    }

    fn sync_v2_transition_if_present(env: &Env, job_id: &String, action: LifecycleAction) {
        if let Some(mut v2) = env
            .storage()
            .instance()
            .get::<_, EscrowV2>(&DataKey::EscrowV2(job_id.clone()))
        {
            v2.state = state_machine::transition(v2.state, action);
            if v2.migrated_from_v1 {
                v2.v2_features_used = true;
            }
            migration::store(env, &v2);
        }
    }

    fn sync_v2_settlement_if_present(env: &Env, job_id: &String, refund: bool) {
        if let Some(mut v2) = env
            .storage()
            .instance()
            .get::<_, EscrowV2>(&DataKey::EscrowV2(job_id.clone()))
        {
            if v2.settlement_mode != SettlementMode::Discrete {
                panic!("Streaming escrow reached a discrete settlement path");
            }
            let remaining = v2.liability();
            if refund {
                v2.state = state_machine::transition(v2.state, LifecycleAction::Refund);
                v2.refunded_to_client = v2
                    .refunded_to_client
                    .checked_add(remaining)
                    .expect("Escrow accounting overflow");
            } else {
                v2.state = state_machine::transition(v2.state, LifecycleAction::Release);
                // Legacy settlement may split this amount between the
                // freelancer and referral/fee recipients. v1 did not persist
                // that split, so the compatibility accounting bucket records
                // the whole released liability here.
                v2.paid_to_freelancer = v2
                    .paid_to_freelancer
                    .checked_add(remaining)
                    .expect("Escrow accounting overflow");
            }
            if v2.migrated_from_v1 {
                v2.v2_features_used = true;
            }
            migration::store(env, &v2);
        }
    }

    fn sync_v2_milestone(
        env: &Env,
        job_id: &String,
        milestone_index: u32,
        amount: i128,
        all_completed: bool,
    ) {
        if let Some(mut v2) = env
            .storage()
            .instance()
            .get::<_, EscrowV2>(&DataKey::EscrowV2(job_id.clone()))
        {
            if v2.settlement_mode != SettlementMode::Discrete {
                panic!("Streaming escrow reached a milestone settlement path");
            }
            v2.state = state_machine::transition(v2.state, LifecycleAction::ReleaseMilestone);
            if milestone_index < v2.milestones.len() {
                let mut item = v2.milestones.get(milestone_index).unwrap();
                item.is_completed = true;
                v2.milestones.set(milestone_index, item);
            }
            v2.paid_to_freelancer = v2
                .paid_to_freelancer
                .checked_add(amount)
                .expect("Escrow accounting overflow");
            if all_completed {
                let action = if v2.state == LifecycleState::Disputed {
                    LifecycleAction::ResolveRelease
                } else {
                    LifecycleAction::Release
                };
                v2.state = state_machine::transition(v2.state, action);
            }
            if v2.migrated_from_v1 {
                v2.v2_features_used = true;
            }
            migration::store(env, &v2);
        }
    }

    // ─── Escrow lifecycle ─────────────────────────────────────────────────────

    /// Client creates an escrow by transferring funds into the contract.
    ///
    /// Parameters:
    ///   job_id           — unique ID matching the backend job record
    ///   freelancer       — the address that will receive payment on release
    ///   token            — SAC address of the payment token (XLM or USDC)
    ///   amount           — payment amount in smallest token units
    ///   milestones       — optional list of milestones (amounts must sum to total amount)
    ///   timeout_ledgers  — optional ledger timeout (default 7 days)
    ///   referrer         — optional referrer address; receives 2% bonus on release
    ///   arbitrator       — optional arbitrator address; enables 2-of-3 multisig release/refund
    pub fn create_escrow(env: Env, job_id: String, client: Address, params: CreateEscrowParams) {
        Self::create_escrow_internal(
            env,
            job_id,
            client,
            params.freelancer,
            params.token,
            params.amount,
            params.milestones,
            params.timeout_ledgers,
            params.referrer,
            params.arbitrator,
            None,
            5,
        )
    }

    /// Client creates an escrow that includes an expected deliverable hash.
    pub fn create_escrow_with_deliverable(
        env: Env,
        job_id: String,
        client: Address,
        params: CreateEscrowParams,
        deliverable_hash: BytesN<32>,
    ) {
        Self::create_escrow_internal(
            env,
            job_id,
            client,
            params.freelancer,
            params.token,
            params.amount,
            params.milestones,
            params.timeout_ledgers,
            params.referrer,
            params.arbitrator,
            Some(deliverable_hash.into()),
            5,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn create_escrow_internal(
        env: Env,
        job_id: String,
        client: Address,
        freelancer: Address,
        token: Address,
        amount: i128,
        milestones: Option<soroban_sdk::Vec<i128>>,
        timeout_ledgers: Option<u32>,
        referrer: Option<Address>,
        arbitrator: Option<Address>,
        deliverable_hash: Option<Bytes>,
        milestone_limit: u32,
    ) {
        client.require_auth();

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        // Referrer must not be the freelancer or client
        if let Some(ref r) = referrer {
            if r == &client || r == &freelancer {
                panic!("Referrer cannot be the client or freelancer");
            }
        }

        // Arbitrator must be a distinct third party
        if let Some(ref a) = arbitrator {
            if a == &client || a == &freelancer {
                panic!("Arbitrator must be distinct from the client and freelancer");
            }
        }

        // Validate milestones if provided
        let mut milestone_list = soroban_sdk::Vec::new(&env);
        if let Some(ms) = milestones {
            if ms.len() > milestone_limit {
                panic!("Milestone count exceeds settlement-mode limit");
            }
            let mut total_ms_amount: i128 = 0;
            for amt in ms.iter() {
                if amt <= 0 {
                    panic!("Milestone amount must be positive");
                }
                total_ms_amount = total_ms_amount
                    .checked_add(amt)
                    .expect("Arithmetic overflow");
                milestone_list.push_back(Milestone {
                    amount: amt,
                    is_completed: false,
                });
            }
            if total_ms_amount != amount {
                panic!("Milestone amounts must sum to total escrow amount");
            }
        }

        // Ensure no duplicate escrow for same job
        if env
            .storage()
            .instance()
            .has(&DataKey::Escrow(job_id.clone()))
        {
            panic!("Escrow already exists for this job");
        }

        // Transfer funds from client into the contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&client, &env.current_contract_address(), &amount);

        let current_ledger = env.ledger().sequence();
        let current_timestamp = env.ledger().timestamp() as u32;
        let timeout = timeout_ledgers.unwrap_or(DEFAULT_TIMEOUT_LEDGERS);
        let timeout_ledger = current_ledger
            .checked_add(timeout)
            .expect("Timeout ledger overflow");
        let timeout_seconds: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DefaultTimeoutSeconds)
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS);
        let timeout_timestamp = current_timestamp
            .checked_add(timeout_seconds)
            .expect("Timeout timestamp overflow");

        // Store escrow record on-chain
        let escrow = Escrow {
            job_id: job_id.clone(),
            client: client.clone(),
            freelancer,
            token,
            amount,
            status: EscrowStatus::Locked,
            created_at: current_ledger,
            timeout_ledger,
            milestones: milestone_list,
            referrer,
            deliverable_hash,
            arbitrator,
            release_approvals: 0,
            refund_approvals: 0,
        };

        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);
        env.storage().instance().set(
            &DataKey::TimeoutTimestamp(job_id.clone()),
            &timeout_timestamp,
        );

        // Increment counter
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0);
        let new_count = count.checked_add(1).expect("Counter overflow");
        env.storage()
            .instance()
            .set(&DataKey::EscrowCount, &new_count);

        // Emit event
        env.events().publish(
            (symbol_short!("escrow_cr"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                escrow.amount,
            ),
        );
    }

    /// Client accepts a freelancer and marks work as in-progress.
    pub fn start_work(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can start work");
        }
        escrow.status = state_machine::transition_legacy(escrow.status, LifecycleAction::Start);
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);
        Self::sync_v2_transition_if_present(&env, &job_id, LifecycleAction::Start);

        env.events().publish(
            (symbol_short!("work_strt"), job_id.clone()),
            (escrow.client.clone(), escrow.freelancer.clone()),
        );
    }

    /// Client approves completed work and releases funds to the freelancer.
    ///
    /// Not available for multisig escrows (those with an arbitrator set) —
    /// those must go through `approve_release()` and reach the 2-of-3 threshold.
    pub fn release_escrow(env: Env, job_id: String, client: Address) {
        client.require_auth();
        Self::require_discrete_if_v2(&env, &job_id);

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can release escrow");
        }
        if escrow.arbitrator.is_some() {
            panic!("Escrow requires multisig approval — use approve_release()");
        }
        Self::release_escrow_core(env, job_id, escrow);
    }

    /// Cast a multisig approval vote to release escrow funds.
    ///
    /// Only valid for escrows created with an `arbitrator` (2-of-3 multisig).
    /// `signer` must be the client, the freelancer, or the arbitrator, and
    /// must authorize the call themselves. Each signer may vote once; once
    /// 2 of the 3 parties have approved, funds are released automatically.
    pub fn approve_release(env: Env, job_id: String, signer: Address) {
        signer.require_auth();
        Self::require_discrete_if_v2(&env, &job_id);

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        let arbitrator = escrow
            .arbitrator
            .clone()
            .expect("Escrow does not use multisig approval");

        multisig::require_signer(&signer, &escrow.client, &escrow.freelancer, &arbitrator);
        state_machine::try_transition(
            state_machine::from_legacy(escrow.status.clone()),
            LifecycleAction::Release,
        )
        .expect("Illegal escrow state transition");

        let vote_key = DataKey::MultisigReleaseVote(job_id.clone(), signer.clone());
        if env.storage().instance().has(&vote_key) {
            panic!("Signer has already approved release for this job");
        }
        env.storage().instance().set(&vote_key, &true);

        let mut escrow = escrow;
        escrow.release_approvals = escrow
            .release_approvals
            .checked_add(1)
            .expect("Counter overflow");
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("rl_appr"), job_id.clone()),
            (signer, escrow.release_approvals),
        );

        if multisig::threshold_reached(escrow.release_approvals) {
            Self::release_escrow_core(env, job_id, escrow);
        }
    }

    /// The portion of an escrow's deposit the contract still holds.
    ///
    /// For a milestone escrow this is the sum of the milestones not yet paid
    /// out; for a plain escrow it is the whole amount. Every path that returns
    /// funds to the client must use this rather than `escrow.amount`: a
    /// milestone payout moves money out while leaving the status at `Locked`,
    /// so `escrow.amount` stops being the contract's liability the moment the
    /// first milestone is released.
    fn unpaid_remainder(escrow: &Escrow) -> i128 {
        if escrow.milestones.is_empty() {
            return escrow.amount;
        }
        let mut remaining: i128 = 0;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
                remaining = remaining
                    .checked_add(ms.amount)
                    .expect("Arithmetic overflow");
            }
        }
        remaining
    }

    fn release_escrow_core(env: Env, job_id: String, mut escrow: Escrow) {
        let released_status =
            state_machine::transition_legacy(escrow.status.clone(), LifecycleAction::Release);

        // Check if there are incomplete milestones
        let mut remaining_amount: i128 = 0;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
                remaining_amount = remaining_amount
                    .checked_add(ms.amount)
                    .expect("Arithmetic overflow");
            }
        }

        // If no milestones, release full amount. If milestones, release remaining.
        let release_amount = if escrow.milestones.is_empty() {
            escrow.amount
        } else {
            remaining_amount
        };

        // Mark all milestones as completed
        let mut updated_ms = soroban_sdk::Vec::new(&env);
        for mut ms in escrow.milestones.iter() {
            ms.is_completed = true;
            updated_ms.push_back(ms);
        }
        escrow.milestones = updated_ms;

        // Increment CompletedJobs for the freelancer and client
        let freelancer_jobs: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CompletedJobs(escrow.freelancer.clone()))
            .unwrap_or(0);
        let new_freelancer_jobs = freelancer_jobs.checked_add(1).expect("Counter overflow");
        env.storage().instance().set(
            &DataKey::CompletedJobs(escrow.freelancer.clone()),
            &new_freelancer_jobs,
        );

        let client_jobs: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CompletedJobs(escrow.client.clone()))
            .unwrap_or(0);
        let new_client_jobs = client_jobs.checked_add(1).expect("Counter overflow");
        env.storage().instance().set(
            &DataKey::CompletedJobs(escrow.client.clone()),
            &new_client_jobs,
        );

        escrow.status = released_status;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));

        if release_amount > 0 {
            let token_client = token::Client::new(&env, &escrow.token);

            // ── Multi-level referral tree bonus ───────────────────────────────
            // Walk up the referral tree from the freelancer and distribute bonuses
            // to up to MAX_REFERRAL_DEPTH ancestors (levels 1–3).
            // Falls back to the legacy single-level referrer stored on the escrow
            // if no tree entry exists for the freelancer.
            let total_bonus = if get_parent(&env, &escrow.freelancer).is_some() {
                // Tree registration found — use multi-level distribution
                distribute_tree_rewards(
                    &env,
                    &token_client,
                    &escrow.freelancer,
                    release_amount,
                    &job_id,
                )
            } else {
                // ISSUE-17: Platform fee, split between the protocol admin and
                // the escrow's referrer (if one was set at creation time).
                let fee = release_amount
                    .checked_mul(PLATFORM_FEE_BPS)
                    .expect("Arithmetic overflow")
                    .checked_div(FEE_BPS_DENOMINATOR)
                    .expect("Arithmetic overflow");

                if fee > 0 {
                    let admin: Address = env
                        .storage()
                        .instance()
                        .get(&DataKey::Admin)
                        .expect("Not initialized");

                    if let Some(ref referrer_addr) = escrow.referrer {
                        // Entire platform fee routed to the referrer.
                        token_client.transfer(&env.current_contract_address(), referrer_addr, &fee);
                        env.events().publish(
                            (symbol_short!("ref_bon"), referrer_addr.clone()),
                            (job_id.clone(), fee),
                        );
                    } else {
                        // No referrer — the entire fee defaults to the platform.
                        token_client.transfer(&env.current_contract_address(), &admin, &fee);
                        env.events().publish(
                            (symbol_short!("fee_adm"), admin.clone()),
                            (job_id.clone(), fee),
                        );
                    }
                }
                fee
            };

            let freelancer_amount = release_amount
                .checked_sub(total_bonus)
                .expect("Arithmetic overflow");

            // Transfer remaining funds to freelancer
            if freelancer_amount > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.freelancer,
                    &freelancer_amount,
                );
            }

            env.events().publish(
                (symbol_short!("escrow_rl"), job_id.clone()),
                (
                    escrow.client.clone(),
                    escrow.freelancer.clone(),
                    freelancer_amount,
                    total_bonus,
                ),
            );
        } else {
            env.events().publish(
                (symbol_short!("escrow_rl"), job_id.clone()),
                (
                    escrow.client.clone(),
                    escrow.freelancer.clone(),
                    0i128,
                    0i128,
                ),
            );
        }
        Self::sync_v2_settlement_if_present(&env, &job_id, false);
    }

    /// Client approves work and releases funds WITH conversion through DEX.
    ///
    /// This is used when the escrow is held in one asset (e.g. USDC) but the
    /// freelancer wants another (e.g. XLM).
    ///
    /// Swapping the payout asset changes *how* the freelancer is paid, not
    /// what the escrow owes or who may authorise the payment. This entrypoint
    /// therefore carries exactly the preconditions `release_escrow()` carries
    /// — including the multisig guard — and settles through the same core, so
    /// the platform fee and referral distribution cannot be routed around by
    /// asking for a different asset.
    pub fn release_with_conversion(
        env: Env,
        job_id: String,
        client: Address,
        target_token: Address,
        _min_amount_out: i128,
    ) {
        client.require_auth();

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can release escrow");
        }
        if escrow.arbitrator.is_some() {
            panic!("Escrow requires multisig approval — use approve_release()");
        }

        let converted_amount = escrow.release_amount();
        let source_token = escrow.token.clone();

        // [Issue #104] Path Payment / DEX Swap.
        //
        // A real implementation would route the payout through a Soroban DEX:
        //
        //   let dex = DEXClient::new(&env, &DEX_ADDRESS);
        //   dex.swap(&env.current_contract_address(), &escrow.freelancer,
        //            &escrow.token, &target_token, &release_amount, &min_amount_out);
        //
        // Until that lands the payout is made in the source asset and the
        // requested conversion is recorded as an event, so the settlement
        // accounting is identical to a plain release and the difference is
        // visible to indexers rather than hidden in the balances.
        Self::release_escrow_core(env.clone(), job_id.clone(), escrow);

        env.events().publish(
            (symbol_short!("escrow_cv"), job_id),
            (source_token, target_token, converted_amount),
        );
    }

    /// Client cancels and gets a refund (only before work starts).
    ///
    /// Not available for multisig escrows (those with an arbitrator set) —
    /// those must go through `approve_refund()` and reach the 2-of-3 threshold.
    pub fn refund_escrow(env: Env, job_id: String, client: Address) {
        client.require_auth();
        Self::require_discrete_if_v2(&env, &job_id);

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can request a refund");
        }
        if escrow.arbitrator.is_some() {
            panic!("Escrow requires multisig approval — use approve_refund()");
        }
        Self::refund_escrow_core(env, job_id, escrow);
    }

    fn refund_escrow_core(env: Env, job_id: String, mut escrow: Escrow) {
        let refunded_status =
            state_machine::transition_legacy(escrow.status.clone(), LifecycleAction::Refund);

        // Return only what the contract still holds for this escrow. Refunding
        // `escrow.amount` after `partial_release()` has already paid a
        // milestone out pays more than was ever deposited, and the excess is
        // taken from the balances of every other escrow the contract holds.
        let refund_amount = Self::unpaid_remainder(&escrow);

        if refund_amount > 0 {
            let token_client = token::Client::new(&env, &escrow.token);
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.client,
                &refund_amount,
            );
        }

        // Whatever was not refunded was already paid out as milestones, so the
        // escrow owes nothing further either way.
        let mut settled_ms = soroban_sdk::Vec::new(&env);
        for mut ms in escrow.milestones.iter() {
            ms.is_completed = true;
            settled_ms.push_back(ms);
        }
        escrow.milestones = settled_ms;

        escrow.status = refunded_status;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));

        env.events().publish(
            (symbol_short!("escrow_rf"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                refund_amount,
            ),
        );
        Self::sync_v2_settlement_if_present(&env, &job_id, true);
    }

    /// Cast a multisig approval vote to refund escrow funds to the client.
    ///
    /// Only valid for escrows created with an `arbitrator` (2-of-3 multisig).
    /// `signer` must be the client, the freelancer, or the arbitrator, and
    /// must authorize the call themselves. Each signer may vote once; once
    /// 2 of the 3 parties have approved, funds are refunded automatically.
    pub fn approve_refund(env: Env, job_id: String, signer: Address) {
        signer.require_auth();
        Self::require_discrete_if_v2(&env, &job_id);

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        let arbitrator = escrow
            .arbitrator
            .clone()
            .expect("Escrow does not use multisig approval");

        multisig::require_signer(&signer, &escrow.client, &escrow.freelancer, &arbitrator);
        state_machine::try_transition(
            state_machine::from_legacy(escrow.status.clone()),
            LifecycleAction::Refund,
        )
        .expect("Illegal escrow state transition");

        let vote_key = DataKey::MultisigRefundVote(job_id.clone(), signer.clone());
        if env.storage().instance().has(&vote_key) {
            panic!("Signer has already approved refund for this job");
        }
        env.storage().instance().set(&vote_key, &true);

        let mut escrow = escrow;
        escrow.refund_approvals = escrow
            .refund_approvals
            .checked_add(1)
            .expect("Counter overflow");
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("rf_appr"), job_id.clone()),
            (signer, escrow.refund_approvals),
        );

        if multisig::threshold_reached(escrow.refund_approvals) {
            Self::refund_escrow_core(env, job_id, escrow);
        }
    }

    /// Get the arbitrator address for a job's escrow, if multisig is enabled.
    pub fn get_arbitrator(env: Env, job_id: String) -> Option<Address> {
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.arbitrator
    }

    /// Issue #175 — Client claims a refund if the freelancer never started work
    /// before the timeout. New escrows enforce the timeout using Unix timestamps;
    /// older escrows fall back to the legacy ledger-sequence threshold.
    pub fn timeout_refund(env: Env, job_id: String, client: Address) {
        client.require_auth();
        Self::require_discrete_if_v2(&env, &job_id);

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can request a timeout refund");
        }
        let refunded_status = state_machine::try_transition(
            state_machine::from_legacy(escrow.status.clone()),
            LifecycleAction::TimeoutRefund,
        )
        .map(state_machine::to_legacy)
        .unwrap_or_else(|| panic!("Escrow is not in Locked state"));

        let current_timestamp = env.ledger().timestamp() as u32;
        let timeout_timestamp: Option<u32> = env
            .storage()
            .instance()
            .get(&DataKey::TimeoutTimestamp(job_id.clone()));
        let expired = if let Some(timeout_timestamp) = timeout_timestamp {
            current_timestamp >= timeout_timestamp
        } else {
            env.ledger().sequence() >= escrow.timeout_ledger
        };

        if !expired {
            panic!("Timeout period has not expired yet");
        }

        // A timeout is still a refund, so it is bound by the same two rules as
        // `refund_escrow()`: it returns only what the contract still holds (see
        // `unpaid_remainder`), and on a multisig escrow it does not let the
        // client act alone. A timeout does not dissolve the arbitrator's stake
        // in the outcome — it just means the client may now ask for one.
        if escrow.arbitrator.is_some() {
            panic!("Escrow requires multisig approval — use approve_refund()");
        }

        let refund_amount = Self::unpaid_remainder(&escrow);

        if refund_amount > 0 {
            let token_client = token::Client::new(&env, &escrow.token);
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.client,
                &refund_amount,
            );
        }

        let mut settled_ms = soroban_sdk::Vec::new(&env);
        for mut ms in escrow.milestones.iter() {
            ms.is_completed = true;
            settled_ms.push_back(ms);
        }
        escrow.milestones = settled_ms;

        escrow.status = refunded_status;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));

        env.events().publish(
            (symbol_short!("escrow_rf"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                refund_amount,
            ),
        );
        Self::sync_v2_settlement_if_present(&env, &job_id, true);
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /// Get the full escrow record for a job.
    pub fn get_escrow(env: Env, job_id: String) -> Escrow {
        env.storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found")
    }

    /// Get escrow status for a job.
    pub fn get_status(env: Env, job_id: String) -> EscrowStatus {
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.status
    }

    /// Get timeout ledger for a job.
    pub fn get_timeout_ledger(env: Env, job_id: String) -> u32 {
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.timeout_ledger
    }

    /// Get the timestamp after which `timeout_refund()` becomes available.
    pub fn get_timeout_timestamp(env: Env, job_id: String) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TimeoutTimestamp(job_id))
            .unwrap_or(0)
    }

    /// Get the referrer address for a job's escrow, if one was set.
    pub fn get_referrer(env: Env, job_id: String) -> Option<Address> {
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.referrer
    }

    /// Get total number of escrows created.
    pub fn get_escrow_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0)
    }

    /// Get the contract admin.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    /// Get the current global timeout in seconds.
    pub fn get_default_timeout_seconds(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DefaultTimeoutSeconds)
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
    }

    /// Update the global timeout in seconds.
    ///
    /// This acts as the governance/admin override for new escrows.
    pub fn set_default_timeout_seconds(env: Env, admin: Address, timeout_seconds: u32) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can update the timeout");
        }
        if timeout_seconds == 0 {
            panic!("Timeout must be positive");
        }

        env.storage()
            .instance()
            .set(&DataKey::DefaultTimeoutSeconds, &timeout_seconds);
        env.events()
            .publish((symbol_short!("timeout"), admin), timeout_seconds);
    }

    // ─── On-chain Message Notarization ─────────────────────────────────────
    //
    // Messages are stored off-chain on IPFS.  Only the IPFS CID is stored on-chain
    // via events, providing censorship resistance and verifiability without the
    // cost of storing full message content on-chain.

    /// Publish a message CID to the ledger.
    ///
    /// The message content itself is stored off-chain (IPFS).  This function
    /// records the IPFS CID on-chain so recipients can verify message authenticity
    /// from Stellar Explorer.
    ///
    /// Parameters:
    ///   job_id    — job this message belongs to
    ///   sender    — the party sending the message
    ///   recipient — the party receiving the message
    ///   ipfs_cid  — IPFS content identifier for the encrypted message payload
    pub fn publish_message(
        env: Env,
        job_id: String,
        sender: Address,
        recipient: Address,
        ipfs_cid: String,
    ) {
        sender.require_auth();

        // Basic validation
        if ipfs_cid.is_empty() {
            panic!("IPFS CID cannot be empty");
        }

        // Store CID in contract storage for on-chain verification
        let mut cids: soroban_sdk::Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::MessageCid(job_id.clone()))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env));
        cids.push_back(ipfs_cid.clone());
        env.storage()
            .instance()
            .set(&DataKey::MessageCid(job_id.clone()), &cids);

        let ledger_seq = env.ledger().sequence();

        env.events().publish(
            (symbol_short!("msg_sent"), job_id.clone()),
            (sender.clone(), recipient.clone(), ipfs_cid, ledger_seq),
        );
    }

    /// Retrieve all message CIDs stored on-chain for a job.
    pub fn get_message_cids(env: Env, job_id: String) -> soroban_sdk::Vec<String> {
        env.storage()
            .instance()
            .get(&DataKey::MessageCid(job_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
    }

    // ─── Referral Tree ───────────────────────────────────────────────────────

    /// Register a parent→child referral relationship on-chain.
    ///
    /// Called when a new user signs up via a referral link.
    /// Requires the *child* to sign (prevents Sybil fake-registration).
    ///
    /// # Panics
    /// - `child == parent` (self-referral)
    /// - `child` already has a registered parent
    /// - Registering would create a cycle in the tree
    pub fn register_referral_tree(env: Env, parent: Address, child: Address) {
        register_referral(&env, parent, child);
    }

    /// Get the direct parent (referrer) of an address.
    pub fn get_referral_parent(env: Env, child: Address) -> Option<Address> {
        get_parent(&env, &child)
    }

    /// Get all direct children (invitees) of an address.
    pub fn get_referral_children(env: Env, parent: Address) -> soroban_sdk::Vec<Address> {
        get_children(&env, &parent)
    }

    /// Get the depth of a user in the referral tree (0 = root, 1 = direct child, …).
    pub fn get_referral_depth(env: Env, user: Address) -> u32 {
        get_depth(&env, &user)
    }

    /// Calculate (but do NOT distribute) multi-level rewards for a given
    /// freelancer and release amount.  Useful for UI preview before release.
    pub fn preview_referral_rewards(
        env: Env,
        freelancer: Address,
        release_amount: i128,
    ) -> soroban_sdk::Vec<referral::ReferralReward> {
        referral::calculate_tree_rewards(&env, &freelancer, release_amount)
    }

    // ─── Governance (DAO) ───────────────────────────────────────────────────

    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        duration_ledgers: u32,
    ) -> u32 {
        proposer.require_auth();

        if duration_ledgers == 0 {
            panic!("Duration must be positive");
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        let proposal_id = count.checked_add(1).expect("Counter overflow");
        let deadline_ledger = env
            .ledger()
            .sequence()
            .checked_add(duration_ledgers)
            .expect("Arithmetic overflow");

        let proposal = Proposal {
            id: proposal_id,
            title: title.clone(),
            description: description.clone(),
            votes_for: 0,
            votes_against: 0,
            deadline_ledger,
            resolved: false,
            result: false,
        };

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCount, &proposal_id);

        env.events().publish(
            (symbol_short!("proposed"), proposer),
            (proposal_id, title, deadline_ledger),
        );

        proposal_id
    }

    pub fn cast_vote(env: Env, voter: Address, proposal_id: u32, approve: bool) {
        voter.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.resolved {
            panic!("Proposal already resolved");
        }

        if env.ledger().sequence() >= proposal.deadline_ledger {
            panic!("Voting period has ended");
        }

        // Check eligibility: must have completed at least 1 job
        let jobs: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CompletedJobs(voter.clone()))
            .unwrap_or(0);
        if jobs == 0 {
            panic!("Only users with completed jobs can vote");
        }

        // Check if already voted
        let voted_key = DataKey::HasVoted(voter.clone(), proposal_id);
        if env.storage().instance().has(&voted_key) {
            panic!("Voter has already cast a vote");
        }

        if approve {
            proposal.votes_for = proposal.votes_for.checked_add(1).expect("Counter overflow");
        } else {
            proposal.votes_against = proposal
                .votes_against
                .checked_add(1)
                .expect("Counter overflow");
        }

        env.storage().instance().set(&voted_key, &true);
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events()
            .publish((symbol_short!("voted"), voter), (proposal_id, approve));
    }

    pub fn resolve_proposal(env: Env, proposal_id: u32) {
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.resolved {
            panic!("Proposal already resolved");
        }

        if env.ledger().sequence() < proposal.deadline_ledger {
            panic!("Voting period is not over yet");
        }

        proposal.resolved = true;
        proposal.result = proposal.votes_for > proposal.votes_against;

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("resolved"), proposal_id),
            (proposal.result, proposal.votes_for, proposal.votes_against),
        );
    }

    pub fn get_proposal(env: Env, id: u32) -> Proposal {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(id))
            .expect("Proposal not found")
    }

    pub fn list_active_proposals(env: Env) -> Vec<Proposal> {
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        let mut active = Vec::new(&env);
        for id in 1..=count {
            if let Some(proposal) = env
                .storage()
                .instance()
                .get::<_, Proposal>(&DataKey::Proposal(id))
            {
                if !proposal.resolved {
                    active.push_back(proposal);
                }
            }
        }
        active
    }

    // ─── Placeholders ─────────────────────────────────────────────────────────

    /// [PLACEHOLDER] Raise a dispute — requires admin resolution.
    /// See ROADMAP.md v2.1 — DAO Governance.
    pub fn raise_dispute(env: Env, job_id: String, caller: Address) {
        caller.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != caller && escrow.freelancer != caller {
            panic!("Only participants can raise a dispute");
        }

        escrow.status = state_machine::transition_legacy(escrow.status, LifecycleAction::Dispute);

        // A stream checkpoints and settles everything earned immediately
        // before entering Disputed. Its clock then remains stopped until the
        // arbitration path resolves it.
        if let Some(mut v2) = env
            .storage()
            .instance()
            .get::<_, EscrowV2>(&DataKey::EscrowV2(job_id.clone()))
        {
            if v2.settlement_mode == SettlementMode::Streaming {
                if v2.state == LifecycleState::Active {
                    let mut schedule: StreamSchedule = env
                        .storage()
                        .instance()
                        .get(&DataKey::StreamSchedule(job_id.clone()))
                        .expect("Stream schedule missing");
                    schedule.checkpoint(env.ledger().sequence());
                    env.storage()
                        .instance()
                        .set(&DataKey::StreamSchedule(job_id.clone()), &schedule);
                    Self::settle_stream_accrued(&env, &mut v2, false);
                }
                v2.state = state_machine::transition(v2.state, LifecycleAction::Dispute);
            } else {
                v2.state = state_machine::transition(v2.state, LifecycleAction::Dispute);
            }
            if v2.migrated_from_v1 {
                v2.v2_features_used = true;
            }
            migration::store(&env, &v2);
        }
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("escrow_ds"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                caller.clone(),
            ),
        );
    }

    /// Milestone-based partial release.
    /// Can be called even if the escrow is Disputed, to release completed work.
    pub fn partial_release(env: Env, job_id: String, milestone_index: u32, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can release a milestone");
        }
        // Nominating an arbitrator is a statement that no single party moves
        // this escrow's funds, and a milestone payout moves funds. Without this
        // guard the multisig is bypassable on any escrow that has milestones:
        // the client releases each milestone in turn and reaches Released
        // having collected no approvals at all.
        if escrow.arbitrator.is_some() {
            panic!("Escrow requires multisig approval — use approve_release()");
        }
        let milestone_state = state_machine::transition_legacy(
            escrow.status.clone(),
            LifecycleAction::ReleaseMilestone,
        );

        if milestone_index >= escrow.milestones.len() {
            panic!("Invalid milestone index");
        }

        let mut milestone = escrow.milestones.get(milestone_index).unwrap();
        if milestone.is_completed {
            panic!("Milestone already completed");
        }

        milestone.is_completed = true;
        escrow.milestones.set(milestone_index, milestone.clone());

        // Transfer funds to freelancer
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &milestone.amount,
        );

        // Check if all milestones are now completed
        let mut all_completed = true;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
                all_completed = false;
                break;
            }
        }

        if all_completed {
            let completion_action = if milestone_state == EscrowStatus::Disputed {
                LifecycleAction::ResolveRelease
            } else {
                LifecycleAction::Release
            };
            escrow.status = state_machine::transition_legacy(milestone_state, completion_action);
            env.storage()
                .instance()
                .remove(&DataKey::TimeoutTimestamp(job_id.clone()));

            // Increment CompletedJobs for the freelancer and client
            let freelancer_jobs: u32 = env
                .storage()
                .instance()
                .get(&DataKey::CompletedJobs(escrow.freelancer.clone()))
                .unwrap_or(0);
            let new_freelancer_jobs = freelancer_jobs.checked_add(1).expect("Counter overflow");
            env.storage().instance().set(
                &DataKey::CompletedJobs(escrow.freelancer.clone()),
                &new_freelancer_jobs,
            );

            let client_jobs: u32 = env
                .storage()
                .instance()
                .get(&DataKey::CompletedJobs(escrow.client.clone()))
                .unwrap_or(0);
            let new_client_jobs = client_jobs.checked_add(1).expect("Counter overflow");
            env.storage().instance().set(
                &DataKey::CompletedJobs(escrow.client.clone()),
                &new_client_jobs,
            );
        } else {
            escrow.status = milestone_state;
        }

        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        Self::sync_v2_milestone(
            &env,
            &job_id,
            milestone_index,
            milestone.amount,
            all_completed,
        );

        env.events().publish(
            (symbol_short!("ms_rel"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                milestone_index,
                milestone.amount,
            ),
        );
    }

    /// Configures an oracle for a specific milestone.
    /// Only the client of the job can configure the oracle.
    pub fn set_milestone_oracle(
        env: Env,
        job_id: String,
        milestone_index: u32,
        oracle: Address,
        query: String,
        client: Address,
    ) {
        client.require_auth();

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can set the milestone oracle");
        }
        if milestone_index >= escrow.milestones.len() {
            panic!("Invalid milestone index");
        }

        let config = MilestoneOracleConfig { oracle, query };
        env.storage()
            .instance()
            .set(&DataKey::MilestoneOracle(job_id, milestone_index), &config);
    }

    /// Milestone-based release triggered by a registered oracle.
    /// Releases milestone funds to the freelancer after verifying oracle authorization.
    pub fn verify_milestone_oracle(
        env: Env,
        job_id: String,
        milestone_index: u32,
        oracle: Address,
        proof: Bytes,
    ) {
        oracle.require_auth();
        Self::require_discrete_if_v2(&env, &job_id);

        let config: MilestoneOracleConfig = env
            .storage()
            .instance()
            .get(&DataKey::MilestoneOracle(job_id.clone(), milestone_index))
            .expect("Milestone oracle configuration not found");

        if config.oracle != oracle {
            panic!("Unauthorized oracle address");
        }

        if !oracle::verify_oracle_proof(&env, &config.query, &proof) {
            panic!("Oracle proof verification failed");
        }

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        // Nominating an arbitrator is a statement that no single party moves
        // this escrow's funds, and a milestone payout moves funds. Without this
        // guard the multisig is bypassable on any escrow that has milestones:
        // the client releases each milestone in turn and reaches Released
        // having collected no approvals at all.
        if escrow.arbitrator.is_some() {
            panic!("Escrow requires multisig approval — use approve_release()");
        }

        let milestone_state = state_machine::transition_legacy(
            escrow.status.clone(),
            LifecycleAction::ReleaseMilestone,
        );

        if milestone_index >= escrow.milestones.len() {
            panic!("Invalid milestone index");
        }

        let mut milestone = escrow.milestones.get(milestone_index).unwrap();
        if milestone.is_completed {
            panic!("Milestone already completed");
        }

        milestone.is_completed = true;
        escrow.milestones.set(milestone_index, milestone.clone());

        // Transfer funds to freelancer
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &milestone.amount,
        );

        // Check if all milestones are now completed
        let mut all_completed = true;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
                all_completed = false;
                break;
            }
        }

        if all_completed {
            let completion_action = if milestone_state == EscrowStatus::Disputed {
                LifecycleAction::ResolveRelease
            } else {
                LifecycleAction::Release
            };
            escrow.status = state_machine::transition_legacy(milestone_state, completion_action);
            env.storage()
                .instance()
                .remove(&DataKey::TimeoutTimestamp(job_id.clone()));

            // Increment CompletedJobs for the freelancer and client
            let freelancer_jobs: u32 = env
                .storage()
                .instance()
                .get(&DataKey::CompletedJobs(escrow.freelancer.clone()))
                .unwrap_or(0);
            let new_freelancer_jobs = freelancer_jobs.checked_add(1).expect("Counter overflow");
            env.storage().instance().set(
                &DataKey::CompletedJobs(escrow.freelancer.clone()),
                &new_freelancer_jobs,
            );

            let client_jobs: u32 = env
                .storage()
                .instance()
                .get(&DataKey::CompletedJobs(escrow.client.clone()))
                .unwrap_or(0);
            let new_client_jobs = client_jobs.checked_add(1).expect("Counter overflow");
            env.storage().instance().set(
                &DataKey::CompletedJobs(escrow.client.clone()),
                &new_client_jobs,
            );
        } else {
            escrow.status = milestone_state;
        }

        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        Self::sync_v2_milestone(
            &env,
            &job_id,
            milestone_index,
            milestone.amount,
            all_completed,
        );

        env.events().publish(
            (symbol_short!("ms_rel"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                milestone_index,
                milestone.amount,
            ),
        );
    }

    // ─── Issue #344: Job Boost with XLM Payment ──────────────────────────────

    /// Client pays XLM to the platform treasury to boost a job listing.
    ///
    /// Boost tiers (in stroops, 1 XLM = 10_000_000 stroops):
    ///   ≥  5 XLM → 7-day boost
    ///   ≥ 15 XLM → 30-day boost
    ///
    /// The payment is transferred directly to `treasury`.
    /// Emits a `JobBoosted` event with job_id and boost_expiry_ledger.
    pub fn boost_job(
        env: Env,
        job_id: String,
        client: Address,
        treasury: Address,
        token: Address,
        amount: i128,
    ) {
        client.require_auth();

        if amount <= 0 {
            panic!("Boost amount must be positive");
        }

        // Minimum boost is 5 XLM (50_000_000 stroops)
        let min_boost_stroops: i128 = 50_000_000;
        if amount < min_boost_stroops {
            panic!("Minimum boost is 5 XLM");
        }

        // Transfer payment from client to treasury
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&client, &treasury, &amount);

        // Calculate boost duration in ledgers (~5 s/ledger)
        // 7 days  = 120_960 ledgers
        // 30 days = 518_400 ledgers
        let boost_ledgers: u32 = if amount >= 150_000_000 {
            518_400 // 30 days
        } else {
            120_960 // 7 days
        };

        let boost_expiry = env
            .ledger()
            .sequence()
            .checked_add(boost_ledgers)
            .expect("Boost expiry overflow");

        env.events().publish(
            (symbol_short!("boosted"), client),
            (job_id, boost_expiry, amount),
        );
    }

    // ─── Issue #108: Sealed-Bid Budget Commitment ────────────────────────────

    /// Client commits to a budget amount (sealed-bid, prevents anchoring bias).
    pub fn commit_budget(env: Env, job_id: String, budget_amount: i128, client: Address) {
        client.require_auth();

        if budget_amount <= 0 {
            panic!("Budget must be positive");
        }

        let commitment = BudgetCommitment {
            job_id: job_id.clone(),
            client: client.clone(),
            budget_amount,
            is_revealed: false,
        };

        env.storage()
            .instance()
            .set(&DataKey::BudgetCommitment(job_id.clone()), &commitment);

        env.events()
            .publish((symbol_short!("budgtcmt"), client), job_id);
    }

    /// Reveal the budget. Auto-rejects bids over 150% of budget.
    pub fn reveal_budget(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut commitment: BudgetCommitment = env
            .storage()
            .instance()
            .get(&DataKey::BudgetCommitment(job_id.clone()))
            .expect("Budget commitment not found");

        if commitment.client != client {
            panic!("Only the client can reveal the budget");
        }
        if commitment.is_revealed {
            panic!("Budget already revealed");
        }

        commitment.is_revealed = true;
        env.storage()
            .instance()
            .set(&DataKey::BudgetCommitment(job_id.clone()), &commitment);

        env.events().publish(
            (symbol_short!("budgrvld"), client),
            commitment.budget_amount,
        );
    }

    /// Get budget commitment.
    pub fn get_budget_commitment(env: Env, job_id: String) -> BudgetCommitment {
        env.storage()
            .instance()
            .get(&DataKey::BudgetCommitment(job_id))
            .expect("Budget commitment not found")
    }

    // ─── Issue #338: Sealed-Bid Commitment Scheme ───────────────────────────

    /// Freelancer submits a sealed commitment hash for their bid amount.
    pub fn submit_bid_commitment(
        env: Env,
        job_id: String,
        freelancer: Address,
        commitment: BytesN<32>,
    ) {
        freelancer.require_auth();

        // Ensure this job has a client-owned bidding session via budget commitment.
        let _budget: BudgetCommitment = env
            .storage()
            .instance()
            .get(&DataKey::BudgetCommitment(job_id.clone()))
            .expect("Budget commitment not found");

        if let Some(state) = env
            .storage()
            .instance()
            .get::<_, BiddingState>(&DataKey::BiddingState(job_id.clone()))
        {
            if state.is_closed {
                panic!("Bidding is closed");
            }
        }

        let key = DataKey::BidCommitment(job_id.clone(), freelancer.clone());
        if env.storage().instance().has(&key) {
            panic!("Bid commitment already submitted");
        }

        let bid_commitment = BidCommitment {
            job_id: job_id.clone(),
            freelancer: freelancer.clone(),
            commitment,
            submitted_at_ledger: env.ledger().sequence(),
            bid_revealed: false,
        };

        env.storage().instance().set(&key, &bid_commitment);
        env.events()
            .publish((symbol_short!("bid_cmt"), job_id), freelancer);
    }

    /// Client closes bidding and opens a reveal window.
    pub fn close_bidding(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let budget: BudgetCommitment = env
            .storage()
            .instance()
            .get(&DataKey::BudgetCommitment(job_id.clone()))
            .expect("Budget commitment not found");
        if budget.client != client {
            panic!("Only the client can close bidding");
        }

        if let Some(existing) = env
            .storage()
            .instance()
            .get::<_, BiddingState>(&DataKey::BiddingState(job_id.clone()))
        {
            if existing.is_closed {
                panic!("Bidding already closed");
            }
        }

        let closed_at = env.ledger().sequence();
        let reveal_deadline = closed_at
            .checked_add(REVEAL_WINDOW_LEDGERS)
            .expect("Reveal deadline overflow");

        let state = BiddingState {
            job_id: job_id.clone(),
            client: client.clone(),
            is_closed: true,
            closed_at_ledger: closed_at,
            reveal_deadline_ledger: reveal_deadline,
        };

        env.storage()
            .instance()
            .set(&DataKey::BiddingState(job_id.clone()), &state);
        env.events()
            .publish((symbol_short!("bid_cls"), job_id), reveal_deadline);
    }

    /// Freelancer reveals their sealed bid: amount + nonce.
    pub fn reveal_bid(
        env: Env,
        job_id: String,
        freelancer: Address,
        amount: i128,
        nonce: BytesN<32>,
    ) {
        freelancer.require_auth();

        if amount <= 0 {
            panic!("Bid amount must be positive");
        }

        let state: BiddingState = env
            .storage()
            .instance()
            .get(&DataKey::BiddingState(job_id.clone()))
            .expect("Bidding not closed");
        if !state.is_closed {
            panic!("Bidding not closed");
        }
        if env.ledger().sequence() > state.reveal_deadline_ledger {
            panic!("Reveal window has closed");
        }

        let key = DataKey::BidCommitment(job_id.clone(), freelancer.clone());
        let mut bid_commitment: BidCommitment = env
            .storage()
            .instance()
            .get(&key)
            .expect("Bid commitment not found");

        if bid_commitment.bid_revealed {
            panic!("Bid already revealed");
        }

        let expected = Self::compute_bid_commitment(&env, amount, nonce);
        if expected != bid_commitment.commitment {
            panic!("Commitment verification failed");
        }

        bid_commitment.bid_revealed = true;
        env.storage().instance().set(&key, &bid_commitment);

        let mut reveals: Vec<RevealedBid> = env
            .storage()
            .instance()
            .get(&DataKey::RevealedBids(job_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        reveals.push_back(RevealedBid {
            freelancer: freelancer.clone(),
            amount,
            revealed_at_ledger: env.ledger().sequence(),
        });
        env.storage()
            .instance()
            .set(&DataKey::RevealedBids(job_id.clone()), &reveals);

        env.events()
            .publish((symbol_short!("bid_rvl"), job_id), (freelancer, amount));
    }

    /// Read a freelancer's sealed bid commitment.
    pub fn get_bid_commitment(env: Env, job_id: String, freelancer: Address) -> BidCommitment {
        env.storage()
            .instance()
            .get(&DataKey::BidCommitment(job_id, freelancer))
            .expect("Bid commitment not found")
    }

    /// Read all bids that were revealed during reveal phase.
    pub fn get_revealed_bids(env: Env, job_id: String) -> Vec<RevealedBid> {
        env.storage()
            .instance()
            .get(&DataKey::RevealedBids(job_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ─── Issue #105: Deliverable Hash Oracle ────────────────────────────────

    /// Client submits deliverable hash.
    pub fn submit_client_deliverable(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut submission: DeliverableSubmission = env
            .storage()
            .instance()
            .get(&DataKey::DeliverableSubmission(job_id.clone()))
            .unwrap_or_else(|| DeliverableSubmission {
                job_id: job_id.clone(),
                client_hash_submitted: false,
                freelancer_hash_submitted: false,
                hashes_match: false,
            });

        submission.client_hash_submitted = true;
        env.storage()
            .instance()
            .set(&DataKey::DeliverableSubmission(job_id.clone()), &submission);

        env.events()
            .publish((symbol_short!("clthash"), client), job_id);
    }

    /// Freelancer submits deliverable hash.
    pub fn submit_freelancer_deliverable(env: Env, job_id: String, freelancer: Address) {
        freelancer.require_auth();

        let mut submission: DeliverableSubmission = env
            .storage()
            .instance()
            .get(&DataKey::DeliverableSubmission(job_id.clone()))
            .unwrap_or_else(|| DeliverableSubmission {
                job_id: job_id.clone(),
                client_hash_submitted: false,
                freelancer_hash_submitted: false,
                hashes_match: false,
            });

        submission.freelancer_hash_submitted = true;
        env.storage()
            .instance()
            .set(&DataKey::DeliverableSubmission(job_id.clone()), &submission);

        env.events()
            .publish((symbol_short!("frelhash"), freelancer), job_id);
    }

    /// Oracle/freelancer submits the deliverable hash.
    ///
    /// If it matches the expected deliverable hash stored in escrow,
    /// the escrow is auto-released. If mismatched, escrow enters dispute.
    pub fn submit_deliverable(env: Env, job_id: String, actual_hash: BytesN<32>, caller: Address) {
        caller.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");

        if caller != escrow.freelancer && caller != admin {
            panic!("Only freelancer or oracle can submit deliverable");
        }

        let expected_hash = escrow
            .deliverable_hash
            .clone()
            .expect("Escrow has no deliverable hash");

        if Into::<Bytes>::into(actual_hash.clone()) == expected_hash {
            // Auto-release on successful deliverable verification.
            Self::release_escrow_core(env.clone(), job_id.clone(), escrow);
            env.events()
                .publish((symbol_short!("dlv_ok"), job_id), (caller, actual_hash));
            return;
        }

        // Mismatch must explicitly enter dispute.
        escrow.status = state_machine::transition_legacy(escrow.status, LifecycleAction::Dispute);
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);
        Self::sync_v2_transition_if_present(&env, &job_id, LifecycleAction::Dispute);

        env.events()
            .publish((symbol_short!("dlv_bad"), job_id), (caller, actual_hash));
    }

    /// Auto-release if both hashes match (manual fallback if mismatch after 7 days).
    pub fn check_deliverable_match(env: Env, job_id: String) -> bool {
        let submission: DeliverableSubmission = env
            .storage()
            .instance()
            .get(&DataKey::DeliverableSubmission(job_id.clone()))
            .expect("Deliverable submission not found");

        // Both must be submitted
        if submission.client_hash_submitted && submission.freelancer_hash_submitted {
            let mut updated = submission.clone();
            updated.hashes_match = true;
            env.storage()
                .instance()
                .set(&DataKey::DeliverableSubmission(job_id), &updated);
            return true;
        }
        false
    }

    /// Get deliverable submission status.
    pub fn get_deliverable_submission(env: Env, job_id: String) -> DeliverableSubmission {
        env.storage()
            .instance()
            .get(&DataKey::DeliverableSubmission(job_id))
            .expect("Deliverable submission not found")
    }

    // ─── Issue #102: Job Completion Certificate ──────────────────────────────

    /// Mint a certificate when job is completed (upon escrow release).
    pub fn mint_certificate(env: Env, job_id: String, client: Address) {
        client.require_auth();

        // Only client can mint
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can mint a certificate");
        }
        if escrow.status != EscrowStatus::Released {
            panic!("Escrow must be released to mint certificate");
        }

        // Prevent duplicate certificates
        if env
            .storage()
            .instance()
            .has(&DataKey::Certificate(job_id.clone()))
        {
            panic!("Certificate already minted");
        }

        let cert = Certificate {
            job_id: job_id.clone(),
            freelancer: escrow.freelancer.clone(),
            amount: escrow.amount,
            created_at: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::Certificate(job_id.clone()), &cert);

        // Track in freelancer's certificate history
        let mut certs: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::FreelancerCertificates(escrow.freelancer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        certs.push_back(job_id.clone());
        env.storage().instance().set(
            &DataKey::FreelancerCertificates(escrow.freelancer.clone()),
            &certs,
        );

        env.events()
            .publish((symbol_short!("certmnt"), client), (job_id, escrow.amount));
    }

    /// Get a certificate.
    pub fn get_certificate(env: Env, job_id: String) -> Certificate {
        env.storage()
            .instance()
            .get(&DataKey::Certificate(job_id))
            .expect("Certificate not found")
    }

    /// Get all certificates for a freelancer.
    pub fn get_freelancer_certificates(env: Env, freelancer: Address) -> Vec<String> {
        env.storage()
            .instance()
            .get(&DataKey::FreelancerCertificates(freelancer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn submit_client_rating(env: Env, job_id: String, client: Address, score: u32) {
        client.require_auth();
        if !(1..=5).contains(&score) {
            panic!("Score must be between 1 and 5");
        }

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");
        if escrow.status != EscrowStatus::Released {
            panic!("Ratings are allowed only after escrow release");
        }
        if escrow.client != client {
            panic!("Only job client can submit client rating");
        }
        if env
            .storage()
            .instance()
            .has(&DataKey::ClientRating(job_id.clone()))
        {
            panic!("Client rating already submitted for this job");
        }

        let rating = Rating {
            job_id: job_id.clone(),
            rater: client.clone(),
            rated: escrow.freelancer.clone(),
            score_out_of_5: score,
            submitted_at_ledger: env.ledger().sequence(),
        };
        env.storage()
            .instance()
            .set(&DataKey::ClientRating(job_id.clone()), &rating);

        let mut stats: FreelancerRatingStats = env
            .storage()
            .instance()
            .get(&DataKey::FreelancerRatingStats(escrow.freelancer.clone()))
            .unwrap_or(FreelancerRatingStats {
                total_score: 0,
                count: 0,
            });
        stats.total_score = stats
            .total_score
            .checked_add(score)
            .expect("Arithmetic overflow");
        stats.count = stats.count.checked_add(1).expect("Arithmetic overflow");
        env.storage()
            .instance()
            .set(&DataKey::FreelancerRatingStats(escrow.freelancer), &stats);
    }

    pub fn submit_freelancer_rating(env: Env, job_id: String, freelancer: Address, score: u32) {
        freelancer.require_auth();
        if !(1..=5).contains(&score) {
            panic!("Score must be between 1 and 5");
        }

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");
        if escrow.status != EscrowStatus::Released {
            panic!("Ratings are allowed only after escrow release");
        }
        if escrow.freelancer != freelancer {
            panic!("Only job freelancer can submit freelancer rating");
        }
        if env
            .storage()
            .instance()
            .has(&DataKey::FreelancerRating(job_id.clone()))
        {
            panic!("Freelancer rating already submitted for this job");
        }

        let rating = Rating {
            job_id: job_id.clone(),
            rater: freelancer,
            rated: escrow.client,
            score_out_of_5: score,
            submitted_at_ledger: env.ledger().sequence(),
        };
        env.storage()
            .instance()
            .set(&DataKey::FreelancerRating(job_id), &rating);
    }

    pub fn get_freelancer_rating_avg(env: Env, freelancer: Address) -> u32 {
        let stats: FreelancerRatingStats = env
            .storage()
            .instance()
            .get(&DataKey::FreelancerRatingStats(freelancer))
            .unwrap_or(FreelancerRatingStats {
                total_score: 0,
                count: 0,
            });
        if stats.count == 0 {
            return 0;
        }
        stats.total_score / stats.count
    }

    pub fn register_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can register arbitrators");
        }
        env.storage()
            .instance()
            .set(&DataKey::Arbitrator(arbitrator.clone()), &true);
        let mut pool: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorPool)
            .unwrap_or_else(|| Vec::new(&env));
        pool.push_back(arbitrator);
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorPool, &pool);
    }

    pub fn open_arbitration(env: Env, job_id: String, admin: Address) -> u32 {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can open arbitration");
        }

        let pool: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorPool)
            .unwrap_or_else(|| Vec::new(&env));
        if pool.len() < 3 {
            panic!("Need at least 3 registered arbitrators");
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ArbitrationCaseCount)
            .unwrap_or(0);
        let case_id = count.checked_add(1).expect("Counter overflow");
        let seed = env.ledger().sequence() as usize;
        let mut chosen = Vec::new(&env);
        chosen.push_back(pool.get((seed % pool.len() as usize) as u32).unwrap());
        chosen.push_back(pool.get(((seed + 1) % pool.len() as usize) as u32).unwrap());
        chosen.push_back(pool.get(((seed + 2) % pool.len() as usize) as u32).unwrap());

        let case = ArbitrationCase {
            job_id,
            arbitrators: chosen,
            votes: Vec::new(&env),
            voters: Vec::new(&env),
            resolution: 0,
            status: 0,
        };
        env.storage()
            .instance()
            .set(&DataKey::ArbitrationCase(case_id), &case);
        env.storage()
            .instance()
            .set(&DataKey::ArbitrationCaseCount, &case_id);
        case_id
    }

    pub fn cast_arbitration_vote(env: Env, case_id: u32, arbitrator: Address, client_percent: u32) {
        arbitrator.require_auth();
        if client_percent > 100 {
            panic!("Client percent must be 0-100");
        }

        let mut case: ArbitrationCase = env
            .storage()
            .instance()
            .get(&DataKey::ArbitrationCase(case_id))
            .expect("Arbitration case not found");
        if case.status != 0 {
            panic!("Arbitration case is not open");
        }
        if !case.arbitrators.contains(&arbitrator) {
            panic!("Only selected arbitrators can vote");
        }
        // Without a per-voter record the three votes are just three calls, and
        // a single selected arbitrator can cast all of them — which makes the
        // median-of-three resolution below their unilateral decision rather
        // than a panel's.
        if case.voters.contains(&arbitrator) {
            panic!("Arbitrator has already voted on this case");
        }
        if case.votes.len() >= 3 {
            panic!("All votes already submitted");
        }
        case.voters.push_back(arbitrator.clone());
        case.votes.push_back(client_percent);
        env.storage()
            .instance()
            .set(&DataKey::ArbitrationCase(case_id), &case);
    }

    pub fn resolve_arbitration(env: Env, case_id: u32) {
        let mut case: ArbitrationCase = env
            .storage()
            .instance()
            .get(&DataKey::ArbitrationCase(case_id))
            .expect("Arbitration case not found");
        if case.votes.len() != 3 {
            panic!("Exactly 3 votes required");
        }
        let vote_a = case.votes.get(0).unwrap();
        let vote_b = case.votes.get(1).unwrap();
        let vote_c = case.votes.get(2).unwrap();
        let min_vote = if vote_a < vote_b { vote_a } else { vote_b };
        let min_vote = if min_vote < vote_c { min_vote } else { vote_c };
        let max_vote = if vote_a > vote_b { vote_a } else { vote_b };
        let max_vote = if max_vote > vote_c { max_vote } else { vote_c };
        case.resolution = vote_a
            .checked_add(vote_b)
            .expect("Counter overflow")
            .checked_add(vote_c)
            .expect("Counter overflow")
            .checked_sub(min_vote)
            .expect("Arithmetic underflow")
            .checked_sub(max_vote)
            .expect("Arithmetic underflow");
        case.status = 1;
        env.storage()
            .instance()
            .set(&DataKey::ArbitrationCase(case_id), &case);

        // Settle the escrow the case was opened over.
        //
        // Until this existed, `raise_dispute()` was a one-way door: it moves an
        // escrow to `Disputed`, every settlement path except the milestone one
        // refuses that status, and resolving the arbitration only recorded a
        // percentage. Either participant could therefore strand the funds
        // permanently with a single call, and the panel's decision had no
        // effect on where the money went.
        Self::settle_arbitrated_escrow(&env, &case.job_id, case.resolution);

        env.events()
            .publish((symbol_short!("arb_res"), case_id), case.resolution);
    }

    /// Pay out a disputed escrow according to the panel's resolution.
    ///
    /// `client_percent` is the share returned to the client; the freelancer
    /// receives the remainder. The split is taken over what the contract still
    /// holds for this escrow, and the freelancer's share is computed as the
    /// *residual* rather than as a second percentage, so the two shares
    /// reconstruct the balance exactly however the division truncates.
    fn settle_arbitrated_escrow(env: &Env, job_id: &String, client_percent: u32) {
        let mut escrow: Escrow = match env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
        {
            Some(e) => e,
            // An arbitration case can name a job that has no escrow — the case
            // is still resolved, there is simply nothing to pay out.
            None => return,
        };

        // v2 records know the exact remaining liability after prior stream or
        // milestone payouts. Settle that liability directly so arbitration
        // can never pay the original deposit a second time.
        if let Some(mut v2) = env
            .storage()
            .instance()
            .get::<_, EscrowV2>(&DataKey::EscrowV2(job_id.clone()))
        {
            let Some(resolved_state) =
                state_machine::try_transition(v2.state.clone(), LifecycleAction::ResolveRelease)
            else {
                return;
            };
            let remaining = v2.liability();
            let client_share = remaining
                .checked_mul(i128::from(client_percent))
                .expect("Arithmetic overflow")
                .checked_div(100)
                .expect("Arithmetic overflow");
            let freelancer_share = remaining
                .checked_sub(client_share)
                .expect("Arithmetic underflow");
            let token_client = token::Client::new(env, &escrow.token);
            if client_share > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.client,
                    &client_share,
                );
            }
            if freelancer_share > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.freelancer,
                    &freelancer_share,
                );
            }
            v2.refunded_to_client = v2
                .refunded_to_client
                .checked_add(client_share)
                .expect("Escrow accounting overflow");
            v2.paid_to_freelancer = v2
                .paid_to_freelancer
                .checked_add(freelancer_share)
                .expect("Escrow accounting overflow");
            v2.state = resolved_state;
            v2.v2_features_used = true;
            migration::store(env, &v2);

            let mut settled_ms = Vec::new(env);
            for mut milestone in escrow.milestones.iter() {
                milestone.is_completed = true;
                settled_ms.push_back(milestone);
            }
            escrow.milestones = settled_ms;
            escrow.status =
                state_machine::transition_legacy(escrow.status, LifecycleAction::ResolveRelease);
            env.storage()
                .instance()
                .set(&DataKey::Escrow(job_id.clone()), &escrow);
            env.storage()
                .instance()
                .remove(&DataKey::TimeoutTimestamp(job_id.clone()));
            env.events().publish(
                (symbol_short!("arb_paid"), job_id.clone()),
                (
                    escrow.client.clone(),
                    escrow.freelancer.clone(),
                    client_share,
                    freelancer_share,
                ),
            );
            return;
        }

        // A settled escrow has already distributed its funds. Paying out again
        // would take the money from other escrows' balances.
        let Some(resolved_status) = state_machine::try_transition(
            state_machine::from_legacy(escrow.status.clone()),
            LifecycleAction::ResolveRelease,
        )
        .map(state_machine::to_legacy) else {
            return;
        };

        let remaining = Self::unpaid_remainder(&escrow);

        if remaining > 0 {
            let client_share = remaining
                .checked_mul(client_percent as i128)
                .expect("Arithmetic overflow")
                .checked_div(100)
                .expect("Arithmetic overflow");
            let freelancer_share = remaining
                .checked_sub(client_share)
                .expect("Arithmetic underflow");

            let token_client = token::Client::new(env, &escrow.token);
            if client_share > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.client,
                    &client_share,
                );
            }
            if freelancer_share > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.freelancer,
                    &freelancer_share,
                );
            }

            env.events().publish(
                (symbol_short!("arb_paid"), job_id.clone()),
                (
                    escrow.client.clone(),
                    escrow.freelancer.clone(),
                    client_share,
                    freelancer_share,
                ),
            );
        }

        let mut settled_ms = soroban_sdk::Vec::new(env);
        for mut ms in escrow.milestones.iter() {
            ms.is_completed = true;
            settled_ms.push_back(ms);
        }
        escrow.milestones = settled_ms;

        escrow.status = resolved_status;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));
    }

    pub fn get_arbitration_case(env: Env, case_id: u32) -> ArbitrationCase {
        env.storage()
            .instance()
            .get(&DataKey::ArbitrationCase(case_id))
            .expect("Arbitration case not found")
    }

    // ─── Zero-knowledge reputation (Issue #319) ───────────────────────────────
    // Thin wrappers around src/reputation.rs — see that module's doc comment
    // for the design, and docs/ADR-010-zk-reputation.md for the full
    // rationale, data model, and revocation semantics.

    /// Configure the address authorized to anchor reputation roots and
    /// register revocations (the platform's issuance service). Admin-only.
    pub fn set_reputation_issuer(env: Env, admin: Address, issuer: Address) {
        reputation::set_issuer(&env, &admin, &issuer);
    }

    /// Anchor a new (epoch, root) checkpoint for `subject`. Issuer-only;
    /// epochs must be anchored in strictly increasing order per subject.
    pub fn anchor_reputation_root(
        env: Env,
        issuer: Address,
        subject: Address,
        epoch: u32,
        root: BytesN<32>,
    ) {
        reputation::anchor_root(&env, &issuer, &subject, epoch, root);
    }

    /// Record that a rating first included at `invalidates_from_epoch` has
    /// been revoked (an appeal was upheld). O(1): see reputation.rs's
    /// `revoke_from_epoch` doc comment for why a single scalar suffices.
    pub fn revoke_reputation_from_epoch(
        env: Env,
        issuer: Address,
        subject: Address,
        invalidates_from_epoch: u32,
    ) {
        reputation::revoke_from_epoch(&env, &issuer, &subject, invalidates_from_epoch);
    }

    /// The anchored root for `(subject, epoch)`, and whether that epoch is
    /// still valid (not superseded by a later revocation). `None` if the
    /// epoch was never anchored or has aged out of the retention window.
    pub fn get_reputation_epoch(
        env: Env,
        subject: Address,
        epoch: u32,
    ) -> Option<(BytesN<32>, bool)> {
        reputation::resolve_epoch(&env, &subject, epoch)
    }

    /// Verify a full zero-knowledge reputation proof on-chain: context
    /// freshness, epoch/root/revocation state, Merkle boundary inclusion,
    /// and the statement's circuit proof. See `ReputationProofArgs` for the
    /// field-by-field mapping back to the off-chain proof object this
    /// mirrors. Returns `false` for any invalid or false-statement proof;
    /// never panics on adversarial input.
    pub fn verify_reputation_proof(env: Env, args: ReputationProofArgs) -> bool {
        let now_ms = env.ledger().timestamp().saturating_mul(1000);
        reputation::verify_reputation_proof(&env, &args, now_ms)
    }

    // ─── Cross-chain bridge ──────────────────────────────────────────────────

    /// Register an EVM deposit on Soroban. Requires relayer authentication.
    pub fn register_bridge_deposit(env: Env, proof: EvmProof) -> BridgeTransfer {
        proof.relayer_address.require_auth();
        bridge::register_deposit(&env, &proof, env.ledger().sequence())
    }

    /// Initiate a withdrawal from Soroban to EVM.
    pub fn initiate_bridge_withdrawal(
        env: Env,
        transfer_id: BytesN<32>,
        recipient: Address,
        amount: i128,
    ) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();
        bridge::initiate_withdrawal(&env, transfer_id, recipient, amount)
    }

    /// Verify and complete a bridged withdrawal after Soroban finality.
    pub fn verify_bridge_completion(env: Env, transfer_id: BytesN<32>) {
        bridge::verify_and_complete_bridge(&env, transfer_id)
    }

    /// Recover a stuck bridge transfer after the recovery deadline.
    pub fn recover_bridge_transfer(env: Env, transfer_id: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();
        bridge::recover_bridge_transfer(&env, transfer_id, admin)
    }

    /// Set the authorised chain ID for incoming EVM proofs.
    pub fn set_bridge_chain_id(env: Env, chain_id: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();
        bridge::set_chain_id(&env, chain_id)
    }

    /// Update confirmations for an existing bridge transfer.
    pub fn update_bridge_confirmations(
        env: Env,
        transfer_id: BytesN<32>,
        new_confirmations: u32,
    ) {
        bridge::update_bridge_confirmations(&env, transfer_id, new_confirmations)
    }

    /// Get a bridge transfer by ID.
    pub fn get_bridge_transfer(env: Env, transfer_id: BytesN<32>) -> Option<BridgeTransfer> {
        bridge::get_bridge_transfer(&env, transfer_id)
    }

    /// Verify an EVM proof without executing state changes.
    pub fn validate_evm_proof(env: Env, proof: EvmProof) -> bool {
        bridge::verify_evm_proof(&env, &proof)
    }
}

#[cfg(test)]
mod legacy_tests;
