"use strict";

const ALLOWED_SIGNING_METHODS = new Set(["linked_wallet", "passkey_account"]);
const DEFAULT_REAUTH_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_SIGNING_PROOF_MAX_AGE_MS = 2 * 60 * 1000;

function ageIsFresh(value, now, maxAgeMs) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
}

function evaluateTransactionAuthorization(
  { organisation, membership, federatedIdentity, session, signingBinding, signingProof },
  options = {}
) {
  const now = new Date(options.now || Date.now()).getTime();
  const reauthMaxAgeMs = options.reauthMaxAgeMs || DEFAULT_REAUTH_MAX_AGE_MS;
  const signingProofMaxAgeMs = options.signingProofMaxAgeMs || DEFAULT_SIGNING_PROOF_MAX_AGE_MS;
  const reasons = [];

  if (organisation?.status !== "active") reasons.push("ORGANISATION_NOT_ACTIVE");
  if (membership?.status !== "active" || membership?.deprovisionedAt) {
    reasons.push("MEMBERSHIP_NOT_ACTIVE");
  }
  if (federatedIdentity?.status !== "active") reasons.push("FEDERATED_IDENTITY_NOT_ACTIVE");

  const sessionExpiresAt = new Date(session?.expiresAt).getTime();
  if (
    session?.status !== "active" ||
    !Number.isFinite(sessionExpiresAt) ||
    sessionExpiresAt <= now
  ) {
    reasons.push("SESSION_NOT_ACTIVE");
  }
  if (!ageIsFresh(session?.sensitiveActionReauthenticatedAt, now, reauthMaxAgeMs)) {
    reasons.push("FRESH_REAUTH_REQUIRED");
  }

  if (
    signingBinding?.status !== "active" ||
    signingBinding?.transactionEnabled !== true ||
    !ALLOWED_SIGNING_METHODS.has(signingBinding?.signingMethod)
  ) {
    reasons.push("SIGNING_BINDING_REQUIRED");
  }

  if (
    signingProof?.verified !== true ||
    signingProof?.bindingId !== signingBinding?.id ||
    !signingProof?.transactionHash ||
    !ageIsFresh(signingProof?.verifiedAt, now, signingProofMaxAgeMs)
  ) {
    reasons.push("FRESH_TRANSACTION_BOUND_SIGNING_PROOF_REQUIRED");
  }

  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons) });
}

module.exports = {
  ALLOWED_SIGNING_METHODS,
  DEFAULT_REAUTH_MAX_AGE_MS,
  DEFAULT_SIGNING_PROOF_MAX_AGE_MS,
  evaluateTransactionAuthorization,
};
