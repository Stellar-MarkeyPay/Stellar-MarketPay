//! Fuzzing with the invariants as oracles.
//!
//! The contract already had fuzz tests. They checked for the absence of
//! panics, which is a weak oracle: a contract that silently pays the wrong
//! party the wrong amount does not panic, and neither did the sequence that
//! drained one escrow into another. These tests use
//! [`marketpay_spec::check_all`] as the oracle instead, so the fuzzer is
//! asking "did the contract do the right thing" rather than "did it survive".
//!
//! The generator is a deterministic xorshift seeded from a constant, so a
//! failure reproduces from the seed printed in the panic message. Randomness
//! that cannot be replayed turns a finding into a rumour.

mod harness;

use harness::Harness;
use marketpay_spec::model::{CreateParams, Model, Step};
use marketpay_spec::state::{Party, Status};
use marketpay_spec::transitions::Action;
use marketpay_spec::{check_all, Counterexample};

/// Deterministic PRNG. `SplitMix64` — small, and good enough to shuffle a
/// call schedule.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    fn party(&mut self) -> Party {
        Party::ALL[self.below(Party::ALL.len() as u64) as usize]
    }
}

/// One fuzzing round: build a random escrow, throw a random call schedule at
/// both the contract and the model, and check the invariants after every step.
fn fuzz_round(seed: u64, steps: usize) -> Result<(), String> {
    let mut rng = Rng(seed);

    // Escrow shape.
    let amount = 1 + rng.below(2_000_000) as i128;
    let use_milestones = rng.below(2) == 0;
    let with_arbitrator = rng.below(3) == 0;
    let with_referrer = rng.below(3) == 0;

    let (params, ms_amounts) = if use_milestones {
        // Split the amount into 2-4 positive parts summing to exactly `amount`.
        let n = 2 + rng.below(3) as usize;
        if amount < n as i128 {
            (CreateParams::simple(amount), None)
        } else {
            let mut parts = vec![1i128; n];
            let mut left = amount - n as i128;
            for part in parts.iter_mut().take(n - 1) {
                let take = if left > 0 { rng.below(left as u64 + 1) as i128 } else { 0 };
                *part += take;
                left -= take;
            }
            parts[n - 1] += left;
            let mut p = CreateParams::with_milestones(&parts);
            p.with_arbitrator = with_arbitrator;
            p.with_referrer = with_referrer;
            (p, Some(parts))
        }
    } else {
        let mut p = CreateParams::simple(amount);
        p.with_arbitrator = with_arbitrator;
        p.with_referrer = with_referrer;
        (p, None)
    };

    let h = Harness::new(amount);
    let job = h.job("fuzz");
    let mut m = Model::new(params);

    h.contract.create_escrow(
        &job,
        &h.client,
        &h.create_params(
            amount,
            ms_amounts.as_deref(),
            params.with_arbitrator,
            params.with_referrer,
        ),
    );
    if !m.step(Action::Create).is_ok() {
        return Err(format!("seed {seed}: model refused a creation the contract accepted"));
    }

    let n_ms = params.n_milestones;

    for step_no in 0..steps {
        let caller = rng.party();
        let addr = h.address_of(caller);
        let choice = rng.below(9);

        // Drive both sides with the same call. `try_*` is used throughout so
        // that a contract-side panic is an observation rather than an abort.
        let (contract_ok, action) = match choice {
            0 => (
                h.contract.try_start_work(&job, &addr).is_ok(),
                Action::StartWork { caller },
            ),
            1 => (
                h.contract.try_release_escrow(&job, &addr).is_ok(),
                Action::ReleaseEscrow { caller },
            ),
            2 => (
                h.contract.try_refund_escrow(&job, &addr).is_ok(),
                Action::RefundEscrow { caller },
            ),
            3 => (
                h.contract.try_approve_release(&job, &addr).is_ok(),
                Action::ApproveRelease { caller },
            ),
            4 => (
                h.contract.try_approve_refund(&job, &addr).is_ok(),
                Action::ApproveRefund { caller },
            ),
            5 => (
                h.contract.try_raise_dispute(&job, &addr).is_ok(),
                Action::RaiseDispute { caller },
            ),
            6 => (
                h.contract.try_timeout_refund(&job, &addr).is_ok(),
                Action::TimeoutRefund { caller },
            ),
            7 => (
                h.contract
                    .try_release_with_conversion(&job, &addr, &h.token.address, &0)
                    .is_ok(),
                Action::ReleaseWithConversion { caller },
            ),
            _ => {
                if n_ms == 0 {
                    h.advance_past_timeout();
                    (true, Action::AdvancePastTimeout)
                } else {
                    let idx = rng.below(n_ms as u64) as u8;
                    (
                        h.contract.try_partial_release(&job, &(idx as u32), &addr).is_ok(),
                        Action::PartialRelease { caller, index: idx },
                    )
                }
            }
        };

        let model_step = m.step(action);
        let model_ok = matches!(model_step, Step::Ok);

        // ── Oracle 1: the model's invariants ──────────────────────────────
        if let Some(v) = check_all(&m.state) {
            let ce = Counterexample::new(v, m.state);
            return Err(format!("seed {seed}, step {step_no}: model invariant broke\n{ce}"));
        }

        // ── Oracle 2: value conservation, measured on the real balances ───
        //
        // This does not go through the model at all. It asks the token
        // contract what happened and checks that the totals still add up,
        // which is the check that would have caught the cross-escrow drain
        // regardless of whether the model was right.
        let out = h.balance(Party::Freelancer)
            + h.balance(Party::Client)
            + h.balance(Party::Referrer)
            + h.balance(Party::Admin);
        if h.held() + out != amount {
            return Err(format!(
                "seed {seed}, step {step_no}: I1 broke on the real contract — \
                 deposited {amount}, contract holds {}, paid out {out}",
                h.held()
            ));
        }
        if h.held() < 0 {
            return Err(format!("seed {seed}, step {step_no}: contract balance went negative"));
        }

        // ── Oracle 3: the contract and the model agree on acceptance ──────
        if contract_ok != model_ok {
            return Err(format!(
                "seed {seed}, step {step_no}: {} by {caller:?} — contract {}, specification {}",
                action.name(),
                if contract_ok { "accepted" } else { "refused" },
                if model_ok { "accepts" } else { "refuses" },
            ));
        }

        // ── Oracle 4: they agree on the resulting status and balances ─────
        let contract_status = h.status(&job);
        let model_status = Some(m.state.escrow.status);
        if contract_status != model_status {
            return Err(format!(
                "seed {seed}, step {step_no}: after {} the contract is {contract_status:?} \
                 but the specification says {model_status:?}",
                action.name()
            ));
        }
        if h.held() != m.state.funds.held {
            return Err(format!(
                "seed {seed}, step {step_no}: after {} the contract holds {} \
                 but the specification says {}",
                action.name(),
                h.held(),
                m.state.funds.held
            ));
        }

        // Once settled there is nothing left to explore on this escrow.
        if matches!(m.state.escrow.status, Status::Released | Status::Refunded) {
            break;
        }
    }

    Ok(())
}

#[test]
fn fuzz_the_contract_against_the_invariants() {
    // Kept modest so the suite stays inside a pull request's patience. The
    // scheduled verification workflow runs the same function with a far larger
    // budget; see `.github/workflows/verification.yml`.
    let rounds = std::env::var("FUZZ_ROUNDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(300u64);

    for seed in 0..rounds {
        if let Err(report) = fuzz_round(seed, 8) {
            panic!("{report}");
        }
    }
    eprintln!("invariant fuzzing: {rounds} rounds, 8 calls each, all oracles held");
}
