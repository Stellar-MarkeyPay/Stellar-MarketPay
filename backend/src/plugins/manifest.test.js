"use strict";

const { validateManifest, assertManifestSize } = require("./manifest");

function baseManifest(overrides = {}) {
  return {
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    apiVersion: "1.0",
    extensionPoints: ["workflow_hook"],
    workflowEvents: ["job.created"],
    permissions: ["read:jobs"],
    entry: "index.js",
    ...overrides,
  };
}

describe("plugin manifest validation", () => {
  test("accepts a well-formed manifest", () => {
    expect(validateManifest(baseManifest())).toEqual({ valid: true, errors: [] });
  });

  test("NEGATIVE: rejects a malformed id", () => {
    const { valid, errors } = validateManifest(baseManifest({ id: "AB" }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("id"))).toBe(true);
  });

  test("NEGATIVE: rejects a non-semver version", () => {
    const { valid } = validateManifest(baseManifest({ version: "v1" }));
    expect(valid).toBe(false);
  });

  test("NEGATIVE: rejects an unknown extension point", () => {
    const { valid, errors } = validateManifest(baseManifest({ extensionPoints: ["shell_exec"] }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("shell_exec"))).toBe(true);
  });

  test("NEGATIVE: workflow_hook requires workflowEvents", () => {
    const { valid } = validateManifest(baseManifest({ workflowEvents: undefined }));
    expect(valid).toBe(false);
  });

  test("NEGATIVE: rejects an unknown permission", () => {
    const { valid } = validateManifest(baseManifest({ permissions: ["read:everything"] }));
    expect(valid).toBe(false);
  });

  test("NEGATIVE: rejects a wildcard network permission", () => {
    const { valid, errors } = validateManifest(baseManifest({ permissions: ["network:*"] }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("one specific host"))).toBe(true);
  });

  test("accepts a scoped network permission", () => {
    const { valid } = validateManifest(baseManifest({ permissions: ["network:api.example.com"] }));
    expect(valid).toBe(true);
  });

  test("NEGATIVE: rejects an entry file other than index.js", () => {
    const { valid } = validateManifest(baseManifest({ entry: "main.js" }));
    expect(valid).toBe(false);
  });

  test("assertManifestSize throws for an oversized manifest", () => {
    const huge = JSON.stringify({ id: "x".repeat(20000) });
    expect(() => assertManifestSize(huge)).toThrow();
  });
});
