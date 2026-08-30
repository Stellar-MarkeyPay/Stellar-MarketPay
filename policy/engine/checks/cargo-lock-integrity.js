/*
 * Check: cargo-lock-integrity
 *
 * Cargo.lock is committed deliberately. The contract is a deployable artefact,
 * so its build must be reproducible.
 *
 * Incident: soroban-env-host declares `ed25519-dalek = ">=2.0.0"`. Without a
 * committed lock, CI re-resolved to a 3.x that does not compile against
 * env-host, and the Rust job broke with no change to this repository. Both
 * halves of that failure are checked here: the lock going missing, and a new
 * unbounded requirement being introduced.
 */

"use strict";

const path = require("node:path");

const { violation } = require("./helpers");

const RULE = "cargo-lock-integrity";

// A requirement with a lower bound and no upper bound, or an outright
// wildcard. `>=2.0.0, <3` is fine; `>=2.0.0` and `*` are not.
const UNBOUNDED = /(?:^|[\s"'=])(>=?\s*[\d.]+|\*)\s*(?:"|'|$)/;
const DEPENDENCY_LINE = /^\s*[A-Za-z0-9_-]+\s*=\s*(.+)$/;

function siblingManifest(lockPath) {
  const dir = path.posix.dirname(lockPath);
  return dir === "." ? "Cargo.toml" : `${dir}/Cargo.toml`;
}

function run(context, options) {
  const results = [];
  const changedPaths = new Set(context.changes.map((file) => file.path));

  for (const file of context.changes) {
    const base = path.posix.basename(file.path);

    if (base === "Cargo.lock") {
      if (file.status === "deleted") {
        results.push(
          violation(RULE, {
            path: file.path,
            message:
              `${file.path} is deleted. The lock is committed on purpose: without it CI ` +
              `re-resolves unbounded version ranges and the contract stops compiling.`,
            remediationHint: `Restore it with: git checkout HEAD -- ${file.path}`,
          })
        );
        continue;
      }

      const manifest = siblingManifest(file.path);
      if (!changedPaths.has(manifest)) {
        results.push(
          violation(RULE, {
            path: file.path,
            message:
              `${file.path} changed but ${manifest} did not. A lock that moves on its own is ` +
              `an unreviewed dependency change.`,
            remediationHint:
              `Either include the ${manifest} change that caused the re-resolve, or revert ` +
              `the lock with: git checkout HEAD -- ${file.path}`,
          })
        );
      }
      continue;
    }

    if (base !== "Cargo.toml") continue;

    for (const { line, text } of file.added) {
      const match = DEPENDENCY_LINE.exec(text);
      if (!match) continue;
      const requirement = match[1];
      // Table form (`{ version = "..", features = [..] }`) and string form
      // both end up here; look at the whole right-hand side.
      if (!UNBOUNDED.test(requirement)) continue;
      results.push(
        violation(RULE, {
          path: file.path,
          line,
          message:
            `${file.path}:${line} introduces an unbounded version requirement ` +
            `(${text.trim()}). An unbounded range resolves to a future major and breaks the ` +
            `build with no change to this repository.`,
          remediationHint: `Pin an upper bound, e.g. ">=2.0.0, <3".`,
          evidence: text.trim(),
        })
      );
    }
  }

  return results;
}

module.exports = { RULE, run };
