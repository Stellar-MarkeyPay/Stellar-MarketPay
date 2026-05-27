import {
  Networks,
  TransactionBuilder,
  Transaction,
  BASE_FEE,
  Contract,
  Address,
  nativeToScVal,
  xdr,
  Operation,
  Asset,
  Memo,
} from "@stellar/stellar-sdk";
import * as SorobanRpc from "@stellar/stellar-sdk/rpc";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const NETWORK_PASSPHRASE = Networks.TESTNET;
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";

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

// ---------------------------------------------------------------------------
// Freighter helpers (browser-only)
// ---------------------------------------------------------------------------

async function getFreighter() {
  if (typeof window === "undefined") {
    throw new Error("Freighter is only available in the browser.");
  }
  // Freighter injects window.freighter; fall back to @stellar/freighter-api
  // when the extension is installed it patches the global.
  const { isConnected, getPublicKey, signTransaction } = await import(
    "@stellar/freighter-api"
  );

  const connected = await isConnected();
  if (!connected) {
    throw new Error(
      "Freighter wallet not found. Please install the Freighter extension."
    );
  }
  return { getPublicKey, signTransaction };
}

// ---------------------------------------------------------------------------
// Core: build the Soroban create_escrow transaction
// ---------------------------------------------------------------------------

/**
 * Builds, simulates, and returns a base64-encoded XDR transaction that invokes
 * `create_escrow(job_id: String, client: Address, amount: i128)` on the
 * deployed Soroban contract.
 *
 * The returned XDR is ready to be signed by Freighter and submitted.
 */
export async function buildCreateEscrowTx(
  params: EscrowParams
): Promise<string> {
  const { clientPublicKey, jobId, budgetXlm } = params;

  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file."
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
    throw new Error(
      `Soroban simulation failed: ${simResponse.error}`
    );
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
  preparedXdr: string
): Promise<EscrowResult> {
  const { signTransaction } = await getFreighter();

  // Ask the user to sign
  const signResult = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedTransaction =
    typeof signResult === "object" && signResult !== null && "signedTransaction" in signResult
      ? (signResult as unknown as { signedTransaction: string }).signedTransaction
      : signResult as unknown as string;

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  // Submit the signed transaction
  const sendResponse = await server.sendTransaction(
    // Re-parse from the signed XDR
    (() => {
      const { Transaction } = require("@stellar/stellar-sdk");
      return new Transaction(signedTransaction, NETWORK_PASSPHRASE);
    })()
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
      `Transaction did not succeed. Status: ${getResponse.status}`
    );
  }

  return { txHash };
}

// ---------------------------------------------------------------------------
// Convenience: build → sign → submit in one call
// ---------------------------------------------------------------------------

export async function createEscrowOnChain(
  params: EscrowParams
): Promise<EscrowResult> {
  const preparedXdr = await buildCreateEscrowTx(params);
  return signAndSubmitEscrowTx(preparedXdr);
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

const STELLAR_EXPERT_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "public" : "testnet";

export function accountUrl(address: string): string {
  return `https://stellar.expert/explorer/${STELLAR_EXPERT_NETWORK}/account/${address}`;
}

export function explorerUrl(txHash: string): string {
  return `https://stellar.expert/explorer/${STELLAR_EXPERT_NETWORK}/tx/${txHash}`;
}

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

export async function getXLMBalance(publicKey: string): Promise<string> {
  const horizonUrl =
    process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
  const res = await fetch(`${horizonUrl}/accounts/${publicKey}`);
  if (!res.ok) return "0";
  const data = await res.json();
  const native = (data.balances ?? []).find(
    (b: { asset_type: string; balance: string }) => b.asset_type === "native"
  );
  return native?.balance ?? "0";
}

// ---------------------------------------------------------------------------
// Horizon server (exported for components that need a raw server reference)
// ---------------------------------------------------------------------------

export const server = {
  baseUrl:
    process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org",
};

// ---------------------------------------------------------------------------
// Transaction history
// ---------------------------------------------------------------------------

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
  marketPayType?: "escrow" | string;
}

export async function fetchMarketPayTransactions(
  publicKey: string,
  limit = 20,
  cursor?: string
): Promise<{ transactions: MarketPayTransaction[]; hasMore: boolean }> {
  const horizonUrl =
    process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";

  const params = new URLSearchParams({
    limit: String(limit + 1),
    order: "desc",
  });
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(
    `${horizonUrl}/accounts/${publicKey}/payments?${params}`
  );
  if (!res.ok) throw new Error("Failed to fetch transactions");

  const data = await res.json();
  const records: any[] = data._embedded?.records ?? [];
  const hasMore = records.length > limit;
  const slice = records.slice(0, limit);

  const transactions: MarketPayTransaction[] = slice.map((r: any) => ({
    id: r.id,
    hash: r.transaction_hash,
    ledger: r.transaction?.ledger ?? 0,
    created_at: r.created_at,
    from: r.from ?? r.funder ?? "",
    to: r.to ?? r.account ?? "",
    amount: r.amount ?? "0",
    asset: r.asset_type === "native" ? "XLM" : (r.asset_code ?? ""),
    memo: r.transaction?.memo,
    memo_type: r.transaction?.memo_type,
    successful: r.transaction_successful ?? true,
    marketPayType: r.transaction?.memo_type === "text" &&
      typeof r.transaction?.memo === "string" &&
      r.transaction.memo.startsWith("escrow:") ? "escrow" : undefined,
  }));

  return { transactions, hasMore };
}

// ---------------------------------------------------------------------------
// Soroban release_escrow helpers
// ---------------------------------------------------------------------------

export async function buildReleaseEscrowTransaction(
  contractId: string,
  jobId: string,
  publicKey: string
): Promise<Transaction> {
  const sorobanUrl =
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
  const rpc = new SorobanRpc.Server(sorobanUrl, { allowHttp: false });
  const account = await rpc.getAccount(publicKey);

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call("release_escrow", nativeToScVal(jobId, { type: "string" }))
    )
    .setTimeout(300)
    .build();

  const sim = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build() as unknown as Transaction;
}

export async function buildPartialReleaseTransaction(
  contractId: string,
  jobId: string,
  publicKey: string,
  milestoneIndex: number
): Promise<Transaction> {
  const sorobanUrl =
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
  const rpc = new SorobanRpc.Server(sorobanUrl, { allowHttp: false });
  const account = await rpc.getAccount(publicKey);

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "partial_release",
        nativeToScVal(jobId, { type: "string" }),
        nativeToScVal(BigInt(milestoneIndex), { type: "i64" })
      )
    )
    .setTimeout(300)
    .build();

  const sim = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build() as unknown as Transaction;
}

export async function submitSignedSorobanTransaction(
  signedXDR: string
): Promise<{ hash: string }> {
  const sorobanUrl =
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
  const rpc = new SorobanRpc.Server(sorobanUrl, { allowHttp: false });

  const tx = new Transaction(signedXDR, Networks.TESTNET);
  const send = await rpc.sendTransaction(tx);

  if (send.status === "ERROR") {
    throw new Error(`Submission failed: ${send.errorResult?.toXDR("base64") ?? "unknown"}`);
  }

  const hash = send.hash;
  let poll = await rpc.getTransaction(hash);
  let attempts = 0;
  while (poll.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
    await new Promise((r) => setTimeout(r, 1500));
    poll = await rpc.getTransaction(hash);
    attempts++;
  }

  if (poll.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction did not succeed. Status: ${poll.status}`);
  }

  return { hash };
}

// ---------------------------------------------------------------------------
// Soroban RPC server singleton (used by sorobanFees.ts)
// ---------------------------------------------------------------------------

export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL, {
  allowHttp: false,
});

// ---------------------------------------------------------------------------
// Horizon payment helpers
// ---------------------------------------------------------------------------

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

export interface PaymentParams {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
  asset: "XLM" | "USDC";
}

export async function buildPaymentTransaction(
  params: PaymentParams
): Promise<Transaction> {
  const { fromPublicKey, toPublicKey, amount, memo, asset } = params;

  const account = await sorobanServer.getAccount(fromPublicKey);

  const paymentAsset =
    asset === "XLM" ? Asset.native() : new Asset("USDC", USDC_ISSUER);

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(
    Operation.payment({ destination: toPublicKey, asset: paymentAsset, amount })
  ).setTimeout(180);

  if (memo) builder.addMemo(Memo.text(memo));

  return builder.build() as unknown as Transaction;
}

export async function submitTransaction(
  signedXDR: string
): Promise<{ hash: string }> {
  const res = await fetch(`${HORIZON_URL}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(signedXDR)}`,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code =
      err?.extras?.result_codes?.transaction ?? "Transaction submission failed";
    throw new Error(code);
  }

  const data = await res.json();
  return { hash: data.hash as string };
}