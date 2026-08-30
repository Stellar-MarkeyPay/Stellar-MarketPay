/*
 * policy/engine/manifest.js
 *
 * Loads and validates policy/policies.json — the single committed definition
 * of the rule set.
 *
 * The manifest is data, not code. A rule's identity, rationale, remediation
 * text and per-stage severity live here; only the detection logic lives in
 * policy/engine/checks. That split is what lets the same rule be a warning in
 * a pre-commit hook and an error in CI without being written twice, and it is
 * why the manifest is validated strictly: a typo in a stage name that silently
 * defaulted to "off" would disable a rule with no visible failure, which is
 * the exact class of problem this engine exists to prevent.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STAGES = ["pre-commit", "commit-msg", "pre-push", "ci"];
const SEVERITIES = ["off", "warn", "error"];

class ManifestError extends Error {}

function fail(message) {
  throw new ManifestError(`policy manifest: ${message}`);
}

function requireString(value, field, ruleId) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`rule "${ruleId}" is missing a non-empty "${field}"`);
  }
  return value;
}

/**
 * @param {string} repoRoot
 * @param {{ manifestPath?: string, checksDir?: string }} [options]
 */
function loadManifest(repoRoot, options = {}) {
  const manifestPath = options.manifestPath || path.join(repoRoot, "policy", "policies.json");
  if (!fs.existsSync(manifestPath)) fail(`not found at ${manifestPath}`);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`${manifestPath} is not valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object") fail("root must be an object");
  requireString(parsed.version, "version", "<root>");
  if (!/^\d+\.\d+\.\d+$/.test(parsed.version)) {
    fail(`version "${parsed.version}" must be semver (major.minor.patch)`);
  }
  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
    fail('"rules" must be a non-empty array');
  }

  const seen = new Set();
  const rules = parsed.rules.map((rule) => {
    if (!rule || typeof rule !== "object") fail("each rule must be an object");
    const id = requireString(rule.id, "id", rule.id || "<unnamed>");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail(`rule id "${id}" must be kebab-case`);
    if (seen.has(id)) fail(`duplicate rule id "${id}"`);
    seen.add(id);

    requireString(rule.title, "title", id);
    requireString(rule.rationale, "rationale", id);
    requireString(rule.remediation, "remediation", id);
    const check = requireString(rule.check, "check", id);

    if (!rule.stages || typeof rule.stages !== "object") {
      fail(`rule "${id}" is missing a "stages" object`);
    }
    for (const [stage, severity] of Object.entries(rule.stages)) {
      if (!STAGES.includes(stage)) {
        fail(`rule "${id}" names unknown stage "${stage}" (expected one of ${STAGES.join(", ")})`);
      }
      if (!SEVERITIES.includes(severity)) {
        fail(
          `rule "${id}" gives stage "${stage}" unknown severity "${severity}" ` +
            `(expected one of ${SEVERITIES.join(", ")})`
        );
      }
    }
    // An unlisted stage is "off" — but every rule must be enforced somewhere,
    // or it is documentation pretending to be a gate.
    const enforced = Object.values(rule.stages).some((severity) => severity !== "off");
    if (!enforced) fail(`rule "${id}" is "off" at every stage; delete it or enable it`);

    return {
      id,
      title: rule.title,
      rationale: rule.rationale,
      remediation: rule.remediation,
      incident: typeof rule.incident === "string" ? rule.incident : null,
      check,
      stages: { ...rule.stages },
      options: rule.options && typeof rule.options === "object" ? rule.options : {},
    };
  });

  return { version: parsed.version, description: parsed.description || "", rules, manifestPath };
}

module.exports = { loadManifest, ManifestError, STAGES, SEVERITIES };
