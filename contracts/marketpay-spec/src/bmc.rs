//! Bounded model checking, in plain Rust.
//!
//! This is the checker CI gates on. It exists alongside the Kani harnesses
//! rather than instead of them because the two answer different questions and
//! have different costs:
//!
//!   * Kani (`src/kani_harnesses.rs`) proves properties over *symbolic*
//!     amounts — every `i128` at once — but needs a nightly toolchain, a
//!     ~1 GB solver bundle and minutes per harness. That is a scheduled job.
//!   * This checker explores the state space *exhaustively but concretely*:
//!     every interleaving of every entrypoint up to a stated depth, over a
//!     small set of representative amounts. It runs under stock stable Rust
//!     in seconds, so every pull request can afford it.
//!
//! Neither is a substitute for the other, and `docs/VERIFICATION.md` §4 is
//! explicit about what each one does and does not establish.

use crate::invariants::{check_all, Violation};
use crate::model::{CreateParams, Model, Step};
use crate::state::{Party, SystemState};
use crate::trace::{Counterexample, TraceEntry};
use crate::transitions::Action;

use std::collections::HashMap;

/// How far to explore.
#[derive(Clone, Copy, Debug)]
pub struct Bounds {
    /// Maximum number of calls in an explored sequence.
    pub depth: usize,
    /// Cap on distinct states visited, so a mis-specified bound degrades into
    /// a slow-but-finite run rather than an unbounded one.
    pub max_states: usize,
}

impl Default for Bounds {
    fn default() -> Self {
        // Depth 8 is not an arbitrary budget: it is where the reachable state
        // space closes. Exploring to depth 8 finds 1673 distinct states, and
        // so does exploring to 9, 10, 12 or 14 — no sequence of further calls
        // reaches a state the first eight had not already reached.
        //
        // That makes the call-depth bound vacuous for this abstraction: the
        // check is exhaustive over reachable states, not merely bounded. The
        // bounds that remain real are the amount domain and the abstraction
        // itself, and VERIFICATION.md §5 is explicit about both.
        //
        // `saturation_is_reached_by_the_default_depth` in `tests/bmc.rs`
        // re-establishes the fixpoint on every run, so this stops being true
        // loudly rather than silently if the state machine grows.
        Bounds { depth: 8, max_states: 4_000_000 }
    }
}

/// What an exploration covered.
#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    pub sequences: usize,
    pub states_visited: usize,
    pub calls_applied: usize,
    pub calls_rejected: usize,
    pub settlements_reached: usize,
}

/// The callers the checker tries for each entrypoint.
///
/// Every role that appears in an authorisation check, plus `Outsider` to
/// stand for the unbounded set of addresses holding no role at all. Adding
/// more addresses of an existing role cannot reach a state these do not,
/// because every check in the contract compares against a role.
const CALLERS: [Party; 5] = [
    Party::Client,
    Party::Freelancer,
    Party::Arbitrator,
    Party::Oracle,
    Party::Outsider,
];

/// Build the action alphabet for an escrow with `n_milestones` milestones.
fn alphabet(n_milestones: u8) -> Vec<Action> {
    let mut acts = Vec::new();
    acts.push(Action::Create);
    acts.push(Action::AdvancePastTimeout);
    for c in CALLERS {
        acts.push(Action::StartWork { caller: c });
        acts.push(Action::ReleaseEscrow { caller: c });
        acts.push(Action::ReleaseWithConversion { caller: c });
        acts.push(Action::ApproveRelease { caller: c });
        acts.push(Action::RefundEscrow { caller: c });
        acts.push(Action::ApproveRefund { caller: c });
        acts.push(Action::TimeoutRefund { caller: c });
        acts.push(Action::RaiseDispute { caller: c });
        for i in 0..n_milestones {
            acts.push(Action::PartialRelease { caller: c, index: i });
            acts.push(Action::VerifyMilestoneOracle { caller: c, index: i });
        }
    }
    acts
}

/// A hashable projection of the model, used to avoid re-exploring states.
///
/// Two models with the same projection have identical futures, so exploring
/// the second one cannot find anything the first did not. This is what makes
/// depth 7 tractable: without it the search is `|alphabet|^depth`, with it it
/// is bounded by the number of genuinely distinct states, which is small.
///
/// The memo is keyed by state but *valued* by the remaining depth it was
/// explored with. Keying by state alone would be unsound: a state first
/// reached one call before the bound gets one call of exploration, and a
/// later path reaching the same state with six calls to spare would be
/// skipped, silently shrinking the search. Only a revisit with strictly more
/// budget is worth re-running, and only those are re-run.
#[derive(Clone, PartialEq, Eq, Hash)]
struct StateKey {
    created: bool,
    status: u8,
    milestones_done: [bool; crate::state::MAX_MILESTONES],
    release_votes: [bool; crate::state::N_SIGNERS],
    refund_votes: [bool; crate::state::N_SIGNERS],
    settlements: u32,
    work_started: bool,
    timed_out: bool,
    held: i128,
    paid_freelancer: i128,
    paid_client: i128,
    paid_fee: i128,
}

fn key(m: &Model) -> StateKey {
    let s = &m.state;
    let mut milestones_done = [false; crate::state::MAX_MILESTONES];
    for (i, done) in milestones_done
        .iter_mut()
        .enumerate()
        .take(s.escrow.n_milestones as usize)
    {
        *done = s.escrow.milestones[i].is_completed;
    }
    StateKey {
        created: m.created,
        status: s.escrow.status as u8,
        milestones_done,
        release_votes: s.escrow.release_votes,
        refund_votes: s.escrow.refund_votes,
        settlements: s.settlements,
        work_started: s.work_started,
        timed_out: s.timed_out,
        held: s.funds.held,
        paid_freelancer: s.funds.paid_freelancer,
        paid_client: s.funds.paid_client,
        paid_fee: s.funds.paid_referrer + s.funds.paid_admin + s.funds.paid_tree,
    }
}

/// Exhaustively explore every call sequence up to `bounds.depth` from the
/// given escrow configuration, checking every invariant after every call.
///
/// Returns the exploration statistics, or the first counterexample found.
pub fn check_config(
    params: CreateParams,
    bounds: Bounds,
) -> Result<Stats, Box<Counterexample>> {
    let acts = alphabet(params.n_milestones);
    let mut stats = Stats::default();
    let mut visited: HashMap<StateKey, usize> = HashMap::new();
    let mut model = Model::new(params);

    // Oracles are configured up front; whether one exists is a static
    // property of the escrow, not something an attacker toggles mid-run.
    for i in 0..params.n_milestones {
        model.set_milestone_oracle(i);
    }

    let mut trace: Vec<TraceEntry> = Vec::with_capacity(bounds.depth);
    let outcome = explore(&mut model, &acts, &bounds, 0, &mut visited, &mut stats, &mut trace);

    match outcome {
        None => Ok(stats),
        Some((violation, state)) => {
            let mut ce = Counterexample::new(violation, state);
            for entry in trace.iter() {
                ce.push(*entry);
            }
            Err(Box::new(ce))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn explore(
    model: &mut Model,
    acts: &[Action],
    bounds: &Bounds,
    depth: usize,
    visited: &mut HashMap<StateKey, usize>,
    stats: &mut Stats,
    trace: &mut Vec<TraceEntry>,
) -> Option<(Violation, SystemState)> {
    if depth >= bounds.depth || stats.states_visited >= bounds.max_states {
        stats.sequences += 1;
        return None;
    }

    for &action in acts {
        let before = *model;
        let step = model.step(action);

        trace.push(TraceEntry {
            action,
            accepted: step.is_ok(),
            held_after: model.state.funds.held,
        });

        let result = (|| {
            if let Some(v) = model.recorded_violation() {
                return Some((v, model.state));
            }
            if let Some(v) = check_all(&model.state) {
                return Some((v, model.state));
            }
            None
        })();

        if let Some(found) = result {
            return Some(found);
        }

        match step {
            // A refused call leaves the state untouched, so recursing from
            // here would re-explore the parent's subtree one level shallower.
            // The refusal itself has already been checked above.
            Step::Rejected(_) => {
                stats.calls_rejected += 1;
            }
            Step::Ok => {
                stats.calls_applied += 1;
                if model.state.escrow.status.is_settled()
                    && !before.state.escrow.status.is_settled()
                {
                    stats.settlements_reached += 1;
                }
                let remaining = bounds.depth - depth - 1;
                let k = key(model);
                let worth_exploring = match visited.get(&k) {
                    Some(&seen_with) => remaining > seen_with,
                    None => {
                        stats.states_visited += 1;
                        true
                    }
                };
                if worth_exploring {
                    visited.insert(k, remaining);
                    if let Some(found) =
                        explore(model, acts, bounds, depth + 1, visited, stats, trace)
                    {
                        return Some(found);
                    }
                }
            }
        }

        trace.pop();
        *model = before;
    }

    stats.sequences += 1;
    None
}

/// The escrow configurations the checker sweeps.
///
/// Chosen so that every branch in the fee arithmetic and every shape of the
/// state machine is represented, including the amounts where truncating
/// division does something interesting:
///
///   * `1` — smaller than the fee denominator, so the fee truncates to zero
///     and the freelancer must receive the entire amount.
///   * `99` / `10_001` — not a multiple of 10 000, so the fee division has a
///     remainder and I5 has something to catch.
///   * `1_000_000` — a clean multiple, the case the example tests already use.
pub fn default_configs() -> Vec<CreateParams> {
    let amounts: [i128; 4] = [1, 99, 10_001, 1_000_000];
    let mut configs = Vec::new();
    for a in amounts {
        configs.push(CreateParams::simple(a));
        configs.push(CreateParams::simple(a).arbitrated());
        configs.push(CreateParams::simple(a).referred());
        let mut tree = CreateParams::simple(a);
        tree.freelancer_in_referral_tree = true;
        configs.push(tree);
    }
    // Milestone shapes: an even split, an uneven split, and a single
    // milestone (which settles on its first payout).
    configs.push(CreateParams::with_milestones(&[500_000, 500_000]));
    configs.push(CreateParams::with_milestones(&[1, 99, 10_000]));
    configs.push(CreateParams::with_milestones(&[7]));
    configs.push(CreateParams::with_milestones(&[300, 300, 300, 50, 50]));
    let mut arb_ms = CreateParams::with_milestones(&[400, 600]);
    arb_ms.with_arbitrator = true;
    configs.push(arb_ms);
    configs
}

/// Run the checker across every default configuration.
pub fn check_all_configs(bounds: Bounds) -> Result<Stats, Box<Counterexample>> {
    let mut total = Stats::default();
    for params in default_configs() {
        let s = check_config(params, bounds)?;
        total.sequences += s.sequences;
        total.states_visited += s.states_visited;
        total.calls_applied += s.calls_applied;
        total.calls_rejected += s.calls_rejected;
        total.settlements_reached += s.settlements_reached;
    }
    Ok(total)
}
