"use strict";

const crypto = require("crypto");
const { getRateLimitRedisClient, storeUnavailableError } = require("./redisRateLimitStore");

const FAILURE_SCRIPT = `
local attempts = redis.call("INCR", KEYS[1])
redis.call("PEXPIRE", KEYS[1], ARGV[1])

local threshold = tonumber(ARGV[2])
if attempts < threshold then
  return { attempts, 0 }
end

local exponent = attempts - threshold
local delay = tonumber(ARGV[3]) * math.pow(2, exponent)
local maxDelay = tonumber(ARGV[4])
if delay > maxDelay then
  delay = maxDelay
end

redis.call("SET", KEYS[2], "1", "PX", math.floor(delay))
return { attempts, math.floor(delay) }
`;

function hashPrincipal(namespace, principal) {
  return crypto
    .createHash("sha256")
    .update(`${namespace}:${String(principal).trim().toUpperCase()}`)
    .digest("hex");
}

function createPrincipalBackoff({
  namespace,
  principalKeyGenerator,
  threshold = 5,
  historyWindowMinutes = 15,
  baseDelaySeconds = 5,
  maxDelaySeconds = 300,
  failureStatusCodes = [400, 401, 403, 404],
  client,
}) {
  if (!namespace) throw new TypeError("namespace is required");
  if (typeof principalKeyGenerator !== "function") {
    throw new TypeError("principalKeyGenerator must be a function");
  }

  const failureStatuses = new Set(failureStatusCodes.map(Number));
  const redis = client || getRateLimitRedisClient();
  const historyTtlMs = Math.ceil(historyWindowMinutes * 60 * 1000);
  const baseDelayMs = Math.ceil(baseDelaySeconds * 1000);
  const maxDelayMs = Math.ceil(maxDelaySeconds * 1000);

  return async function principalBackoff(req, res, next) {
    let principal;
    try {
      principal = principalKeyGenerator(req);
    } catch {
      principal = null;
    }

    if (!principal) return next();

    const hashed = hashPrincipal(namespace, principal);
    const failureKey = `marketpay:auth-backoff:${namespace}:failures:${hashed}`;
    const blockKey = `marketpay:auth-backoff:${namespace}:blocked:${hashed}`;

    let blockedTtlMs;
    try {
      blockedTtlMs = Number(await redis.pttl(blockKey));
    } catch (error) {
      return next(storeUnavailableError(error));
    }

    if (blockedTtlMs > 0) {
      res.set("Retry-After", String(Math.max(1, Math.ceil(blockedTtlMs / 1000))));
      return res.status(429).json({
        message: "Too many requests — please wait before trying again",
      });
    }

    res.once("finish", () => {
      const status = Number(res.statusCode);

      if (status >= 200 && status < 300) {
        redis.del(failureKey, blockKey).catch((error) => {
          console.warn("[auth-backoff] Could not reset failure state:", error.message);
        });
        return;
      }

      if (!failureStatuses.has(status)) return;

      redis
        .eval(
          FAILURE_SCRIPT,
          2,
          failureKey,
          blockKey,
          String(historyTtlMs),
          String(threshold),
          String(baseDelayMs),
          String(maxDelayMs)
        )
        .catch((error) => {
          console.warn("[auth-backoff] Could not record failure:", error.message);
        });
    });

    return next();
  };
}

module.exports = { createPrincipalBackoff };
