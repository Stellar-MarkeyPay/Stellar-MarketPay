import type { Page } from "@playwright/test";
import type { Keypair } from "@stellar/stellar-sdk";
import { signChallenge } from "../api/sep10";

/**
 * Stubs `window.freighter` (see `frontend/lib/wallet.ts`) so the app's real
 * SEP-10 bootstrap (`frontend/pages/_app.tsx`) signs its challenge with a
 * real Stellar keypair instead of talking to the Freighter extension.
 *
 * The private key never crosses into browser JS: `signTransaction` calls
 * back into Node via `page.exposeFunction`, where the real signing happens.
 */
export async function installFreighterStub(
  page: Page,
  keypair: Keypair,
  networkPassphrase: string
): Promise<void> {
  await page.exposeFunction("__sep10Sign__", (xdr: string) => {
    try {
      return signChallenge(xdr, networkPassphrase, keypair);
    } catch {
      // Not a real Stellar transaction envelope — e.g. the app also routes
      // mock Soroban escrow XDRs (NEXT_PUBLIC_USE_CONTRACT_MOCK=true) through
      // this same signTransaction call. The mock contract layer never
      // inspects the signed value, so any string is a safe passthrough.
      return `mock-signed:${xdr}`;
    }
  });

  await page.addInitScript((publicKey: string) => {
    try {
      localStorage.setItem("smp_wallet_public_key", publicKey);
    } catch {}
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: true }),
      isAllowed: async () => ({ isAllowed: true }),
      requestAccess: async () => ({ error: null }),
      getPublicKey: async () => ({ publicKey }),
      signTransaction: async (xdr: string) => ({
        signedTransaction: await (window as any).__sep10Sign__(xdr),
      }),
    };
  }, keypair.publicKey());
}
