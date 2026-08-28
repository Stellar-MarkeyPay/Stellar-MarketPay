import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  affectedPushPaths,
  exportHeadWorktree,
  exportIndexSnapshot,
  operationState,
} from "../git.mjs";

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), "marketpay-hooks-git-test-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Hook Test");
  git(root, "config", "user.email", "hooks@example.test");
  git(root, "config", "core.autocrlf", "false");
  writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "test: initialise fixture");
  return root;
}

test("pre-push range includes every commit since the merge base, not only HEAD~1", () => {
  const root = repository();
  const previousBase = process.env.MARKETPAY_HOOK_BASE;
  try {
    const base = git(root, "rev-parse", "HEAD");
    mkdirSync(path.join(root, "frontend"));
    writeFileSync(path.join(root, "frontend", "first.js"), "export const first = true;\n");
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "test: add first project change");

    mkdirSync(path.join(root, "backend"));
    writeFileSync(path.join(root, "backend", "second.js"), "module.exports = true;\n");
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "test: add second project change");

    process.env.MARKETPAY_HOOK_BASE = base;
    assert.deepEqual(affectedPushPaths(root), ["backend/second.js", "frontend/first.js"]);
  } finally {
    if (previousBase === undefined) delete process.env.MARKETPAY_HOOK_BASE;
    else process.env.MARKETPAY_HOOK_BASE = previousBase;
    rmSync(root, { recursive: true, force: true });
  }
});

test("HEAD snapshots exclude staged and unstaged future content", () => {
  const root = repository();
  try {
    writeFileSync(path.join(root, "README.md"), "staged future\n");
    git(root, "add", "README.md");
    writeFileSync(path.join(root, "README.md"), "unstaged future\n");
    const snapshot = exportIndexSnapshot(root, "HEAD");
    try {
      assert.equal(readFileSync(path.join(snapshot.path, "README.md"), "utf8"), "# fixture\n");
    } finally {
      snapshot.cleanup();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("index snapshots preserve staged blob bytes when checkout conversion is enabled", () => {
  const root = repository();
  try {
    git(root, "config", "core.autocrlf", "true");
    writeFileSync(path.join(root, "README.md"), "staged with LF\n");
    git(root, "add", "README.md");
    const staged = spawnSync("git", ["show", ":README.md"], {
      cwd: root,
      encoding: null,
    });
    assert.equal(staged.status, 0, staged.stderr?.toString("utf8"));

    const snapshot = exportIndexSnapshot(root);
    try {
      assert.deepEqual(readFileSync(path.join(snapshot.path, "README.md")), staged.stdout);
    } finally {
      snapshot.cleanup();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the persistent pre-push worktree follows root HEAD but excludes future content", () => {
  const root = repository();
  let hooksDirectory;
  try {
    const first = exportHeadWorktree(root);
    hooksDirectory = path.dirname(first.path);
    assert.equal(readFileSync(path.join(first.path, "README.md"), "utf8"), "# fixture\n");

    writeFileSync(path.join(root, "README.md"), "committed\n");
    git(root, "add", "README.md");
    git(root, "commit", "--quiet", "-m", "test: advance root HEAD");
    writeFileSync(path.join(root, "README.md"), "staged future\n");
    git(root, "add", "README.md");
    writeFileSync(path.join(root, "README.md"), "unstaged future\n");

    const second = exportHeadWorktree(root);
    assert.equal(second.path, first.path);
    assert.equal(readFileSync(path.join(second.path, "README.md"), "utf8"), "committed\n");
  } finally {
    if (hooksDirectory) {
      spawnSync(
        "git",
        ["worktree", "remove", "--force", path.join(hooksDirectory, "head-worktree")],
        {
          cwd: root,
          encoding: "utf8",
        }
      );
      rmSync(hooksDirectory, { recursive: true, force: true });
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("Git lifecycle state detection distinguishes replay, merge, and conflict-resolution states", () => {
  const root = repository();
  const gitDirectory = path.join(root, ".git");
  try {
    mkdirSync(path.join(gitDirectory, "rebase-merge"));
    writeFileSync(path.join(gitDirectory, "BISECT_LOG"), "fixture\n");
    writeFileSync(path.join(gitDirectory, "MERGE_HEAD"), `${git(root, "rev-parse", "HEAD")}\n`);
    writeFileSync(
      path.join(gitDirectory, "CHERRY_PICK_HEAD"),
      `${git(root, "rev-parse", "HEAD")}\n`
    );
    writeFileSync(path.join(gitDirectory, "REVERT_HEAD"), `${git(root, "rev-parse", "HEAD")}\n`);

    assert.deepEqual(operationState(root), {
      rebase: true,
      bisect: true,
      merge: true,
      cherryPick: true,
      revert: true,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleted files still route their owning project on pre-push", () => {
  const root = repository();
  const previousBase = process.env.MARKETPAY_HOOK_BASE;
  try {
    mkdirSync(path.join(root, "frontend"));
    writeFileSync(path.join(root, "frontend", "removed.js"), "export default true;\n");
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "test: add removable file");
    const base = git(root, "rev-parse", "HEAD");

    rmSync(path.join(root, "frontend", "removed.js"));
    git(root, "add", "-u");
    git(root, "commit", "--quiet", "-m", "test: remove project file");

    process.env.MARKETPAY_HOOK_BASE = base;
    assert.deepEqual(affectedPushPaths(root), ["frontend/removed.js"]);
  } finally {
    if (previousBase === undefined) delete process.env.MARKETPAY_HOOK_BASE;
    else process.env.MARKETPAY_HOOK_BASE = previousBase;
    rmSync(root, { recursive: true, force: true });
  }
});
