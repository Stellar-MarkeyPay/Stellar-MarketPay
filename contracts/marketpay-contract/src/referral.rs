/*
 * contracts/marketpay-contract/src/referral.rs
 *
 * On-Chain Referral Tree with Multi-Level Rewards
 *
 * Design
 * ──────
 * Each registered user can have exactly ONE parent in the tree.
 * The parent/child relationship is recorded as:
 *
 *   DataKey::ReferralParent(child) → Address   (who referred this user)
 *   DataKey::ReferralDepth(user)  → u32        (depth from the root of the tree, root = 0)
 *   DataKey::ReferralChildren(parent) → Vec<Address>  (direct invitees)
 *
 * Reward distribution
 * ───────────────────
 * When a job escrow is released the referral bonus is distributed across
 * up to MAX_REFERRAL_DEPTH ancestors of the *freelancer*:
 *
 *   Level 1 (direct referrer)  : LEVEL1_BPS  = 200 bps  (2.00%)
 *   Level 2 (referrer's ref.)  : LEVEL2_BPS  =  75 bps  (0.75%)
 *   Level 3 (depth-3 ancestor) : LEVEL3_BPS  =  25 bps  (0.25%)
 *
 * Total maximum bonus = 3.00% of escrow amount.
 * The remaining 97% (or more, if some levels are missing) goes to the freelancer.
 *
 * Security
 * ────────
 *  1. Self-referral: `register_referral` panics if child == parent.
 *  2. Loop detection: before storing a new parent, we walk up the existing
 *     chain for MAX_REFERRAL_DEPTH + 1 steps.  If we encounter `child`
 *     anywhere in that chain the registration is rejected.
 *  3. One-parent rule: once a parent is registered it cannot be changed.
 *     This prevents late-claiming after a profitable address becomes active.
 *  4. Sybil resistance: `register_referral` requires the *child* to authorize
 *     the call, so an attacker cannot register fake children on behalf of
 *     real addresses without holding their signing key.
 *  5. Depth cap: the on-chain reward walk is bounded at MAX_REFERRAL_DEPTH
 *     iterations, preventing unbounded storage/gas usage in pathological trees.
 */

// `ReferralKey`'s variants deliberately share a `Referral` prefix; see the
// type's doc comment. The allow is module-level because the lint fires from
// inside the `#[contracttype]` expansion, where an item-level attribute does
// not reach it.
#![allow(clippy::enum_variant_names)]

use soroban_sdk::{contracttype, symbol_short, Address, Env, Vec};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Maximum depth of the referral tree we will walk when distributing rewards.
pub const MAX_REFERRAL_DEPTH: u32 = 3;

/// Basis points awarded to each ancestor level.
/// Index 0 = level 1 (direct referrer), index 2 = level 3.
pub const LEVEL_BPS: [i128; 3] = [200, 75, 25];

/// Denominator for basis-point calculations.
pub const BPS_DENOMINATOR: i128 = 10_000;

// ─── Storage keys ─────────────────────────────────────────────────────────────

/// Keyed by the *child* address — stores the parent (referrer) address.
///
/// The shared `Referral` prefix is what the module-level
/// `enum_variant_names` allow above is for: `#[contracttype]` derives the
/// on-chain encoding from these variant names, so renaming them changes the
/// storage key of every referral relationship already written to the ledger.
/// That is a migration, not a cleanup.
#[contracttype]
#[derive(Clone)]
pub enum ReferralKey {
    /// ReferralParent(child) → Address  (the user who invited `child`)
    ReferralParent(Address),
    /// ReferralChildren(parent) → Vec<Address>  (all direct invitees)
    ReferralChildren(Address),
    /// ReferralDepth(user) → u32  (0 for root nodes, 1 for their direct invitees, …)
    ReferralDepth(Address),
}

// ─── Structs ──────────────────────────────────────────────────────────────────

/// A single payout record returned by `calculate_tree_rewards`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ReferralReward {
    /// The ancestor address that earns this bonus.
    pub recipient: Address,
    /// Reward amount in token base units (stroops for XLM).
    pub amount: i128,
    /// Depth level (1 = direct, 2 = grand-referrer, 3 = great-grand).
    pub level: u32,
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/// Walk `MAX_REFERRAL_DEPTH + 1` steps up from `candidate_parent` to check
/// whether `child` already appears in the chain.
///
/// Returns `true` if a cycle would be introduced (reject the registration).
fn would_create_cycle(env: &Env, child: &Address, candidate_parent: &Address) -> bool {
    let mut cursor = candidate_parent.clone();
    for _ in 0..=MAX_REFERRAL_DEPTH {
        if &cursor == child {
            return true;
        }
        match env
            .storage()
            .instance()
            .get::<_, Address>(&ReferralKey::ReferralParent(cursor.clone()))
        {
            Some(parent) => cursor = parent,
            None => return false, // reached a root — no cycle
        }
    }
    // Reached depth cap without finding child — treat as no cycle
    false
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Register a parent→child referral relationship on-chain.
///
/// # Panics
/// - If `child == parent` (self-referral).
/// - If `child` already has a registered parent (one-parent rule).
/// - If registering this relationship would create a cycle in the tree.
///
/// # Auth
/// Requires `child.require_auth()` — the new user must sign their own
/// registration to prevent third-party Sybil attacks.
pub fn register_referral(env: &Env, parent: Address, child: Address) {
    // ── Security: self-referral check ────────────────────────────────────────
    if parent == child {
        panic!("Self-referral is not allowed");
    }

    // ── Security: require child's authorization ───────────────────────────────
    child.require_auth();

    // ── Security: one-parent rule ─────────────────────────────────────────────
    if env
        .storage()
        .instance()
        .has(&ReferralKey::ReferralParent(child.clone()))
    {
        panic!("Referral already registered for this address");
    }

    // ── Security: loop / cycle detection ──────────────────────────────────────
    if would_create_cycle(env, &child, &parent) {
        panic!("Registering this referral would create a cycle");
    }

    // ── Store parent pointer ───────────────────────────────────────────────────
    env.storage()
        .instance()
        .set(&ReferralKey::ReferralParent(child.clone()), &parent);

    // ── Store child in parent's children list ─────────────────────────────────
    let mut children: Vec<Address> = env
        .storage()
        .instance()
        .get(&ReferralKey::ReferralChildren(parent.clone()))
        .unwrap_or_else(|| Vec::new(env));
    children.push_back(child.clone());
    env.storage()
        .instance()
        .set(&ReferralKey::ReferralChildren(parent.clone()), &children);

    // ── Compute and store child's depth ───────────────────────────────────────
    let parent_depth: u32 = env
        .storage()
        .instance()
        .get(&ReferralKey::ReferralDepth(parent.clone()))
        .unwrap_or(0);
    let child_depth = parent_depth.saturating_add(1);
    env.storage()
        .instance()
        .set(&ReferralKey::ReferralDepth(child.clone()), &child_depth);

    // ── Emit event ────────────────────────────────────────────────────────────
    env.events().publish(
        (symbol_short!("ref_reg"), parent.clone()),
        (child.clone(), child_depth),
    );
}

/// Calculate the multi-level reward distribution for `release_amount` when
/// the payer is `freelancer`.
///
/// Returns a `Vec<ReferralReward>` with one entry per ancestor level that
/// exists in the tree (0–3 entries).  The caller is responsible for
/// performing the actual token transfers and computing the freelancer's
/// net amount.
///
/// # Returns
/// Vector of `ReferralReward` ordered from level 1 (direct) to level 3.
pub fn calculate_tree_rewards(
    env: &Env,
    freelancer: &Address,
    release_amount: i128,
) -> Vec<ReferralReward> {
    let mut rewards = Vec::new(env);

    let mut cursor = freelancer.clone();
    for level in 1..=MAX_REFERRAL_DEPTH {
        // Walk one step up the tree
        let parent = match env
            .storage()
            .instance()
            .get::<_, Address>(&ReferralKey::ReferralParent(cursor.clone()))
        {
            Some(p) => p,
            None => break, // reached the root — no more ancestors
        };

        let bps = LEVEL_BPS[(level - 1) as usize];
        let amount = release_amount
            .checked_mul(bps)
            .expect("Referral reward overflow")
            .checked_div(BPS_DENOMINATOR)
            .expect("Referral reward div error");

        if amount > 0 {
            rewards.push_back(ReferralReward {
                recipient: parent.clone(),
                amount,
                level,
            });
        }

        cursor = parent;
    }

    rewards
}

/// Distribute multi-level tree rewards, transferring tokens to each ancestor.
///
/// Returns the total bonus paid out (the freelancer receives
/// `release_amount - total_bonus`).
///
/// # Panics
/// Panics on arithmetic overflow (should never happen in practice because
/// release_amount is bounded by i128 and total_bps ≤ 300).
pub fn distribute_tree_rewards(
    env: &Env,
    token_client: &soroban_sdk::token::Client,
    freelancer: &Address,
    release_amount: i128,
    job_id: &soroban_sdk::String,
) -> i128 {
    let rewards = calculate_tree_rewards(env, freelancer, release_amount);
    let mut total_bonus: i128 = 0;

    for reward in rewards.iter() {
        if reward.amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &reward.recipient,
                &reward.amount,
            );

            env.events().publish(
                (symbol_short!("tree_bon"), reward.recipient.clone()),
                (job_id.clone(), reward.amount, reward.level),
            );

            total_bonus = total_bonus
                .checked_add(reward.amount)
                .expect("Total bonus overflow");
        }
    }

    total_bonus
}

/// Get the direct parent (referrer) of an address, if any.
pub fn get_parent(env: &Env, child: &Address) -> Option<Address> {
    env.storage()
        .instance()
        .get(&ReferralKey::ReferralParent(child.clone()))
}

/// Get the direct children (invitees) of an address.
pub fn get_children(env: &Env, parent: &Address) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&ReferralKey::ReferralChildren(parent.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

/// Get the depth of a user in the tree (0 = root, 1 = direct child of root, …).
pub fn get_depth(env: &Env, user: &Address) -> u32 {
    env.storage()
        .instance()
        .get(&ReferralKey::ReferralDepth(user.clone()))
        .unwrap_or(0)
}
