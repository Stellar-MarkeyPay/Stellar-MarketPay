import crypto from "crypto";
import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
// @ts-ignore
import { getClientIp } from "../utils/clientIp";
const { RedisRateLimitStore } = require("./redisRateLimitStore");

export function hashRateLimitIdentifier(kind: string, value: any): string {
  return crypto
    .createHash("sha256")
    .update(`${kind}:${String(value || "")}`)
    .digest("hex");
}

export function getRetryAfterSeconds(
  req: any,
  requestPropertyName: string,
  fallbackSeconds: number
): number {
  const info = req?.[requestPropertyName] || req?.rateLimit;
  const resetTime = info?.resetTime instanceof Date ? info.resetTime.getTime() : null;

  if (Number.isFinite(resetTime)) {
    return Math.max(1, Math.ceil((resetTime! - Date.now()) / 1000));
  }

  return Math.max(1, Math.ceil(fallbackSeconds));
}

/**
 * Factory function to create reusable rate limiters.
 *
 * Existing callers may continue using createRateLimiter(max, windowMinutes).
 * Sensitive routes can additionally supply a shared store and a custom key.
 */
export const createRateLimiter = (
  maxRequests: number,
  windowMinutes: number,
  options: any = {}
) => {
  const windowMs = Number(windowMinutes) * 60 * 1000;
  const max = Number(maxRequests);

  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new TypeError("windowMinutes must be a positive number");
  }
  if (!Number.isInteger(max) || max <= 0) {
    throw new TypeError("maxRequests must be a positive integer");
  }

  const requestPropertyName = options.requestPropertyName || "rateLimit";
  const config: any = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: options.legacyHeaders ?? true,
    keyGenerator: options.keyGenerator || ((req: Request) => getClientIp(req)),
    requestPropertyName,
    handler: (req: Request, res: Response) => {
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

export function normalizePrincipal(value: any): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase();
}

export function safePropertySuffix(namespace: string): string {
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
export function getPrincipalBucketIdentity(req: any, principal: string): string {
  const normalized = normalizePrincipal(principal);
  if (!normalized) return "";

  const authenticated = normalizePrincipal(req?.user?.publicKey);
  if (authenticated && authenticated === normalized) {
    return `trusted:${normalized}`;
  }

  return `preauth:${normalized}:ip:${getClientIp(req)}`;
}

export interface SensitiveRateLimitersOptions {
  namespace: string;
  windowMinutes: number;
  maxRequestsPerIp: number;
  maxRequestsPerPrincipal: number;
  principalKeyGenerator: (req: Request) => string | null | undefined;
  storeFactory?: (options: { prefix: string }) => any;
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
export function createSensitiveRateLimiters({
  namespace,
  windowMinutes,
  maxRequestsPerIp,
  maxRequestsPerPrincipal,
  principalKeyGenerator,
  storeFactory,
}: SensitiveRateLimitersOptions) {
  if (!namespace) throw new TypeError("namespace is required");
  if (typeof principalKeyGenerator !== "function") {
    throw new TypeError("principalKeyGenerator must be a function");
  }

  const makeStore =
    storeFactory ||
    (({ prefix }: { prefix: string }) => {
      return new RedisRateLimitStore({ prefix });
    });

  const suffix = safePropertySuffix(namespace);
  const principalCacheKey = Symbol(`rateLimitPrincipal:${namespace}`);
  const getPrincipal = (req: any) => {
    if (Object.prototype.hasOwnProperty.call(req, principalCacheKey)) {
      return req[principalCacheKey];
    }

    let value = "";
    try {
      value = normalizePrincipal(principalKeyGenerator(req));
    } catch {
      value = "";
    }

    Object.defineProperty(req, principalCacheKey, {
      configurable: false,
      enumerable: false,
      writable: false,
      value,
    });
    return value;
  };

  const ipLimiter = createRateLimiter(maxRequestsPerIp, windowMinutes, {
    store: makeStore({ prefix: `${namespace}:ip:` }),
    keyGenerator: (req: Request) => hashRateLimitIdentifier("ip", getClientIp(req)),
    requestPropertyName: `rateLimit_${suffix}_ip`,
    legacyHeaders: false,
  });

  const principalLimiter = createRateLimiter(maxRequestsPerPrincipal, windowMinutes, {
    store: makeStore({ prefix: `${namespace}:principal:` }),
    skip: (req: Request) => !getPrincipal(req),
    keyGenerator: (req: Request) =>
      hashRateLimitIdentifier("principal", getPrincipalBucketIdentity(req, getPrincipal(req))),
    requestPropertyName: `rateLimit_${suffix}_principal`,
    legacyHeaders: false,
  });

  return [ipLimiter, principalLimiter];
}
