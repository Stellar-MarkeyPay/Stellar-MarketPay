"use strict";

const promClient = require("prom-client");

const bridgeCircuitBreaker = new promClient.Gauge({
  name: "bridge_circuit_breaker_active",
  help: "Cross-chain bridge circuit breaker state (1 = active, 0 = inactive)",
});

const bridgeTransfersPending = new promClient.Gauge({
  name: "bridge_transfers_pending",
  help: "Number of pending bridge transfers",
});

const bridgeVerificationsTotal = new promClient.Counter({
  name: "bridge_verifications_total",
  help: "Total number of bridge proof verifications",
  labelNames: ["status"],
});

const bridgeVerificationFailuresTotal = new promClient.Counter({
  name: "bridge_verification_failures_total",
  help: "Total number of failed bridge proof verifications",
  labelNames: ["reason"],
});

const bridgeVolume = new promClient.Gauge({
  name: "bridge_hourly_volume",
  help: "Current hourly bridge volume",
});

module.exports = {
  bridgeCircuitBreaker,
  bridgeTransfersPending,
  bridgeVerificationsTotal,
  bridgeVerificationFailuresTotal,
  bridgeVolume,
};
