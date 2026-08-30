"use strict";

const { DEFAULT_RULES, validateRuleSet, policyChecksum } = require("./policySchema");
const { evaluateGeography, getApplicableRuleSet, clearPolicyCache } = require("./policyService");

describe("jurisdiction policy schema", () => {
  it("normalizes and hashes a complete policy deterministically", () => {
    const first = validateRuleSet(DEFAULT_RULES);
    const second = validateRuleSet(JSON.parse(JSON.stringify(DEFAULT_RULES)));

    expect(first.tierLimits[2]).toBe("10000");
    expect(policyChecksum(first)).toBe(policyChecksum(second));
  });

  it("rejects unknown fields, non-monotonic limits, and weights that do not sum to one", () => {
    expect(() => validateRuleSet({ ...DEFAULT_RULES, hiddenBypass: true })).toThrow(
      "Unknown policy field"
    );
    expect(() =>
      validateRuleSet({
        ...DEFAULT_RULES,
        tierLimits: { 0: "0", 1: "1000", 2: "500", 3: "100000" },
      })
    ).toThrow("monotonic");
    expect(() =>
      validateRuleSet({
        ...DEFAULT_RULES,
        riskWeights: {
          identity: 1,
          screening: 1,
          behaviour: 1,
          onchain: 1,
          geography: 1,
        },
      })
    ).toThrow("sum to 1");
  });

  it("makes prohibited and conflicting geo decisions explainable and mode aware", () => {
    const rules = validateRuleSet({
      ...DEFAULT_RULES,
      mode: "enforce",
      prohibitedTerritories: ["KP"],
    });
    const policy = { rules };

    expect(
      evaluateGeography({ kycCountry: "KP", ipCountry: "KP", ipConfidence: 0.99 }, policy)
    ).toMatchObject({ outcome: "deny", reasonCode: "PROHIBITED_TERRITORY" });
    expect(
      evaluateGeography(
        { kycCountry: "NG", declaredCountry: "GH", ipCountry: "NG", ipConfidence: 0.99 },
        policy
      )
    ).toMatchObject({ outcome: "review", reasonCode: "GEO_SIGNAL_CONFLICT", conflict: true });
  });

  it("rejects a stored policy whose content no longer matches its published checksum", async () => {
    clearPolicyCache();
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: "policy-1",
            jurisdiction: "DEFAULT",
            version: 1,
            schema_version: 1,
            effective_from: "1970-01-01T00:00:00.000Z",
            effective_until: null,
            checksum: "tampered",
            rules: DEFAULT_RULES,
          },
        ],
      }),
    };

    await expect(getApplicableRuleSet("NG", new Date("2026-01-01"), db)).rejects.toMatchObject({
      code: "POLICY_INTEGRITY_FAILED",
    });
  });
});
