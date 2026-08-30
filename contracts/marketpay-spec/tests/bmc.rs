//! The bounded model check that CI gates on.
//!
//! Every invariant in `docs/SPECIFICATION.md` §3 is checked after every call
//! of every interleaving up to the stated depth, across every escrow shape in
//! [`bmc::default_configs`]. A failure prints the reproducing call sequence,
//! not a solver dump.

use marketpay_spec::bmc::{self, Bounds};
use marketpay_spec::model::CreateParams;

/// Render a counterexample the way CI should show it, then fail.
fn fail(ce: &marketpay_spec::Counterexample) -> ! {
    let mut out = String::new();
    use std::fmt::Write;
    write!(out, "{}", ce).unwrap();
    panic!("{}", out);
}

#[test]
fn every_invariant_holds_across_the_bounded_state_space() {
    let bounds = Bounds::default();
    match bmc::check_all_configs(bounds) {
        Ok(stats) => {
            // The exploration is only meaningful if it actually got somewhere.
            // A checker that silently explores nothing passes trivially, which
            // is the failure mode this assertion exists to catch.
            assert!(
                stats.settlements_reached > 0,
                "the checker never reached a settlement — the bound or the \
                 alphabet is wrong, and a passing run means nothing"
            );
            assert!(stats.states_visited > 100, "suspiciously small state space");
            eprintln!(
                "bounded model check: depth {}, {} distinct states, {} calls applied, \
                 {} calls rejected, {} settlements reached",
                bounds.depth,
                stats.states_visited,
                stats.calls_applied,
                stats.calls_rejected,
                stats.settlements_reached
            );
        }
        Err(ce) => fail(&ce),
    }
}

#[test]
fn milestone_escrows_conserve_value_under_every_interleaving() {
    // The interleaving that matters most: a milestone payout followed by a
    // refund. Explored on its own so a failure here names the shape directly.
    let params = CreateParams::with_milestones(&[400, 600]);
    if let Err(ce) = bmc::check_config(params, Bounds { depth: 6, max_states: 2_000_000 }) {
        fail(&ce);
    }
}

#[test]
fn arbitrated_escrows_conserve_value_under_every_interleaving() {
    let params = CreateParams::simple(10_001).arbitrated();
    if let Err(ce) = bmc::check_config(params, Bounds { depth: 7, max_states: 2_000_000 }) {
        fail(&ce);
    }
}

/// The deeper sweep the nightly workflow runs.
///
/// Marked `#[ignore]` so a pull request pays for depth 7 and not for this.
/// Depth is taken from `BMC_DEPTH` because the useful depth changes as the
/// state machine grows, and hard-coding it here would mean the nightly job
/// and the checker disagree about what "deeper" means.
#[test]
#[ignore = "nightly: run with --ignored, see .github/workflows/verification.yml"]
fn deeper_sweep_of_the_bounded_state_space() {
    let depth = std::env::var("BMC_DEPTH")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(9usize);

    let bounds = Bounds { depth, max_states: 40_000_000 };
    match bmc::check_all_configs(bounds) {
        Ok(stats) => {
            assert!(stats.settlements_reached > 0);
            eprintln!(
                "deep bounded model check: depth {depth}, {} distinct states, \
                 {} calls applied, {} settlements reached",
                stats.states_visited, stats.calls_applied, stats.settlements_reached
            );
        }
        Err(ce) => fail(&ce),
    }
}

/// The reachable state space is closed at the default depth.
///
/// This is what turns "bounded model check" into something stronger for this
/// abstraction. If exploring three calls deeper than the default finds no new
/// state, then no sequence of calls — of any length — reaches a state the
/// default depth missed, and the depth bound stops being a limitation.
///
/// It is asserted rather than asserted-once-and-commented because the claim
/// depends on the shape of the state machine. Adding an entrypoint that
/// introduces a genuinely new state is fine; letting the published claim go
/// stale without noticing is not.
#[test]
fn saturation_is_reached_by_the_default_depth() {
    let base = Bounds::default();
    let at_default = bmc::check_all_configs(base).expect("default depth must pass");
    let deeper = bmc::check_all_configs(Bounds {
        depth: base.depth + 3,
        ..base
    })
    .expect("deeper exploration must pass");

    assert_eq!(
        at_default.states_visited, deeper.states_visited,
        "the reachable state space is no longer closed at depth {}: exploring \
         to depth {} found {} states rather than {}. Either raise Bounds::default \
         until the counts agree again, or amend the claim in \
         docs/VERIFICATION.md §5 — do not leave a published exhaustiveness \
         claim that the checker no longer supports.",
        base.depth,
        base.depth + 3,
        deeper.states_visited,
        at_default.states_visited
    );

    eprintln!(
        "state space closed at depth {}: {} distinct states, unchanged at depth {}",
        base.depth,
        at_default.states_visited,
        base.depth + 3
    );
}
