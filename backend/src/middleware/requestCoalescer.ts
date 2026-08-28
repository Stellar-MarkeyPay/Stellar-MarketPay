/**
 * src/middleware/requestCoalescer.ts
 * Cache-stampede protection via single-flight request coalescing (#91).
 */
const inFlight = new Map<string, Promise<any>>();

export async function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(() => fn())
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/** Test/metrics hook — number of distinct keys currently in flight. */
export function _inFlightCount(): number {
  return inFlight.size;
}
