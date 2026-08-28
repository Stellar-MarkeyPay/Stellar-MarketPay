import { Horizon } from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
export const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { data: Horizon.AccountResponse; timestamp: number }>();
const inFlight = new Map<string, Promise<Horizon.AccountResponse>>();

function getServer(): Horizon.Server {
  return new Horizon.Server(HORIZON_URL);
}

export async function getAccount(publicKey: string): Promise<Horizon.AccountResponse> {
  if (!publicKey) {
    const e = new Error("Public key is required") as Error & { status?: number };
    e.status = 400;
    throw e;
  }

  const now = Date.now();
  const cached = cache.get(publicKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  if (inFlight.has(publicKey)) {
    return inFlight.get(publicKey)!;
  }

  const promise = (async () => {
    try {
      const server = getServer();
      const account = await server.loadAccount(publicKey);
      cache.set(publicKey, { data: account, timestamp: Date.now() });
      return account;
    } finally {
      inFlight.delete(publicKey);
    }
  })();

  inFlight.set(publicKey, promise);
  return promise;
}

export function invalidate(publicKey: string): void {
  cache.delete(publicKey);
}

export function invalidateAll(): void {
  cache.clear();
}

export function getCacheSize(): number {
  return cache.size;
}
