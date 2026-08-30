/*
 * Check: hook-integrity
 *
 * The hook scripts and the policy definitions are themselves checked.
 *
 * A hook that reports success without running anything is a supply-chain
 * problem, not a lint problem, and it is invisible precisely because
 * everything looks green. policy/integrity.json records a SHA-256 for each
 * governed file; this check recomputes them.
 *
 * The check does not stop a contributor from changing a hook — it stops a
 * change from being *silent*. Editing a hook means regenerating the manifest
 * (`npm run policy:integrity -- --write`), which puts the new digest in the
 * diff where a reviewer sees it. Combined with evaluating policy from the base
 * branch in CI, a pull request cannot weaken the gate that is judging it.
 */

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { violation } = require("./helpers");

const RULE = "hook-integrity";

function digestOf(repoRoot, target, readFile) {
  const fromChangeset = readFile ? readFile(target) : null;
  if (fromChangeset !== null && fromChangeset !== undefined) {
    return crypto.createHash("sha256").update(fromChangeset).digest("hex");
  }
  const absolute = path.join(repoRoot, target);
  if (!fs.existsSync(absolute)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
}

function loadRecorded(context, manifestPath) {
  const inTree = context.readFile(manifestPath);
  if (inTree) return JSON.parse(inTree);
  const absolute = path.join(context.repoRoot, manifestPath);
  if (!fs.existsSync(absolute)) return null;
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function run(context, options) {
  const manifestPath = options.manifestPath || "policy/integrity.json";
  const recorded = loadRecorded(context, manifestPath);
  if (!recorded || !recorded.files) {
    return [
      violation(RULE, {
        path: manifestPath,
        message: `${manifestPath} is missing, so the hook scripts and policy set are unverified.`,
        remediationHint: `Generate it with: npm run policy:integrity -- --write`,
      }),
    ];
  }

  const results = [];
  const governed = Object.keys(recorded.files);

  for (const target of governed) {
    const actual = digestOf(context.repoRoot, target, context.readFile);
    if (actual === null) {
      results.push(
        violation(RULE, {
          path: target,
          message: `${target} is recorded in ${manifestPath} but no longer exists.`,
          remediationHint:
            `If the removal is intended, regenerate the manifest: ` +
            `npm run policy:integrity -- --write`,
        })
      );
      continue;
    }
    if (actual !== recorded.files[target]) {
      results.push(
        violation(RULE, {
          path: target,
          message:
            `${target} does not match the digest recorded in ${manifestPath} ` +
            `(recorded ${recorded.files[target].slice(0, 12)}, found ${actual.slice(0, 12)}).`,
          remediationHint:
            `If you meant to change it, regenerate the manifest so the new digest is part of ` +
            `the diff a reviewer reads: npm run policy:integrity -- --write`,
        })
      );
    }
  }

  // A governed file that appears in the changeset but not in the manifest is
  // a new hook or check nobody recorded — the same blind spot, arriving from
  // the other direction.
  const patterns = options.governs || [];
  for (const file of context.changes) {
    if (file.status === "deleted") continue;
    const isGoverned = patterns.some((pattern) => file.path.startsWith(pattern));
    if (!isGoverned || governed.includes(file.path)) continue;
    results.push(
      violation(RULE, {
        path: file.path,
        message: `${file.path} governs the policy gate but is not recorded in ${manifestPath}.`,
        remediationHint: `Record it with: npm run policy:integrity -- --write`,
      })
    );
  }

  return results;
}

module.exports = { RULE, run, digestOf };
