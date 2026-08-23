"use strict";

const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { getClientIp } = require("../utils/clientIp");
const { RedisRateLimitStore } = require("./redisRateLimitStore");

function hashRateLimitIdentifier(kind, value) {
  return crypto
    .createHash("sha256")
    .update(`${kind}:${String(value || "")}`)
    .digest("hex");
}

function getRetryAfterSeconds(req, requestPropertyName, fallbackSeconds) {
  const info = req?.[requestPropertyName] || req?.rateLimit;
  const resetTime = info?.resetTime instanceof Date ? info.resetTime.getTime() : null;

  if (Number.isFinite(resetTime)) {
    return Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
  }

  return Math.max(1, Math.ceil(fallbackSeconds));
}

/**
 * Factory function to create reusable rate limiters.
 *
 * Existing callers may continue using createRateLimiter(max, windowMinutes).
 * Sensitive routes can additionally supply a shared store and a custom key.
 */
const createRateLimiter = (maxRequests, windowMinutes, options = {}) => {
  const windowMs = Number(windowMinutes) * 60 * 1000;
  const max = Number(maxRequests);

  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new TypeError("windowMinutes must be a positive number");
  }
  if (!Number.isInteger(max) || max <= 0) {
    throw new TypeError("maxRequests must be a positive integer");
  }

  const requestPropertyName = options.requestPropertyName || "rateLimit";
  const config = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: options.legacyHeaders ?? true,
    keyGenerator: options.keyGenerator || ((req) => getClientIp(req)),
    requestPropertyName,
    handler: (req, res) => {
      const retryAfter = getRetryAfterSeconds(req, requestPropertyName, windowMs / 1000);
      res.set("Retry-After", String(retryAfter));
      res.set("Cache-Control", "no-store");
      return res.status(429).json({
        message: "Too many requests — please wait before trying again",
      });
    },
  };

  if (options.store) config.store = options.store;
  if (options.skip) config.skip = options.skip;
  return rateLimit(config);
};

function normalizePrincipal(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase();
}

function safePropertySuffix(namespace) {
  return String(namespace).replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * A principal supplied before authentication must not become a global lockout
 * handle. Otherwise an attacker who merely knows a wallet/public key can burn
 * that principal's quota from arbitrary clients.
 *
 * Authenticated principals get a global principal bucket. Untrusted principals
 * are bound to the effective client IP, while the independent IP bucket still
 * limits clients that rotate principals.
 */
function getPrincipalBucketIdentity(req, principal) {
  const normalized = normalizePrincipal(principal);
  if (!normalized) return "";

  const authenticated = normalizePrincipal(req?.user?.publicKey);
  if (authenticated && authenticated === normalized) {
    return `trusted:${normalized}`;
  }

  return `preauth:${normalized}:ip:${getClientIp(req)}`;
}

/**
 * Builds two shared-state limiters for a sensitive endpoint:
 *
 * 1. an independent client-IP bucket; and
 * 2. a principal bucket whose scope depends on principal provenance.
 *
 * Authenticated principals are limited across IPs. Caller-supplied pre-auth
 * principals are IP-bound to avoid turning rate limiting into a targeted
 * denial-of-service primitive.
 */
function createSensitiveRateLimiters({
  namespace,
  windowMinutes,
  maxRequestsPerIp,
  maxRequestsPerPrincipal,
  principalKeyGenerator,
  storeFactory,
}) {
  if (!namespace) throw new TypeError("namespace is required");
  if (typeof principalKeyGenerator !== "function") {
    throw new TypeError("principalKeyGenerator must be a function");
  }

  const makeStore =
    storeFactory ||
    (({ prefix }) => {
      return new RedisRateLimitStore({ prefix });
    });

  const suffix = safePropertySuffix(namespace);
  const getPrincipal = (req) => normalizePrincipal(principalKeyGenerator(req));

  const ipLimiter = createRateLimiter(maxRequestsPerIp, windowMinutes, {
    store: makeStore({ prefix: `${namespace}:ip:` }),
    keyGenerator: (req) => hashRateLimitIdentifier("ip", getClientIp(req)),
    requestPropertyName: `rateLimit_${suffix}_ip`,
    legacyHeaders: false,
  });

  const principalLimiter = createRateLimiter(maxRequestsPerPrincipal, windowMinutes, {
    store: makeStore({ prefix: `${namespace}:principal:` }),
    skip: (req) => !getPrincipal(req),
    keyGenerator: (req) =>
      hashRateLimitIdentifier("principal", getPrincipalBucketIdentity(req, getPrincipal(req))),
    requestPropertyName: `rateLimit_${suffix}_principal`,
    legacyHeaders: false,
  });

  return [ipLimiter, principalLimiter];
}

module.exports = {
  createRateLimiter,
  createSensitiveRateLimiters,
  getPrincipalBucketIdentity,
  getRetryAfterSeconds,
  hashRateLimitIdentifier,
  normalizePrincipal,
};
