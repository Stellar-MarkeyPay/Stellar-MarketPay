"use strict";

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const ROOT_PREFIX = "marketpay:rate-limit:";

const INCREMENT_SCRIPT = `
local total = redis.call("INCR", KEYS[1])
if total == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { total, ttl }
`;

const DECREMENT_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return 0
end
current = tonumber(current)
if current <= 1 then
  redis.call("DEL", KEYS[1])
  return 0
end
return redis.call("DECR", KEYS[1])
`;

let sharedClient = null;

function createSharedClient() {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2500,
    retryStrategy(times) {
      return times <= 1 ? 100 : null;
    },
  });

  client.on("error", () => {
    // Keep connection details out of logs. Request handling receives a
    // generic 503 through storeUnavailableError when the store cannot serve.
    console.warn("[rate-limit] Redis connection unavailable");
  });

  return client;
}

function getRateLimitRedisClient() {
  if (!sharedClient) sharedClient = createSharedClient();
  return sharedClient;
}

function storeUnavailableError(cause) {
  const error = new Error("Rate limiting service unavailable");
  error.status = 503;
  error.cause = cause;
  return error;
}

class RedisRateLimitStore {
  constructor({ prefix, client } = {}) {
    if (!prefix || typeof prefix !== "string") {
      throw new TypeError("RedisRateLimitStore requires a non-empty prefix");
    }

    this.prefix = `${ROOT_PREFIX}${prefix}`;
    this.localKeys = false;
    this.client = client || getRateLimitRedisClient();
    this.windowMs = null;
  }

  init(options) {
    const windowMs = Number(options?.windowMs);
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new TypeError("RedisRateLimitStore requires a positive windowMs");
    }
    this.windowMs = Math.ceil(windowMs);
  }

  key(key) {
    return `${this.prefix}${key}`;
  }

  async increment(key) {
    if (!this.windowMs) {
      throw new Error("RedisRateLimitStore has not been initialized");
    }

    try {
      const result = await this.client.eval(
        INCREMENT_SCRIPT,
        1,
        this.key(key),
        String(this.windowMs)
      );
      const totalHits = Number(result?.[0]);
      const ttlMs = Number(result?.[1]);

      if (!Number.isInteger(totalHits) || totalHits < 1 || !Number.isFinite(ttlMs)) {
        throw new Error("Invalid rate-limit response from Redis");
      }

      return {
        totalHits,
        resetTime: new Date(Date.now() + Math.max(0, ttlMs)),
      };
    } catch (error) {
      if (error?.status === 503) throw error;
      throw storeUnavailableError(error);
    }
  }

  async decrement(key) {
    try {
      await this.client.eval(DECREMENT_SCRIPT, 1, this.key(key));
    } catch (error) {
      throw storeUnavailableError(error);
    }
  }

  async resetKey(key) {
    try {
      await this.client.del(this.key(key));
    } catch (error) {
      throw storeUnavailableError(error);
    }
  }

  async resetAll() {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          "MATCH",
          `${this.prefix}*`,
          "COUNT",
          100
        );
        cursor = nextCursor;
        if (keys.length) await this.client.del(...keys);
      } while (cursor !== "0");
    } catch (error) {
      throw storeUnavailableError(error);
    }
  }
}

module.exports = {
  RedisRateLimitStore,
  getRateLimitRedisClient,
  storeUnavailableError,
};
