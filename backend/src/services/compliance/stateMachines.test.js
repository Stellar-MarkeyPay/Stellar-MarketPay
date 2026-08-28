"use strict";

const {
  IDENTITY_TRANSITIONS,
  CASE_TRANSITIONS,
  TRAVEL_RULE_TRANSITIONS,
  transitionIdentity,
  transitionCase,
  transitionTravelRule,
} = require("./stateMachines");

describe("central compliance state machines", () => {
  it.each([
    [IDENTITY_TRANSITIONS, transitionIdentity],
    [CASE_TRANSITIONS, transitionCase],
    [TRAVEL_RULE_TRANSITIONS, transitionTravelRule],
  ])("accepts exactly every documented edge and rejects every other edge", (table, transition) => {
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

  it("keeps terminal case and Travel Rule states terminal", () => {
    expect(CASE_TRANSITIONS.closed).toEqual([]);
    expect(TRAVEL_RULE_TRANSITIONS.acknowledged).toEqual([]);
    expect(TRAVEL_RULE_TRANSITIONS.self_hosted_verified).toEqual([]);
  });
});
