//! Shared multisig role and threshold rules.

use soroban_sdk::Address;

pub const MULTISIG_THRESHOLD: u32 = 2;

pub fn require_signer(
    signer: &Address,
    client: &Address,
    freelancer: &Address,
    arbitrator: &Address,
) {
    if signer != client && signer != freelancer && signer != arbitrator {
        panic!("Signer must be the client, freelancer, or arbitrator");
    }
}

pub const fn threshold_reached(approvals: u32) -> bool {
    approvals >= MULTISIG_THRESHOLD
}
