/**
 * Real SEP-10 web-auth handshake, driven from Node instead of a browser
 * wallet extension. The frontend redoes this same challenge/sign/verify
 * round trip on every page load via `window.freighter` (see
 * `frontend/lib/wallet.ts` and `frontend/pages/_app.tsx`) — this module lets
 * fixtures perform the identical handshake directly against the real
 * backend so seeded data and a persona's browser session use the same JWT.
 */
import axios from "axios";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

export async function fetchChallenge(baseURL: string, publicKey: string): Promise<string> {
  const { data } = await axios.get<{ transaction: string }>(`${baseURL}/api/auth`, {
    params: { account: publicKey },
  });
  return data.transaction;
}

export function signChallenge(xdr: string, networkPassphrase: string, keypair: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  tx.sign(keypair);
  return tx.toXDR();
}

export async function verifyChallenge(baseURL: string, signedXdr: string): Promise<string> {
  const { data } = await axios.post<{ success: boolean; token: string }>(`${baseURL}/api/auth`, {
    transaction: signedXdr,
  });
  return data.token;
}

/** Full Node-side login: returns a real backend JWT for direct API seeding. */
export async function loginWithKeypair(
  baseURL: string,
  networkPassphrase: string,
  keypair: Keypair
): Promise<{ token: string; publicKey: string }> {
  const publicKey = keypair.publicKey();
  const challengeXdr = await fetchChallenge(baseURL, publicKey);
  const signedXdr = signChallenge(challengeXdr, networkPassphrase, keypair);
  const token = await verifyChallenge(baseURL, signedXdr);
  return { token, publicKey };
}
