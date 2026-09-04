#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, String,
};

const MAX_QUERY_LEN: usize = 512;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Attestation {
    pub oracle: Address,
    pub deliverable_hash: BytesN<32>,
    pub approved: bool,
    pub submitted_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MilestoneStatus {
    pub approvals: u32,
    pub rejections: u32,
    pub finalized: bool,
    pub agreed_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Quorum,
    Oracle(Address),
    OracleCount,
    Attestation(String, u32, Address), // job_id, milestone_index, oracle
    MilestoneStatus(String, u32),       // job_id, milestone_index
}

#[contract]
pub struct OracleContract;

#[contractimpl]
impl OracleContract {
    /// Initialize the decentralized Oracle Contract.
    pub fn initialize(env: Env, admin: Address, quorum: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if quorum == 0 {
            panic!("Quorum must be at least 1");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        env.storage().instance().set(&DataKey::OracleCount, &0u32);

        env.events()
            .publish((symbol_short!("init"), admin), quorum);
    }

    /// Register a trusted oracle node/turret.
    pub fn register_oracle(env: Env, admin: Address, oracle: Address) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only admin can register oracles");
        }
        admin.require_auth();

        if !Self::is_oracle(env.clone(), oracle.clone()) {
            env.storage()
                .instance()
                .set(&DataKey::Oracle(oracle.clone()), &true);
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::OracleCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::OracleCount, &(count + 1));

            env.events()
                .publish((symbol_short!("reg_orc"), admin), oracle);
        }
    }

    /// Remove a registered oracle node.
    pub fn remove_oracle(env: Env, admin: Address, oracle: Address) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only admin can remove oracles");
        }
        admin.require_auth();

        if Self::is_oracle(env.clone(), oracle.clone()) {
            env.storage()
                .instance()
                .set(&DataKey::Oracle(oracle.clone()), &false);
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::OracleCount)
                .unwrap_or(1);
            env.storage()
                .instance()
                .set(&DataKey::OracleCount, &count.saturating_sub(1));

            env.events()
                .publish((symbol_short!("rem_orc"), admin), oracle);
        }
    }

    /// Check if address is a registered active oracle.
    pub fn is_oracle(env: Env, oracle: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Oracle(oracle))
            .unwrap_or(false)
    }

    /// Update required quorum for consensus.
    pub fn set_quorum(env: Env, admin: Address, quorum: u32) {
        if quorum == 0 {
            panic!("Quorum must be at least 1");
        }
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only admin can set quorum");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Quorum, &quorum);
        env.events()
            .publish((symbol_short!("set_qrm"), admin), quorum);
    }

    /// Get current quorum requirement.
    pub fn get_quorum(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Quorum).unwrap_or(1)
    }

    /// Submit an attestation from an authorized oracle.
    /// Returns true if milestone has reached approved quorum.
    pub fn submit_attestation(
        env: Env,
        oracle: Address,
        job_id: String,
        milestone_index: u32,
        deliverable_hash: BytesN<32>,
        approved: bool,
    ) -> bool {
        if !Self::is_oracle(env.clone(), oracle.clone()) {
            panic!("Caller is not registered oracle");
        }
        oracle.require_auth();

        let att_key = DataKey::Attestation(job_id.clone(), milestone_index, oracle.clone());
        if env.storage().instance().has(&att_key) {
            panic!("Oracle already submitted attestation for this milestone");
        }

        let attestation = Attestation {
            oracle: oracle.clone(),
            deliverable_hash: deliverable_hash.clone(),
            approved,
            submitted_at_ledger: env.ledger().sequence(),
        };
        env.storage().instance().set(&att_key, &attestation);

        let status_key = DataKey::MilestoneStatus(job_id.clone(), milestone_index);
        let mut status = env
            .storage()
            .instance()
            .get::<_, MilestoneStatus>(&status_key)
            .unwrap_or(MilestoneStatus {
                approvals: 0,
                rejections: 0,
                finalized: false,
                agreed_hash: deliverable_hash.clone(),
            });

        if approved {
            status.approvals = status.approvals.checked_add(1).expect("Overflow");
            status.agreed_hash = deliverable_hash.clone();
        } else {
            status.rejections = status.rejections.checked_add(1).expect("Overflow");
        }

        let quorum = Self::get_quorum(env.clone());
        if status.approvals >= quorum {
            status.finalized = true;
        }

        env.storage().instance().set(&status_key, &status);

        env.events().publish(
            (symbol_short!("attest"), oracle),
            (job_id, milestone_index, approved),
        );

        status.finalized
    }

    /// Compatible with MarketPay `OracleTrait::verify_milestone`:
    /// Computes cryptographic hash over `b"verified:" + query` and compares against `proof`.
    pub fn verify_milestone(
        env: Env,
        _job_id: String,
        _milestone_index: u32,
        query: String,
        proof: Bytes,
    ) -> bool {
        if proof.len() != 32 {
            return false;
        }

        let mut payload = Bytes::new(&env);
        for byte in b"verified:".iter() {
            payload.push_back(*byte);
        }

        let query_len = query.len() as usize;
        if query_len > MAX_QUERY_LEN {
            panic!("Oracle query too long");
        }

        let mut query_buf = [0u8; MAX_QUERY_LEN];
        query.copy_into_slice(&mut query_buf[..query_len]);
        for byte in query_buf.iter().take(query_len) {
            payload.push_back(*byte);
        }

        let expected_hash: BytesN<32> = env.crypto().sha256(&payload).into();
        let Ok(proof_hash) = BytesN::<32>::try_from(proof) else {
            return false;
        };

        expected_hash == proof_hash
    }

    /// Check if milestone is approved and agreed deliverable hash matches expected hash.
    pub fn check_deliverable(
        env: Env,
        job_id: String,
        milestone_index: u32,
        expected_hash: BytesN<32>,
    ) -> bool {
        let status_key = DataKey::MilestoneStatus(job_id, milestone_index);
        if let Some(status) = env
            .storage()
            .instance()
            .get::<_, MilestoneStatus>(&status_key)
        {
            status.finalized && status.agreed_hash == expected_hash
        } else {
            false
        }
    }

    /// Check if milestone is finalized by quorum.
    pub fn is_milestone_finalized(env: Env, job_id: String, milestone_index: u32) -> bool {
        let status_key = DataKey::MilestoneStatus(job_id, milestone_index);
        if let Some(status) = env
            .storage()
            .instance()
            .get::<_, MilestoneStatus>(&status_key)
        {
            status.finalized
        } else {
            false
        }
    }

    /// Retrieve attestation for a specific oracle.
    pub fn get_attestation(
        env: Env,
        job_id: String,
        milestone_index: u32,
        oracle: Address,
    ) -> Option<Attestation> {
        let key = DataKey::Attestation(job_id, milestone_index, oracle);
        env.storage().instance().get(&key)
    }

    /// Retrieve current milestone status.
    pub fn get_milestone_status(
        env: Env,
        job_id: String,
        milestone_index: u32,
    ) -> Option<MilestoneStatus> {
        let key = DataKey::MilestoneStatus(job_id, milestone_index);
        env.storage().instance().get(&key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize_and_register_oracle() {
        let env = Env::default();
        let contract_id = env.register(OracleContract, ());
        let client = OracleContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let oracle1 = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin, &2);
        assert_eq!(client.get_quorum(), 2);
        assert!(!client.is_oracle(&oracle1));

        client.register_oracle(&admin, &oracle1);
        assert!(client.is_oracle(&oracle1));

        client.remove_oracle(&admin, &oracle1);
        assert!(!client.is_oracle(&oracle1));
    }

    #[test]
    fn test_attestation_and_quorum_resolution() {
        let env = Env::default();
        let contract_id = env.register(OracleContract, ());
        let client = OracleContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let oracle1 = Address::generate(&env);
        let oracle2 = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin, &2);
        client.register_oracle(&admin, &oracle1);
        client.register_oracle(&admin, &oracle2);

        let job_id = String::from_str(&env, "job-777");
        let milestone_index = 0u32;
        let test_hash = BytesN::from_array(&env, &[7u8; 32]);

        // First attestation (quorum is 2, so not yet finalized)
        let finalized1 = client.submit_attestation(
            &oracle1,
            &job_id,
            &milestone_index,
            &test_hash,
            &true,
        );
        assert!(!finalized1);
        assert!(!client.is_milestone_finalized(&job_id, &milestone_index));

        // Second attestation reaches quorum (2)
        let finalized2 = client.submit_attestation(
            &oracle2,
            &job_id,
            &milestone_index,
            &test_hash,
            &true,
        );
        assert!(finalized2);
        assert!(client.is_milestone_finalized(&job_id, &milestone_index));

        // Check deliverable matches
        assert!(client.check_deliverable(&job_id, &milestone_index, &test_hash));
        let wrong_hash = BytesN::from_array(&env, &[9u8; 32]);
        assert!(!client.check_deliverable(&job_id, &milestone_index, &wrong_hash));
    }

    #[test]
    fn test_verify_milestone_hash() {
        let env = Env::default();
        let contract_id = env.register(OracleContract, ());
        let client = OracleContractClient::new(&env, &contract_id);

        let job_id = String::from_str(&env, "job-github-pr-12");
        let query = String::from_str(&env, "github.com/org/repo/pull/42");

        // Compute valid proof
        let mut payload = Bytes::new(&env);
        for byte in b"verified:".iter() {
            payload.push_back(*byte);
        }
        let mut buf = [0u8; 64];
        let qlen = query.len() as usize;
        query.copy_into_slice(&mut buf[..qlen]);
        for byte in buf.iter().take(qlen) {
            payload.push_back(*byte);
        }
        let proof_bytes: Bytes = env.crypto().sha256(&payload).into();

        let ok = client.verify_milestone(&job_id, &0, &query, &proof_bytes);
        assert!(ok);

        // Invalid proof fails
        let invalid_proof = Bytes::from_array(&env, &[1u8; 32]);
        let not_ok = client.verify_milestone(&job_id, &0, &query, &invalid_proof);
        assert!(!not_ok);
    }

    #[test]
    #[should_panic(expected = "Caller is not registered oracle")]
    fn test_unauthorized_oracle_panics() {
        let env = Env::default();
        let contract_id = env.register(OracleContract, ());
        let client = OracleContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let intruder = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin, &1);

        let job_id = String::from_str(&env, "job-fake");
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        client.submit_attestation(&intruder, &job_id, &0, &hash, &true);
    }

    #[test]
    #[should_panic(expected = "Oracle already submitted attestation for this milestone")]
    fn test_duplicate_attestation_panics() {
        let env = Env::default();
        let contract_id = env.register(OracleContract, ());
        let client = OracleContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        env.mock_all_auths();

        client.initialize(&admin, &2);
        client.register_oracle(&admin, &oracle);

        let job_id = String::from_str(&env, "job-dup");
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        client.submit_attestation(&oracle, &job_id, &0, &hash, &true);
        client.submit_attestation(&oracle, &job_id, &0, &hash, &true);
    }
}
