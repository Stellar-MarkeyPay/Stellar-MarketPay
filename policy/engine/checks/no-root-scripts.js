/*
 * Check: no-root-scripts
 *
 * The repository root is not a scratch directory.
 *
 * One-off scripts left at the root have had to be cleaned up once already.
 * They are invisible to the subproject linters, get no tests, and are the
 * first thing a new contributor reads.
 */

"use strict";

const { matchesAny, violation } = require("./helpers");

const RULE = "no-root-scripts";

function run(context, options) {
  const extensions = options.extensions || [".sh", ".py", ".rb", ".pl"];
  const allow = options.allow || [];
  const destination = options.destination || "scripts/";

  const results = [];
  for (const file of context.changes) {
    if (file.status === "deleted") continue;
    if (file.path.includes("/")) continue; // root level only
    if (!extensions.some((extension) => file.path.endsWith(extension))) continue;
    if (matchesAny(file.path, allow)) continue;

    results.push(
      violation(RULE, {
        path: file.path,
        message: `${file.path} is a script at the repository root.`,
        remediationHint:
          `Move it to ${destination} (or delete it if it was a one-off) and reference it from ` +
          `a package.json script so it is discoverable.`,
      })
    );
  }
  return results;
}

module.exports = { RULE, run };
