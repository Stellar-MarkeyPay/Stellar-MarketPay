/**
 * Stellar asset / Soroban token contract addresses (#277).
 */

const NETWORK =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toLowerCase();

/** USDC Stellar Asset Contract (SAC) addresses per network */
export const USDC_CONTRACT_BY_NETWORK: Record<string, string> = {
  testnet:
    process.env.NEXT_PUBLIC_USDC_CONTRACT_ID ||
    "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  mainnet:
    process.env.NEXT_PUBLIC_USDC_CONTRACT_ID_MAINNET ||
    "CCW67TSZV3SSKGHXYSJCF3QNYXWJYNUX2X3HMXQDAMA",
};

export function getUsdcContractId(): string {
  return USDC_CONTRACT_BY_NETWORK[NETWORK === "mainnet" ? "mainnet" : "testnet"];
}

export type PaymentCurrency = "XLM" | "USDC";

export const SUPPORTED_CURRENCIES: PaymentCurrency[] = ["XLM", "USDC"];

/** 1 XLM = 10^7 stroops; USDC on Stellar uses 7 decimals as well */
export const STROOPS_PER_UNIT = 10_000_000;

export function toStroops(amount: number, currency: PaymentCurrency): bigint {
  const factor = STROOPS_PER_UNIT;
  return BigInt(Math.round(amount * factor));
}

/** Native XLM Stellar Asset Contract (SAC) addresses per network */
export const XLM_CONTRACT_BY_NETWORK: Record<string, string> = {
  testnet:
    process.env.NEXT_PUBLIC_XLM_CONTRACT_ID ||
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  mainnet:
    process.env.NEXT_PUBLIC_XLM_CONTRACT_ID_MAINNET ||
    "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
};

export function getXlmContractId(): string {
  return XLM_CONTRACT_BY_NETWORK[NETWORK === "mainnet" ? "mainnet" : "testnet"];
}

export function tokenAddressForCurrency(currency: PaymentCurrency = "XLM"): string {
  if (currency === "USDC") return getUsdcContractId();
  return getXlmContractId();
}

