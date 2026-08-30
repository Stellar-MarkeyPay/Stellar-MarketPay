"use strict";

const {
  IDENTITY_TRANSITIONS,
  MEMBERSHIP_TRANSITIONS,
  PROVIDER_TRANSITIONS,
  SIGNING_BINDING_TRANSITIONS,
  transitionIdentity,
  transitionMembership,
  transitionProvider,
  transitionSigningBinding,
} = require("./stateMachines");

describe("federation lifecycle state machines", () => {
  it.each([
    [MEMBERSHIP_TRANSITIONS, transitionMembership],
    [PROVIDER_TRANSITIONS, transitionProvider],
    [IDENTITY_TRANSITIONS, transitionIdentity],
    [SIGNING_BINDING_TRANSITIONS, transitionSigningBinding],
  ])("allows only documented lifecycle edges", (table, transition) => {
    const states = Object.keys(table);
    for (const from of states) {
      for (const to of states) {
        if (from === to || table[from].includes(to)) {
          expect(transition(from, to)).toBe(to);
        } else {
          expect(() => transition(from, to)).toThrow("is not allowed");
        }
      }
    }
  });

  it("makes deprovisioned and revoked records terminal", () => {
    expect(MEMBERSHIP_TRANSITIONS.deprovisioned).toEqual([]);
    expect(IDENTITY_TRANSITIONS.deprovisioned).toEqual([]);
    expect(SIGNING_BINDING_TRANSITIONS.revoked).toEqual([]);
  });
});
