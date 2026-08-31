import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { runPreCommit } from "../runner.mjs";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CLI = path.join(SOURCE_ROOT, "scripts", "hooks", "cli.mjs");

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function link(source, destination) {
  symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "marketpay hooks ü fixture "));
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Hook Test");
  git(root, "config", "user.email", "hooks@example.test");
  mkdirSync(path.join(root, "scripts"));
  link(path.join(SOURCE_ROOT, "scripts", "hooks"), path.join(root, "scripts", "hooks"));
  link(path.join(SOURCE_ROOT, "node_modules"), path.join(root, "node_modules"));
  writeFileSync(path.join(root, ".prettierrc.json"), '{"semi":true}\n');
  writeFileSync(path.join(root, ".prettierignore"), "node_modules\n");
  writeFileSync(path.join(root, ".editorconfig"), "root = true\n[*]\nend_of_line = lf\n");
  writeFileSync(path.join(root, "package-lock.json"), "{}\n");
  mkdirSync(path.join(root, "docs"));
  writeFileSync(path.join(root, "docs", "space ü.json"), '{\n  "value": 1\n}\n');
  git(
    root,
    "add",
    ".prettierrc.json",
    ".prettierignore",
    ".editorconfig",
    "package-lock.json",
    "docs"
  );
  git(root, "commit", "--quiet", "-m", "test: initialise fixture");
  return root;
}

function gitState(root) {
  return {
    cached: git(root, "diff", "--cached", "--binary"),
    worktree: git(root, "diff", "--binary"),
    stash: git(root, "stash", "list"),
    content: readFileSync(path.join(root, "docs", "space ü.json"), "utf8"),
  };
}

function gitStateForPath(root, target) {
  return {
    cached: git(root, "diff", "--cached", "--binary", "--", target),
    worktree: git(root, "diff", "--binary", "--", target),
    stash: git(root, "stash", "list"),
    content: readFileSync(path.join(root, target), "utf8"),
  };
}

test("pre-commit validates the staged blob, preserves an unstaged hunk, and meets budget", async () => {
  const root = fixture();
  try {
    const file = path.join(root, "docs", "space ü.json");
    writeFileSync(file, '{\n  "value": 2\n}\n');
    git(root, "add", "docs/space ü.json");
    writeFileSync(file, '{"value":3}\n');
    const before = gitState(root);

    const previousEnforcement = process.env.MARKETPAY_HOOK_ENFORCE_BUDGET;
    delete process.env.MARKETPAY_HOOK_ENFORCE_BUDGET;
    const report = await runPreCommit(root);
    process.env.MARKETPAY_HOOK_ENFORCE_BUDGET = "1";
    const warmReport = await runPreCommit(root);
    if (previousEnforcement === undefined) delete process.env.MARKETPAY_HOOK_ENFORCE_BUDGET;
    else process.env.MARKETPAY_HOOK_ENFORCE_BUDGET = previousEnforcement;

    assert.equal(report.status, 0);
    assert.equal(warmReport.status, 0);
    assert.ok(warmReport.totalMs < 2_000, `warm pre-commit took ${warmReport.totalMs}ms`);
    assert.deepEqual(gitState(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-commit rejects an unformatted staged blob even when the working copy is formatted", async () => {
  const root = fixture();
  try {
    const file = path.join(root, "docs", "space ü.json");
    writeFileSync(file, '{"value":2}\n');
    git(root, "add", "docs/space ü.json");
    writeFileSync(file, '{\n  "value": 3\n}\n');
    const before = gitState(root);

    const report = await runPreCommit(root);

    assert.notEqual(report.status, 0);
    assert.deepEqual(gitState(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rustfmt checks a staged, unreferenced Rust module with its crate edition", async () => {
  const root = fixture();
  try {
    const crate = path.join(root, "contracts", "marketpay-contract");
    mkdirSync(path.join(crate, "src"), { recursive: true });
    writeFileSync(
      path.join(crate, "Cargo.toml"),
      '[package]\nname = "hook-fixture"\nversion = "0.1.0"\nedition = "2021"\n'
    );
    writeFileSync(path.join(crate, "src", "lib.rs"), "pub fn existing() {}\n");
    git(root, "add", "contracts");
    git(root, "commit", "--quiet", "-m", "test: add Rust fixture");

    const file = path.join(crate, "src", "unreferenced.rs");
    writeFileSync(file, "pub fn staged(){let _value=1;}\n");
    git(root, "add", "contracts/marketpay-contract/src/unreferenced.rs");
    writeFileSync(file, "pub fn staged() {\n    let _value = 1;\n}\n");
    const before = gitStateForPath(root, "contracts/marketpay-contract/src/unreferenced.rs");

    const report = await runPreCommit(root);

    assert.notEqual(report.status, 0);
    assert.deepEqual(
      gitStateForPath(root, "contracts/marketpay-contract/src/unreferenced.rs"),
      before
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rebase and bisect replay skip repeated pre-commit work", async () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "docs", "space ü.json"), '{"unformatted":true}\n');
    git(root, "add", "docs/space ü.json");

    mkdirSync(path.join(root, ".git", "rebase-merge"));
    const rebase = await runPreCommit(root);
    assert.equal(rebase.skipped, "rebase");
    rmSync(path.join(root, ".git", "rebase-merge"), { recursive: true });

    writeFileSync(path.join(root, ".git", "BISECT_LOG"), "fixture\n");
    const bisect = await runPreCommit(root);
    assert.equal(bisect.skipped, "bisect");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolved merge, cherry-pick, revert, and ordinary amend paths validate the staged index", async () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "docs", "space ü.json"), '{\n  "valid": true\n}\n');
    git(root, "add", "docs/space ü.json");
    const head = git(root, "rev-parse", "HEAD").trim();

    for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", null]) {
      if (marker) writeFileSync(path.join(root, ".git", marker), `${head}\n`);
      const report = await runPreCommit(root);
      assert.equal(report.status, 0, `${marker || "ordinary/amend"} should validate normally`);
      if (marker) rmSync(path.join(root, ".git", marker));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unresolved merge conflicts are reported before any staged check runs", async () => {
  const root = fixture();
  try {
    const originalBranch = git(root, "branch", "--show-current").trim();
    git(root, "checkout", "--quiet", "-b", "conflicting-side");
    writeFileSync(path.join(root, "docs", "space ü.json"), '{\n  "side": true\n}\n');
    git(root, "add", "docs/space ü.json");
    git(root, "commit", "--quiet", "-m", "test: side conflict");

    git(root, "checkout", "--quiet", originalBranch);
    writeFileSync(path.join(root, "docs", "space ü.json"), '{\n  "main": true\n}\n');
    git(root, "add", "docs/space ü.json");
    git(root, "commit", "--quiet", "-m", "test: main conflict");
    const merge = spawnSync("git", ["merge", "--no-edit", "conflicting-side"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(merge.status, 0);

    await assert.rejects(runPreCommit(root), /Resolve staged conflicts.*docs\/space ü\.json/s);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "SIGINT leaves staged, unstaged, and stash state byte-for-byte unchanged",
  { skip: process.platform === "win32" },
  async () => {
    const root = fixture();
    try {
      const file = path.join(root, "docs", "space ü.json");
      writeFileSync(file, '{\n  "value": 2\n}\n');
      git(root, "add", "docs/space ü.json");
      writeFileSync(file, '{"value":3}\n');
      const before = gitState(root);

      const child = spawn(process.execPath, [CLI, "pre-commit"], {
        cwd: root,
        env: { ...process.env, MARKETPAY_HOOK_TEST_DELAY_MS: "5000" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("hook did not reach the interrupt point")),
          3_000
        );
        child.stdout.on("data", (chunk) => {
          if (chunk.toString().includes("test delay")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("error", reject);
      });
      child.kill("SIGINT");
      const code = await new Promise((resolve) => child.once("close", resolve));

      assert.equal(code, 130);
      assert.deepEqual(gitState(root), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);
