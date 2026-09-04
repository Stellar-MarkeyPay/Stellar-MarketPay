"use strict";

const rateLimit = require("express-rate-limit");
const { getClientIp } = require("../utils/clientIp");

/**
 * Factory function to create reusable rate limiters
 */
const createRateLimiter = (maxRequests, windowMinutes) => {
  const effectiveMax =
    process.env.NODE_ENV === "development"
      ? Math.max(maxRequests * 20, 2000)
      : maxRequests;
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: effectiveMax,
    standardHeaders: true,
    legacyHeaders: true,
    keyGenerator: (req) => getClientIp(req),
    handler: (req, res) => {
      res.set("Retry-After", Math.ceil(windowMinutes * 60));
      return res.status(429).json({
        message: "Too many requests — please wait before trying again",
      });
    },
  });
};

module.exports = { createRateLimiter };
