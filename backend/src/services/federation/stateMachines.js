"use strict";

const { federationError } = require("./errors");

const MEMBERSHIP_TRANSITIONS = Object.freeze({
  pending: ["active", "deprovisioned"],
  active: ["suspended", "deprovisioned"],
  suspended: ["active", "deprovisioned"],
  deprovisioned: [],
});

const PROVIDER_TRANSITIONS = Object.freeze({
  draft: ["enabled", "retired"],
  enabled: ["disabled", "retired"],
  disabled: ["enabled", "retired"],
  retired: [],
});

const IDENTITY_TRANSITIONS = Object.freeze({
  active: ["suspended", "deprovisioned"],
  suspended: ["active", "deprovisioned"],
  deprovisioned: [],
});

const SIGNING_BINDING_TRANSITIONS = Object.freeze({
  pending: ["active", "revoked"],
  active: ["suspended", "revoked"],
  suspended: ["active", "revoked"],
  revoked: [],
});

function transition(table, from, to, model) {
  if (from === to) return to;
  if (!table[from] || !table[from].includes(to)) {
    throw federationError(
      409,
      "ILLEGAL_FEDERATION_TRANSITION",
      `${model} transition ${from} -> ${to} is not allowed`
    );
  }
  return to;
}

module.exports = {
  IDENTITY_TRANSITIONS,
  MEMBERSHIP_TRANSITIONS,
  PROVIDER_TRANSITIONS,
  SIGNING_BINDING_TRANSITIONS,
  transitionIdentity: (from, to) => transition(IDENTITY_TRANSITIONS, from, to, "Identity"),
  transitionMembership: (from, to) => transition(MEMBERSHIP_TRANSITIONS, from, to, "Membership"),
  transitionProvider: (from, to) => transition(PROVIDER_TRANSITIONS, from, to, "Provider"),
  transitionSigningBinding: (from, to) =>
    transition(SIGNING_BINDING_TRANSITIONS, from, to, "Signing binding"),
};
