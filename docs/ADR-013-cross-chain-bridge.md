# ADR-013: Cross-Chain Bridge for EVM-Soroban Escrow

**Status:** Accepted  
**Date:** 2026-08-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Smart Contract Team, Backend Team, Frontend Team, Security Team

## Context

The marketplace settles only in Soroban-native assets. A large share of freelance demand holds funds on EVM chains, and asking a client to bridge manually before they can post a job is where they leave. This epic makes an escrow fundable from an EVM chain and settleable back, without the platform ever taking custody.

## Decision

We will implement a cross-chain bridge using a **light-client validator-set oracle** pattern. The platform is **never a trusted party** for user funds.

### Trust Model

| Party | Trust Assumption | Can Steal Funds? |
|---|---|---|
| **Client (EVM)** | None | No |
| **Freelancer (Soroban)** | None | No |
| **Relayer Network** | Honest majority (≥2/3) | No — can delay, not steal |
| **Platform / Admin** | None | No — never holds keys or custody |
| **Arbitrator** | Honest in multisig cases | Only via arbitration resolution |

**Funds are stealable only if:**
1. The relayer network colludes to submit a fraudulent proof (mitigated by ≥2/3 honest assumption and chain-id binding)
2. Both chains reorganize simultaneously (probability negligible)

### Protocol Selection

We evaluated:
1. **Established message-passing protocol (e.g., LayerZero, Axelar)** — Rejected: external dependency, platform must trust third-party validator set, adds cost.
2. **HTLC-based atomic swap** — Rejected: requires both parties to be online for timeout paths; poor UX for long-lived escrows.
3. **Validator-set bridge with light-client verification** — **Selected**: minimal trust surface, reorg-safe with confirmation thresholds, no external protocol dependency.

### Data Model

```
BridgeTransfer {
  id: [u8; 32]
  source_chain: ChainId (EVM | Soroban)
  source_tx_hash: [u8; 32]
  source_block_number: u64
  source_log_index: u32
  destination_chain: ChainId
  destination_address: [u8; 20] | Address
  amount: i128
  token: Address
  status: Pending | Deposited | Released | Refunded | Recovering
  confirmations: u32
  required_confirmations: u32
  nonce: u64
  chain_id: [u8; 32]
  created_at_ledger: u32
  updated_at_ledger: u32
  recovery_deadline: u32
}
```

### Reorg Safety

- **EVM deposits**: Require 12 block confirmations on Ethereum mainnet (or equivalent on L2). Soroban will not recognize a deposit until `block_number + required_confirmations <= finalized_block`.
- **Soroban releases**: Soroban finality is sub-second and deterministic. The EVM contract recognizes Soroban finality immediately (no reorg risk).
- **No settlement against non-final deposits**: enforced by `bridge.rs` `assert_finalized()` check.

### Recovery Path

If a bridge transfer is stuck:
1. **Deposit stuck (EVM → Soroban)**: After `recovery_deadline` (7 days), the depositor can call `emergency_refund()` on the EVM contract to reclaim funds minus a small protocol fee.
2. **Withdrawal stuck (Soroban → EVM)**: After `recovery_deadline`, the Soroban contract allows the initiator to cancel and reclaim funds.
3. **Relayer failure**: Any relayer can submit the proof; if one fails, another picks it up within minutes.

### Circuit Breaker

Bridge operations halt when any of:
- Hourly bridge volume exceeds `MAX_HOURLY_VOLUME` (configurable by admin)
- Verification failure rate exceeds `MAX_FAILURE_RATE` (5% over 100 attempts)
- Manual admin pause

### Fee and Slippage Presentation

Before confirmation, the frontend shows:
- Bridge fee (bps)
- Estimated gas on destination chain
- Slippage tolerance window
- Time to finality

## Rationale

### Why Light-Client Validator-Set Oracle?

- Minimal external dependencies
- Reorg-safe with explicit confirmation thresholds
- Platform never holds custody or private keys
- Transparent, on-chain verification logic

### Why Not HTLC?

- Atomic swaps require both parties to monitor timeouts
- Long-lived escrows (weeks/months) make HTLC impractical
- UX friction: users must act before timeout or lose funds

## Consequences

- Relayer network must be operated or delegated
- Confirmation delays add latency to EVM deposits (minutes vs seconds)
- Recovery paths add complexity but ensure funds are never stranded
- Circuit breaker adds operational overhead but limits blast radius

## Alternatives Considered

1. **No bridge** — Current state; high user drop-off at funding step
2. **Centralized custodian** — Rejected: platform becomes trusted third party
3. **Wrapped token mint/burn** — Rejected: requires liquidity provisioning, rehypothecation risk
