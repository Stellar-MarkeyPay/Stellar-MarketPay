"use strict";

const { complianceError } = require("./errors");

const IDENTITY_TRANSITIONS = Object.freeze({
  unverified: ["pending"],
  pending: ["needs_input", "verified", "expired", "rejected", "cancelled"],
  needs_input: ["pending", "verified", "expired", "rejected", "cancelled"],
  verified: ["pending", "expired", "rejected"],
  expired: ["pending"],
  rejected: ["pending"],
  cancelled: [],
});

const CASE_TRANSITIONS = Object.freeze({
  open: ["triaged"],
  triaged: ["investigating", "decided"],
  investigating: ["escalated", "decided"],
  escalated: ["investigating", "decided"],
  decided: ["closed", "investigating"],
  closed: [],
});

const TRAVEL_RULE_TRANSITIONS = Object.freeze({
  not_required: [],
  pending: ["sent", "failed", "self_hosted_verified", "rejected"],
  sent: ["acknowledged", "failed"],
  acknowledged: [],
  failed: ["pending", "sent", "rejected"],
  self_hosted_verified: [],
  rejected: [],
});

function transition(table, from, to, modelName) {
  if (from === to) return to;
  if (!table[from] || !table[from].includes(to)) {
    throw complianceError(
      409,
      "ILLEGAL_TRANSITION",
      `${modelName} transition ${from} -> ${to} is not allowed`
    );
  }
  return to;
}

const transitionIdentity = (from, to) => transition(IDENTITY_TRANSITIONS, from, to, "Identity");
const transitionCase = (from, to) => transition(CASE_TRANSITIONS, from, to, "Case");
const transitionTravelRule = (from, to) =>
  transition(TRAVEL_RULE_TRANSITIONS, from, to, "Travel Rule");

module.exports = {
  IDENTITY_TRANSITIONS,
  CASE_TRANSITIONS,
  TRAVEL_RULE_TRANSITIONS,
  transitionIdentity,
  transitionCase,
  transitionTravelRule,
};
