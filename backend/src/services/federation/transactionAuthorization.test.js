"use strict";

const { evaluateTransactionAuthorization } = require("./transactionAuthorization");

const NOW = "2026-08-28T06:00:00.000Z";

function eligibleContext() {
  return {
    organisation: { status: "active" },
    membership: { status: "active", deprovisionedAt: null },
    federatedIdentity: { status: "active" },
    session: {
      status: "active",
      expiresAt: "2026-08-28T06:10:00.000Z",
      sensitiveActionReauthenticatedAt: "2026-08-28T05:58:00.000Z",
    },
    signingBinding: {
      id: "binding-1",
      status: "active",
      signingMethod: "linked_wallet",
      transactionEnabled: true,
    },
    signingProof: {
      bindingId: "binding-1",
      verified: true,
      verifiedAt: "2026-08-28T05:59:00.000Z",
      transactionHash: "transaction-hash-1",
    },
  };
}

describe("federated transaction authorization invariant", () => {
  it("denies an SSO-authenticated session without an independent signing credential", () => {
    const context = eligibleContext();
    delete context.signingBinding;
    delete context.signingProof;

    const result = evaluateTransactionAuthorization(context, { now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "SIGNING_BINDING_REQUIRED",
        "FRESH_TRANSACTION_BOUND_SIGNING_PROOF_REQUIRED",
      ])
    );
  });

  it("allows an active member only after fresh reauthentication and transaction-bound proof", () => {
    expect(evaluateTransactionAuthorization(eligibleContext(), { now: NOW })).toEqual({
      allowed: true,
      reasons: [],
    });
  });

  it("immediately denies a deprovisioned member even with an otherwise valid proof", () => {
    const context = eligibleContext();
    context.membership = {
      status: "deprovisioned",
      deprovisionedAt: "2026-08-28T05:59:30.000Z",
    };
    expect(evaluateTransactionAuthorization(context, { now: NOW })).toEqual({
      allowed: false,
      reasons: ["MEMBERSHIP_NOT_ACTIVE"],
    });
  });

  it("does not treat a custodial key as a supported signing mode", () => {
    const context = eligibleContext();
    context.signingBinding.signingMethod = "custodial";
    const result = evaluateTransactionAuthorization(context, { now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("SIGNING_BINDING_REQUIRED");
  });

  it("rejects stale reauthentication, stale proof, or proof for a different binding", () => {
    const stale = eligibleContext();
    stale.session.sensitiveActionReauthenticatedAt = "2026-08-28T05:40:00.000Z";
    stale.signingProof.verifiedAt = "2026-08-28T05:40:00.000Z";
    stale.signingProof.bindingId = "binding-2";
    const result = evaluateTransactionAuthorization(stale, { now: NOW });
    expect(result.reasons).toEqual([
      "FRESH_REAUTH_REQUIRED",
      "FRESH_TRANSACTION_BOUND_SIGNING_PROOF_REQUIRED",
    ]);
  });
});
