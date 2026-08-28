//! Named, reusable milestone templates and two-party amendment records.

use soroban_sdk::{contracttype, Address, BytesN, Env, String, Vec};

pub const MAX_TEMPLATE_MILESTONES: u32 = 20;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneTemplateItem {
    pub name: String,
    pub acceptance_criteria_hash: BytesN<32>,
    pub amount: i128,
    /// Relative deadline used to make a template safely reusable. The
    /// instantiated snapshot stores an absolute ledger deadline.
    pub deadline_offset_ledgers: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneTemplate {
    pub template_id: String,
    pub owner: Address,
    pub name: String,
    pub items: Vec<MilestoneTemplateItem>,
    pub revision: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NamedMilestone {
    pub name: String,
    pub acceptance_criteria_hash: BytesN<32>,
    pub amount: i128,
    pub deadline_ledger: u32,
    pub is_completed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneAmendment {
    pub replacement_items: Vec<MilestoneTemplateItem>,
    pub client_approved: bool,
    pub freelancer_approved: bool,
    pub proposed_at_ledger: u32,
}

pub fn validate_items(items: &Vec<MilestoneTemplateItem>, expected_total: i128) {
    if items.is_empty() {
        panic!("Milestone template must contain at least one item");
    }
    if items.len() > MAX_TEMPLATE_MILESTONES {
        panic!("Milestone template exceeds maximum size");
    }

    let mut total = 0i128;
    for item in items.iter() {
        if item.name.is_empty() {
            panic!("Milestone name must not be empty");
        }
        if item.amount <= 0 {
            panic!("Milestone amount must be positive");
        }
        if item.deadline_offset_ledgers == 0 {
            panic!("Milestone deadline must be positive");
        }
        total = total
            .checked_add(item.amount)
            .expect("Milestone amount overflow");
    }
    if total != expected_total {
        panic!("Milestone amounts must equal the remaining escrow amount");
    }
}

pub fn instantiate(
    env: &Env,
    items: &Vec<MilestoneTemplateItem>,
    base_ledger: u32,
) -> Vec<NamedMilestone> {
    let mut result = Vec::new(env);
    for item in items.iter() {
        result.push_back(NamedMilestone {
            name: item.name,
            acceptance_criteria_hash: item.acceptance_criteria_hash,
            amount: item.amount,
            deadline_ledger: base_ledger
                .checked_add(item.deadline_offset_ledgers)
                .expect("Milestone deadline overflow"),
            is_completed: false,
        });
    }
    result
}
