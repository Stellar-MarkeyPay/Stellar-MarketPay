"use strict";

const { sha256 } = require("./canonical");

function withinWindow(occurredAt, nowMs, windowMs) {
  const timestamp = new Date(occurredAt).getTime();
  return Number.isFinite(timestamp) && timestamp >= nowMs - windowMs && timestamp <= nowMs;
}

function makeAlert(ruleCode, severity, score, evidence, transaction) {
  const bucket = new Date(transaction.occurredAt).toISOString().slice(0, 13);
  return {
    ruleCode,
    severity,
    score,
    evidence,
    dedupeKey: sha256({
      ruleCode,
      subjectId: transaction.originatorSubjectId,
      transactionId: transaction.id || transaction.idempotencyKey,
      bucket,
    }),
  };
}

function evaluateTransaction(transaction, history, monitoringRules) {
  const nowMs = new Date(transaction.occurredAt).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("transaction.occurredAt must be a valid date");
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("transaction.amount must be positive");
  const alerts = [];

  const structuring = monitoringRules.structuring;
  const structuringWindow = [...history, transaction].filter(
    (item) =>
      withinWindow(item.occurredAt, nowMs, structuring.windowHours * 60 * 60 * 1000) &&
      Number(item.amount) < Number(structuring.singleThreshold)
  );
  const structuredTotal = structuringWindow.reduce((sum, item) => sum + Number(item.amount), 0);
  if (
    amount < Number(structuring.singleThreshold) &&
    structuringWindow.length >= structuring.minimumCount &&
    structuredTotal >= Number(structuring.aggregateThreshold)
  ) {
    alerts.push(
      makeAlert(
        "STRUCTURING_ROLLING_SUM",
        "high",
        82,
        {
          count: structuringWindow.length,
          aggregateAmount: structuredTotal.toFixed(7),
          singleThreshold: String(structuring.singleThreshold),
          aggregateThreshold: String(structuring.aggregateThreshold),
          windowHours: structuring.windowHours,
        },
        transaction
      )
    );
  }

  const velocity = monitoringRules.velocity;
  const velocityWindow = [...history, transaction].filter((item) =>
    withinWindow(item.occurredAt, nowMs, velocity.windowMinutes * 60 * 1000)
  );
  const velocityAmount = velocityWindow.reduce((sum, item) => sum + Number(item.amount), 0);
  if (velocityWindow.length > velocity.maxCount || velocityAmount > Number(velocity.maxAmount)) {
    alerts.push(
      makeAlert(
        "TRANSFER_VELOCITY",
        velocityAmount > Number(velocity.maxAmount) * 2 ? "critical" : "high",
        velocityAmount > Number(velocity.maxAmount) * 2 ? 92 : 75,
        {
          count: velocityWindow.length,
          aggregateAmount: velocityAmount.toFixed(7),
          maxCount: velocity.maxCount,
          maxAmount: String(velocity.maxAmount),
          windowMinutes: velocity.windowMinutes,
        },
        transaction
      )
    );
  }

  const counterparty = monitoringRules.counterparty;
  const counterpartyHistory = history.filter((item) =>
    withinWindow(item.occurredAt, nowMs, counterparty.windowDays * 24 * 60 * 60 * 1000)
  );
  const seenCounterparty = counterpartyHistory.some(
    (item) => item.beneficiaryAddress === transaction.beneficiaryAddress
  );
  if (!seenCounterparty && amount >= Number(counterparty.newCounterpartyAmount)) {
    alerts.push(
      makeAlert(
        "UNUSUAL_NEW_COUNTERPARTY",
        "medium",
        58,
        {
          amount: amount.toFixed(7),
          threshold: String(counterparty.newCounterpartyAmount),
          lookbackDays: counterparty.windowDays,
        },
        transaction
      )
    );
  }

  const counterparties = new Set([
    ...counterpartyHistory.map((item) => item.beneficiaryAddress),
    transaction.beneficiaryAddress,
  ]);
  if (counterparties.size > counterparty.fanOutCount) {
    alerts.push(
      makeAlert(
        "COUNTERPARTY_FAN_OUT",
        "high",
        72,
        { distinctCounterparties: counterparties.size, limit: counterparty.fanOutCount },
        transaction
      )
    );
  }

  return alerts;
}

module.exports = { evaluateTransaction };
