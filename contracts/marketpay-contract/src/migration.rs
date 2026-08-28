//! Lazy, additive conversion from the preserved v1 escrow shape.

use soroban_sdk::{BytesN, Env, String, Vec};

use crate::escrow::{
    Escrow, EscrowStatus, EscrowV2, MigrationStatus, SettlementMode, ESCROW_SCHEMA_V2,
};
use crate::milestones::NamedMilestone;
use crate::state_machine::from_legacy;
use crate::DataKey;

pub fn from_v1(env: &Env, legacy: &Escrow) -> EscrowV2 {
    let mut milestones = Vec::new(env);
    let mut completed_amount = 0i128;
    for item in legacy.milestones.iter() {
        if item.is_completed {
            completed_amount = completed_amount
                .checked_add(item.amount)
                .expect("Migration accounting overflow");
        }
        milestones.push_back(NamedMilestone {
            name: String::from_str(env, "Legacy milestone"),
            acceptance_criteria_hash: BytesN::from_array(env, &[0; 32]),
            amount: item.amount,
            deadline_ledger: legacy.timeout_ledger,
            is_completed: item.is_completed,
        });
    }

    let (paid_to_freelancer, refunded_to_client) = match legacy.status {
        EscrowStatus::Released => (legacy.amount, 0),
        EscrowStatus::Refunded => (completed_amount, legacy.amount - completed_amount),
        EscrowStatus::Locked | EscrowStatus::InProgress | EscrowStatus::Disputed => {
            (completed_amount, 0)
        }
    };

    let migrated = EscrowV2 {
        schema_version: ESCROW_SCHEMA_V2,
        job_id: legacy.job_id.clone(),
        client: legacy.client.clone(),
        freelancer: legacy.freelancer.clone(),
        token: legacy.token.clone(),
        amount: legacy.amount,
        state: from_legacy(legacy.status.clone()),
        settlement_mode: SettlementMode::Discrete,
        paid_to_freelancer,
        paid_as_fees: 0,
        refunded_to_client,
        template_id: None,
        milestones,
        migrated_from_v1: true,
        v2_features_used: false,
    };
    migrated.assert_conservation();
    migrated
}

/// Load a v2 record, converting and backing up the legacy record on first
/// access. Repeated calls are read-only and return the same record.
pub fn load_or_migrate(env: &Env, job_id: &String) -> EscrowV2 {
    let v2_key = DataKey::EscrowV2(job_id.clone());
    if let Some(v2) = env.storage().instance().get::<_, EscrowV2>(&v2_key) {
        return v2;
    }

    let legacy: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");
    let migrated = from_v1(env, &legacy);
    env.storage()
        .instance()
        .set(&DataKey::MigrationBackup(job_id.clone()), &legacy);
    env.storage().instance().set(&v2_key, &migrated);
    env.storage().instance().set(
        &DataKey::V2MigrationStatus(job_id.clone()),
        &MigrationStatus::Migrated,
    );
    migrated
}

pub fn store(env: &Env, escrow: &EscrowV2) {
    escrow.assert_conservation();
    env.storage()
        .instance()
        .set(&DataKey::EscrowV2(escrow.job_id.clone()), escrow);
}
