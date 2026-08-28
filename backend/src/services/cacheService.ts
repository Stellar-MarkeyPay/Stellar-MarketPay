/**
 * src/services/cacheService.ts
 * Redis-backed cache with graceful degradation (#290).
 *
 * All public methods silently fall through to the caller on Redis errors so
 * the API never returns 5xx because Redis is down or misconfigured.
 *
 * TTLs:
 *   job listings  — 30 s  (jobs change frequently)
 *   profiles      — 300 s (5 min)
 */

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let client: Redis | null = null;

function getClient(): Redis | null {
  if (client) return client;
  try {
    client = new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    client.on("error", (err: Error) => {
      // Log but don't crash — graceful degradation
      console.warn("[cache] Redis error:", err.message);
    });
  } catch (err: any) {
    console.warn("[cache] Failed to create Redis client:", err.message);
    client = null;
  }
  return client;
}

/**
 * Build a deterministic cache key for job list queries.
 * Sorts params alphabetically so key is stable regardless of insertion order.
 */
export function jobListKey(queryParams: Record<string, string | undefined>): string {
  const sorted = Object.entries(queryParams)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return `jobs:list:${new URLSearchParams(sorted as [string, string][]).toString()}`;
}

/**
 * Build the profile cache key for a given public key.
 */
export function profileKey(publicKey: string): string {
  return `profile:${publicKey}`;
}

/**
 * Build the cache key for a single job detail lookup.
 */
export function jobDetailKey(jobId: string): string {
  return `job:detail:${jobId}`;
}

/**
 * Get a cached value. Returns null on miss or error.
 */
export async function get(key: string): Promise<any | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds.
 */
export async function set(key: string, value: any, ttlSeconds: number): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Swallow — graceful degradation
  }
}

/**
 * Delete all keys matching a glob pattern.
 * Used to invalidate job list cache on write operations.
 */
export async function delPattern(pattern: string): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // Swallow — graceful degradation
  }
}

/**
 * Delete a single key.
 */
export async function del(key: string): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // Swallow — graceful degradation
  }
}

// TTL constants exported so callers don't hard-code numbers.
export const TTL = {
  JOBS_LIST: 30, // 30 s — jobs change frequently
  PROFILE: 300, // 5 min
  JOB_DETAIL: 30, // 30 s — same volatility as the list; event-driven purge covers the rest
};
