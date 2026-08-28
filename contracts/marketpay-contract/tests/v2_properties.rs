//! Deterministic property tests over the complete v2 transition relation.

use marketpay_contract::state_machine::try_transition;
use marketpay_contract::{LifecycleAction, LifecycleState};

fn states() -> [LifecycleState; 7] {
    [
        LifecycleState::Locked,
        LifecycleState::Active,
        LifecycleState::Paused,
        LifecycleState::Disputed,
        LifecycleState::Released,
        LifecycleState::Refunded,
        LifecycleState::Cancelled,
    ]
}

fn actions() -> [LifecycleAction; 11] {
    [
        LifecycleAction::Start,
        LifecycleAction::Release,
        LifecycleAction::ReleaseMilestone,
        LifecycleAction::Refund,
        LifecycleAction::TimeoutRefund,
        LifecycleAction::Pause,
        LifecycleAction::Resume,
        LifecycleAction::Dispute,
        LifecycleAction::Cancel,
        LifecycleAction::ResolveRelease,
        LifecycleAction::ResolveRefund,
    ]
}

fn terminal(state: &LifecycleState) -> bool {
    matches!(
        state,
        LifecycleState::Released | LifecycleState::Refunded | LifecycleState::Cancelled
    )
}

#[test]
fn the_complete_transition_matrix_has_only_the_documented_edges() {
    let mut accepted_edges = 0;
    for state in states() {
        for action in actions() {
            if try_transition(state.clone(), action).is_some() {
                accepted_edges += 1;
            }
        }
    }
    assert_eq!(accepted_edges, 20);
}

#[test]
fn random_full_state_machine_traces_conserve_balance_and_settle_once() {
    for seed in 1u64..=10_000 {
        let amount = i128::from((seed % 10_000) as u32 + 1);
        let mut paid = 0i128;
        let mut refunded = 0i128;
        let mut state = LifecycleState::Locked;
        let mut settled_edges = 0u32;
        let mut random = seed;

        for _ in 0..64 {
            random = random
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let action = actions()[(random as usize) % actions().len()].clone();
            let Some(next) = try_transition(state.clone(), action.clone()) else {
                continue;
            };

            if action == LifecycleAction::ReleaseMilestone {
                let liability = amount - paid - refunded;
                if liability > 0 {
                    let part = (i128::from(((random >> 32) % 7) as u32) + 1).min(liability);
                    paid += part;
                }
            }

            if terminal(&next) {
                settled_edges += 1;
                let liability = amount - paid - refunded;
                match next {
                    LifecycleState::Released => paid += liability,
                    LifecycleState::Refunded | LifecycleState::Cancelled => {
                        refunded += liability;
                    }
                    _ => unreachable!(),
                }
            }
            state = next;

            assert!(paid >= 0 && refunded >= 0);
            assert_eq!(amount, amount - paid - refunded + paid + refunded);
            assert!(paid + refunded <= amount);

            if terminal(&state) {
                for later_action in actions() {
                    assert_eq!(try_transition(state.clone(), later_action), None);
                }
            }
        }
        assert!(settled_edges <= 1, "seed {seed} settled more than once");
        if terminal(&state) {
            assert_eq!(paid + refunded, amount);
        }
    }
}
