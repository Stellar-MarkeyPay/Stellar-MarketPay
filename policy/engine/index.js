/*
 * policy/engine/index.js
 *
 * The evaluator.
 *
 * evaluate() takes a changeset context and a rule set and returns findings.
 * It has no notion of where it is running. decide() then maps those findings
 * onto a stage's severities and applies overrides. Splitting the two is the
 * mechanism behind the parity guarantee: the local hook and the CI job call
 * the same evaluate() with the same manifest, so a violation found in one is
 * found in the other by construction, and the only thing a stage can change
 * is what happens next.
 */

"use strict";

const { getCheck } = require("./checks");
const { loadManifest } = require("./manifest");
const { applySeverity, loadOverrides, severityFor } = require("./severity");

/**
 * Run every rule in the set against a context.
 *
 * A check that throws is reported as a violation of itself rather than
 * crashing the run: an engine that dies on one malformed input stops
 * enforcing every other rule, which is worse than a loud finding.
 *
 * @returns {{rule: string, path: string|null, line: number|null, message: string}[]}
 */
function evaluate(context, ruleSet) {
  const findings = [];
  for (const rule of ruleSet.rules) {
    const check = getCheck(rule.check);
    let produced;
    try {
      produced = check.run(context, rule.options) || [];
    } catch (error) {
      findings.push({
        rule: rule.id,
        path: null,
        line: null,
        message: `check "${rule.check}" failed to run: ${error.message}`,
        remediationHint: "This is a defect in the policy engine, not in the changeset.",
        evidence: null,
        engineError: true,
      });
      continue;
    }
    // A check may return findings tagged with its own check name; the rule id
    // is what the catalogue, the overrides and the report all key on.
    for (const finding of produced) findings.push({ ...finding, rule: rule.id });
  }
  return findings;
}

/**
 * Map findings onto a stage.
 *
 * Rules that are "off" at this stage are dropped here rather than skipped
 * during evaluation, so `--dry-run` can report what a stage would say without
 * the rule set changing shape between stages.
 */
function decide(findings, ruleSet, stage, overrides, now) {
  const active = findings.filter((finding) => {
    const rule = ruleSet.rules.find((candidate) => candidate.id === finding.rule);
    return rule ? severityFor(rule, stage) !== "off" : true;
  });
  return applySeverity(active, ruleSet.rules, stage, overrides, now);
}

/**
 * Full run: load, evaluate, decide.
 *
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {object} options.context
 * @param {string} options.stage
 * @param {boolean} [options.dryRun]
 */
function run(options) {
  const ruleSet = options.ruleSet || loadManifest(options.repoRoot);
  const overrides = options.overrides || loadOverrides(options.repoRoot).overrides;

  const findings = evaluate(options.context, ruleSet);
  const { decided, audit } = decide(findings, ruleSet, options.stage, overrides, options.now);

  const errors = decided.filter((finding) => finding.severity === "error");
  const warnings = decided.filter((finding) => finding.severity === "warn");

  return {
    version: ruleSet.version,
    stage: options.stage,
    dryRun: Boolean(options.dryRun),
    ruleSet,
    findings: decided,
    errors,
    warnings,
    audit,
    // Dry-run reports and never blocks; that is how a new rule is introduced
    // without an immediate wall of failures.
    exitCode: options.dryRun ? 0 : errors.length > 0 ? 1 : 0,
  };
}

module.exports = { evaluate, decide, run, loadManifest, loadOverrides };
