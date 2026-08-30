use marketpay_contract::{
    CreateEscrowParams, DataKey, EscrowStatus, LifecycleState, MarketPayContract,
    MarketPayContractClient, MigrationStatus, MilestoneTemplateItem,
};
use soroban_sdk::testutils::{Address as _, EnvTestConfig, Ledger};
use soroban_sdk::{token, Address, BytesN, Env, String, Vec};

struct Fixture<'a> {
    env: Env,
    contract: MarketPayContractClient<'a>,
    token: token::Client<'a>,
    admin: Address,
    client: Address,
    freelancer: Address,
    outsider: Address,
}

impl Fixture<'_> {
    fn new(funding: i128) -> Self {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        contract.initialize(&admin);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = sac.address();
        let token = token::Client::new(&env, &token_id);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        let client = Address::generate(&env);
        token_admin.mint(&client, &funding);
        Self {
            freelancer: Address::generate(&env),
            outsider: Address::generate(&env),
            env,
            contract,
            token,
            admin,
            client,
        }
    }

    fn params(&self, amount: i128) -> CreateEscrowParams {
        CreateEscrowParams {
            freelancer: self.freelancer.clone(),
            token: self.token.address.clone(),
            amount,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
            arbitrator: None,
        }
    }

    fn job(&self, value: &str) -> String {
        String::from_str(&self.env, value)
    }

    fn set_sequence(&self, sequence_number: u32) {
        let mut ledger = self.env.ledger().get();
        ledger.sequence_number = sequence_number;
        self.env.ledger().set(ledger);
    }

    fn item(&self, name: &str, amount: i128, offset: u32) -> MilestoneTemplateItem {
        MilestoneTemplateItem {
            name: String::from_str(&self.env, name),
            acceptance_criteria_hash: BytesN::from_array(&self.env, &[offset as u8; 32]),
            amount,
            deadline_offset_ledgers: offset,
        }
    }
}

#[test]
fn stream_many_partial_withdrawals_conserve_every_unit_without_dust() {
    let f = Fixture::new(101);
    let job = f.job("no-dust");
    let start = f.env.ledger().sequence();
    f.contract
        .create_streaming_escrow(&job, &f.client, &f.params(101), &start, &(start + 100));

    let mut withdrawn = 0i128;
    for elapsed in 1..=100 {
        f.set_sequence(start + elapsed);
        withdrawn += f.contract.withdraw_stream(&job, &f.freelancer);
    }

    assert_eq!(withdrawn, 101);
    assert_eq!(f.token.balance(&f.freelancer), 101);
    assert_eq!(f.token.balance(&f.contract.address), 0);
    let v2 = f.contract.get_escrow_v2(&job);
    assert_eq!(v2.state, LifecycleState::Released);
    assert_eq!(v2.liability(), 0);
    assert_eq!(f.contract.get_stream(&job).withdrawn, 101);
}

#[test]
fn pause_resume_and_cancel_settle_at_each_checkpoint() {
    let f = Fixture::new(100);
    let job = f.job("pause-resume-cancel");
    let start = f.env.ledger().sequence();
    f.contract
        .create_streaming_escrow(&job, &f.client, &f.params(100), &start, &(start + 100));

    f.set_sequence(start + 20);
    assert_eq!(f.contract.pause_stream(&job, &f.client), 20);
    f.set_sequence(start + 70);
    assert_eq!(f.contract.get_stream(&job).withdrawn, 20);

    f.contract.resume_stream(&job, &f.freelancer);
    f.set_sequence(start + 90);
    assert_eq!(f.contract.withdraw_stream(&job, &f.freelancer), 20);
    assert_eq!(f.contract.cancel_stream(&job, &f.client), 60);

    assert_eq!(f.token.balance(&f.freelancer), 40);
    assert_eq!(f.token.balance(&f.client), 60);
    assert_eq!(f.token.balance(&f.contract.address), 0);
    let v2 = f.contract.get_escrow_v2(&job);
    assert_eq!(v2.state, LifecycleState::Cancelled);
    assert_eq!(v2.paid_to_freelancer + v2.refunded_to_client, 100);
}

#[test]
fn cancelling_at_the_exact_endpoint_releases_instead_of_refunding() {
    let f = Fixture::new(17);
    let job = f.job("cancel-at-end");
    let start = f.env.ledger().sequence();
    f.contract
        .create_streaming_escrow(&job, &f.client, &f.params(17), &start, &(start + 7));

    f.set_sequence(start + 7);
    assert_eq!(f.contract.cancel_stream(&job, &f.client), 0);
    assert_eq!(f.token.balance(&f.freelancer), 17);
    assert_eq!(f.token.balance(&f.client), 0);
    assert_eq!(f.token.balance(&f.contract.address), 0);
    assert_eq!(
        f.contract.get_escrow_v2(&job).state,
        LifecycleState::Released
    );
}

#[test]
fn dispute_stops_stream_and_arbitration_settles_only_the_remainder() {
    let f = Fixture::new(100);
    let job = f.job("stream-dispute");
    let start = f.env.ledger().sequence();
    f.contract
        .create_streaming_escrow(&job, &f.client, &f.params(100), &start, &(start + 100));
    f.set_sequence(start + 25);
    f.contract.raise_dispute(&job, &f.freelancer);
    assert_eq!(f.token.balance(&f.freelancer), 25);
    assert_eq!(
        f.contract.get_escrow_v2(&job).state,
        LifecycleState::Disputed
    );

    f.set_sequence(start + 75);
    assert_eq!(f.contract.get_stream(&job).withdrawn, 25);
    assert!(f.contract.try_withdraw_stream(&job, &f.freelancer).is_err());

    let panel = [
        Address::generate(&f.env),
        Address::generate(&f.env),
        Address::generate(&f.env),
    ];
    for arbitrator in panel.iter() {
        f.contract.register_arbitrator(&f.admin, arbitrator);
    }
    let case_id = f.contract.open_arbitration(&job, &f.admin);
    for arbitrator in panel.iter() {
        f.contract.cast_arbitration_vote(&case_id, arbitrator, &50);
    }
    f.contract.resolve_arbitration(&case_id);

    let v2 = f.contract.get_escrow_v2(&job);
    assert_eq!(v2.state, LifecycleState::Released);
    assert_eq!(v2.liability(), 0);
    assert_eq!(v2.paid_to_freelancer, 63);
    assert_eq!(v2.refunded_to_client, 37);
    assert_eq!(f.token.balance(&f.contract.address), 0);
}

#[test]
fn reusable_template_can_be_amended_only_after_both_parties_authorise() {
    let f = Fixture::new(1_000);
    let template_id = f.job("standard-build");
    let mut items = Vec::new(&f.env);
    items.push_back(f.item("Design", 400, 10));
    items.push_back(f.item("Delivery", 600, 20));
    f.contract
        .create_milestone_template(&template_id, &f.client, &f.job("Standard build"), &items);

    let job = f.job("template-job");
    f.contract
        .create_escrow_from_template(&job, &f.client, &template_id, &f.params(1_000));
    f.contract.start_work(&job, &f.client);
    f.contract.partial_release(&job, &0, &f.client);

    let mut replacement = Vec::new(&f.env);
    replacement.push_back(f.item("Beta", 200, 10));
    replacement.push_back(f.item("Launch", 400, 20));
    f.contract
        .propose_milestone_amendment(&job, &f.client, &replacement);
    assert_eq!(f.contract.get_escrow_v2(&job).milestones.len(), 2);
    f.contract.approve_milestone_amendment(&job, &f.freelancer);
    let amended = f.contract.get_escrow_v2(&job);
    assert_eq!(amended.milestones.len(), 3);
    assert!(amended.milestones.get(0).unwrap().is_completed);

    f.contract.partial_release(&job, &1, &f.client);
    f.contract.partial_release(&job, &2, &f.client);
    let settled = f.contract.get_escrow_v2(&job);
    assert_eq!(settled.state, LifecycleState::Released);
    assert_eq!(settled.liability(), 0);
}

#[test]
fn lazy_v1_migration_settles_under_v2_and_pristine_migration_rolls_back() {
    let f = Fixture::new(2_000);
    let settled_job = f.job("legacy-settle");
    f.contract
        .create_escrow(&settled_job, &f.client, &f.params(1_000));
    // Soroban's unit environment cannot replace the executing WASM in-place,
    // so mirror the version write performed by `upgrade` after the v1-shaped
    // record exists. The pre-upgrade record is then first accessed by v2.
    f.env.as_contract(&f.contract.address, || {
        f.env.storage().instance().set(&DataKey::Version, &2u32);
    });
    assert_eq!(f.contract.get_version(), 2);
    let migrated = f.contract.get_escrow_v2(&settled_job);
    assert!(migrated.migrated_from_v1);
    assert_eq!(migrated.state, LifecycleState::Locked);
    f.contract.start_work(&settled_job, &f.client);
    f.contract.release_escrow(&settled_job, &f.client);
    let settled = f.contract.get_escrow_v2(&settled_job);
    assert_eq!(settled.state, LifecycleState::Released);
    assert_eq!(settled.liability(), 0);
    assert_eq!(
        f.contract.get_escrow(&settled_job).status,
        EscrowStatus::Released
    );

    let rollback_job = f.job("legacy-rollback");
    f.contract
        .create_escrow(&rollback_job, &f.client, &f.params(1_000));
    f.contract.migrate_escrow_v2(&rollback_job);
    f.contract.rollback_escrow_v2(&rollback_job, &f.admin);
    assert_eq!(
        f.contract.get_v2_migration_status(&rollback_job),
        Some(MigrationStatus::RolledBack)
    );
    assert_eq!(
        f.contract.get_escrow(&rollback_job).status,
        EscrowStatus::Locked
    );
}

#[test]
fn v2_state_changing_entrypoints_reject_wrong_roles() {
    let f = Fixture::new(300);
    let stream_job = f.job("auth-stream");
    let start = f.env.ledger().sequence();
    f.contract.create_streaming_escrow(
        &stream_job,
        &f.client,
        &f.params(100),
        &start,
        &(start + 100),
    );
    assert!(f
        .contract
        .try_withdraw_stream(&stream_job, &f.outsider)
        .is_err());
    assert!(f
        .contract
        .try_pause_stream(&stream_job, &f.outsider)
        .is_err());
    assert!(f
        .contract
        .try_resume_stream(&stream_job, &f.outsider)
        .is_err());
    assert!(f
        .contract
        .try_cancel_stream(&stream_job, &f.outsider)
        .is_err());
    assert!(f
        .contract
        .try_raise_dispute(&stream_job, &f.outsider)
        .is_err());

    let template_id = f.job("auth-template");
    let mut items = Vec::new(&f.env);
    items.push_back(f.item("Authorised item", 100, 10));
    f.contract.create_milestone_template(
        &template_id,
        &f.client,
        &f.job("Authorisation template"),
        &items,
    );
    let template_job = f.job("auth-template-job");
    f.contract
        .create_escrow_from_template(&template_job, &f.client, &template_id, &f.params(100));
    assert!(f
        .contract
        .try_propose_milestone_amendment(&template_job, &f.outsider, &items)
        .is_err());
    f.contract
        .propose_milestone_amendment(&template_job, &f.client, &items);
    assert!(f
        .contract
        .try_approve_milestone_amendment(&template_job, &f.outsider)
        .is_err());

    let legacy_job = f.job("auth-rollback");
    f.contract
        .create_escrow(&legacy_job, &f.client, &f.params(100));
    f.contract.migrate_escrow_v2(&legacy_job);
    assert!(f
        .contract
        .try_rollback_escrow_v2(&legacy_job, &f.outsider)
        .is_err());
}

#[test]
fn resource_matrix_covers_every_v2_entrypoint_and_the_template_upper_bound() {
    let f = Fixture::new(1_000);
    macro_rules! measure {
        ($name:literal, $expression:expr) => {{
            f.env.budget().reset_unlimited();
            f.env.budget().reset_tracker();
            let result = $expression;
            let cpu = f.env.budget().cpu_instruction_cost();
            let memory = f.env.budget().memory_bytes_cost();
            std::println!("RESOURCE,{},{},{}", $name, cpu, memory);
            assert!(cpu > 0, "{} did not execute", $name);
            result
        }};
    }

    let template_id = f.job("max-bound-template");
    let mut max_items = Vec::new(&f.env);
    for index in 1..=20 {
        max_items.push_back(f.item("Bounded item", 1, index));
    }
    measure!(
        "create_milestone_template",
        f.contract.create_milestone_template(
            &template_id,
            &f.client,
            &f.job("Max bound"),
            &max_items,
        )
    );
    measure!(
        "get_milestone_template",
        f.contract.get_milestone_template(&template_id)
    );

    let template_job = f.job("max-bound-job");
    measure!(
        "create_escrow_from_template",
        f.contract.create_escrow_from_template(
            &template_job,
            &f.client,
            &template_id,
            &f.params(20),
        )
    );
    measure!("get_escrow_v2", f.contract.get_escrow_v2(&template_job));

    let mut amendment = Vec::new(&f.env);
    for index in 1..=20 {
        amendment.push_back(f.item("Replacement", 1, index));
    }
    measure!(
        "propose_milestone_amendment",
        f.contract
            .propose_milestone_amendment(&template_job, &f.client, &amendment)
    );
    measure!(
        "get_milestone_amendment",
        f.contract.get_milestone_amendment(&template_job)
    );
    measure!(
        "approve_milestone_amendment",
        f.contract
            .approve_milestone_amendment(&template_job, &f.freelancer)
    );

    let stream_job = f.job("resource-stream");
    let start = f.env.ledger().sequence();
    measure!(
        "create_streaming_escrow",
        f.contract.create_streaming_escrow(
            &stream_job,
            &f.client,
            &f.params(100),
            &start,
            &(start + 100),
        )
    );
    f.set_sequence(start + 10);
    measure!(
        "withdraw_stream",
        f.contract.withdraw_stream(&stream_job, &f.freelancer)
    );
    measure!("get_stream", f.contract.get_stream(&stream_job));
    measure!(
        "pause_stream",
        f.contract.pause_stream(&stream_job, &f.client)
    );
    measure!(
        "resume_stream",
        f.contract.resume_stream(&stream_job, &f.freelancer)
    );
    f.set_sequence(start + 20);
    measure!(
        "cancel_stream",
        f.contract.cancel_stream(&stream_job, &f.client)
    );

    let legacy_job = f.job("resource-migration");
    f.contract
        .create_escrow(&legacy_job, &f.client, &f.params(50));
    measure!(
        "migrate_escrow_v2",
        f.contract.migrate_escrow_v2(&legacy_job)
    );
    measure!(
        "get_v2_migration_status",
        f.contract.get_v2_migration_status(&legacy_job)
    );
    measure!(
        "rollback_escrow_v2",
        f.contract.rollback_escrow_v2(&legacy_job, &f.admin)
    );

    // v1 comparison points for the lifecycle operations that have a v2
    // analogue. Unrelated legacy entrypoints are implementation-identical and
    // are listed as unchanged in the committed resource report.
    let baseline_release = f.job("baseline-release");
    measure!(
        "v1_create_escrow_plain",
        f.contract
            .create_escrow(&baseline_release, &f.client, &f.params(60))
    );
    measure!("v1_get_escrow", f.contract.get_escrow(&baseline_release));
    measure!(
        "v1_start_work",
        f.contract.start_work(&baseline_release, &f.client)
    );
    measure!(
        "v1_release_escrow",
        f.contract.release_escrow(&baseline_release, &f.client)
    );

    let baseline_refund = f.job("baseline-refund");
    f.contract
        .create_escrow(&baseline_refund, &f.client, &f.params(40));
    measure!(
        "v1_refund_escrow",
        f.contract.refund_escrow(&baseline_refund, &f.client)
    );

    let baseline_milestone = f.job("baseline-milestone");
    let mut legacy_amounts = Vec::new(&f.env);
    legacy_amounts.push_back(25);
    legacy_amounts.push_back(25);
    let mut legacy_params = f.params(50);
    legacy_params.milestones = Some(legacy_amounts);
    f.contract
        .create_escrow(&baseline_milestone, &f.client, &legacy_params);
    f.contract.start_work(&baseline_milestone, &f.client);
    measure!(
        "v1_partial_release",
        f.contract
            .partial_release(&baseline_milestone, &0, &f.client)
    );

    let baseline_dispute = f.job("baseline-dispute");
    f.contract
        .create_escrow(&baseline_dispute, &f.client, &f.params(30));
    f.contract.start_work(&baseline_dispute, &f.client);
    measure!(
        "v1_raise_dispute",
        f.contract.raise_dispute(&baseline_dispute, &f.client)
    );
}
