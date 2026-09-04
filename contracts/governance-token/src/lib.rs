#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String,
};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AllowanceDataKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Decimals,
    Name,
    Symbol,
    TotalSupply,
    Balance(Address),
    Allowance(AllowanceDataKey),
    Delegate(Address),
    DelegatedVotes(Address),
}

#[contract]
pub struct GovernanceToken;

#[contractimpl]
impl GovernanceToken {
    /// Initialize the Governance Token (SEP-41 compliant with voting extensions).
    pub fn initialize(env: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);

        env.events().publish(
            (symbol_short!("init"), admin),
            (name, symbol, decimals),
        );
    }

    /// Admin can mint new governance tokens.
    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only admin can mint");
        }
        admin.require_auth();

        let current_bal = Self::read_balance(&env, &to);
        let new_bal = current_bal.checked_add(amount).expect("Balance overflow");
        env.storage().instance().set(&DataKey::Balance(to.clone()), &new_bal);

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        let new_supply = supply.checked_add(amount).expect("Supply overflow");
        env.storage().instance().set(&DataKey::TotalSupply, &new_supply);

        // Update delegated voting power if receiver delegated
        Self::update_delegated_power(&env, &to, amount, true);

        env.events().publish((symbol_short!("mint"), admin), (to, amount));
    }

    /// Set a new admin.
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if admin != stored_admin {
            panic!("Only current admin can transfer admin");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish((symbol_short!("set_adm"), admin), new_admin);
    }

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    // ─── SEP-41 Token Standard Methods ───────────────────────────────────────

    pub fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, &id)
    }

    pub fn spendable_balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, &id)
    }

    pub fn authorized(_env: Env, _id: Address) -> bool {
        true
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let key = DataKey::Allowance(AllowanceDataKey { from, spender });
        if let Some(val) = env.storage().instance().get::<_, AllowanceValue>(&key) {
            if val.expiration_ledger > env.ledger().sequence() {
                return val.amount;
            }
        }
        0
    }

    pub fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("Negative allowance amount");
        }
        let key = DataKey::Allowance(AllowanceDataKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let val = AllowanceValue {
            amount,
            expiration_ledger,
        };
        env.storage().instance().set(&key, &val);

        env.events()
            .publish((symbol_short!("approve"), from), (spender, amount));
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::do_transfer(&env, from, to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        let current_allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
        if current_allowance < amount {
            panic!("Insufficient allowance");
        }

        let key = DataKey::Allowance(AllowanceDataKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let val = env
            .storage()
            .instance()
            .get::<_, AllowanceValue>(&key)
            .expect("Allowance missing");
        let new_allowance = AllowanceValue {
            amount: current_allowance - amount,
            expiration_ledger: val.expiration_ledger,
        };
        env.storage().instance().set(&key, &new_allowance);

        Self::do_transfer(&env, from, to, amount);
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::do_burn(&env, from, amount);
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        let current_allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
        if current_allowance < amount {
            panic!("Insufficient allowance");
        }

        let key = DataKey::Allowance(AllowanceDataKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let val = env
            .storage()
            .instance()
            .get::<_, AllowanceValue>(&key)
            .expect("Allowance missing");
        let new_allowance = AllowanceValue {
            amount: current_allowance - amount,
            expiration_ledger: val.expiration_ledger,
        };
        env.storage().instance().set(&key, &new_allowance);

        Self::do_burn(&env, from, amount);
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "MarketPay Token"))
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "MPAY"))
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    // ─── DAO Voting & Delegation Extensions ──────────────────────────────────

    /// Delegate voting power to another address.
    pub fn delegate(env: Env, delegator: Address, delegatee: Address) {
        delegator.require_auth();
        let balance = Self::read_balance(&env, &delegator);

        // Remove power from previous delegate if exists
        if let Some(prev_delegate) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Delegate(delegator.clone()))
        {
            let prev_power: i128 = env
                .storage()
                .instance()
                .get(&DataKey::DelegatedVotes(prev_delegate.clone()))
                .unwrap_or(0);
            let new_power = prev_power.saturating_sub(balance);
            env.storage()
                .instance()
                .set(&DataKey::DelegatedVotes(prev_delegate), &new_power);
        }

        // Add power to new delegate
        let current_power: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DelegatedVotes(delegatee.clone()))
            .unwrap_or(0);
        let updated_power = current_power
            .checked_add(balance)
            .expect("Delegation overflow");
        env.storage()
            .instance()
            .set(&DataKey::DelegatedVotes(delegatee.clone()), &updated_power);
        env.storage()
            .instance()
            .set(&DataKey::Delegate(delegator.clone()), &delegatee);

        env.events()
            .publish((symbol_short!("delegate"), delegator), delegatee);
    }

    /// Undelegate voting power back to self.
    pub fn undelegate(env: Env, delegator: Address) {
        delegator.require_auth();
        let balance = Self::read_balance(&env, &delegator);

        if let Some(prev_delegate) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Delegate(delegator.clone()))
        {
            let prev_power: i128 = env
                .storage()
                .instance()
                .get(&DataKey::DelegatedVotes(prev_delegate.clone()))
                .unwrap_or(0);
            let new_power = prev_power.saturating_sub(balance);
            env.storage()
                .instance()
                .set(&DataKey::DelegatedVotes(prev_delegate), &new_power);
            env.storage()
                .instance()
                .remove(&DataKey::Delegate(delegator.clone()));
        }

        env.events()
            .publish((symbol_short!("undel"), delegator), balance);
    }

    /// Return the delegate for an account.
    pub fn get_delegate(env: Env, account: Address) -> Option<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Delegate(account))
    }

    /// Calculate the effective voting power for an account.
    /// If an account delegated its votes away, its personal balance is not counted for self.
    pub fn get_voting_power(env: Env, account: Address) -> i128 {
        let delegated_to_me: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DelegatedVotes(account.clone()))
            .unwrap_or(0);

        let has_delegated = env
            .storage()
            .instance()
            .has(&DataKey::Delegate(account.clone()));

        if has_delegated {
            delegated_to_me
        } else {
            let self_balance = Self::read_balance(&env, &account);
            self_balance
                .checked_add(delegated_to_me)
                .expect("Voting power overflow")
        }
    }

    // ─── Internal Helpers ───────────────────────────────────────────────────

    fn read_balance(env: &Env, id: &Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn update_delegated_power(env: &Env, account: &Address, amount: i128, is_addition: bool) {
        if let Some(target) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Delegate(account.clone()))
        {
            let current_power: i128 = env
                .storage()
                .instance()
                .get(&DataKey::DelegatedVotes(target.clone()))
                .unwrap_or(0);
            let updated = if is_addition {
                current_power.checked_add(amount).expect("Overflow")
            } else {
                current_power.saturating_sub(amount)
            };
            env.storage()
                .instance()
                .set(&DataKey::DelegatedVotes(target), &updated);
        }
    }

    fn do_transfer(env: &Env, from: Address, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        let from_bal = Self::read_balance(env, &from);
        if from_bal < amount {
            panic!("Insufficient balance");
        }

        let new_from = from_bal - amount;
        let to_bal = Self::read_balance(env, &to);
        let new_to = to_bal.checked_add(amount).expect("Balance overflow");

        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &new_from);
        env.storage()
            .instance()
            .set(&DataKey::Balance(to.clone()), &new_to);

        Self::update_delegated_power(env, &from, amount, false);
        Self::update_delegated_power(env, &to, amount, true);

        env.events()
            .publish((symbol_short!("transfer"), from), (to, amount));
    }

    fn do_burn(env: &Env, from: Address, amount: i128) {
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        let from_bal = Self::read_balance(env, &from);
        if from_bal < amount {
            panic!("Insufficient balance");
        }

        let new_from = from_bal - amount;
        env.storage()
            .instance()
            .set(&DataKey::Balance(from.clone()), &new_from);

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        let new_supply = supply.saturating_sub(amount);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        Self::update_delegated_power(env, &from, amount, false);

        env.events().publish((symbol_short!("burn"), from), amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize_and_metadata() {
        let env = Env::default();
        let contract_id = env.register(GovernanceToken, ());
        let client = GovernanceTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Token");
        let symbol = String::from_str(&env, "MPAY");
        client.initialize(&admin, &7, &name, &symbol);

        assert_eq!(client.name(), name);
        assert_eq!(client.symbol(), symbol);
        assert_eq!(client.decimals(), 7);
        assert_eq!(client.total_supply(), 0);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_mint_transfer_burn() {
        let env = Env::default();
        let contract_id = env.register(GovernanceToken, ());
        let client = GovernanceTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Token");
        let symbol = String::from_str(&env, "MPAY");
        client.initialize(&admin, &7, &name, &symbol);

        // Mint
        client.mint(&admin, &alice, &1000);
        assert_eq!(client.balance(&alice), 1000);
        assert_eq!(client.total_supply(), 1000);

        // Transfer
        client.transfer(&alice, &bob, &400);
        assert_eq!(client.balance(&alice), 600);
        assert_eq!(client.balance(&bob), 400);

        // Burn
        client.burn(&bob, &100);
        assert_eq!(client.balance(&bob), 300);
        assert_eq!(client.total_supply(), 900);
    }

    #[test]
    fn test_allowance_and_transfer_from() {
        let env = Env::default();
        let contract_id = env.register(GovernanceToken, ());
        let client = GovernanceTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Token");
        let symbol = String::from_str(&env, "MPAY");
        client.initialize(&admin, &7, &name, &symbol);

        client.mint(&admin, &alice, &1000);
        client.approve(&alice, &bob, &500, &1000);
        assert_eq!(client.allowance(&alice, &bob), 500);

        // Bob transfers from Alice to Charlie
        client.transfer_from(&bob, &alice, &charlie, &300);
        assert_eq!(client.balance(&alice), 700);
        assert_eq!(client.balance(&charlie), 300);
        assert_eq!(client.allowance(&alice, &bob), 200);
    }

    #[test]
    fn test_voting_delegation() {
        let env = Env::default();
        let contract_id = env.register(GovernanceToken, ());
        let client = GovernanceTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Token");
        let symbol = String::from_str(&env, "MPAY");
        client.initialize(&admin, &7, &name, &symbol);

        client.mint(&admin, &alice, &1000);
        client.mint(&admin, &bob, &500);

        // Initial voting power equals balances
        assert_eq!(client.get_voting_power(&alice), 1000);
        assert_eq!(client.get_voting_power(&bob), 500);

        // Alice delegates to Bob
        client.delegate(&alice, &bob);
        assert_eq!(client.get_delegate(&alice), Some(bob.clone()));
        assert_eq!(client.get_voting_power(&alice), 0);
        assert_eq!(client.get_voting_power(&bob), 1500);

        // Alice transfers some tokens to Bob
        client.transfer(&alice, &bob, &200);
        // Alice now has 800 (all delegated to Bob), Bob has 700 + 800 = 1500
        assert_eq!(client.get_voting_power(&bob), 1500);

        // Alice undelegates
        client.undelegate(&alice);
        assert_eq!(client.get_delegate(&alice), None);
        assert_eq!(client.get_voting_power(&alice), 800);
        assert_eq!(client.get_voting_power(&bob), 700);
    }

    #[test]
    #[should_panic(expected = "Only admin can mint")]
    fn test_unauthorized_mint_panics() {
        let env = Env::default();
        let contract_id = env.register(GovernanceToken, ());
        let client = GovernanceTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        env.mock_all_auths();

        let name = String::from_str(&env, "MarketPay Token");
        let symbol = String::from_str(&env, "MPAY");
        client.initialize(&admin, &7, &name, &symbol);

        client.mint(&attacker, &attacker, &10000);
    }
}
