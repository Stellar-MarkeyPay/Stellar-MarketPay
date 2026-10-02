# EVM Bridge Contract

EVM-side escrow bridge for Stellar MarketPay. This contract locks funds on EVM chains and releases them based on Soroban finality proofs verified by an authorised relayer set.

## Architecture

- **Trust model**: The platform never holds custody. Only the depositor and the relayer network interact with funds.
- **Reorg safety**: Deposits require 12 block confirmations before Soroban recognition.
- **Replay protection**: Each deposit uses a unique nonce tracked on-chain.
- **Chain-id binding**: Proofs are rejected if the chain ID doesn't match the configured value.

## Deployment

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Security

- ReentrancyGuard on all state-changing functions
- Pausable circuit breaker
- Ownable admin controls
- Authorized relayer set with ECDSA proof verification
