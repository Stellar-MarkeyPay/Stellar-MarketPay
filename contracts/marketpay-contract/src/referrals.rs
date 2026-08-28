//! Public referral-domain façade. The implementation remains in the original
//! `referral` module during the compatibility window.

pub use crate::referral::{
    distribute_tree_rewards, get_children, get_depth, get_parent, register_referral,
    MAX_REFERRAL_DEPTH,
};
