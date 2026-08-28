import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.encoding === null ? null : "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr || "";
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${stderr.trim()}`);
  }
  return result;
}

export function git(root, args, options = {}) {
  const result = commandResult("git", args, { ...options, cwd: root });
  if (options.encoding === null) return result.stdout;
  return (result.stdout || "").trimEnd();
}

export function locateRoot(cwd = process.cwd()) {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

export function gitDir(root) {
  const raw = git(root, ["rev-parse", "--git-common-dir"]);
  return path.resolve(root, raw);
}

function splitNul(bufferOrString) {
  const text = Buffer.isBuffer(bufferOrString) ? bufferOrString.toString("utf8") : bufferOrString;
  return text.split("\0").filter(Boolean);
}

export function stagedPaths(root) {
  return splitNul(
    git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
      encoding: null,
    })
  );
}

export function stagedChangedPaths(root) {
  return splitNul(
    git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-z"], {
      encoding: null,
    })
  );
}

export function conflictedPaths(root) {
  return splitNul(git(root, ["diff", "--name-only", "--diff-filter=U", "-z"], { encoding: null }));
}

export function indexSignature(root, paths) {
  if (paths.length === 0) return "";
  return git(root, ["ls-files", "-s", "-z", "--", ...paths], { encoding: null }).toString("hex");
}

export function treeSignature(root, treeish, paths) {
  if (paths.length === 0) return "";
  const result = commandResult("git", ["ls-tree", "-r", "-z", treeish, "--", ...paths], {
    cwd: root,
    encoding: null,
    allowFailure: true,
  });
  if (result.status !== 0) return "";
  return result.stdout.toString("hex");
}

export function pathExistsInGitDir(root, name) {
  const resolved = git(root, ["rev-parse", "--git-path", name]);
  return path.resolve(root, resolved);
}

export function operationState(root) {
  const rebase = ["rebase-merge", "rebase-apply"].some((name) =>
    existsSync(pathExistsInGitDir(root, name))
  );
  const bisect = existsSync(pathExistsInGitDir(root, "BISECT_LOG"));
  const merge = existsSync(pathExistsInGitDir(root, "MERGE_HEAD"));
  const cherryPick = existsSync(pathExistsInGitDir(root, "CHERRY_PICK_HEAD"));
  const revert = existsSync(pathExistsInGitDir(root, "REVERT_HEAD"));
  return { rebase, bisect, merge, cherryPick, revert };
}

export function exportIndexSnapshot(root, treeish = null) {
  const holder = mkdtempSync(path.join(tmpdir(), "marketpay-hooks-"));
  const snapshot = path.join(holder, "snapshot");
  mkdirSync(snapshot);
  const env = { ...process.env };

  if (treeish) {
    env.GIT_INDEX_FILE = path.join(holder, "index");
    git(root, ["read-tree", treeish], { env });
  }

  // `git checkout-index` applies checkout filters such as core.autocrlf. That means a staged LF
  // blob becomes CRLF on Windows before Prettier sees it, so the hook no longer validates the
  // bytes Git will commit. Materialise stage-zero blobs directly from the object database instead.
  const records = splitNul(git(root, ["ls-files", "--stage", "-z"], { encoding: null, env }));
  const snapshotRoot = `${path.resolve(snapshot)}${path.sep}`;

  for (const record of records) {
    const separator = record.indexOf("\t");
    if (separator < 0) continue;
    const [mode, objectId, stage] = record.slice(0, separator).split(" ");
    if (stage !== "0") continue;

    const relativePath = record.slice(separator + 1);
    const destination = path.resolve(snapshot, ...relativePath.split("/"));
    if (!destination.startsWith(snapshotRoot)) {
      throw new Error(`Refusing to export an index path outside the snapshot: ${relativePath}`);
    }

    if (mode === "160000") {
      mkdirSync(destination, { recursive: true });
      continue;
    }

    mkdirSync(path.dirname(destination), { recursive: true });
    const content = git(root, ["cat-file", "blob", objectId], { encoding: null, env });
    if (mode === "120000" && process.platform !== "win32") {
      symlinkSync(content.toString("utf8"), destination);
      continue;
    }

    writeFileSync(destination, content);
    if (mode === "100755") chmodSync(destination, 0o755);
  }

  return {
    path: snapshot,
    cleanup() {
      rmSync(holder, { recursive: true, force: true });
    },
  };
}

export function exportHeadWorktree(root, treeish = "HEAD") {
  const repositoryId = createHash("sha256").update(gitDir(root)).digest("hex").slice(0, 16);
  // Jest ignores source trees nested below .git, so keep the stable worktree in the OS temp area.
  // The Git-owned result and compiler caches remain under .git/marketpay-hooks.
  const hooksDirectory = path.join(tmpdir(), `marketpay-hooks-${repositoryId}`);
  const snapshot = path.join(hooksDirectory, "head-worktree");
  const commit = git(root, ["rev-parse", "--verify", `${treeish}^{commit}`]);
  mkdirSync(hooksDirectory, { recursive: true });

  let reused = false;
  if (existsSync(path.join(snapshot, ".git"))) {
    try {
      // Keep this path stable so Cargo can reuse incremental artifacts keyed to source paths.
      // Hard reset and clean only this detached worktree; the contributor's checkout is untouched.
      git(snapshot, ["reset", "--hard", commit]);
      git(snapshot, ["clean", "-ffdx"]);
      reused = true;
    } catch {
      // The OS may preserve the directory after Git metadata was removed; recreate that stale copy.
    }
  }

  if (!reused) {
    rmSync(snapshot, { recursive: true, force: true });
    git(root, ["worktree", "prune"]);
    git(root, ["worktree", "add", "--detach", "--force", snapshot, commit]);
  }

  return {
    path: snapshot,
    // The detached worktree intentionally persists under .git for warm tool caches and stable paths.
    cleanup() {},
  };
}

function verifiedCommit(root, ref) {
  if (!ref) return null;
  const result = commandResult("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: root,
    allowFailure: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function mergeBase(root, left, right) {
  const result = commandResult("git", ["merge-base", left, right], {
    cwd: root,
    allowFailure: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function resolveFallbackBase(root, remoteName = "origin", head = "HEAD") {
  const explicit = verifiedCommit(root, process.env.MARKETPAY_HOOK_BASE);
  if (explicit) return mergeBase(root, head, explicit);

  const upstream = verifiedCommit(root, "@{upstream}");
  if (upstream) return mergeBase(root, head, upstream);

  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    allowFailure: true,
  });
  const candidates = [
    branch ? `refs/remotes/${remoteName}/${branch}` : null,
    `refs/remotes/${remoteName}/HEAD`,
    `refs/remotes/${remoteName}/main`,
    `refs/remotes/${remoteName}/develop`,
  ];

  for (const candidate of candidates) {
    const commit = verifiedCommit(root, candidate);
    if (commit) return mergeBase(root, head, commit);
  }
  return null;
}

function diffPaths(root, base, head) {
  if (!base) {
    return splitNul(git(root, ["ls-tree", "-r", "--name-only", "-z", head], { encoding: null }));
  }
  return splitNul(
    git(root, ["diff", "--name-only", "--diff-filter=ACMRD", "-z", base, head], {
      encoding: null,
    })
  );
}

export function affectedPushPaths(root, pushInput = "", remoteName = "origin") {
  const zero = /^0{40,64}$/;
  const ranges = [];

  for (const line of pushInput.split(/\r?\n/)) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || zero.test(localSha)) continue;
    const head = verifiedCommit(root, localSha);
    if (!head) continue;
    let base = !zero.test(remoteSha || "") ? verifiedCommit(root, remoteSha) : null;
    if (base) base = mergeBase(root, head, base);
    if (!base) base = resolveFallbackBase(root, remoteName, head);
    ranges.push({ base, head });
  }

  if (ranges.length === 0) {
    ranges.push({ base: resolveFallbackBase(root, remoteName), head: "HEAD" });
  }

  const paths = new Set();
  for (const range of ranges) {
    for (const file of diffPaths(root, range.base, range.head)) paths.add(file);
  }
  return [...paths].sort();
}
