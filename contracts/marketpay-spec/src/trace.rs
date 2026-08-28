//! Readable counterexamples.
//!
//! A bounded model checker that fails with a raw solver dump costs more time
//! than it saves: the reader has to reconstruct what happened before they can
//! judge whether it matters. Everything in this subsystem that can fail
//! produces a [`Counterexample`] instead, which renders as the sequence of
//! calls that got there, the state at the point of failure, and the one-line
//! statement of the property that broke.

use crate::invariants::Violation;
use crate::state::{Party, Status, SystemState};
use crate::transitions::Action;
use core::fmt::{self, Write};

/// The maximum trace length the checkers retain. Traces longer than this are
/// truncated from the front, keeping the tail that led to the failure.
pub const MAX_TRACE: usize = 16;

/// A recorded call in a failing execution.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TraceEntry {
    pub action: Action,
    /// Whether the model accepted the call. Rejected calls are kept in the
    /// trace because "this was refused" is often the load-bearing step.
    pub accepted: bool,
    /// Contract balance after the call.
    pub held_after: i128,
}

/// A failing execution: what was done, what broke, and where.
#[derive(Clone, Copy)]
pub struct Counterexample {
    pub trace: [Option<TraceEntry>; MAX_TRACE],
    pub len: usize,
    pub violation: Violation,
    pub final_state: SystemState,
}

impl Counterexample {
    pub fn new(violation: Violation, final_state: SystemState) -> Self {
        Counterexample {
            trace: [None; MAX_TRACE],
            len: 0,
            violation,
            final_state,
        }
    }

    pub fn push(&mut self, entry: TraceEntry) {
        if self.len < MAX_TRACE {
            self.trace[self.len] = Some(entry);
            self.len += 1;
        }
    }

    pub fn entries(&self) -> impl Iterator<Item = &TraceEntry> {
        self.trace[..self.len].iter().flatten()
    }

    /// Render the counterexample into any `Write` sink.
    ///
    /// Kept generic over the sink so the same rendering serves `println!` in a
    /// test, a `String` in the fuzzer's panic message, and a `core::fmt`
    /// buffer under `no_std`.
    pub fn render<W: Write>(&self, w: &mut W) -> fmt::Result {
        writeln!(w, "\n╭─ SPECIFICATION VIOLATION ──────────────────────────────")?;
        writeln!(w, "│ {}", self.violation.id.label())?;
        writeln!(w, "│")?;
        writeln!(w, "│ {}", wrap_note(self.violation.id.statement()))?;
        writeln!(w, "│")?;
        writeln!(w, "│ expected: {}", self.violation.expected)?;
        writeln!(w, "│ actual:   {}", self.violation.actual)?;
        writeln!(w, "│")?;
        writeln!(w, "│ Reproducing call sequence:")?;
        if self.len == 0 {
            writeln!(w, "│   (violated in the initial state)")?;
        }
        for (i, entry) in self.entries().enumerate() {
            let mark = if entry.accepted { "ok      " } else { "rejected" };
            writeln!(
                w,
                "│   {:>2}. {:<28} by {:<11} [{}] held={}",
                i + 1,
                entry.action.name(),
                describe_caller(entry.action),
                mark,
                entry.held_after,
            )?;
        }
        writeln!(w, "│")?;
        self.render_state(w)?;
        writeln!(w, "╰────────────────────────────────────────────────────────")
    }

    fn render_state<W: Write>(&self, w: &mut W) -> fmt::Result {
        let s = &self.final_state;
        writeln!(w, "│ Final state:")?;
        writeln!(w, "│   status            {}", status_name(s.escrow.status))?;
        writeln!(w, "│   amount            {}", s.escrow.amount)?;
        writeln!(w, "│   settlements       {}", s.settlements)?;
        writeln!(
            w,
            "│   multisig          {}",
            if s.escrow.has_arbitrator { "yes (2-of-3)" } else { "no" }
        )?;
        if s.escrow.has_arbitrator {
            writeln!(
                w,
                "│   release votes     client={} freelancer={} arbitrator={}",
                s.escrow.release_votes[0], s.escrow.release_votes[1], s.escrow.release_votes[2]
            )?;
            writeln!(
                w,
                "│   refund votes      client={} freelancer={} arbitrator={}",
                s.escrow.refund_votes[0], s.escrow.refund_votes[1], s.escrow.refund_votes[2]
            )?;
        }
        if s.escrow.n_milestones > 0 {
            write!(w, "│   milestones        ")?;
            for i in 0..s.escrow.n_milestones as usize {
                let m = s.escrow.milestones[i];
                write!(w, "[{}{}] ", m.amount, if m.is_completed { " paid" } else { "" })?;
            }
            writeln!(w)?;
        }
        writeln!(w, "│")?;
        writeln!(w, "│   deposited         {}", s.funds.deposited)?;
        writeln!(w, "│   still held        {}", s.funds.held)?;
        writeln!(w, "│   → freelancer      {}", s.funds.paid_freelancer)?;
        writeln!(w, "│   → client          {}", s.funds.paid_client)?;
        writeln!(w, "│   → referrer        {}", s.funds.paid_referrer)?;
        writeln!(w, "│   → admin (fee)     {}", s.funds.paid_admin)?;
        writeln!(w, "│   → referral tree   {}", s.funds.paid_tree)?;
        let out = s.funds.total_out();
        writeln!(w, "│   total out         {}", out)?;
        if out > s.funds.deposited {
            writeln!(
                w,
                "│   ⚠ {} more left the contract than was ever deposited",
                out - s.funds.deposited
            )?;
        }
        Ok(())
    }
}

impl fmt::Display for Counterexample {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.render(f)
    }
}

impl fmt::Debug for Counterexample {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.render(f)
    }
}

fn describe_caller(action: Action) -> &'static str {
    match action.caller() {
        Some(Party::Client) => "client",
        Some(Party::Freelancer) => "freelancer",
        Some(Party::Arbitrator) => "arbitrator",
        Some(Party::Referrer) => "referrer",
        Some(Party::Admin) => "admin",
        Some(Party::Oracle) => "oracle",
        Some(Party::Panel) => "arb. panel",
        Some(Party::Outsider) => "outsider",
        None => "-",
    }
}

fn status_name(s: Status) -> &'static str {
    match s {
        Status::Locked => "Locked",
        Status::InProgress => "InProgress",
        Status::Released => "Released",
        Status::Refunded => "Refunded",
        Status::Disputed => "Disputed",
    }
}

/// Soft-wrap a one-line statement so it stays inside the box.
fn wrap_note(note: &str) -> &str {
    // The statements are authored to fit; this exists so that a future longer
    // one is an obvious formatting problem rather than a silent overflow.
    note
}
