import assert from "node:assert/strict";
import test from "node:test";
import { cacheKey } from "../cache.mjs";
import { classifyPaths, projectForPath, rustCratesForPaths } from "../config.mjs";

test("routes files to their owning projects and unions cross-project changes", () => {
  assert.equal(projectForPath("frontend/pages/index.tsx"), "frontend");
  assert.equal(projectForPath("backend/src/server.js"), "backend");
  assert.equal(projectForPath("docs/hooks.md"), null);
  assert.deepEqual(classifyPaths(["backend/src/server.js", "frontend/pages/index.tsx"]).projects, [
    "frontend",
    "backend",
  ]);
});

test("shared workflow and hook configuration changes route every project", () => {
  assert.deepEqual(classifyPaths([".github/workflows/ci.yml"]).projects, [
    "frontend",
    "backend",
    "contracts",
    "ml",
  ]);
  assert.deepEqual(classifyPaths(["scripts/hooks/runner.mjs"]).projects, [
    "frontend",
    "backend",
    "contracts",
    "ml",
  ]);
});

test("Rust formatting is crate-aware", () => {
  assert.deepEqual(
    rustCratesForPaths([
      "contracts/marketpay-spec/src/lib.rs",
      "contracts/marketpay-contract/src/lib.rs",
      "frontend/pages/index.tsx",
    ]),
    ["marketpay-contract", "marketpay-spec"]
  );
});

test("cache keys change with content, tool, command, or configuration engine", () => {
  const root = process.cwd();
  const base = {
    root,
    step: "frontend-tests",
    command: "jest --ci",
    toolVersion: "30.0.0",
    inputSignature: "blob-a config-a lock-a",
  };
  const original = cacheKey(base);
  assert.equal(cacheKey(base), original);
  assert.notEqual(cacheKey({ ...base, inputSignature: "blob-b config-a lock-a" }), original);
  assert.notEqual(cacheKey({ ...base, toolVersion: "31.0.0" }), original);
  assert.notEqual(cacheKey({ ...base, command: "jest --ci --runInBand" }), original);
});
