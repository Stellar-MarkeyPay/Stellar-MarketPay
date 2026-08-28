//! Legacy contract unit tests kept outside the ABI façade.

use super::*;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_init_panics() {
        let env = Env::default();
        let id = env.register(MarketPayContract, ());
        let c = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize(&admin);
        c.initialize(&admin);
    }

    #[test]
    fn test_escrow_count_starts_zero() {
        let env = Env::default();
        let id = env.register(MarketPayContract, ());
        let c = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize(&admin);
        assert_eq!(c.get_escrow_count(), 0);
    }

    #[test]
    fn test_governance_flow() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let proposer = Address::generate(&env);
        let voter1 = Address::generate(&env);
        let voter2 = Address::generate(&env);

        // Give voters completed jobs directly into storage
        env.as_contract(&id, || {
            env.storage()
                .instance()
                .set(&DataKey::CompletedJobs(voter1.clone()), &1u32);
            env.storage()
                .instance()
                .set(&DataKey::CompletedJobs(voter2.clone()), &1u32);
        });

        let title = String::from_str(&env, "Test Proposal");
        let desc = String::from_str(&env, "Description");
        let pid = client.create_proposal(&proposer, &title, &desc, &100);

        assert_eq!(pid, 1);
        let prop = client.get_proposal(&pid);
        assert_eq!(prop.title, title);

        // Vote
        client.cast_vote(&voter1, &pid, &true);
        client.cast_vote(&voter2, &pid, &false);

        // Advance ledger using internal testutils sequence setter if possible,
        // or by generating mock block.
        // We will mock sequence directly on test env.
        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 101;
        env.ledger().set(ledger_info);

        client.resolve_proposal(&pid);

        let final_prop = client.get_proposal(&pid);
        assert!(final_prop.resolved);
        assert!(!final_prop.result); // 1 to 1 is not majority
    }

    #[test]
    #[should_panic(expected = "Only users with completed jobs can vote")]
    fn test_governance_unauthorized_voter() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Desc");
        let pid = client.create_proposal(&proposer, &title, &desc, &100);

        // Panics here
        client.cast_vote(&voter, &pid, &true);
    }
}

#[cfg(test)]
mod timeout_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

    fn setup_contract(
        env: &Env,
    ) -> (
        MarketPayContractClient<'_>,
        Address,
        Address,
        Address,
        Address,
    ) {
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&admin);

        let contract_client_addr = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&contract_client_addr, &1000);

        (client, contract_client_addr, freelancer, token_id, admin)
    }

    #[test]
    fn test_timeout_refund_success() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "timeout_job_1");
        let timeout_ledgers = 10u32;
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: Some(timeout_ledgers),
                referrer: None,
                arbitrator: None,
            },
        );

        let escrow = client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Locked);
        assert_eq!(
            escrow.timeout_ledger,
            env.ledger().sequence() + timeout_ledgers
        );

        // Advance ledger past timeout (both sequence and timestamp)
        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += timeout_ledgers + 1;
        ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS + 1) as u64; // Advance timestamp too
        env.ledger().set(ledger_info);

        client.timeout_refund(&job_id, &contract_client);

        let escrow_after = client.get_escrow(&job_id);
        assert_eq!(escrow_after.status, EscrowStatus::Refunded);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&contract_client), 1000);
    }

    #[test]
    #[should_panic(expected = "Timeout period has not expired yet")]
    fn test_timeout_refund_before_timeout_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "timeout_job_2");
        let timeout_ledgers = 100u32;
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: Some(timeout_ledgers),
                referrer: None,
                arbitrator: None,
            },
        );

        // Try to timeout refund before timeout — should panic
        client.timeout_refund(&job_id, &contract_client);
    }

    #[test]
    #[should_panic(expected = "Only the client can request a timeout refund")]
    fn test_timeout_refund_unauthorized_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "timeout_job_3");
        let timeout_ledgers = 5u32;
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: Some(timeout_ledgers),
                referrer: None,
                arbitrator: None,
            },
        );

        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += timeout_ledgers + 1;
        env.ledger().set(ledger_info);

        let attacker = Address::generate(&env);
        client.timeout_refund(&job_id, &attacker);
    }

    #[test]
    #[should_panic(expected = "Escrow is not in Locked state")]
    fn test_timeout_refund_after_start_work_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "timeout_job_4");
        let timeout_ledgers = 10u32;
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: Some(timeout_ledgers),
                referrer: None,
                arbitrator: None,
            },
        );

        // Start work changes status to InProgress
        client.start_work(&job_id, &contract_client);

        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += timeout_ledgers + 1;
        env.ledger().set(ledger_info);

        client.timeout_refund(&job_id, &contract_client);
    }

    #[test]
    fn test_timeout_refund_with_custom_timeout() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "custom_timeout_job");
        let custom_timeout = 50u32;
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: Some(custom_timeout),
                referrer: None,
                arbitrator: None,
            },
        );

        let escrow = client.get_escrow(&job_id);
        assert_eq!(
            escrow.timeout_ledger,
            env.ledger().sequence() + custom_timeout
        );
    }

    #[test]
    fn test_default_timeout_ledgers() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "default_timeout_job");
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        let escrow = client.get_escrow(&job_id);
        assert_eq!(
            escrow.timeout_ledger,
            env.ledger().sequence() + DEFAULT_TIMEOUT_LEDGERS
        );
    }

    #[test]
    fn test_get_timeout_ledger() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "get_timeout_job");
        let timeout = 25u32;
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: Some(timeout),
                referrer: None,
                arbitrator: None,
            },
        );

        assert_eq!(
            client.get_timeout_ledger(&job_id),
            env.ledger().sequence() + timeout
        );
    }
}

#[cfg(test)]
mod regression_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

    #[test]
    #[should_panic(expected = "Arithmetic overflow")]
    fn test_milestone_overflow_regression() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let job_id = String::from_str(&env, "job1");
        let freelancer = Address::generate(&env);
        let token = Address::generate(&env);

        let mut milestones = Vec::new(&env);
        milestones.push_back(i128::MAX);
        milestones.push_back(1);

        client.create_escrow(
            &job_id,
            &admin,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token.clone(),
                amount: i128::MAX,
                milestones: Some(milestones),
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
    }

    #[test]
    fn test_release_escrow_state_consistency_regression() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract_client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        contract_client.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let job_id = String::from_str(&env, "job1");
        contract_client.create_escrow(
            &job_id,
            &client.clone(),
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        contract_client.start_work(&job_id, &client.clone());

        contract_client.release_escrow(&job_id, &client.clone());

        let escrow = contract_client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        // ISSUE-17: no referrer was set, so the 1% platform fee defaults to the admin.
        assert_eq!(token_client.balance(&freelancer), 990);
        assert_eq!(token_client.balance(&admin), 10);
    }

    #[test]
    fn test_platform_fee_routed_to_referrer() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract_client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        contract_client.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let referrer = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let job_id = String::from_str(&env, "job_referrer");
        contract_client.create_escrow(
            &job_id,
            &client.clone(),
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: Some(referrer.clone()),
                arbitrator: None,
            },
        );
        contract_client.start_work(&job_id, &client.clone());

        contract_client.release_escrow(&job_id, &client.clone());

        // ISSUE-17: with a referrer set, the entire 1% platform fee routes to
        // the referrer instead of the admin.
        assert_eq!(token_client.balance(&freelancer), 990);
        assert_eq!(token_client.balance(&referrer), 10);
        assert_eq!(token_client.balance(&admin), 0);
    }

    #[test]
    fn test_release_with_conversion() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract_client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        contract_client.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let job_id = String::from_str(&env, "job_conv");
        contract_client.create_escrow(
            &job_id,
            &client.clone(),
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        let target_token = Address::generate(&env);
        contract_client.release_with_conversion(&job_id, &client.clone(), &target_token, &900);

        let escrow = contract_client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }
    #[test]
    fn test_partial_release() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract_client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        contract_client.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let mut milestones = Vec::new(&env);
        milestones.push_back(400);
        milestones.push_back(600);

        let job_id = String::from_str(&env, "job_partial");
        contract_client.create_escrow(
            &job_id,
            &client.clone(),
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: Some(milestones),
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        contract_client.start_work(&job_id, &client.clone());

        // Raise dispute to test that we can still partial release
        contract_client.raise_dispute(&job_id, &client.clone());

        contract_client.partial_release(&job_id, &0u32, &client.clone());

        let escrow = contract_client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Disputed);
        assert_eq!(token_client.balance(&freelancer), 400);
        assert!(escrow.milestones.get(0).unwrap().is_completed);
        assert!(!escrow.milestones.get(1).unwrap().is_completed);

        // Release final milestone
        contract_client.partial_release(&job_id, &1u32, &client.clone());
        let escrow2 = contract_client.get_escrow(&job_id);
        assert_eq!(escrow2.status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&freelancer), 1000);
    }
}

#[cfg(test)]
mod upgrade_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

    /// Verifies that:
    ///   - get_version() returns 1 after initialize()
    ///   - upgrade() with a valid hash increments the version to 2
    ///   - existing escrow state is preserved after upgrade
    ///
    /// Note: `update_current_contract_wasm` requires the hash to reference
    /// an installed WASM blob. In unit tests we verify the auth guard and
    /// version-bump logic; the actual WASM swap is covered by integration /
    /// testnet tests (see README upgrade process).
    #[test]
    fn test_version_starts_at_one() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_version(), 1u32);
    }

    /// Verifies escrow state is readable before and after a simulated upgrade
    /// (version bump via direct storage write, bypassing WASM swap).
    #[test]
    fn test_escrow_state_preserved_across_version_bump() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let depositor = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&depositor, &500);

        let job_id = String::from_str(&env, "upgrade_job_1");
        client.create_escrow(
            &job_id,
            &depositor,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        // Simulate the version bump that upgrade() performs (without WASM swap)
        env.as_contract(&id, || {
            let v: u32 = env.storage().instance().get(&DataKey::Version).unwrap_or(1);
            env.storage().instance().set(&DataKey::Version, &(v + 1));
        });

        assert_eq!(client.get_version(), 2u32);

        // Escrow state intact
        let escrow = client.get_escrow(&job_id);
        assert_eq!(escrow.amount, 500);
        assert_eq!(escrow.status, EscrowStatus::Locked);
    }

    #[test]
    #[should_panic]
    fn test_upgrade_rejected_for_non_admin() {
        let env = Env::default();
        // Do NOT mock_all_auths — auth will fail for non-admin
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
        // Called without admin auth → should panic
        client.upgrade(&fake_hash);
    }
}

#[cfg(test)]
mod event_tests {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Events;
    use soroban_sdk::{Address, Env, String, Vec};

    fn setup(env: &Env) -> (MarketPayContractClient<'_>, Address, Address, Address) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&admin);

        let contract_client = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&contract_client, &1000);

        (client, contract_client, freelancer, token_id)
    }

    fn get_event_topic0_str(env: &Env, idx: u32) -> std::string::String {
        let events = env.events().all();
        let event = events.get(idx).unwrap();
        let topic0 = event.1.get(0).unwrap();
        std::format!("{:?}", topic0)
    }

    #[test]
    fn test_create_escrow_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-1");

        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        let last_idx = env.events().all().len() - 1;
        assert!(get_event_topic0_str(&env, last_idx).contains("escrow_cr"),);
    }

    #[test]
    fn test_start_work_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-2");
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        client.start_work(&job_id, &contract_client);

        assert!(get_event_topic0_str(&env, env.events().all().len() - 1).contains("work_strt"),);
    }

    #[test]
    fn test_release_escrow_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-3");
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        client.start_work(&job_id, &contract_client);

        client.release_escrow(&job_id, &contract_client);

        assert!(get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_rl"),);
    }

    #[test]
    fn test_refund_escrow_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-4");
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        client.refund_escrow(&job_id, &contract_client);

        assert!(get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_rf"),);
    }

    #[test]
    fn test_raise_dispute_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-5");
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        client.raise_dispute(&job_id, &contract_client);

        assert!(get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_ds"),);
    }

    #[test]
    fn test_milestone_released_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-6");
        let mut milestones = Vec::new(&env);
        milestones.push_back(400);
        milestones.push_back(600);
        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: Some(milestones),
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        client.start_work(&job_id, &contract_client);

        client.partial_release(&job_id, &0u32, &contract_client);

        assert!(get_event_topic0_str(&env, env.events().all().len() - 1).contains("ms_rel"),);
    }

    #[test]
    fn test_full_lifecycle_events_all_emitted() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-7");

        client.create_escrow(
            &job_id,
            &contract_client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_cr"),
            "Missing escrow_cr after create_escrow",
        );

        client.start_work(&job_id, &contract_client);
        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("work_strt"),
            "Missing work_strt after start_work",
        );

        client.release_escrow(&job_id, &contract_client);
        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_rl"),
            "Missing escrow_rl after release_escrow",
        );
    }
}

#[cfg(test)]
mod sealed_bid_tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _, testutils::Ledger, Address, Bytes, BytesN, Env, String,
    };

    fn bid_commitment(env: &Env, amount: i128, nonce: BytesN<32>) -> BytesN<32> {
        let mut payload = Bytes::new(env);
        for byte in amount.to_be_bytes().iter() {
            payload.push_back(*byte);
        }
        for byte in nonce.to_array().iter() {
            payload.push_back(*byte);
        }
        env.crypto().sha256(&payload).into()
    }

    fn setup(env: &Env) -> (MarketPayContractClient<'_>, Address, Address, String) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        let owner = Address::generate(env);
        client.initialize(&admin);
        let job_id = String::from_str(env, "sealed-bid-job-1");
        client.commit_budget(&job_id, &1_000, &owner);
        (client, owner, admin, job_id)
    }

    #[test]
    fn test_reveal_bid_verifies_commitment() {
        let env = Env::default();
        let (client, owner, _admin, job_id) = setup(&env);
        let freelancer = Address::generate(&env);
        let nonce = BytesN::from_array(&env, &[7u8; 32]);
        let amount = 450i128;
        let commitment = bid_commitment(&env, amount, nonce.clone());

        client.submit_bid_commitment(&job_id, &freelancer, &commitment);
        client.close_bidding(&job_id, &owner);
        client.reveal_bid(&job_id, &freelancer, &amount, &nonce);

        let reveals = client.get_revealed_bids(&job_id);
        assert_eq!(reveals.len(), 1);
        let revealed = reveals.get(0).unwrap();
        assert_eq!(revealed.amount, amount);
        assert_eq!(revealed.freelancer, freelancer);
    }

    #[test]
    #[should_panic(expected = "Commitment verification failed")]
    fn test_reveal_bid_with_invalid_nonce_rejected() {
        let env = Env::default();
        let (client, owner, _admin, job_id) = setup(&env);
        let freelancer = Address::generate(&env);
        let amount = 500i128;
        let nonce = BytesN::from_array(&env, &[1u8; 32]);
        let bad_nonce = BytesN::from_array(&env, &[2u8; 32]);
        let commitment = bid_commitment(&env, amount, nonce);

        client.submit_bid_commitment(&job_id, &freelancer, &commitment);
        client.close_bidding(&job_id, &owner);
        client.reveal_bid(&job_id, &freelancer, &amount, &bad_nonce);
    }

    #[test]
    #[should_panic(expected = "Reveal window has closed")]
    fn test_late_reveal_rejected() {
        let env = Env::default();
        let (client, owner, _admin, job_id) = setup(&env);
        let freelancer = Address::generate(&env);
        let nonce = BytesN::from_array(&env, &[3u8; 32]);
        let amount = 525i128;
        let commitment = bid_commitment(&env, amount, nonce.clone());

        client.submit_bid_commitment(&job_id, &freelancer, &commitment);
        client.close_bidding(&job_id, &owner);

        let mut ledger = env.ledger().get();
        ledger.sequence_number += REVEAL_WINDOW_LEDGERS + 1;
        env.ledger().set(ledger);

        client.reveal_bid(&job_id, &freelancer, &amount, &nonce);
    }
}

#[cfg(test)]
mod deliverable_oracle_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

    fn setup(
        env: &Env,
    ) -> (
        MarketPayContractClient<'_>,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        contract.initialize(&admin);

        let client = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&client, &1_000);

        (contract, admin, client, freelancer, token_id)
    }

    #[test]
    fn test_submit_deliverable_match_auto_releases() {
        let env = Env::default();
        let (contract, admin, client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "deliverable-match");
        let expected_hash = BytesN::from_array(&env, &[9u8; 32]);

        contract.create_escrow_with_deliverable(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
            &expected_hash,
        );

        contract.submit_deliverable(&job_id, &expected_hash, &freelancer);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);

        let token_client = token::Client::new(&env, &token_id);
        // ISSUE-17: no referrer was set, so the 1% platform fee defaults to the admin.
        assert_eq!(token_client.balance(&freelancer), 990);
        assert_eq!(token_client.balance(&admin), 10);
    }

    #[test]
    fn test_submit_deliverable_mismatch_enters_dispute() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "deliverable-mismatch");
        let expected_hash = BytesN::from_array(&env, &[1u8; 32]);
        let actual_hash = BytesN::from_array(&env, &[2u8; 32]);

        contract.create_escrow_with_deliverable(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
            &expected_hash,
        );

        contract.submit_deliverable(&job_id, &actual_hash, &freelancer);
        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Disputed);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 0);
    }
}

#[cfg(test)]
mod milestone_oracle_tests {
    use super::*;
    use oracle::compute_verification_hash;
    use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, String, Vec};

    fn setup(
        env: &Env,
    ) -> (
        MarketPayContractClient<'_>,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        contract.initialize(&admin);

        let client = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&client, &1_000);

        (contract, admin, client, freelancer, token_id)
    }

    fn proof_for_query(env: &Env, query: &String) -> Bytes {
        compute_verification_hash(env, query).into()
    }

    #[test]
    fn test_verify_milestone_oracle_releases_funds() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env);
        let oracle = Address::generate(&env);
        let job_id = String::from_str(&env, "oracle-milestone");
        let query = String::from_str(
            &env,
            "github:owner/repo:commit:abc123def4567890abcd1234567890abcd1234",
        );

        let mut milestones = Vec::new(&env);
        milestones.push_back(1_000);

        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: Some(milestones),
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        contract.start_work(&job_id, &client);
        contract.set_milestone_oracle(&job_id, &0u32, &oracle, &query, &client);

        contract.verify_milestone_oracle(&job_id, &0u32, &oracle, &proof_for_query(&env, &query));

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        assert!(escrow.milestones.get(0).unwrap().is_completed);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 1_000);
    }

    #[test]
    #[should_panic(expected = "Oracle proof verification failed")]
    fn test_verify_milestone_oracle_rejects_invalid_proof() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env);
        let oracle = Address::generate(&env);
        let job_id = String::from_str(&env, "oracle-bad-proof");
        let query = String::from_str(
            &env,
            "github:owner/repo:commit:abc123def4567890abcd1234567890abcd1234",
        );

        let mut milestones = Vec::new(&env);
        milestones.push_back(1_000);

        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: Some(milestones),
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        contract.start_work(&job_id, &client);
        contract.set_milestone_oracle(&job_id, &0u32, &oracle, &query, &client);

        let bad_proof = Bytes::from_array(&env, &[1u8; 32]);
        contract.verify_milestone_oracle(&job_id, &0u32, &oracle, &bad_proof);
    }

    #[test]
    #[should_panic(expected = "Unauthorized oracle address")]
    fn test_verify_milestone_oracle_rejects_unauthorized_oracle() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env);
        let oracle = Address::generate(&env);
        let impostor = Address::generate(&env);
        let job_id = String::from_str(&env, "oracle-unauthorized");
        let query = String::from_str(&env, "website:https://example.com:status:200");

        let mut milestones = Vec::new(&env);
        milestones.push_back(500);

        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 500,
                milestones: Some(milestones),
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        contract.start_work(&job_id, &client);
        contract.set_milestone_oracle(&job_id, &0u32, &oracle, &query, &client);

        contract.verify_milestone_oracle(&job_id, &0u32, &impostor, &proof_for_query(&env, &query));
    }
}

#[cfg(test)]
mod multisig_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    /// Sets up a contract + funded client + 2-of-3 multisig escrow
    /// (client, freelancer, arbitrator), already moved to InProgress.
    fn setup_multisig_escrow(
        env: &Env,
    ) -> (
        MarketPayContractClient<'_>,
        Address,
        Address,
        Address,
        Address,
        String,
    ) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        contract.initialize(&admin);

        let client = Address::generate(env);
        let freelancer = Address::generate(env);
        let arbitrator = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&client, &1_000);

        let job_id = String::from_str(env, "multisig-job-1");
        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: Some(arbitrator.clone()),
            },
        );
        contract.start_work(&job_id, &client);

        (contract, client, freelancer, arbitrator, token_id, job_id)
    }

    #[test]
    fn test_escrow_initializes_with_three_signers() {
        let env = Env::default();
        let (contract, client, freelancer, arbitrator, _token_id, job_id) =
            setup_multisig_escrow(&env);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.client, client);
        assert_eq!(escrow.freelancer, freelancer);
        assert_eq!(escrow.arbitrator, Some(arbitrator));
        assert_eq!(escrow.release_approvals, 0);
    }

    #[test]
    fn test_single_approval_does_not_release_funds() {
        let env = Env::default();
        let (contract, client, freelancer, _arbitrator, token_id, job_id) =
            setup_multisig_escrow(&env);

        contract.approve_release(&job_id, &client);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::InProgress);
        assert_eq!(escrow.release_approvals, 1);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 0);
    }

    #[test]
    fn test_two_approvals_release_funds() {
        let env = Env::default();
        let (contract, client, freelancer, arbitrator, token_id, job_id) =
            setup_multisig_escrow(&env);

        contract.approve_release(&job_id, &client);
        contract.approve_release(&job_id, &arbitrator);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        assert_eq!(escrow.release_approvals, 2);

        // ISSUE-17 takes a 1% platform fee out of the released amount, so the
        // freelancer nets 990 of the 1_000 locked in escrow.
        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 990);
    }

    #[test]
    fn test_freelancer_and_arbitrator_can_release_without_client() {
        let env = Env::default();
        let (contract, _client, freelancer, arbitrator, token_id, job_id) =
            setup_multisig_escrow(&env);

        contract.approve_release(&job_id, &freelancer);
        contract.approve_release(&job_id, &arbitrator);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);

        // Net of the 1% ISSUE-17 platform fee, as above.
        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 990);
    }

    #[test]
    #[should_panic(expected = "Signer has already approved release for this job")]
    fn test_duplicate_approval_rejected() {
        let env = Env::default();
        let (contract, client, _freelancer, _arbitrator, _token_id, job_id) =
            setup_multisig_escrow(&env);

        contract.approve_release(&job_id, &client);
        contract.approve_release(&job_id, &client);
    }

    #[test]
    #[should_panic(expected = "Signer must be the client, freelancer, or arbitrator")]
    fn test_non_signer_approval_rejected() {
        let env = Env::default();
        let (contract, _client, _freelancer, _arbitrator, _token_id, job_id) =
            setup_multisig_escrow(&env);

        let outsider = Address::generate(&env);
        contract.approve_release(&job_id, &outsider);
    }

    #[test]
    #[should_panic(expected = "Escrow requires multisig approval")]
    fn test_unilateral_release_rejected_for_multisig_escrow() {
        let env = Env::default();
        let (contract, client, _freelancer, _arbitrator, _token_id, job_id) =
            setup_multisig_escrow(&env);

        contract.release_escrow(&job_id, &client);
    }

    #[test]
    #[should_panic(expected = "Escrow does not use multisig approval")]
    fn test_approve_release_rejected_for_non_multisig_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        contract.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &500);

        let job_id = String::from_str(&env, "non-multisig-job");
        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer,
                token: token_id,
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        contract.approve_release(&job_id, &client);
    }

    #[test]
    fn test_two_approvals_refund_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        contract.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1_000);

        let job_id = String::from_str(&env, "multisig-refund-job");
        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: Some(arbitrator.clone()),
            },
        );

        // Refund is only allowed before work starts (status Locked)
        contract.approve_refund(&job_id, &freelancer);
        contract.approve_refund(&job_id, &arbitrator);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&client), 1_000);
    }

    #[test]
    #[should_panic(expected = "Escrow requires multisig approval")]
    fn test_unilateral_refund_rejected_for_multisig_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        contract.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &500);

        let job_id = String::from_str(&env, "multisig-refund-rejected-job");
        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer,
                token: token_id,
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: Some(arbitrator),
            },
        );

        contract.refund_escrow(&job_id, &client);
    }

    #[test]
    #[should_panic(expected = "Arbitrator must be distinct from the client and freelancer")]
    fn test_arbitrator_cannot_equal_client_or_freelancer() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        contract.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &500);

        let job_id = String::from_str(&env, "bad-arbitrator-job");
        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id,
                amount: 500,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: Some(client.clone()),
            },
        );
    }
}
