import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
// @ts-ignore
import { getClientIp } from "../utils/clientIp";
// @ts-ignore
import { findApiKeyByRawValue, recordApiKeyUsage } from "../services/developerService";

export function createApiKeyRateLimiter(maxRequests = 100, windowMinutes = 60) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.apiKey?.id || getClientIp(req),
    handler: (req: Request, res: Response) => {
      res.set("Retry-After", String(windowMinutes * 60));
      return res.status(429).json({
        error: "Too many requests for this API key. Please try again later.",
      });
    },
  });
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const rawKey = req.header("x-api-key") || req.header("X-API-Key");
    if (!rawKey) {
      return res.status(401).json({ error: "Missing API key" });
    }

    const apiKey = await findApiKeyByRawValue(rawKey);
    if (!apiKey || apiKey.revoked_at) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    req.apiKey = apiKey;
    await recordApiKeyUsage(apiKey.id);
    next();
  } catch (error) {
    next(error);
  }
}
