/**
 * src/middleware/flagContext.js
 * Extracts evaluation context (user, org, locale) from JWT / request.
 */
"use strict";

/**
 * Build an evaluation context from the authenticated user and request.
 * Attaches req.flagContext for downstream route handlers.
 */
function flagContextMiddleware(req, res, next) {
  const ctx = {};

  if (req.user) {
    ctx.user_id = req.user.publicKey || req.user.sub || undefined;
    ctx.organisation_id = req.user.organisation_id || undefined;
  }

  // Locale from Accept-Language header
  const acceptLanguage = req.headers["accept-language"];
  if (acceptLanguage) {
    ctx.locale = acceptLanguage.split(",")[0].split("-")[0].trim();
  }

  req.flagContext = ctx;
  next();
}

module.exports = { flagContextMiddleware };
