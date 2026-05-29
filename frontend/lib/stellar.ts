import {
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  nativeToScVal,
  xdr,
  Horizon,
} from "@stellar/stellar-sdk";
import * as SorobanRpc from "@stellar/stellar-sdk/rpc";
import { optionalClientEnv, requireClientEnv } from "./env";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NETWORK_NAME = optionalClientEnv("NEXT_PUBLIC_STELLAR_NETWORK", "testnet").toLowerCase();
if (NETWORK_NAME !== "testnet" && NETWORK_NAME !== "mainnet") {
  throw new Error("NEXT_PUBLIC_STELLAR_NETWORK must be either testnet or mainnet.");
}

const NETWORK_PASSPHRASE = NETWORK_NAME === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const HORIZON_URL = optionalClientEnv(
  "NEXT_PUBLIC_HORIZON_URL",
  NETWORK_NAME === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org",
);
const SOROBAN_RPC_URL = optionalClientEnv(
  "NEXT_PUBLIC_SOROBAN_RPC_URL",
  NETWORK_NAME === "mainnet"
    ? "https://soroban-mainnet.stellar.org"
    : "https://soroban-testnet.stellar.org",
);
const USE_CONTRACT_MOCK =
  process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";

const CONTRACT_ID = USE_CONTRACT_MOCK
  ? ""
  : requireClientEnv("NEXT_PUBLIC_CONTRACT_ID");

export const server = new Horizon.Server(HORIZON_URL, { allowHttp: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscrowParams {
  /** Stellar public key of the client funding the escrow */
  clientPublicKey: string;
  /** Unique job identifier (stored in your backend) */
  jobId: string;
  /** Budget in XLM (e.g. 50 for 50 XLM) */
  budgetXlm: number;
}

export interface EscrowResult {
  /** The transaction hash returned after submission */
  txHash: string;
}

export interface MarketPayTransaction {
  id: string;
  hash: string;
  ledger: number;
  created_at: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  memo?: string;
  memo_type?: string;
  successful: boolean;
  marketPayType?: "escrow" | "payment" | "refund" | "other";
}

export interface FetchTransactionsResponse {
  transactions: MarketPayTransaction[];
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Freighter helpers (browser-only)
// ---------------------------------------------------------------------------

async function getFreighter() {
  if (typeof window === "undefined") {
    throw new Error("Freighter is only available in the browser.");
  }
  // Freighter injects window.freighter; fall back to @stellar/freighter-api
  // when the extension is installed it patches the global.
  const { isConnected, getPublicKey, signTransaction } =
    await import("@stellar/freighter-api");

  const connected = await isConnected();
  if (!connected) {
    throw new Error(
      "Freighter wallet not found. Please install the Freighter extension.",
    );
  }
  return { getPublicKey, signTransaction };
}

// ---------------------------------------------------------------------------
// Core: build the Soroban create_escrow transaction
// ---------------------------------------------------------------------------

/**
 * Builds, simulates, and returns a base64-encoded XDR transaction that invokes
 * `create_escrow(job_id: String, client: Address, freelancer: Address, token: Address, amount: i128, ...)` on the
 * deployed Soroban contract.
 *
 * The returned XDR is ready to be signed by Freighter and submitted.
 */
export async function buildCreateEscrowTx(
  params: EscrowParams,
): Promise<string> {
  const { clientPublicKey, jobId, budgetXlm } = params;

  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file.",
    );
  }

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  // Fetch the source account
  const account = await server.getAccount(clientPublicKey);

  // Convert XLM to stroops (1 XLM = 10_000_000 stroops)
  const amountStroops = BigInt(Math.round(budgetXlm * 10_000_000));

  // Build the contract call arguments
  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }), // job_id: String
    Address.fromString(clientPublicKey).toScVal(), // client: Address
    nativeToScVal(amountStroops, { type: "i128" }), // amount: i128 (stroops)
  ];

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("create_escrow", ...callArgs))
    .setTimeout(300)
    .build();

  // Simulate to populate the soroban data / auth entries
  const simResponse = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Soroban simulation failed: ${simResponse.error}`);
  }

  // Assemble the transaction (adds footprint, resource fees, etc.)
  const assembledTx = SorobanRpc.assembleTransaction(tx, simResponse).build();

  return assembledTx.toXDR();
}

// ---------------------------------------------------------------------------
// Core: sign with Freighter and submit
// ---------------------------------------------------------------------------

/**
 * Signs the prepared XDR transaction via Freighter, submits it to the
 * Soroban RPC, and polls until the transaction is finalised.
 *
 * Returns the confirmed transaction hash.
 */
export async function signAndSubmitEscrowTx(
  preparedXdr: string,
): Promise<EscrowResult> {
  const { signTransaction } = await getFreighter();

  // Ask the user to sign
  const { signedTransaction } = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  // Submit the signed transaction
  const sendResponse = await server.sendTransaction(
    // Re-parse from the signed XDR
    (() => {
      const { Transaction } = require("@stellar/stellar-sdk");
      return new Transaction(signedTransaction, NETWORK_PASSPHRASE);
    })(),
  );

  if (sendResponse.status === "ERROR") {
    const resultXdr = sendResponse.errorResult?.toXDR("base64") ?? "unknown";
    throw new Error(`Transaction submission failed. Result XDR: ${resultXdr}`);
  }

  const txHash = sendResponse.hash;

  // Poll for confirmation
  let getResponse = await server.getTransaction(txHash);
  const MAX_POLLS = 20;
  let polls = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    polls < MAX_POLLS
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResponse = await server.getTransaction(txHash);
    polls++;
  }

  if (getResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `Transaction did not succeed. Status: ${getResponse.status}`,
    );
  }

  return { txHash };
}

// ---------------------------------------------------------------------------
// Convenience: build → sign → submit in one call
// ---------------------------------------------------------------------------

export async function createEscrowOnChain(
  params: EscrowParams,
): Promise<EscrowResult> {
  if (USE_CONTRACT_MOCK) {
    const { mockCreateEscrow } = await import("./contractMock");
    const txHash = await mockCreateEscrow({
      jobId: params.jobId,
      client: params.clientPublicKey,
      freelancer: params.clientPublicKey,
      token: "native",
      amount: String(BigInt(Math.round(params.budgetXlm * 10_000_000))),
    });
    return { txHash };
  }

  const preparedXdr = await buildCreateEscrowTx(params);
  return signAndSubmitEscrowTx(preparedXdr);
}

export async function buildReleaseEscrowTransaction(
  _escrowContractId: string,
  jobId: string,
  clientPublicKey: string,
): Promise<{ toXDR: () => string }> {
  if (USE_CONTRACT_MOCK) {
    const { mockReleaseEscrow } = await import("./contractMock");
    await mockReleaseEscrow({ jobId, client: clientPublicKey });
    return { toXDR: () => "MOCK_UNSIGNED_XDR" };
  }

  throw new Error(
    "Release escrow requires NEXT_PUBLIC_USE_CONTRACT_MOCK=true or a deployed contract integration.",
  );
}

export async function submitSignedSorobanTransaction(
  _signedXDR: string,
): Promise<{ hash: string }> {
  if (USE_CONTRACT_MOCK) {
    return { hash: `mock-${Date.now().toString(16)}` };
  }

  throw new Error(
    "Soroban submission requires NEXT_PUBLIC_USE_CONTRACT_MOCK=true or RPC configuration.",
  );
}

export const USDC_SAC_ADDRESS = "";
export const XLM_SAC_ADDRESS = "";

export async function getEscrowState(_jobId: string) {
  return null;
}

export function subscribeToContractEvents(
  _jobId: string,
  _handler: (event: unknown) => void,
) {
  return () => {};
}

export async function buildPartialReleaseTransaction(
  _contractId: string,
  _jobId: string,
  _clientPublicKey: string,
  _index: number,
) {
  throw new Error("Partial release is not available in mock mode.");
}

// ---------------------------------------------------------------------------
// On-chain Message Notarization
// ---------------------------------------------------------------------------

export interface MessageTxParams {
  jobId: string;
  senderPublicKey: string;
  recipientPublicKey: string;
  ipfsCid: string;
}

/**
 * Builds a Soroban `publish_message` transaction, simulates it, and returns
 * a base64-encoded XDR ready for Freighter signing.
 */
export async function buildPublishMessageTx(
  params: MessageTxParams,
): Promise<string> {
  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file.",
    );
  }

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  const { jobId, senderPublicKey, recipientPublicKey, ipfsCid } = params;
  const account = await server.getAccount(senderPublicKey);

  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }),
    Address.fromString(senderPublicKey).toScVal(),
    Address.fromString(recipientPublicKey).toScVal(),
    nativeToScVal(ipfsCid, { type: "string" }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("publish_message", ...callArgs))
    .setTimeout(300)
    .build();

  const simResponse = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Soroban simulation failed: ${simResponse.error}`);
  }

  const assembledTx = SorobanRpc.assembleTransaction(tx, simResponse).build();
  return assembledTx.toXDR();
}

/**
 * Signs the prepared publish_message XDR via Freighter and submits it.
 * Returns the confirmed transaction hash.
 */
async function signAndSubmitToSoroban(
  preparedXdr: string,
): Promise<string> {
  const { signTransaction } = await getFreighter();

  const { signedTransaction } = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  const sendResponse = await server.sendTransaction(
    (() => {
      const { Transaction } = require("@stellar/stellar-sdk");
      return new Transaction(signedTransaction, NETWORK_PASSPHRASE);
    })(),
  );

  if (sendResponse.status === "ERROR") {
    const resultXdr = sendResponse.errorResult?.toXDR("base64") ?? "unknown";
    throw new Error(`Transaction submission failed. Result XDR: ${resultXdr}`);
  }

  const txHash = sendResponse.hash;

  let getResponse = await server.getTransaction(txHash);
  const MAX_POLLS = 20;
  let polls = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    polls < MAX_POLLS
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResponse = await server.getTransaction(txHash);
    polls++;
  }

  if (getResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `Transaction did not succeed. Status: ${getResponse.status}`,
    );
  }

  return txHash;
}

/**
 * Convenience: build → sign → submit publish_message in one call.
 * Returns the transaction hash.
 */
export async function publishMessageOnChain(
  params: MessageTxParams,
): Promise<string> {
  const preparedXdr = await buildPublishMessageTx(params);
  return signAndSubmitToSoroban(preparedXdr);
}

// ---------------------------------------------------------------------------
// Transaction History & Explorer URLs
// ---------------------------------------------------------------------------

/**
 * Fetch the native XLM balance for a Stellar account.
 * Returns "0" if the account does not exist yet.
 */
export async function getXLMBalance(publicKey: string): Promise<string> {
  try {
    const res = await fetch(
      `${HORIZON_URL}/accounts/${encodeURIComponent(publicKey)}`
    );
    if (!res.ok) return "0";
    const data = await res.json();
    const native = (data.balances ?? []).find(
      (b: { asset_type: string; balance: string }) => b.asset_type === "native"
    );
    return native?.balance ?? "0";
  } catch {
    return "0";
  }
}

// ---------------------------------------------------------------------------
// Build a boost_job Soroban transaction (Issue #344)
// ---------------------------------------------------------------------------

export interface BoostParams {
  /** Stellar public key of the client paying for the boost */
  clientPublicKey: string;
  /** Backend job UUID */
  jobId: string;
  /** Boost amount in XLM (5 = 7 days, 15 = 30 days) */
  amountXlm: number;
  /** Platform treasury address that receives the payment */
  treasuryAddress: string;
}

/**
 * Builds a Soroban transaction that calls `boost_job` on the contract.
 * Returns the assembled XDR string ready for Freighter signing.
 */
export async function buildBoostJobTx(params: BoostParams): Promise<string> {
  const { clientPublicKey, jobId, amountXlm, treasuryAddress } = params;

  if (!CONTRACT_ID) {
    throw new Error("NEXT_PUBLIC_CONTRACT_ID is not set.");
  }

  const server = sorobanServer;
  const account = await server.getAccount(clientPublicKey);
  const amountStroops = BigInt(Math.round(amountXlm * 10_000_000));

  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }),
    Address.fromString(clientPublicKey).toScVal(),
    Address.fromString(treasuryAddress).toScVal(),
    nativeToScVal(amountStroops, { type: "i128" }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("boost_job", ...callArgs))
    .setTimeout(300)
    .build();

  const simResponse = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Soroban simulation failed: ${simResponse.error}`);
  }

  return SorobanRpc.assembleTransaction(tx, simResponse).build().toXDR();
}

// ---------------------------------------------------------------------------
// Build + sign + submit helpers for generic Soroban transactions
// ---------------------------------------------------------------------------

/**
 * Sign an XDR transaction with Freighter and submit it to the Soroban RPC.
 * Polls until confirmed. Returns the transaction hash.
 */
export async function signAndSubmitSorobanTx(xdrString: string): Promise<string> {
  const { signTransaction } = await getFreighter();

  const { signedTransaction } = await signTransaction(xdrString, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const server = sorobanServer;
  const { Transaction } = await import("@stellar/stellar-sdk");
  const sendResponse = await server.sendTransaction(
    new Transaction(signedTransaction, NETWORK_PASSPHRASE)
  );

  if (sendResponse.status === "ERROR") {
    throw new Error(
      `Transaction submission failed: ${sendResponse.errorResult?.toXDR("base64") ?? "unknown"}`
    );
  }

  const txHash = sendResponse.hash;
  let getResponse = await server.getTransaction(txHash);
  let polls = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    polls < 20
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResponse = await server.getTransaction(txHash);
    polls++;
  }

  if (getResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction did not succeed. Status: ${getResponse.status}`);
  }

  return txHash;
}

// ---------------------------------------------------------------------------
// Release escrow helpers (used by jobs/[id].tsx)
// ---------------------------------------------------------------------------

export async function buildReleaseEscrowTransaction(
  contractId: string,
  jobId: string,
  clientPublicKey: string
) {
  const server = sorobanServer;
  const account = await server.getAccount(clientPublicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "release_escrow",
        nativeToScVal(jobId, { type: "string" }),
        Address.fromString(clientPublicKey).toScVal()
      )
    )
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build();
}

export async function buildPartialReleaseTransaction(
  contractId: string,
  jobId: string,
  clientPublicKey: string,
  milestoneIndex: number
) {
  const server = sorobanServer;
  const account = await server.getAccount(clientPublicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "partial_release",
        nativeToScVal(jobId, { type: "string" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
        Address.fromString(clientPublicKey).toScVal()
      )
    )
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build();
}

export async function submitSignedSorobanTransaction(
  signedXDR: string
): Promise<{ hash: string }> {
  const hash = await signAndSubmitSorobanTx(signedXDR);
  return { hash };
}

export async function getEscrowState(contractId: string, jobId: string) {
  const server = sorobanServer;
  const contract = new Contract(contractId);
  // Read-only call — simulate only
  const account = await server.getAccount(contractId).catch(() => null);
  if (!account) return null;
  // Return null for now; actual implementation would parse XDR result
  return null;
}

export async function subscribeToContractEvents(
  contractId: string,
  onEvent: (event: unknown) => void
) {
  // Placeholder — real implementation would use Horizon event streaming
  return () => {};
}

export const XLM_SAC_ADDRESS = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const USDC_SAC_ADDRESS = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export function accountUrl(publicKey: string): string {
  return `https://stellar.expert/explorer/testnet/account/${publicKey}`;
}

export async function signTransactionWithWallet(
  xdrString: string
): Promise<{ signedXDR: string | null; error: string | null }> {
  try {
    const { signTransaction } = await getFreighter();
    const { signedTransaction } = await signTransaction(xdrString, {
      network: "TESTNET",
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    return { signedXDR: signedTransaction, error: null };
  } catch (e) {
    return { signedXDR: null, error: e instanceof Error ? e.message : "Signing failed" };
  }
}
