/*
 * Check: new-module-tests
 *
 * A new backend service or route arrives with a test file.
 *
 * This rule is not retroactive: 30 services and 39 routes predate it and are
 * untested. It fires only on files the changeset *adds*, so the debt stops
 * growing without a wall of failures on day one — the same reason the rule
 * ships warn-only first (see docs/POLICY_CATALOGUE.md).
 */

"use strict";

const path = require("node:path");

const { isTestPath, matchesAny, violation } = require("./helpers");

const RULE = "new-module-tests";

function run(context, options) {
  const directories = options.directories || ["backend/src/services", "backend/src/routes"];
  const extensions = options.extensions || [".js"];
  const ignore = options.ignore || [];

  const changedPaths = new Set(context.changes.map((file) => file.path));
  const repoFiles = new Set(context.files);
  const results = [];

  for (const file of context.changes) {
    if (file.status !== "added") continue;
    if (!directories.some((directory) => file.path.startsWith(`${directory}/`))) continue;
    if (!extensions.includes(path.posix.extname(file.path))) continue;
    if (isTestPath(file.path)) continue;
    if (matchesAny(file.path, ignore)) continue;

    const extension = path.posix.extname(file.path);
    const stem = file.path.slice(0, -extension.length);
    const candidates = [`${stem}.test${extension}`, `${stem}.integration.test${extension}`];

    if (candidates.some((candidate) => changedPaths.has(candidate) || repoFiles.has(candidate))) {
      continue;
    }

    results.push(
      violation(RULE, {
        path: file.path,
        message: `${file.path} is a new module with no test file.`,
        remediationHint:
          `Add ${candidates[0]} covering its exported behaviour. It runs in the existing ` +
          `backend Jest suite with no configuration.`,
      })
    );
  }

  return results;
}

module.exports = { RULE, run };
