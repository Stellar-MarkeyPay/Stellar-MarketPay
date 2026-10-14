/**
 * lib/wallet.ts
 * Freighter wallet integration for Stellar MarketPay.
 */

import {
  isConnected,
  getPublicKey,
  signTransaction,
  requestAccess,
  isAllowed,
  getNetworkDetails,
} from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "./stellar";
import { fetchAuthChallenge, verifyAuthChallenge, setJwtToken } from "./api";

type FreighterWindowApi = {
  isConnected?: () => Promise<boolean | { isConnected?: boolean }>;
  isAllowed?: () => Promise<boolean | { isAllowed?: boolean }>;
  requestAccess?: () => Promise<unknown>;
  getPublicKey?: () => Promise<string | { publicKey?: string; error?: string }>;
  signTransaction?: (
    transactionXDR: string,
    opts: Record<string, unknown>
  ) => Promise<string | { signedTransaction?: string }>;
  getNetworkDetails?: () => Promise<{ network?: string; networkUrl?: string; networkPassphrase?: string; error?: string }>;
};

function getWindowFreighter(): FreighterWindowApi | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { freighter?: FreighterWindowApi };
  return w.freighter ?? null;
}

export async function isFreighterInstalled(): Promise<boolean> {
  const freighter = getWindowFreighter();
  if (freighter?.isConnected) {
    try {
      const result = await freighter.isConnected();
      if (typeof result === "object" && result !== null && "isConnected" in result) {
        return Boolean((result as { isConnected?: boolean }).isConnected);
      }
      return Boolean(result);
    } catch {
      return false;
    }
  }

  try {
    const result = await isConnected();
    if (typeof result === "object" && result !== null && "isConnected" in result) {
      return Boolean((result as any).isConnected);
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

export type WalletErrorType = "NOT_INSTALLED" | "LOCKED" | "NETWORK_MISMATCH" | "USER_REJECTED" | "GENERIC";

export interface WalletConnectResult {
  publicKey: string | null;
  error: string | null;
  errorCode?: WalletErrorType;
}

export async function connectWallet(): Promise<WalletConnectResult> {
  const installed = await isFreighterInstalled();
  if (!installed) {
    return {
      publicKey: null,
      error: "Freighter wallet not installed. Please install the extension at https://freighter.app",
      errorCode: "NOT_INSTALLED",
    };
  }

  const freighter = getWindowFreighter();
  
  // Verify network match if possible before requesting access
  try {
    const networkResult = freighter?.getNetworkDetails ? await freighter.getNetworkDetails() : await getNetworkDetails();
    if (networkResult && typeof networkResult === 'object' && networkResult.networkPassphrase) {
      if (networkResult.networkPassphrase !== NETWORK_PASSPHRASE) {
        return {
          publicKey: null,
          error: \Network mismatch. Please switch your Freighter wallet to \.\,
          errorCode: "NETWORK_MISMATCH",
        };
      }
    }
  } catch (err) {
    // Ignore error, might fail if locked
  }

  try {
    if (freighter?.requestAccess) {
      await freighter.requestAccess();
    } else {
      await requestAccess();
    }
    
    // Check network again after access is granted (if it failed before due to lock)
    try {
      const networkResult = freighter?.getNetworkDetails ? await freighter.getNetworkDetails() : await getNetworkDetails();
      if (networkResult && typeof networkResult === 'object' && networkResult.networkPassphrase) {
        if (networkResult.networkPassphrase !== NETWORK_PASSPHRASE) {
          return {
            publicKey: null,
            error: \Network mismatch. Please switch your Freighter wallet to \.\,
            errorCode: "NETWORK_MISMATCH",
          };
        }
      }
    } catch (e) {
      // Ignore error
    }

    const result = freighter?.getPublicKey ? await freighter.getPublicKey() : await getPublicKey();
    const publicKey =
      typeof result === "object" && result !== null && "publicKey" in result
        ? (result as any).publicKey
        : (result as string);
        
    if (!publicKey) {
       return { publicKey: null, error: "Freighter is locked. Please open the extension and unlock it.", errorCode: "LOCKED" };
    }
    
    return { publicKey: publicKey || null, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("User declined") || msg.toLowerCase().includes("reject")) {
      return { publicKey: null, error: "Connection rejected. Please approve the request in Freighter.", errorCode: "USER_REJECTED" };
    }
    if (msg.toLowerCase().includes("locked") || msg.toLowerCase().includes("timeout")) {
      return { publicKey: null, error: "Freighter is locked. Please open the extension and unlock it.", errorCode: "LOCKED" };
    }
    return { publicKey: null, error: \Wallet connection failed: \\, errorCode: "GENERIC" };
  }
}

export async function getConnectedPublicKey(): Promise<string | null> {
  const freighter = getWindowFreighter();
  try {
    const allowed = freighter?.isAllowed ? await freighter.isAllowed() : await isAllowed();
    const isAllowedBool =
      typeof allowed === "object" && allowed !== null && "isAllowed" in allowed
        ? (allowed as any).isAllowed
        : Boolean(allowed);
    if (!isAllowedBool) return null;
    
    // Check network mismatch, return null so we don't act as connected on wrong network
    const networkResult = freighter?.getNetworkDetails ? await freighter.getNetworkDetails() : await getNetworkDetails();
    if (networkResult && typeof networkResult === 'object' && networkResult.networkPassphrase) {
      if (networkResult.networkPassphrase !== NETWORK_PASSPHRASE) {
        return null;
      }
    }

    const result = freighter?.getPublicKey ? await freighter.getPublicKey() : await getPublicKey();
    const pk =
      typeof result === "object" && result !== null && "publicKey" in result
        ? (result as any).publicKey
        : (result as string);
    return pk || null;
  } catch {
    return null;
  }
}

/**
 * Run the full SEP-0010 auth flow after wallet connection.
 * Returns the JWT on success, or an error string.
 */
export async function performSEP0010Auth(
  publicKey: string
): Promise<{ token: string | null; error: string | null }> {
  try {
    const challengeXDR = await fetchAuthChallenge(publicKey);
    const { signedXDR, error: signError } = await signTransactionWithWallet(challengeXDR);
    if (signError || !signedXDR) {
      return { token: null, error: signError || "Failed to sign challenge" };
    }
    const token = await verifyAuthChallenge(signedXDR);
    setJwtToken(token);
    return { token, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { token: null, error: \Authentication failed: \\ };
  }
}

export async function signTransactionWithWallet(
  transactionXDR: string,
  mockParams?: any
): Promise<{ signedXDR: string | null; error: string | null; mockParams?: any }> {
  // Mock mode: bypass Freighter entirely
  if (
    process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true" &&
    transactionXDR === "MOCK_UNSIGNED_XDR"
  ) {
    console.log("[WALLET] Mock mode: skipping Freighter signature");
    return { signedXDR: "MOCK_SIGNED_XDR", error: null, mockParams };
  }

  const freighter = getWindowFreighter();
  try {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
    const result = freighter?.signTransaction
      ? await freighter.signTransaction(transactionXDR, {
          networkPassphrase: NETWORK_PASSPHRASE,
          network,
        })
      : await signTransaction(transactionXDR, { networkPassphrase: NETWORK_PASSPHRASE, network });
    const signedXDR =
      typeof result === "object" && result !== null && "signedTransaction" in result
        ? (result as any).signedTransaction
        : (result as string);
    return { signedXDR, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("User declined") || msg.includes("rejected"))
      return { signedXDR: null, error: "Transaction signing rejected." };
    return { signedXDR: null, error: \Signing failed: \\ };
  }
}
