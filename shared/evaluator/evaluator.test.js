/**
 * shared/evaluator/evaluator.test.js
 * Unit tests for the shared flag evaluation engine.
 */
"use strict";

const { evaluateFlag, evaluateFlags, fnv1a, percentageBucket } = require("./evaluator");

/** Helper to build a minimal FlagDefinition */
function makeFlag(overrides = {}) {
  return {
    id: "test-flag-1",
    key: "test.feature",
    flag_type: "boolean",
    default_value: false,
    safe_value: false,
    enabled: true,
    killed_at: null,
    targeting_rules: [],
    overrides: [],
    ...overrides,
  };
}

describe("fnv1a", () => {
  test("returns a deterministic unsigned 32-bit integer", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
    expect(fnv1a("hello")).not.toBe(fnv1a("world"));
    expect(typeof fnv1a("test")).toBe("number");
  });

  test("produces values in [0, 2^32 - 1]", () => {
    const val = fnv1a("test-input");
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("percentageBucket", () => {
  test("returns a number in [0, 99]", () => {
    const bucket = percentageBucket("user-123", "my.flag");
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThanOrEqual(99);
  });

  test("is deterministic for the same inputs", () => {
    expect(percentageBucket("user-1", "flag-a")).toBe(percentageBucket("user-1", "flag-a"));
  });

  test("different users get different buckets (for most inputs)", () => {
    const buckets = new Set();
    for (let i = 0; i < 100; i++) {
      buckets.add(percentageBucket(`user-${i}`, "flag-a"));
    }
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe("evaluateFlag", () => {
  test("returns FLAG_NOT_FOUND for null flag", () => {
    const result = evaluateFlag(null, {});
    expect(result.reason).toBe("FLAG_NOT_FOUND");
    expect(result.value).toBeNull();
  });

  test("returns safe_value when flag is killed", () => {
    const flag = makeFlag({
      killed_at: "2025-01-01T00:00:00Z",
      safe_value: "safe-fallback",
    });
    const result = evaluateFlag(flag, { user_id: "user-1" });
    expect(result.reason).toBe("FLAG_KILLED");
    expect(result.value).toBe("safe-fallback");
  });

  test("returns safe_value when flag is disabled", () => {
    const flag = makeFlag({ enabled: false, safe_value: "disabled-fallback" });
    const result = evaluateFlag(flag, {});
    expect(result.reason).toBe("FLAG_DISABLED");
    expect(result.value).toBe("disabled-fallback");
  });

  test("returns override value when user has an override", () => {
    const flag = makeFlag({
      overrides: [{ context_key: "user-1", value: "override-val" }],
    });
    const result = evaluateFlag(flag, { user_id: "user-1" });
    expect(result.reason).toBe("OVERRIDE");
    expect(result.value).toBe("override-val");
  });

  test("returns default when no override matches", () => {
    const flag = makeFlag({
      overrides: [{ context_key: "user-2", value: "other" }],
    });
    const result = evaluateFlag(flag, { user_id: "user-1" });
    expect(result.reason).toBe("DEFAULT");
    expect(result.value).toBe(false);
  });

  test("evaluates targeting rule with user_id condition", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-1",
          name: "Beta users",
          priority: 1,
          enabled: true,
          conditions: { user_id: ["user-1", "user-2"] },
          allocations: [{ variant: "treatment", weight: 100 }],
        },
      ],
    });

    const hit = evaluateFlag(flag, { user_id: "user-1" });
    expect(hit.reason).toBe("TARGETING_RULE");
    expect(hit.value).toBe("treatment");

    const miss = evaluateFlag(flag, { user_id: "user-99" });
    expect(miss.reason).toBe("DEFAULT");
  });

  test("evaluates targeting rule with locale condition", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-1",
          name: "ES users",
          priority: 1,
          enabled: true,
          conditions: { locale: ["es", "pt"] },
          allocations: [{ variant: "spanish", weight: 100 }],
        },
      ],
    });

    expect(evaluateFlag(flag, { locale: "es" }).value).toBe("spanish");
    expect(evaluateFlag(flag, { locale: "en" }).reason).toBe("DEFAULT");
  });

  test("evaluates targeting rule with account_age_days condition", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-1",
          name: "New users",
          priority: 1,
          enabled: true,
          conditions: { account_age_days: { min: 0, max: 7 } },
          allocations: [{ variant: "new用户体验", weight: 100 }],
        },
      ],
    });

    expect(evaluateFlag(flag, { account_age_days: 3 }).value).toBe("new用户体验");
    expect(evaluateFlag(flag, { account_age_days: 30 }).reason).toBe("DEFAULT");
  });

  test("evaluates targeting rule with organisation_id condition", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-1",
          name: "Org members",
          priority: 1,
          enabled: true,
          conditions: { organisation_id: ["org-abc"] },
          allocations: [{ variant: "org-feature", weight: 100 }],
        },
      ],
    });

    expect(evaluateFlag(flag, { organisation_id: "org-abc" }).value).toBe("org-feature");
    expect(evaluateFlag(flag, { organisation_id: "org-xyz" }).reason).toBe("DEFAULT");
  });

  test("skips disabled targeting rules", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-1",
          name: "Disabled rule",
          priority: 1,
          enabled: false,
          conditions: { user_id: ["user-1"] },
          allocations: [{ variant: "treatment", weight: 100 }],
        },
      ],
    });

    const result = evaluateFlag(flag, { user_id: "user-1" });
    expect(result.reason).toBe("DEFAULT");
  });

  test("respects rule priority ordering", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-low",
          name: "Low priority",
          priority: 2,
          enabled: true,
          conditions: { user_id: ["user-1"] },
          allocations: [{ variant: "low", weight: 100 }],
        },
        {
          id: "rule-high",
          name: "High priority",
          priority: 1,
          enabled: true,
          conditions: { user_id: ["user-1"] },
          allocations: [{ variant: "high", weight: 100 }],
        },
      ],
    });

    const result = evaluateFlag(flag, { user_id: "user-1" });
    expect(result.value).toBe("high");
  });

  test("percentage rollout assigns user deterministically", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-1",
          name: "Rollout",
          priority: 1,
          enabled: true,
          conditions: {},
          allocations: [{ variant: "treatment", rollout_percentage: 50 }],
        },
      ],
    });

    // Same user always gets the same assignment
    const r1 = evaluateFlag(flag, { user_id: "user-42" });
    const r2 = evaluateFlag(flag, { user_id: "user-42" });
    expect(r1.value).toBe(r2.value);
    expect(r1.variant).toBe(r2.variant);
  });

  test("percentage rollout with 0% gives no one the treatment", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-1",
          name: "Zero rollout",
          priority: 1,
          enabled: true,
          conditions: {},
          allocations: [{ variant: "treatment", rollout_percentage: 0 }],
        },
      ],
    });

    for (let i = 0; i < 10; i++) {
      const result = evaluateFlag(flag, { user_id: `user-${i}` });
      expect(result.value).toBe(false); // default
    }
  });

  test("percentage rollout with 100% gives everyone the treatment", () => {
    const flag = makeFlag({
      targeting_rules: [
        {
          id: "rule-1",
          name: "Full rollout",
          priority: 1,
          enabled: true,
          conditions: {},
          allocations: [{ variant: "treatment", rollout_percentage: 100 }],
        },
      ],
    });

    for (let i = 0; i < 10; i++) {
      const result = evaluateFlag(flag, { user_id: `user-${i}` });
      expect(result.value).toBe(true);
      expect(result.variant).toBe("treatment");
    }
  });

  test("weighted allocation picks a variant", () => {
    const flag = makeFlag({
      flag_type: "multivariate",
      default_value: "control",
      targeting_rules: [
        {
          id: "rule-1",
          name: "AB test",
          priority: 1,
          enabled: true,
          conditions: {},
          allocations: [
            { variant: "control", weight: 50 },
            { variant: "treatment", weight: 50 },
          ],
        },
      ],
    });

    const result = evaluateFlag(flag, { user_id: "user-1" });
    expect(["control", "treatment"]).toContain(result.value);
  });

  test("returns default when no rules match", () => {
    const flag = makeFlag({
      default_value: "fallback",
      targeting_rules: [
        {
          id: "rule-1",
          name: "Specific user",
          priority: 1,
          enabled: true,
          conditions: { user_id: ["user-999"] },
          allocations: [{ variant: "treatment", weight: 100 }],
        },
      ],
    });

    const result = evaluateFlag(flag, { user_id: "user-1" });
    expect(result.reason).toBe("DEFAULT");
    expect(result.value).toBe("fallback");
  });
});

describe("evaluateFlags", () => {
  test("evaluates multiple flags and returns a map", () => {
    const flags = [
      makeFlag({ key: "flag-a", default_value: true }),
      makeFlag({ key: "flag-b", default_value: "hello" }),
    ];

    const results = evaluateFlags(flags, {});
    expect(results.size).toBe(2);
    expect(results.get("flag-a").value).toBe(true);
    expect(results.get("flag-b").value).toBe("hello");
  });

  test("returns empty map for empty input", () => {
    const results = evaluateFlags([], {});
    expect(results.size).toBe(0);
  });
});
