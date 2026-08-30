"use strict";

const { createServiceLogger, logError } = require("../../utils/logger");
const { expireDueVerifications } = require("./identityService");
const { runDueScreenings } = require("./screeningService");
const { retryDueExchanges } = require("./travelRuleService");

const logger = createServiceLogger("compliance-worker");

async function runComplianceCycle(options = {}) {
  const limit = Math.max(1, Math.min(1000, Number(options.limit) || 100));
  const expired = await expireDueVerifications(limit, options.db);
  const screenings = await runDueScreenings(limit, options);
  const travelRuleRetries = await retryDueExchanges(limit, options);
  const result = {
    expiredVerifications: expired.length,
    screenings: screenings.length,
    screeningErrors: screenings.filter((item) => item.status === "provider_error").length,
    travelRuleRetries: travelRuleRetries.length,
    travelRuleFailures: travelRuleRetries.filter((item) => item.status === "failed").length,
  };
  logger.info(result, "Compliance cycle complete");
  return result;
}

function startComplianceScheduler(options = {}) {
  const intervalMs = Math.max(60_000, Number(options.intervalMs) || 15 * 60 * 1000);
  const run = async () => {
    try {
      await runComplianceCycle(options);
    } catch (error) {
      logError(logger, error, { operation: "compliance_cycle" });
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { runComplianceCycle, startComplianceScheduler };
