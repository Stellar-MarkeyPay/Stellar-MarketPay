"use strict";

const { requestGeoSignal } = require("./geoSignals");

function request(headers = {}) {
  return {
    ip: "203.0.113.10",
    get: (name) => headers[name.toLowerCase()],
  };
}

describe("trusted geo signal extraction", () => {
  it("ignores client-supplied geo headers until the trusted edge is enabled", () => {
    const result = requestGeoSignal(request({ "cf-ipcountry": "KP" }), {
      JWT_SECRET: "fixture",
      COMPLIANCE_TRUSTED_GEO_HEADERS: "false",
    });
    expect(result).toMatchObject({ ipCountry: null, ipConfidence: 0, source: "untrusted_network" });
    expect(result.ipAuditToken).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("203.0.113.10");
  });

  it("accepts validated country and proxy signals from a configured trusted edge", () => {
    const result = requestGeoSignal(request({ "cf-ipcountry": "ng", "x-geo-proxy": "vpn" }), {
      JWT_SECRET: "fixture",
      COMPLIANCE_TRUSTED_GEO_HEADERS: "true",
      COMPLIANCE_GEO_HEADER_CONFIDENCE: "0.98",
    });
    expect(result).toMatchObject({
      ipCountry: "NG",
      ipConfidence: 0.98,
      proxyDetected: true,
      source: "trusted_edge_header",
    });
  });
});
