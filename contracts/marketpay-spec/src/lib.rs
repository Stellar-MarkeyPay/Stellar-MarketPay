//! # MarketPay escrow — formal specification and verification
//!
//! `contracts/marketpay-contract/src/lib.rs` holds user funds across sixty-odd
//! entrypoints, and until now the only thing standing behind those funds was a
//! set of example-based tests. Example tests pass on the cases someone thought
//! of. They cannot fail on a case nobody thought of, which is exactly the class
//! of failure that costs money — a merge that dropped struct fields, and fee
//! arithmetic that was silently wrong in a restored test, both went through a
//! green suite.
//!
//! This crate states what the escrow is supposed to do, independently of how
//! it does it, and then checks the two against each other.
//!
//! ## Layout
//!
//! | module | role |
//! |---|---|
//! | [`state`] | the abstract escrow state, free of `soroban_sdk` types |
//! | [`invariants`] | the properties that must hold, stated once (I1–I9) |
//! | [`transitions`] | the legal state-machine edges, stated as data |
//! | [`model`] | an executable reference implementation of the specification |
//! | [`referral_model`] | the multi-level referral payout arithmetic |
//! | [`bmc`] | exhaustive bounded checking, runs on every pull request |
//! | [`kani_harnesses`] | symbolic proofs, run on a schedule |
//! | [`trace`] | counterexamples that read as call sequences, not solver dumps |
//!
//! ## What is proven, and what is not
//!
//! Everything here is bounded. The bound is stated, not hidden:
//! [`bmc::Bounds`] fixes the call depth and [`bmc::default_configs`] fixes the
//! amounts. Kani lifts the amount bound but keeps the depth bound. Nothing in
//! this crate establishes an unbounded property, and `docs/VERIFICATION.md` §5
//! says so at length, because a bound that is claimed away is worse than a
//! bound that is written down.
//!
//! ## The rule this crate imposes
//!
//! Changing a fund-moving entrypoint means changing [`model`] and, if the
//! change touches who may call it or what states it spans,
//! [`transitions::LEGAL_TRANSITIONS`]. The differential tests in the contract
//! crate fail loudly when the implementation moves and the specification does
//! not, which is the point.

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]

pub mod invariants;
pub mod model;
pub mod referral_model;
pub mod state;
pub mod trace;
pub mod transitions;

#[cfg(feature = "std")]
pub mod bmc;

#[cfg(kani)]
pub mod kani_harnesses;

pub use invariants::{check_all, InvariantId, Violation};
pub use model::{CreateParams, Model, Reject, Step};
pub use state::{Escrow, Funds, Milestone, Party, Status, SystemState};
pub use trace::Counterexample;
pub use transitions::{Action, Transition, TransitionKind, LEGAL_TRANSITIONS};
