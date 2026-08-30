/*
 * policy/engine/context.js
 *
 * Builds the evaluation context — the single input every policy check sees.
 *
 * The context is deliberately stage-free. A check receives a changeset and a
 * view of the repository and nothing else; it cannot know whether it is
 * running in a pre-commit hook or in CI. That is what makes the parity
 * guarantee structural rather than aspirational: there is no branch a check
 * could take that differs between local and remote, because the information
 * needed to take one is not in scope. Stage affects severity only, and
 * severity is resolved outside the check (see severity.js).
 */

"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { parseDiff } = require("./diff");

// ASCII unit and record separators. Commit subjects and bodies contain
// newlines and almost anything else, so a delimiter that cannot appear in the
// payload is the only safe way to parse `git log` output.
const FIELD_SEP = String.fromCharCode(31);
const RECORD_SEP = String.fromCharCode(30);

function git(args, { cwd, allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(`git ${args.join(" ")} failed: ${error.stderr || error.message}`);
  }
}

/**
 * Resolve the diff arguments for a source.
 *
 * `range` uses three-dot syntax so the changeset is what the branch actually
 * introduces relative to the merge base, not everything that has landed on the
 * base since the branch was cut. Diffing two-dot would make an out-of-date
 * branch inherit its base's violations.
 */
function diffArgs(source, base, head) {
  switch (source) {
    case "staged":
      return ["diff", "--cached", "-U0", "-M", "--no-color", "--no-ext-diff"];
    case "worktree":
      return ["diff", "-U0", "-M", "--no-color", "--no-ext-diff", "HEAD"];
    case "range":
      return ["diff", "-U0", "-M", "--no-color", "--no-ext-diff", `${base}...${head}`];
    default:
      throw new Error(`unknown changeset source: ${source}`);
  }
}

function readCommits(source, base, head, cwd) {
  if (source !== "range") return [];
  const format = ["%H", "%G?", "%GS", "%an", "%ae", "%B"].join(FIELD_SEP) + RECORD_SEP;
  const raw = git(["log", `--format=${format}`, `${base}..${head}`], { cwd, allowFailure: true });
  return raw
    .split(RECORD_SEP)
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [sha, signature, signer, authorName, authorEmail, ...rest] = chunk.split(FIELD_SEP);
      const message = rest.join(FIELD_SEP);
      return {
        sha,
        // %G? is 'G' good, 'B' bad, 'U' good-untrusted, 'X'/'Y'/'R' expired
        // variants, 'E' missing key, 'N' unsigned.
        signature,
        signer,
        authorName,
        authorEmail,
        message,
        subject: message.split("\n")[0] || "",
      };
    });
}

/**
 * @param {Object} options
 * @param {string} options.repoRoot
 * @param {"staged"|"worktree"|"range"} options.source
 * @param {string} [options.base]
 * @param {string} [options.head]
 * @param {string} [options.commitMessage] message under construction, if any
 * @param {string} [options.prBody]
 */
function buildContext(options) {
  const repoRoot = options.repoRoot;
  const source = options.source;
  const base = options.base || "origin/main";
  const head = options.head || "HEAD";

  const raw = git(diffArgs(source, base, head), { cwd: repoRoot });
  const changes = parseDiff(raw);

  const tracked = git(["ls-files"], { cwd: repoRoot, allowFailure: true })
    .split("\n")
    .filter(Boolean);

  const contentCache = new Map();
  const baseCache = new Map();

  /**
   * Content of a path as the changeset leaves it. Reads the index for a
   * staged run and the head tree for a range, falling back to the working
   * tree, so a check never sees a half-staged file.
   */
  function readFile(target) {
    if (contentCache.has(target)) return contentCache.get(target);
    let content = null;
    if (source === "staged") {
      content = git(["show", `:${target}`], { cwd: repoRoot, allowFailure: true }) || null;
    } else if (source === "range") {
      content = git(["show", `${head}:${target}`], { cwd: repoRoot, allowFailure: true }) || null;
    }
    if (content === null || content === "") {
      const absolute = path.join(repoRoot, target);
      content = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
    }
    contentCache.set(target, content);
    return content;
  }

  /**
   * Content of a path *before* the changeset. Rules that must reason about a
   * shape change — a dropped struct field, a renamed storage key — cannot do
   * it from a diff alone, because `-U0` hunks give changed lines and not the
   * declaration they sit inside.
   */
  function readBaseFile(target) {
    if (baseCache.has(target)) return baseCache.get(target);
    const ref = source === "range" ? base : "HEAD";
    const content =
      git(["show", `${ref}:${target}`], { cwd: repoRoot, allowFailure: true }) || null;
    baseCache.set(target, content);
    return content;
  }

  return {
    repoRoot,
    changes,
    files: tracked,
    commits: readCommits(source, base, head, repoRoot),
    commitMessage: options.commitMessage || "",
    prBody: options.prBody || "",
    readFile,
    readBaseFile,
    /** Every changed path, including the pre-rename name. */
    paths: changes.flatMap((file) => (file.oldPath ? [file.path, file.oldPath] : [file.path])),
    find(predicate) {
      return this.changes.filter(predicate);
    },
    has(predicate) {
      return this.changes.some(predicate);
    },
  };
}

/** Build a context from literal data. Used by the test harness and fixtures. */
function syntheticContext(partial) {
  const changes = (partial.changes || []).map((file) => ({
    path: file.path,
    oldPath: file.oldPath || null,
    status: file.status || "modified",
    binary: Boolean(file.binary),
    added: file.added || [],
    removed: file.removed || [],
  }));
  const contents = partial.contents || {};
  const baseContents = partial.baseContents || {};
  return {
    repoRoot: partial.repoRoot || process.cwd(),
    changes,
    files: partial.files || Object.keys(contents),
    commits: partial.commits || [],
    commitMessage: partial.commitMessage || "",
    prBody: partial.prBody || "",
    readFile: (target) => (target in contents ? contents[target] : null),
    readBaseFile: (target) => (target in baseContents ? baseContents[target] : null),
    paths: changes.flatMap((file) => (file.oldPath ? [file.path, file.oldPath] : [file.path])),
    find(predicate) {
      return this.changes.filter(predicate);
    },
    has(predicate) {
      return this.changes.some(predicate);
    },
  };
}

module.exports = { buildContext, syntheticContext, git };
