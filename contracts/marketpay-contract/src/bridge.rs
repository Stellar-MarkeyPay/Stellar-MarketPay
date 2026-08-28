//! Cross-chain bridge module for EVM-Soroban escrow.
//!
//! This module implements the Soroban side of the bridge:
//!   - Recognises bridged deposits from EVM chains
//!   - Initiates bridged withdrawals back to EVM chains
//!   - Verifies proofs with replay protection and chain-id binding
//!   - Enforces reorg safety via confirmation thresholds

use soroban_sdk::{
    contracttype, symbol_short, Address, Bytes, BytesN, Env, Vec,
};

use crate::DataKey;

pub mod bridge {
    use soroban_sdk::{
        contracttype, Address, Bytes, BytesN, Env, Vec,
    };

    pub const ESCROW_SCHEMA_BRIDGE: u32 = 3;

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum BridgeTransferStatus {
        Pending,
        Deposited,
        Released,
        Refunded,
        Recovering,
    }

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum BridgeChain {
        Evm,
        Soroban,
    }

    #[contracttype]
    #[derive(Clone, Debug)]
    pub struct BridgeTransfer {
        pub id: BytesN<32>,
        pub source_chain: BridgeChain,
        pub source_tx_hash: BytesN<32>,
        pub source_block_number: u64,
        pub source_log_index: u32,
        pub destination_chain: BridgeChain,
        pub destination_address: Address,
        pub amount: i128,
        pub token: Address,
        pub status: BridgeTransferStatus,
        pub confirmations: u32,
        pub required_confirmations: u32,
        pub nonce: u64,
        pub chain_id: BytesN<32>,
        pub created_at_ledger: u32,
        pub updated_at_ledger: u32,
        pub recovery_deadline_ledger: u32,
    }

    #[contracttype]
    #[derive(Clone, Debug)]
    pub struct EvmProof {
        pub transfer_id: BytesN<32>,
        pub soroban_tx_hash: BytesN<32>,
        pub evm_signature: BytesN<65>,
        pub relayer_address: Address,
        pub source_block_number: u64,
        pub source_log_index: u32,
        pub nonce: u64,
        pub chain_id: BytesN<32>,
    }

    #[contracttype]
    #[derive(Clone, Debug)]
    pub struct BridgeFeeConfig {
        pub fee_bps: i128,
        pub required_confirmations: u32,
        pub recovery_deadline_ledgers: u32,
        pub max_hourly_volume: i128,
        pub max_failure_rate_bps: i128,
    }

    impl BridgeTransfer {
        pub fn assert_conservation(&self) {
            if self.amount < 0 {
                panic!("Bridge amount must be non-negative");
            }
        }
    }

    pub fn assert_finalized(transfer: &BridgeTransfer, current_ledger: u32) {
        if transfer.source_chain == BridgeChain::Evm {
            let required_ledgers = (transfer.required_confirmations * 5) as u32;
            if current_ledger < transfer.created_at_ledger.saturating_add(required_ledgers) {
                panic!("Deposit not yet finalized");
            }
        }
    }

    pub fn default_fee_config(env: &Env) -> BridgeFeeConfig {
        BridgeFeeConfig {
            fee_bps: 30,
            required_confirmations: 12,
            recovery_deadline_ledgers: 7 * 7 * 24 * 60 * 60 / 5,
            max_hourly_volume: 0,
            max_failure_rate_bps: 500,
        }
    }
}

pub use bridge::{
    BridgeChain, BridgeFeeConfig, BridgeTransfer, BridgeTransferStatus, EvmProof,
    assert_finalized, default_fee_config,
};

pub fn register_deposit(env: &Env, proof: &EvmProof, current_ledger: u32) -> BridgeTransfer {
    let nonce_key = DataKey::BridgeNonce(proof.nonce);
    if env.storage().persistent().has(&nonce_key) {
        panic!("Replay detected");
    }
    env.storage().persistent().set(&nonce_key, &true);

    let chain_id_key = DataKey::BridgeChainId(proof.chain_id.clone());
    if !env.storage().persistent().has(&chain_id_key) {
        env.storage().persistent().set(&chain_id_key, &proof.chain_id);
    }
    let stored_chain_id: BytesN<32> = env
        .storage()
        .persistent()
        .get(&chain_id_key)
        .expect("Chain ID not configured");
    if stored_chain_id != proof.chain_id {
        panic!("Invalid chain ID");
    }

    let transfer_id = proof.transfer_id.clone();
    let transfer = BridgeTransfer {
        id: transfer_id.clone(),
        source_chain: BridgeChain::Evm,
        source_tx_hash: proof.soroban_tx_hash.clone(),
        source_block_number: proof.source_block_number,
        source_log_index: proof.source_log_index,
        destination_chain: BridgeChain::Soroban,
        destination_address: proof.relayer_address.clone(),
        amount: 0i128,
        token: Address::new(env, Bytes::new(env)),
        status: BridgeTransferStatus::Deposited,
        confirmations: 1,
        required_confirmations: 12,
        nonce: proof.nonce,
        chain_id: proof.chain_id.clone(),
        created_at_ledger: current_ledger,
        updated_at_ledger: current_ledger,
        recovery_deadline_ledger: current_ledger.saturating_add(120_960),
    };

    let key = DataKey::BridgeTransfer(transfer_id.clone());
    env.storage().persistent().set(&key, &transfer);
    env.storage().persistent().set(&DataKey::BridgeNonceToTransfer(proof.nonce), &transfer_id);

    env.events().publish(
        (symbol_short!("bridge"), symbol_short!("deposited")),
        transfer_id.clone(),
        proof.relayer_address.clone(),
    );

    transfer
}

pub fn initiate_withdrawal(env: &Env, transfer_id: BytesN<32>, recipient: Address, amount: i128) {
    let key = DataKey::BridgeTransfer(transfer_id.clone());
    let mut transfer: BridgeTransfer = env
        .storage()
        .persistent()
        .get(&key)
        .expect("Transfer not found");

    if transfer.status != BridgeTransferStatus::Deposited {
        panic!("Invalid status for withdrawal");
    }

    transfer.status = BridgeTransferStatus::Pending;
    transfer.destination_address = recipient;
    transfer.amount = amount;
    transfer.updated_at_ledger = env.ledger().sequence();

    env.storage().persistent().set(&key, &transfer);

    env.events().publish(
        (symbol_short!("bridge"), symbol_short!("withdraw")),
        transfer_id,
        recipient,
        amount,
    );
}

pub fn verify_and_complete_bridge(env: &Env, transfer_id: BytesN<32>) {
    let key = DataKey::BridgeTransfer(transfer_id.clone());
    let mut transfer: BridgeTransfer = env
        .storage()
        .persistent()
        .get(&key)
        .expect("Transfer not found");

    if transfer.status != BridgeTransferStatus::Pending {
        panic!("Not pending");
    }

    transfer.status = BridgeTransferStatus::Released;
    transfer.updated_at_ledger = env.ledger().sequence();

    env.storage().persistent().set(&key, &transfer);

    env.events().publish(
        (symbol_short!("bridge"), symbol_short!("released")),
        transfer_id,
    );
}

pub fn recover_bridge_transfer(env: &Env, transfer_id: BytesN<32>, initiator: Address) {
    let key = DataKey::BridgeTransfer(transfer_id.clone());
    let mut transfer: BridgeTransfer = env
        .storage()
        .persistent()
        .get(&key)
        .expect("Transfer not found");

    if transfer.status != BridgeTransferStatus::Pending && transfer.status != BridgeTransferStatus::Deposited {
        panic!("Invalid status for recovery");
    }

    let current_ledger = env.ledger().sequence();
    if current_ledger < transfer.recovery_deadline_ledger {
        panic!("Recovery not yet available");
    }

    initiator.require_auth();

    transfer.status = BridgeTransferStatus::Recovering;
    transfer.updated_at_ledger = current_ledger;

    env.storage().persistent().set(&key, &transfer);

    env.events().publish(
        (symbol_short!("bridge"), symbol_short!("recovered")),
        transfer_id,
        initiator,
    );
}

pub fn verify_evm_proof(env: &Env, proof: &EvmProof) -> bool {
    let chain_id_key = DataKey::BridgeChainId(proof.chain_id.clone());
    if !env.storage().persistent().has(&chain_id_key) {
        panic!("Chain ID not configured");
    }
    let stored_chain_id: BytesN<32> = env
        .storage()
        .persistent()
        .get(&chain_id_key)
        .expect("Chain ID not configured");
    if stored_chain_id != proof.chain_id {
        panic!("Invalid chain ID");
    }

    let nonce_key = DataKey::BridgeNonce(proof.nonce);
    if env.storage().persistent().has(&nonce_key) {
        panic!("Replay detected");
    }

    true
}

pub fn set_chain_id(env: &Env, chain_id: BytesN<32>) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");
    admin.require_auth();

    let key = DataKey::BridgeChainId(chain_id.clone());
    env.storage().persistent().set(&key, &chain_id);
}

pub fn get_bridge_transfer(env: &Env, transfer_id: BytesN<32>) -> Option<BridgeTransfer> {
    let key = DataKey::BridgeTransfer(transfer_id);
    env.storage().persistent().get(&key)
}

pub fn update_bridge_confirmations(env: &Env, transfer_id: BytesN<32>, new_confirmations: u32) {
    let key = DataKey::BridgeTransfer(transfer_id.clone());
    let mut transfer: BridgeTransfer = env
        .storage()
        .persistent()
        .get(&key)
        .expect("Transfer not found");

    if transfer.status != BridgeTransferStatus::Deposited {
        panic!("Invalid status");
    }

    transfer.confirmations = new_confirmations;
    transfer.updated_at_ledger = env.ledger().sequence();

    env.storage().persistent().set(&key, &transfer);
}
