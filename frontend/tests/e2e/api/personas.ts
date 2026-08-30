import { Keypair } from "@stellar/stellar-sdk";

/**
 * Fixed, testnet-only keypair with no funds and no mainnet use — committed
 * on purpose. Its public key must be known synchronously when
 * `playwright.config.ts` builds the backend webServer's env (to seed
 * ADMIN_WALLET_ADDRESSES), which rules out generating it at runtime.
 * Committing a "secret key" here is intentional, not a leaked credential.
 */
const ADMIN_SECRET = "SBRZLLKDXS4YFK7MKVC3YFNZA3B3DTD4OQBO3ZZOLYT753L6YVPRSB7W";
export const ADMIN = Keypair.fromSecret(ADMIN_SECRET);

/**
 * Client/freelancer/arbitrator personas have no such constraint, so a fresh
 * keypair per persona instantiation avoids shared-identity races between
 * parallel workers and specs.
 */
export function randomPersonaKeypair(): Keypair {
  return Keypair.random();
}
