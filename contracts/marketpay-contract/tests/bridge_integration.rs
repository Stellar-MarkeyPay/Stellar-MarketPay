use marketpay_contract::{
    BridgeChain, BridgeTransferStatus, DataKey, EvmProof, MarketPayContract,
    MarketPayContractClient, BridgeTransfer, ESCROW_SCHEMA_BRIDGE,
};
use soroban_sdk::testutils::{Address as _, EnvTestConfig, Ledger};
use soroban_sdk::{token, Address, Bytes, BytesN, Env, String, Vec};

struct BridgeFixture<'a> {
    env: Env,
    contract: MarketPayContractClient<'a>,
    admin: Address,
    relayer: Address,
    depositor: Address,
    recipient: Address,
    chain_id: BytesN<'a, 32>,
}

impl<'a> BridgeFixture<'a> {
    fn new() -> Self {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        contract.initialize(&admin);
        let relayer = Address::generate(&env);
        let depositor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let chain_id = BytesN::from_array(&env, &[0xAB; 32]);
        Self {
            env,
            contract,
            admin,
            relayer,
            depositor,
            recipient,
            chain_id,
        }
    }

    fn evm_proof(&self, nonce: u64) -> EvmProof {
        EvmProof {
            transfer_id: BytesN::from_array(&self.env, &[(nonce % 256) as u8; 32]),
            soroban_tx_hash: BytesN::from_array(&self.env, &[0xCD; 32]),
            evm_signature: BytesN::from_array(&self.env, &[0xEF; 65]),
            relayer_address: self.relayer.clone(),
            source_block_number: 1000,
            source_log_index: 0,
            nonce,
            chain_id: self.chain_id.clone(),
        }
    }

    fn set_sequence(&self, sequence_number: u32) {
        let mut ledger = self.env.ledger().get();
        ledger.sequence_number = sequence_number;
        self.env.ledger().set(ledger);
    }
}

#[test]
fn bridge_register_deposit_creates_transfer() {
    let f = BridgeFixture::new();
    let proof = f.evm_proof(1);
    let current_ledger = f.env.ledger().sequence();

    let transfer = f.contract.register_bridge_deposit(&proof);

    assert_eq!(transfer.source_chain, BridgeChain::Evm);
    assert_eq!(transfer.status, BridgeTransferStatus::Deposited);
    assert_eq!(transfer.confirmations, 1);
    assert_eq!(transfer.required_confirmations, 12);
    assert_eq!(transfer.chain_id, f.chain_id);
    assert_eq!(transfer.created_at_ledger, current_ledger);
}

#[test]
fn bridge_register_deposit_rejects_replay() {
    let f = BridgeFixture::new();
    let proof = f.evm_proof(2);
    f.contract.register_bridge_deposit(&proof);
    assert_eq!(
        f.contract.try_register_bridge_deposit(&proof),
        Err(Ok(BridgeTransferStatus::Deposited))
    );
}

#[test]
fn bridge_register_deposit_rejects_wrong_chain_id() {
    let f = BridgeFixture::new();
    let mut bad_proof = f.evm_proof(3);
    bad_proof.chain_id = BytesN::from_array(&f.env, &[0xFF; 32]);
    assert_eq!(
        f.contract.try_register_bridge_deposit(&bad_proof),
        Err(Ok(BridgeTransferStatus::Deposited))
    );
}

#[test]
fn bridge_initiate_withdrawal_changes_status() {
    let f = BridgeFixture::new();
    let proof = f.evm_proof(4);
    let transfer = f.contract.register_bridge_deposit(&proof);

    f.contract.initiate_bridge_withdrawal(&transfer.id, &f.recipient, &1000);

    let updated = f.contract.get_bridge_transfer(&transfer.id).unwrap();
    assert_eq!(updated.status, BridgeTransferStatus::Pending);
    assert_eq!(updated.amount, 1000);
    assert_eq!(updated.destination_address, f.recipient);
}

#[test]
fn bridge_recovery_available_after_deadline() {
    let f = BridgeFixture::new();
    let proof = f.evm_proof(5);
    let transfer = f.contract.register_bridge_deposit(&proof);

    f.set_sequence(transfer.recovery_deadline_ledger + 1);
    f.contract.recover_bridge_transfer(&transfer.id);

    let updated = f.contract.get_bridge_transfer(&transfer.id).unwrap();
    assert_eq!(updated.status, BridgeTransferStatus::Recovering);
}

#[test]
fn bridge_recovery_rejected_before_deadline() {
    let f = BridgeFixture::new();
    let proof = f.evm_proof(6);
    let transfer = f.contract.register_bridge_deposit(&proof);

    assert_eq!(
        f.contract.try_recover_bridge_transfer(&transfer.id),
        Err(Ok(BridgeTransferStatus::Deposited))
    );
}

#[test]
fn bridge_verify_completion_marks_released() {
    let f = BridgeFixture::new();
    let proof = f.evm_proof(7);
    let transfer = f.contract.register_bridge_deposit(&proof);
    f.contract.initiate_bridge_withdrawal(&transfer.id, &f.recipient, &500);
    f.contract.verify_bridge_completion(&transfer.id);

    let updated = f.contract.get_bridge_transfer(&transfer.id).unwrap();
    assert_eq!(updated.status, BridgeTransferStatus::Released);
}

#[test]
fn bridge_set_chain_id() {
    let f = BridgeFixture::new();
    let new_chain_id = BytesN::from_array(&f.env, &[0x11; 32]);
    f.contract.set_bridge_chain_id(&new_chain_id);
    let proof = f.evm_proof(8);
    proof.chain_id = new_chain_id.clone();
    let transfer = f.contract.register_bridge_deposit(&proof);
    assert_eq!(transfer.chain_id, new_chain_id);
}

#[test]
fn bridge_validate_evm_proof_verifies_chain_id() {
    let f = BridgeFixture::new();
    let mut bad_proof = f.evm_proof(9);
    bad_proof.chain_id = BytesN::from_array(&f.env, &[0xFF; 32]);
    assert!(!f.contract.validate_evm_proof(&bad_proof));
}
