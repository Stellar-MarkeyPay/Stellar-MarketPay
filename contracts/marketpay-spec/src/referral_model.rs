//! The multi-level referral bonus, as specified.
//!
//! `src/referral.rs` in the contract walks up to three ancestors of the
//! freelancer and pays each a share of the release. The model needs the same
//! arithmetic, but stated over "how many ancestors exist" rather than over a
//! storage-backed tree, because the tree's *shape* is irrelevant to value
//! conservation — only the total that leaves the contract matters.

/// Basis points paid to each ancestor level. Mirrors `LEVEL_BPS` in
/// `src/referral.rs`: level 1 (direct referrer) through level 3.
pub const LEVEL_BPS: [i128; 3] = [200, 75, 25];

/// Mirrors `BPS_DENOMINATOR` in `src/referral.rs`.
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Mirrors `MAX_REFERRAL_DEPTH`.
pub const MAX_REFERRAL_DEPTH: usize = 3;

/// The bonus owed to a single ancestor level, truncating as the contract does.
pub fn level_bonus(release_amount: i128, level: usize) -> i128 {
    if level == 0 || level > MAX_REFERRAL_DEPTH {
        return 0;
    }
    release_amount
        .checked_mul(LEVEL_BPS[level - 1])
        .expect("referral bonus overflow")
        / BPS_DENOMINATOR
}

/// Total bonus across every ancestor level that exists.
///
/// `depth` is how many ancestors the freelancer actually has, capped at
/// [`MAX_REFERRAL_DEPTH`]. Levels beyond the freelancer's real ancestry pay
/// nothing, which is why a shallow tree leaves more for the freelancer rather
/// than paying a phantom recipient.
pub fn tree_bonus_total_at_depth(release_amount: i128, depth: usize) -> i128 {
    let capped = depth.min(MAX_REFERRAL_DEPTH);
    let mut total = 0i128;
    let mut level = 1usize;
    while level <= capped {
        total += level_bonus(release_amount, level);
        level += 1;
    }
    total
}

/// Total bonus for a freelancer registered in the tree at full depth.
///
/// The model treats "in the referral tree" as the worst case for the
/// freelancer — all three levels populated, 3.00% total — because that is the
/// largest amount that can leave the contract on this path, and value
/// conservation has to hold at the extreme, not at the average.
pub fn tree_bonus_total(release_amount: i128) -> i128 {
    tree_bonus_total_at_depth(release_amount, MAX_REFERRAL_DEPTH)
}
