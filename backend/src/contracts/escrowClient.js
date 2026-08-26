const { contract } = require('@stellar/stellar-sdk');

// Environment variables for network configuration
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === 'mainnet'
  ? 'Public Global Stellar Network ; September 2015'
  : 'Test SDF Network ; September 2015';
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';

/**
 * Returns a contract client instance for the escrow contract.
 * @returns {contract.Client}
 */
function getEscrowContractClient() {
  const contractId = process.env.CONTRACT_ID || process.env.ESCROW_CONTRACT_ID;
  if (!contractId) {
    throw new Error('CONTRACT_ID is not configured');
  }
  return new contract.Client({
    contractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
}

/**
 * Calls the on‑chain `get_escrow` view function.
 * The contract is expected to expose a `get_escrow` method that takes the job/escrow ID.
 *
 * @param {string} escrowId - The job identifier used as the escrow key.
 * @returns {Promise<Object>} Decoded on‑chain escrow representation.
 */
async function getEscrowOnChain(escrowId) {
  const client = getEscrowContractClient();
  // Build a simulated transaction to invoke the view function.
  const tx = await client.invoke('get_escrow', { id: escrowId });
  const simulation = await tx.simulate();
  // The SDK returns decoded results under `result.decoded`.
  return simulation.result?.decoded ?? null;
}

module.exports = {
  getEscrowContractClient,
  getEscrowOnChain,
};
