"use strict";

const bridgeRelayService = require("../services/bridgeRelayService");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("bridge-relay-job");

async function runBridgeRelay() {
  try {
    await bridgeRelayService.observeEVMDeposits();
    await bridgeRelayService.observeSorobanWithdrawals();
    bridgeRelayService.checkCircuitBreaker();
  } catch (err) {
    logger.error(err, "Bridge relay job failed");
  }
}

module.exports = { runBridgeRelay };
