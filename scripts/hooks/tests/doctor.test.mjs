import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { diagnose } from "../doctor.mjs";

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), "marketpay-hook-doctor-"));
  git(root, "init", "--quiet");
  return root;
}

test("doctor reports an installation skipped by npm --ignore-scripts", () => {
  const root = repository();
  try {
    const hooks = diagnose(root).find((item) => item.label === "Git hooks");
    assert.equal(hooks.level, "fail");
    assert.match(hooks.detail, /core\.hooksPath is unset/);
    assert.match(hooks.fix, /npm run prepare/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor reports another hook manager shadowing Husky", () => {
  const root = repository();
  try {
    git(root, "config", "core.hooksPath", ".git/hooks");
    const hooks = diagnose(root).find((item) => item.label === "Git hooks");
    assert.equal(hooks.level, "fail");
    assert.match(hooks.detail, /shadows Husky/);
    assert.match(hooks.fix, /npm run prepare/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
