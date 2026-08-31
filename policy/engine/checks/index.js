/*
 * policy/engine/checks/index.js
 *
 * The check registry. A rule in policy/policies.json names a `check` here;
 * a manifest naming a check that does not exist fails to load rather than
 * silently passing, because a rule that evaluates to nothing looks exactly
 * like a rule that found nothing.
 */

"use strict";

const checks = [
  require("./contract-entrypoint-tests"),
  require("./storage-compat-ack"),
  require("./cargo-lock-integrity"),
  require("./migration-down-tested"),
  require("./new-module-tests"),
  require("./no-wallclock-tests"),
  require("./no-root-scripts"),
  require("./no-secrets"),
  require("./signed-commits"),
  require("./hook-integrity"),
];

const registry = new Map(checks.map((check) => [check.RULE, check]));

function getCheck(name) {
  const check = registry.get(name);
  if (!check) {
    throw new Error(
      `policy: no check named "${name}". Registered checks: ${[...registry.keys()].join(", ")}`
    );
  }
  return check;
}

module.exports = { registry, getCheck, checkNames: [...registry.keys()] };
