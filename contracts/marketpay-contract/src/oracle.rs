use soroban_sdk::{Address, Bytes, BytesN, Env, String};

const MAX_ORACLE_QUERY_LEN: usize = 512;

/// Soroban Oracle interface trait.
/// Enables external verification of milestones (e.g., checking a GitHub commit or website status).
pub trait OracleTrait {
    /// Verify a challenge/proof for a milestone.
    /// Returns true if the milestone is verified.
    fn verify_milestone(
        env: Env,
        job_id: String,
        milestone_index: u32,
        query: String,
        proof: Bytes,
    ) -> bool;
}

/// Helper struct stored on-chain to track oracle configuration per milestone.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MilestoneOracleConfig {
    pub oracle: Address,
    pub query: String,
}

/// Build the expected 32-byte verification hash for a milestone oracle query.
/// Off-chain verifiers must submit this hash as proof after validating the query.
pub fn compute_verification_hash(env: &Env, query: &String) -> BytesN<32> {
    let mut payload = Bytes::new(env);
    for byte in b"verified:".iter() {
        payload.push_back(*byte);
    }

    let query_len = query.len() as usize;
    if query_len > MAX_ORACLE_QUERY_LEN {
        panic!("Oracle query too long");
    }

    let mut query_buf = [0u8; MAX_ORACLE_QUERY_LEN];
    query.copy_into_slice(&mut query_buf[..query_len]);
    for byte in query_buf.iter().take(query_len) {
        payload.push_back(*byte);
    }

    env.crypto().sha256(&payload).into()
}

/// Validate that `proof` matches the challenge response for `query`.
pub fn verify_oracle_proof(env: &Env, query: &String, proof: &Bytes) -> bool {
    if proof.len() != 32 {
        return false;
    }

    let expected = compute_verification_hash(env, query);
    let Ok(proof_hash) = BytesN::<32>::try_from(proof.clone()) else {
        return false;
    };

    expected == proof_hash
}
