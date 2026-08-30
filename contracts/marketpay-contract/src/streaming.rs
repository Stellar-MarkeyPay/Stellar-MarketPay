//! Linear per-ledger settlement with cumulative (rather than incremental)
//! rounding.  The cumulative formula is what makes repeated tiny withdrawals
//! equivalent to one terminal withdrawal.

use soroban_sdk::contracttype;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamSchedule {
    pub total_amount: i128,
    pub start_ledger: u32,
    pub duration_ledgers: u32,
    /// Active ledgers accumulated before the latest pause/resume checkpoint.
    pub checkpoint_elapsed: u32,
    /// Start of the current active interval. It is ignored while paused or
    /// disputed because those actions first checkpoint the schedule.
    pub active_since_ledger: u32,
    pub withdrawn: i128,
}

impl StreamSchedule {
    pub fn new(total_amount: i128, start_ledger: u32, end_ledger: u32) -> Self {
        if total_amount <= 0 {
            panic!("Stream amount must be positive");
        }
        if end_ledger <= start_ledger {
            panic!("Stream end must be after start");
        }
        Self {
            total_amount,
            start_ledger,
            duration_ledgers: end_ledger - start_ledger,
            checkpoint_elapsed: 0,
            active_since_ledger: start_ledger,
            withdrawn: 0,
        }
    }

    pub fn elapsed_at(&self, ledger: u32, accruing: bool) -> u32 {
        let current_interval = if accruing && ledger > self.active_since_ledger {
            ledger - self.active_since_ledger
        } else {
            0
        };
        self.checkpoint_elapsed
            .saturating_add(current_interval)
            .min(self.duration_ledgers)
    }

    /// Cumulative entitlement at `ledger`. Division happens only after the
    /// cumulative product, so rounding remainders stay in the contract until a
    /// later withdrawal. The exact endpoint assigns the full amount.
    pub fn vested_at(&self, ledger: u32, accruing: bool) -> i128 {
        let elapsed = self.elapsed_at(ledger, accruing);
        if elapsed >= self.duration_ledgers {
            return self.total_amount;
        }
        self.total_amount
            .checked_mul(i128::from(elapsed))
            .expect("Streaming arithmetic overflow")
            .checked_div(i128::from(self.duration_ledgers))
            .expect("Stream duration must be positive")
    }

    pub fn withdrawable_at(&self, ledger: u32, accruing: bool) -> i128 {
        self.vested_at(ledger, accruing)
            .checked_sub(self.withdrawn)
            .expect("Stream accounting invariant violated")
    }

    /// Stop the active clock at `ledger`. Returns the accrued and unpaid value
    /// at that exact checkpoint.
    pub fn checkpoint(&mut self, ledger: u32) -> i128 {
        self.checkpoint_elapsed = self.elapsed_at(ledger, true);
        self.active_since_ledger = ledger;
        self.withdrawable_at(ledger, false)
    }

    pub fn resume(&mut self, ledger: u32) {
        self.active_since_ledger = ledger.max(self.start_ledger);
    }

    pub fn record_withdrawal(&mut self, amount: i128) {
        if amount < 0 {
            panic!("Withdrawal cannot be negative");
        }
        self.withdrawn = self
            .withdrawn
            .checked_add(amount)
            .expect("Streaming arithmetic overflow");
        if self.withdrawn > self.total_amount {
            panic!("Stream accounting invariant violated");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cumulative_rounding_has_no_dust() {
        let mut stream = StreamSchedule::new(101, 10, 110);
        for ledger in 11..110 {
            let amount = stream.withdrawable_at(ledger, true);
            stream.record_withdrawal(amount);
        }
        let final_amount = stream.withdrawable_at(110, true);
        stream.record_withdrawal(final_amount);
        assert_eq!(stream.withdrawn, 101);
        assert_eq!(stream.withdrawable_at(110, true), 0);
    }

    #[test]
    fn pause_excludes_inactive_ledgers() {
        let mut stream = StreamSchedule::new(100, 10, 110);
        assert_eq!(stream.checkpoint(30), 20);
        assert_eq!(stream.vested_at(80, false), 20);
        stream.resume(80);
        assert_eq!(stream.vested_at(100, true), 40);
    }
}
