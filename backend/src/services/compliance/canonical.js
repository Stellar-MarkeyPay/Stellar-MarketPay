"use strict";

const crypto = require("crypto");

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  const input = typeof value === "string" ? value : canonicalize(value);
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hmacSha256(secret, value) {
  const input = typeof value === "string" ? value : canonicalize(value);
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

module.exports = { canonicalize, sha256, hmacSha256 };
