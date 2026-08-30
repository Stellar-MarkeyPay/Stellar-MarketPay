//! Rating storage records and arithmetic.

use soroban_sdk::{contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug)]
pub struct Rating {
    pub job_id: String,
    pub rater: Address,
    pub rated: Address,
    pub score_out_of_5: u32,
    pub submitted_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FreelancerRatingStats {
    pub total_score: u32,
    pub count: u32,
}
