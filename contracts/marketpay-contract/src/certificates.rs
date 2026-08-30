//! Completion-certificate storage records.

use soroban_sdk::{contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug)]
pub struct Certificate {
    pub job_id: String,
    pub freelancer: Address,
    pub amount: i128,
    pub created_at: u32,
}
