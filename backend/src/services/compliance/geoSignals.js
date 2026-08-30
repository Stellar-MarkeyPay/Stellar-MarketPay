"use strict";

const { hmacSha256 } = require("./canonical");

function requestGeoSignal(req, env = process.env) {
  const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
  const ipAuditToken = hmacSha256(
    env.COMPLIANCE_GEO_AUDIT_KEY || env.JWT_SECRET || "local-geo-audit",
    clientIp
  );
  if (env.COMPLIANCE_TRUSTED_GEO_HEADERS !== "true") {
    return {
      ipCountry: null,
      ipConfidence: 0,
      proxyDetected: false,
      ipAuditToken,
      source: "untrusted_network",
    };
  }

  const rawCountry =
    req.get("cf-ipcountry") || req.get("x-vercel-ip-country") || req.get("x-geo-country") || "";
  const country = String(rawCountry).trim().toUpperCase();
  const validCountry = /^[A-Z]{2}$/.test(country) && !["XX", "T1"].includes(country);
  const proxySignal = String(req.get("x-geo-proxy") || "").toLowerCase();
  return {
    ipCountry: validCountry ? country : null,
    ipConfidence: validCountry
      ? Math.max(0, Math.min(1, Number(env.COMPLIANCE_GEO_HEADER_CONFIDENCE) || 0.95))
      : 0,
    proxyDetected: ["true", "1", "vpn", "proxy", "tor"].includes(proxySignal),
    ipAuditToken,
    source: validCountry ? "trusted_edge_header" : "trusted_edge_unknown",
  };
}

module.exports = { requestGeoSignal };
