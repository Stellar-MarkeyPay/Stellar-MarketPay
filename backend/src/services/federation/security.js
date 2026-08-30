"use strict";

const crypto = require("crypto");
const { federationError } = require("./errors");

const HASH_DOMAIN = "marketpay-enterprise-federation-v1";

function decodeKey(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value !== "string" || value.length === 0) return Buffer.alloc(0);
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  return Buffer.from(value, "base64");
}

function getFederationHashKey(env = process.env) {
  const configured = decodeKey(env.FEDERATION_HASH_KEY);
  if (configured.length === 32) return configured;

  if (env.NODE_ENV === "production") {
    throw federationError(
      500,
      "FEDERATION_HASH_KEY_REQUIRED",
      "FEDERATION_HASH_KEY must contain exactly 32 bytes in production"
    );
  }

  return crypto
    .createHash("sha256")
    .update(`${env.JWT_SECRET || "local"}:${HASH_DOMAIN}:local-only`)
    .digest();
}

function requireOpaqueValue(value, fieldName, maxLength = 4096) {
  if (typeof value !== "string") {
    throw federationError(400, "INVALID_FEDERATION_VALUE", `${fieldName} must be a string`);
  }
  if (value.trim().length === 0 || value.length > maxLength || value.includes("\u0000")) {
    throw federationError(
      400,
      "INVALID_FEDERATION_VALUE",
      `${fieldName} must contain between 1 and ${maxLength} characters`
    );
  }
  // Subjects, state, nonce, codes and assertion IDs are opaque and
  // case/whitespace-sensitive. Do not trim or Unicode-normalize them.
  return value;
}

function blindIndex(namespace, context, value, key = getFederationHashKey()) {
  const normalizedNamespace = requireOpaqueValue(namespace, "namespace", 80);
  const normalizedContext = requireOpaqueValue(context, "context", 2048);
  const normalizedValue = requireOpaqueValue(value, "value");
  const decodedKey = decodeKey(key);
  if (decodedKey.length !== 32) {
    throw federationError(500, "INVALID_FEDERATION_HASH_KEY", "Federation hash key is invalid");
  }

  return crypto
    .createHmac("sha256", decodedKey)
    .update(
      `${HASH_DOMAIN}\u0000${normalizedNamespace}\u0000${normalizedContext}\u0000${normalizedValue}`
    )
    .digest("hex");
}

function hashFederatedSubject(providerId, subject, key) {
  return blindIndex("external-subject", providerId, subject, key);
}

function hashOneTimeValue(providerId, kind, value, key) {
  const allowedKinds = new Set([
    "saml-request",
    "saml-response",
    "saml-assertion",
    "oidc-state",
    "oidc-nonce",
    "oidc-code",
    "oidc-id-token",
  ]);
  if (!allowedKinds.has(kind)) {
    throw federationError(400, "INVALID_ONE_TIME_VALUE_KIND", "Unknown one-time value kind");
  }
  return blindIndex(kind, providerId, value, key);
}

function hashesEqual(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(left || "") || !/^[0-9a-f]{64}$/i.test(right || "")) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

module.exports = {
  blindIndex,
  decodeKey,
  getFederationHashKey,
  hashesEqual,
  hashFederatedSubject,
  hashOneTimeValue,
  requireOpaqueValue,
};
