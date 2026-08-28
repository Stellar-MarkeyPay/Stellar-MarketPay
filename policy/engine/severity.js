/*
 * policy/engine/severity.js
 *
 * Resolves a violation's severity, and applies overrides.
 *
 * Detection and severity are separate on purpose. A check answers "is this
 * true of the changeset?" and nothing else; this module answers "what should
 * happen about it here?". Because the answer to the first question is
 * identical everywhere, a contributor who bypasses a hook learns about a
 * violation later, never avoids it — which is the whole point of the gate.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RANK = { off: 0, warn: 1, error: 2 };

/** Severity a rule carries at a stage; unlisted stages are "off". */
function severityFor(rule, stage) {
  return rule.stages[stage] || "off";
}

function loadOverrides(repoRoot, options = {}) {
  const overridesPath = options.overridesPath || path.join(repoRoot, "policy", "overrides.json");
  if (!fs.existsSync(overridesPath)) return { overrides: [], overridesPath };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
  } catch (error) {
    throw new Error(`policy overrides: ${overridesPath} is not valid JSON: ${error.message}`);
  }
  const overrides = Array.isArray(parsed.overrides) ? parsed.overrides : [];

  overrides.forEach((override, index) => {
    for (const field of ["id", "rule", "reason", "actor", "approvedBy", "expires"]) {
      if (typeof override[field] !== "string" || override[field].trim() === "") {
        throw new Error(
          `policy overrides: entry ${index} is missing "${field}". Every override must ` +
            `name who asked, who approved, why, and when it expires.`
        );
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(override.expires)) {
      throw new Error(
        `policy overrides: entry "${override.id}" has expires="${override.expires}"; ` +
          `use YYYY-MM-DD. An override without an expiry is a deleted rule.`
      );
    }
  });

  return { overrides, overridesPath };
}

function overrideMatches(override, violation) {
  if (override.rule !== violation.rule) return false;
  const paths = Array.isArray(override.paths) ? override.paths : null;
  if (!paths || paths.length === 0) return true;
  if (!violation.path) return false;
  return paths.some(
    (candidate) => candidate === violation.path || violation.path.startsWith(`${candidate}/`)
  );
}

function isExpired(override, now) {
  // Expiry is inclusive of the named day; the override dies at the end of it.
  return Date.parse(`${override.expires}T23:59:59Z`) < now.getTime();
}

/**
 * Attach severity to raw violations and apply any live override.
 *
 * An override downgrades but never silences: an overridden error becomes a
 * warning that still prints, still names the approver, and still says when the
 * exception dies. Silencing it would make the override invisible in review,
 * which is how exceptions become permanent.
 *
 * @returns {{ decided: object[], audit: object[] }}
 */
function applySeverity(violations, rules, stage, overrides, now = new Date()) {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const audit = [];
  const used = new Set();

  const decided = violations.map((violation) => {
    const rule = byId.get(violation.rule);
    const base = rule ? severityFor(rule, stage) : "error";
    const match = overrides.find((override) => overrideMatches(override, violation));

    if (!match) return { ...violation, severity: base, override: null };

    if (isExpired(match, now)) {
      audit.push({
        kind: "expired-override",
        override: match.id,
        rule: match.rule,
        expires: match.expires,
        actor: match.actor,
      });
      return { ...violation, severity: base, override: null, expiredOverride: match.id };
    }

    used.add(match.id);
    const downgraded = base === "error" ? "warn" : base;
    return { ...violation, severity: downgraded, override: match };
  });

  for (const override of overrides) {
    if (isExpired(override, now)) {
      if (!audit.some((entry) => entry.override === override.id)) {
        audit.push({
          kind: "expired-override",
          override: override.id,
          rule: override.rule,
          expires: override.expires,
          actor: override.actor,
        });
      }
      continue;
    }
    if (!used.has(override.id)) {
      // A live override that never fires is a rule the repository has already
      // grown out of. Surfacing it is how the periodic review finds them.
      audit.push({
        kind: "unused-override",
        override: override.id,
        rule: override.rule,
        expires: override.expires,
        actor: override.actor,
      });
    }
  }

  return { decided, audit };
}

module.exports = { RANK, severityFor, loadOverrides, applySeverity, isExpired, overrideMatches };
