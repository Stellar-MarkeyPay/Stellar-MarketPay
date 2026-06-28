"use strict";

const crypto = require("crypto");
const pool = require("../db/pool");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("fraud-detection");

const DEFAULT_RULES = Object.freeze({
  windowMs: 5 * 60 * 1000,
  maxFreelancerBidsPerWindow: 5,
  maxJobBidsPerWindow: 20,
  maxBidToBudgetRatio: 3,
  minBidToBudgetRatio: 0.05,
  maxAmountZScore: 3.5,
  minJobBidsForAmountStats: 3,
});

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const RULES = Object.freeze({
  windowMs: numberFromEnv("FRAUD_WINDOW_MS", DEFAULT_RULES.windowMs),
  maxFreelancerBidsPerWindow: numberFromEnv(
    "FRAUD_MAX_FREELANCER_BIDS_PER_WINDOW",
    DEFAULT_RULES.maxFreelancerBidsPerWindow,
  ),
  maxJobBidsPerWindow: numberFromEnv(
    "FRAUD_MAX_JOB_BIDS_PER_WINDOW",
    DEFAULT_RULES.maxJobBidsPerWindow,
  ),
  maxBidToBudgetRatio: numberFromEnv(
    "FRAUD_MAX_BID_TO_BUDGET_RATIO",
    DEFAULT_RULES.maxBidToBudgetRatio,
  ),
  minBidToBudgetRatio: numberFromEnv(
    "FRAUD_MIN_BID_TO_BUDGET_RATIO",
    DEFAULT_RULES.minBidToBudgetRatio,
  ),
  maxAmountZScore: numberFromEnv(
    "FRAUD_MAX_AMOUNT_ZSCORE",
    DEFAULT_RULES.maxAmountZScore,
  ),
  minJobBidsForAmountStats: numberFromEnv(
    "FRAUD_MIN_JOB_BIDS_FOR_AMOUNT_STATS",
    DEFAULT_RULES.minJobBidsForAmountStats,
  ),
});

const ALERT_COOLDOWN_MS = numberFromEnv("FRAUD_ALERT_COOLDOWN_MS", 5 * 60 * 1000);

const state = {
  freelancerWindows: new Map(),
  jobWindows: new Map(),
};

function resetFraudDetectionStateForTests() {
  state.freelancerWindows.clear();
  state.jobWindows.clear();
  if (state.suppressedAlerts) state.suppressedAlerts.clear();
}

function normalizePositiveNumber(value, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  return number;
}

function pruneEntries(entries, now, windowMs) {
  return entries.filter((entry) => now - entry.timestamp <= windowMs);
}

function calculateStats(amounts) {
  if (!amounts.length) {
    return {
      count: 0,
      mean: null,
      min: null,
      max: null,
      stdDev: null,
    };
  }

  const mean = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  const variance = amounts.reduce((sum, amount) => sum + (amount - mean) ** 2, 0) / amounts.length;
  const stdDev = Math.sqrt(variance);

  return {
    count: amounts.length,
    mean,
    min: Math.min(...amounts),
    max: Math.max(...amounts),
    stdDev,
  };
}

function formatAmount(amount) {
  return Number(amount).toFixed(7);
}

function hashValue(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createRule(ruleCode, severity, reason, riskScore, context = {}) {
  return {
    ruleCode,
    severity,
    reason,
    riskScore,
    context,
  };
}

function createAlert({
  jobId,
  applicationId,
  freelancerAddress,
  bidAmount,
  currency,
  rules,
  context,
  sourceIp,
  userAgent,
}) {
  const primaryRule = rules.sort((a, b) => b.riskScore - a.riskScore)[0];
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    jobId,
    applicationId: applicationId || null,
    freelancerAddress,
    bidAmount: formatAmount(bidAmount),
    currency: currency || "XLM",
    ruleCode: primaryRule.ruleCode,
    severity: primaryRule.severity,
    reason: primaryRule.reason,
    riskScore: Math.min(100, primaryRule.riskScore),
    rules,
    context,
    sourceIpHash: hashValue(sourceIp),
    userAgent: userAgent || null,
    createdAt: new Date(now).toISOString(),
  };
}

async function persistAlert(alert) {
  try {
    await pool.query(
      `INSERT INTO fraud_alerts (
         job_id,
         application_id,
         freelancer_address,
         bid_amount,
         currency,
         rule_code,
         severity,
         reason,
         risk_score,
         context,
         source_ip_hash,
         user_agent,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, NOW())`,
      [
        alert.jobId,
        alert.applicationId,
        alert.freelancerAddress,
        alert.bidAmount,
        alert.currency,
        alert.ruleCode,
        alert.severity,
        alert.reason,
        alert.riskScore,
        JSON.stringify(alert.context),
        alert.sourceIpHash,
        alert.userAgent,
      ],
    );
  } catch (error) {
    logger.warn({ error: error.message, alert }, "Failed to persist fraud alert");
  }
}

function shouldSuppressAlert(alert) {
  if (ALERT_COOLDOWN_MS <= 0) return false;

  const bucket = Math.floor(Date.now() / ALERT_COOLDOWN_MS);
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${alert.ruleCode}:${alert.jobId}:${alert.freelancerAddress}:${bucket}`)
    .digest("hex");

  if (state.suppressedAlerts?.has(fingerprint)) return true;

  if (!state.suppressedAlerts) state.suppressedAlerts = new Map();
  state.suppressedAlerts.set(fingerprint, Date.now());

  for (const [key, timestamp] of state.suppressedAlerts.entries()) {
    if (Date.now() - timestamp > ALERT_COOLDOWN_MS) state.suppressedAlerts.delete(key);
  }

  return false;
}

async function analyzeBidEvent(input = {}) {
  const {
    jobId,
    applicationId,
    freelancerAddress,
    bidAmount,
    currency = "XLM",
    jobBudget,
    sourceIp,
    userAgent,
  } = input;

  if (!jobId) {
    const error = new Error("jobId is required");
    error.status = 400;
    throw error;
  }
  if (!freelancerAddress) {
    const error = new Error("freelancerAddress is required");
    error.status = 400;
    throw error;
  }

  const amount = normalizePositiveNumber(bidAmount, "bidAmount must be a positive number");
  const budget = jobBudget == null ? null : normalizePositiveNumber(jobBudget, "jobBudget must be a positive number");
  const now = Date.now();

  const jobWindow = pruneEntries(state.jobWindows.get(jobId) || [], now, RULES.windowMs);
  const freelancerWindow = pruneEntries(
    state.freelancerWindows.get(freelancerAddress) || [],
    now,
    RULES.windowMs,
  );

  const jobAmounts = jobWindow.map((entry) => entry.amount);
  const jobStats = calculateStats(jobAmounts);
  const freelancerRecentBidCount = freelancerWindow.length + 1;
  const jobRecentBidCount = jobWindow.length + 1;
  const rules = [];

  if (freelancerRecentBidCount > RULES.maxFreelancerBidsPerWindow) {
    rules.push(createRule(
      "FREELANCER_BID_SPAM",
      "high",
      `Freelancer submitted ${freelancerRecentBidCount} bids in ${Math.round(RULES.windowMs / 1000)} seconds`,
      85,
      {
        limit: RULES.maxFreelancerBidsPerWindow,
        recentBidCount: freelancerRecentBidCount,
      },
    ));
  }

  if (jobRecentBidCount > RULES.maxJobBidsPerWindow) {
    rules.push(createRule(
      "JOB_BID_SPAM",
      "high",
      `Job received ${jobRecentBidCount} bids in ${Math.round(RULES.windowMs / 1000)} seconds`,
      80,
      {
        limit: RULES.maxJobBidsPerWindow,
        recentBidCount: jobRecentBidCount,
      },
    ));
  }

  if (budget != null) {
    const bidToBudgetRatio = amount / budget;

    if (bidToBudgetRatio > RULES.maxBidToBudgetRatio) {
      rules.push(createRule(
        "EXTREME_HIGH_BID",
        "high",
        `Bid is ${bidToBudgetRatio.toFixed(2)}x the job budget`,
        90,
        {
          budget: formatAmount(budget),
          bidToBudgetRatio: Number(bidToBudgetRatio.toFixed(4)),
          limit: RULES.maxBidToBudgetRatio,
        },
      ));
    }

    if (bidToBudgetRatio < RULES.minBidToBudgetRatio) {
      rules.push(createRule(
        "EXTREME_LOW_BID",
        "medium",
        `Bid is ${bidToBudgetRatio.toFixed(2)}x the job budget`,
        65,
        {
          budget: formatAmount(budget),
          bidToBudgetRatio: Number(bidToBudgetRatio.toFixed(4)),
          limit: RULES.minBidToBudgetRatio,
        },
      ));
    }
  }

  if (jobStats.count >= RULES.minJobBidsForAmountStats && jobStats.stdDev > 0) {
    const zScore = Math.abs((amount - jobStats.mean) / jobStats.stdDev);

    if (zScore >= RULES.maxAmountZScore) {
      rules.push(createRule(
        "BID_AMOUNT_OUTLIER",
        "medium",
        `Bid amount is ${zScore.toFixed(2)} standard deviations from recent bids`,
        Math.min(95, 50 + zScore * 10),
        {
          zScore: Number(zScore.toFixed(2)),
          meanBid: Number(jobStats.mean.toFixed(7)),
          stdDevBid: Number(jobStats.stdDev.toFixed(7)),
          limit: RULES.maxAmountZScore,
        },
      ));
    }
  }

  jobWindow.push({
    timestamp: now,
    amount,
    applicationId: applicationId || null,
  });
  freelancerWindow.push({
    timestamp: now,
    amount,
    applicationId: applicationId || null,
  });
  state.jobWindows.set(jobId, jobWindow);
  state.freelancerWindows.set(freelancerAddress, freelancerWindow);

  const updatedJobStats = calculateStats(jobWindow.map((entry) => entry.amount));
  const flagged = rules.length > 0;
  const riskScore = flagged ? Math.max(...rules.map((rule) => rule.riskScore)) : 0;
  const context = {
    jobId,
    applicationId: applicationId || null,
    freelancerAddress,
    bidAmount: formatAmount(amount),
    currency,
    jobBudget: budget == null ? null : formatAmount(budget),
    windowMs: RULES.windowMs,
    freelancerRecentBidCount,
    jobRecentBidCount,
    jobStats: {
      count: updatedJobStats.count,
      mean: updatedJobStats.mean == null ? null : Number(updatedJobStats.mean.toFixed(7)),
      min: updatedJobStats.min == null ? null : formatAmount(updatedJobStats.min),
      max: updatedJobStats.max == null ? null : formatAmount(updatedJobStats.max),
      stdDev: updatedJobStats.stdDev == null ? null : Number(updatedJobStats.stdDev.toFixed(7)),
    },
  };

  const alert = flagged
    ? createAlert({
      jobId,
      applicationId,
      freelancerAddress,
      bidAmount: amount,
      currency,
      rules,
      context,
      sourceIp,
      userAgent,
    })
    : null;

  if (alert && !shouldSuppressAlert(alert)) {
    await persistAlert(alert);
  }

  return {
    flagged,
    riskScore,
    rules,
    alert,
    job: {
      recentBidCount: jobRecentBidCount,
      count: updatedJobStats.count,
      mean: updatedJobStats.mean == null ? null : Number(updatedJobStats.mean.toFixed(7)),
      min: updatedJobStats.min == null ? null : formatAmount(updatedJobStats.min),
      max: updatedJobStats.max == null ? null : formatAmount(updatedJobStats.max),
      stdDev: updatedJobStats.stdDev == null ? null : Number(updatedJobStats.stdDev.toFixed(7)),
    },
    freelancer: {
      recentBidCount: freelancerRecentBidCount,
    },
  };
}

function getJobFraudStats(jobId) {
  if (!jobId) {
    const error = new Error("jobId is required");
    error.status = 400;
    throw error;
  }

  const now = Date.now();
  const jobWindow = pruneEntries(state.jobWindows.get(jobId) || [], now, RULES.windowMs);
  const jobStats = calculateStats(jobWindow.map((entry) => entry.amount));
  const flaggedFreelancers = [...state.freelancerWindows.entries()]
    .map(([freelancerAddress, entries]) => ({
      freelancerAddress,
      recentBidCount: pruneEntries(entries, now, RULES.windowMs).length,
    }))
    .filter((entry) => entry.recentBidCount > RULES.maxFreelancerBidsPerWindow);

  return {
    jobId,
    windowMs: RULES.windowMs,
    recentBidCount: jobWindow.length,
    count: jobStats.count,
    mean: jobStats.mean == null ? null : Number(jobStats.mean.toFixed(7)),
    min: jobStats.min == null ? null : formatAmount(jobStats.min),
    max: jobStats.max == null ? null : formatAmount(jobStats.max),
    stdDev: jobStats.stdDev == null ? null : Number(jobStats.stdDev.toFixed(7)),
    rules: RULES,
    flaggedFreelancers,
  };
}

module.exports = {
  analyzeBidEvent,
  getJobFraudStats,
  resetFraudDetectionStateForTests,
  RULES,
};
