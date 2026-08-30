//! Shared scaffolding for the differential, fuzz and regression suites.
//!
//! Every test in `tests/` drives the real contract through the same small
//! adapter so that "what the contract did" is measured identically everywhere.
//! Without that, a differential test and a regression test can disagree about
//! what they observed and both be right, which makes a failure unreadable.

#![allow(dead_code)]

use marketpay_contract::{
    CreateEscrowParams, Escrow, EscrowStatus, MarketPayContract, MarketPayContractClient,
};
use marketpay_spec::state::{Party, Status};
use soroban_sdk::testutils::{Address as _, EnvTestConfig, Ledger};
use soroban_sdk::{token, Address, Env, String, Vec};

/// A contract instance plus every address the tests need to talk about.
pub struct Harness<'a> {
    pub env: Env,
    pub contract: MarketPayContractClient<'a>,
    pub token: token::Client<'a>,
    pub token_admin: token::StellarAssetClient<'a>,
    pub admin: Address,
    pub client: Address,
    pub freelancer: Address,
    pub arbitrator: Address,
    pub referrer: Address,
    pub oracle: Address,
    /// Synthetic address used when the specification needs a concrete caller
    /// for the abstract arbitration panel role.
    ///
    /// The panel is not a single address on-chain — `resolve_arbitration` is
    /// permissionless once three selected arbitrators have voted — but the
    /// fuzz and differential scaffolding still need an address-shaped value
    /// for "a caller that is none of the named escrow roles".
    pub panel: Address,
    pub outsider: Address,
}

impl Harness<'_> {
    /// Stand up an initialised contract with a funded client.
    ///
    /// `mock_all_auths` is on: these suites are about *which party the
    /// contract's own checks accept*, not about whether Soroban's signature
    /// verification works. Leaving real auth on would mean every unauthorised
    /// call failed in the host before reaching the contract logic under test,
    /// which would make the authorisation properties vacuous.
    pub fn new(funding: i128) -> Self {
        // `Env::default()` writes a ledger snapshot to `test_snapshots/` when it
        // drops. That is useful for a handful of hand-written example tests and
        // ruinous here: the fuzzer builds a fresh `Env` per round, so a 4 000
        // round campaign produced 4 000 files and 144 MB of JSON that nobody
        // reads and that must not reach the repository. These suites assert on
        // balances and statuses directly, so the snapshots carry no information
        // the tests do not already check.
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

        Harness {
            env,
            contract,
            token,
            token_admin,
            admin,
            client,
            freelancer: Address::generate(&env2(&sac)),
            arbitrator: Address::generate(&env2(&sac)),
            referrer: Address::generate(&env2(&sac)),
            oracle: Address::generate(&env2(&sac)),
            panel: Address::generate(&env2(&sac)),
            outsider: Address::generate(&env2(&sac)),
        }
    }

    pub fn address_of(&self, p: Party) -> Address {
        match p {
            Party::Client => self.client.clone(),
            Party::Freelancer => self.freelancer.clone(),
            Party::Arbitrator => self.arbitrator.clone(),
            Party::Referrer => self.referrer.clone(),
            Party::Admin => self.admin.clone(),
            Party::Oracle => self.oracle.clone(),
            Party::Panel => self.panel.clone(),
            Party::Outsider => self.outsider.clone(),
        }
    }

    pub fn job(&self, name: &str) -> String {
        String::from_str(&self.env, name)
    }

    /// Everything the contract still holds. The escrow's own balance is the
    /// contract's balance, since each test uses a fresh contract.
    pub fn held(&self) -> i128 {
        self.token.balance(&self.contract.address)
    }

    pub fn balance(&self, p: Party) -> i128 {
        self.token.balance(&self.address_of(p))
    }

    pub fn status(&self, job: &String) -> Option<Status> {
        self.try_escrow(job).map(|e| map_status(e.status))
    }

    pub fn try_escrow(&self, job: &String) -> Option<Escrow> {
        self.contract.try_get_escrow(job).ok().and_then(|r| r.ok())
    }

    /// Move the ledger clock past any plausible escrow timeout.
    ///
    /// Only the timestamp is pushed far: new escrows record a Unix-timestamp
    /// deadline and `timeout_refund` checks that first. The sequence number is
    /// nudged rather than jumped because the test host archives contract
    /// instances after enough ledgers, and an archived instance fails the call
    /// for a reason that has nothing to do with the property under test.
    pub fn advance_past_timeout(&self) {
        let mut info = self.env.ledger().get();
        info.timestamp += 30 * 24 * 60 * 60;
        info.sequence_number += 10;
        self.env.ledger().set(info);
    }

    /// Register three arbitrators so `open_arbitration` can seat a panel.
    pub fn seat_arbitration_panel(&self) -> [Address; 3] {
        let panel = [
            Address::generate(&self.env),
            Address::generate(&self.env),
            Address::generate(&self.env),
        ];
        for a in panel.iter() {
            self.contract.register_arbitrator(&self.admin, a);
        }
        panel
    }

    pub fn create_params(
        &self,
        amount: i128,
        milestones: Option<&[i128]>,
        with_arbitrator: bool,
        with_referrer: bool,
    ) -> CreateEscrowParams {
        let ms = milestones.map(|amounts| {
            let mut v = Vec::new(&self.env);
            for a in amounts {
                v.push_back(*a);
            }
            v
        });
        CreateEscrowParams {
            freelancer: self.freelancer.clone(),
            token: self.token.address.clone(),
            amount,
            milestones: ms,
            timeout_ledgers: None,
            referrer: if with_referrer {
                Some(self.referrer.clone())
            } else {
                None
            },
            arbitrator: if with_arbitrator {
                Some(self.arbitrator.clone())
            } else {
                None
            },
        }
    }
}

/// Borrow the env out of the registered asset contract so the address
/// generators above can run after `env` has been moved into the struct
/// literal's earlier fields.
fn env2(sac: &soroban_sdk::testutils::StellarAssetContract) -> Env {
    sac.address().env().clone()
}

pub fn map_status(s: EscrowStatus) -> Status {
    match s {
        EscrowStatus::Locked => Status::Locked,
        EscrowStatus::InProgress => Status::InProgress,
        EscrowStatus::Released => Status::Released,
        EscrowStatus::Refunded => Status::Refunded,
        EscrowStatus::Disputed => Status::Disputed,
    }
}
