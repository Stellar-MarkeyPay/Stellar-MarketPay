/*
 * Check: migration-down-tested
 *
 * Every forward migration ships with a down migration, and a change to the
 * migration set is accompanied by a migration test.
 *
 * A migration without a tested reverse is a deploy with no rollback. The
 * repository already runs `npm run migrate:rollback`; the policy exists so
 * that command keeps working.
 */

"use strict";

const { matchesAny, violation } = require("./helpers");

const RULE = "migration-down-tested";

function run(context, options) {
  const dir = options.directory || "backend/src/db/migrations";
  const testGlobs = options.testGlobs || ["backend/src/db/migrate.test.js"];

  const inScope = context.changes.filter((file) => file.path.startsWith(`${dir}/`));
  if (inScope.length === 0) return [];

  const results = [];
  const changedPaths = new Set(context.changes.map((file) => file.path));
  const repoFiles = new Set(context.files);

  for (const file of inScope) {
    if (file.path.endsWith(".down.sql")) {
      if (file.status === "deleted") {
        results.push(
          violation(RULE, {
            path: file.path,
            message: `${file.path} is deleted, leaving its forward migration with no rollback.`,
            remediationHint: `Restore it with: git checkout HEAD -- ${file.path}`,
          })
        );
      }
      continue;
    }
    if (!file.path.endsWith(".up.sql")) continue;

    const down = file.path.replace(/\.up\.sql$/, ".down.sql");
    const downInChangeset = changedPaths.has(down);
    const downExists = downInChangeset || repoFiles.has(down);

    if (!downExists) {
      results.push(
        violation(RULE, {
          path: file.path,
          message: `${file.path} has no matching ${down}. This migration cannot be rolled back.`,
          remediationHint: `Create ${down} reversing every statement in ${file.path}, in the opposite order.`,
        })
      );
      continue;
    }

    if (file.status === "modified" && !downInChangeset) {
      results.push(
        violation(RULE, {
          path: file.path,
          message:
            `${file.path} changed but ${down} did not. The rollback no longer reverses the ` +
            `forward migration.`,
          remediationHint: `Update ${down} to match the new forward statements.`,
        })
      );
    }
  }

  // The "no test" finding is independent of the structural ones: a change
  // that adds a correct up/down pair and never executes either is exactly the
  // case this rule exists for, and it produces no structural finding at all.
  const testChanged = context.changes.some((file) => matchesAny(file.path, testGlobs));
  if (!testChanged) {
    results.push(
      violation(RULE, {
        path: inScope[0].path,
        message:
          `The migration set changed but no migration test did. A down migration that is never ` +
          `executed is a rollback nobody has run.`,
        remediationHint: `Add a case to ${testGlobs[0]} that applies the up and then the down.`,
      })
    );
  }

  return results;
}

module.exports = { RULE, run };
