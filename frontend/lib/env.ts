// Static references so Next.js Webpack DefinePlugin inlines them into browser bundles
const STATIC_CLIENT_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
  NEXT_PUBLIC_SOROBAN_RPC_URL: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
  NEXT_PUBLIC_CONTRACT_ID: process.env.NEXT_PUBLIC_CONTRACT_ID,
  NEXT_PUBLIC_GOVERNANCE_TOKEN_ID: process.env.NEXT_PUBLIC_GOVERNANCE_TOKEN_ID,
  NEXT_PUBLIC_CERTIFICATE_CONTRACT_ID: process.env.NEXT_PUBLIC_CERTIFICATE_CONTRACT_ID,
  NEXT_PUBLIC_ORACLE_CONTRACT_ID: process.env.NEXT_PUBLIC_ORACLE_CONTRACT_ID,
  NEXT_PUBLIC_USE_CONTRACT_MOCK: process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK,
};

const DEFAULT_CLIENT_ENV: Record<string, string> = {
  NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
  NEXT_PUBLIC_HORIZON_URL: "https://horizon-testnet.stellar.org",
  NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  NEXT_PUBLIC_CONTRACT_ID: "CBYODFFD7JLCVBFJQJV7RVHRIUI42AAWQK7QDPXLJQATDLNCMIWWASYS",
  NEXT_PUBLIC_GOVERNANCE_TOKEN_ID: "CBLBGXQAMPCSRKKBGAXBDRRRGA5VHJ34X2W4F3JHOYYJUZVZJXBTSICQ",
  NEXT_PUBLIC_CERTIFICATE_CONTRACT_ID: "CD34BVGIHT3MZG6NXUGXA2ZEOLNAVOPNIQH7TLMCVMMEHADZ2HURN6AY",
  NEXT_PUBLIC_ORACLE_CONTRACT_ID: "CAP4SGXXQFY4ZGI2SP2Y6OPW72O6XPUHZS3IOPFM356TUBWJRFKO42SI",
  NEXT_PUBLIC_API_URL: "http://localhost:4000",
};

export function requireClientEnv(name: string, fallback?: string): string {
  const value =
    STATIC_CLIENT_ENV[name]?.trim() ||
    process.env[name]?.trim() ||
    fallback?.trim() ||
    DEFAULT_CLIENT_ENV[name] ||
    "";
  if (!value) {
    throw new Error(`${name} is not set. Add it to your .env.local file.`);
  }
  return value;
}

export function optionalClientEnv(name: string, fallback: string): string {
  return (
    STATIC_CLIENT_ENV[name]?.trim() ||
    process.env[name]?.trim() ||
    fallback ||
    DEFAULT_CLIENT_ENV[name] ||
    ""
  );
}
