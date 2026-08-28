//! Arbitration domain records. Contract entrypoints use these records through
//! this module rather than defining storage shapes in the façade.

use soroban_sdk::{contracttype, Address, String, Vec};

#[contracttype]
#[derive(Clone, Debug)]
pub struct ArbitrationCase {
    pub job_id: String,
    pub arbitrators: Vec<Address>,
    pub votes: Vec<u32>,
    pub voters: Vec<Address>,
    pub resolution: u32,
    pub status: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeCase {
    pub job_id: String,
    pub arbitrators: Vec<Address>,
    pub votes: Vec<u32>,
    pub voters: Vec<Address>,
    pub resolution: u32,
    pub status: u32,
}
