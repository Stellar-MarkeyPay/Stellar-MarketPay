/*
 * policy/tests/helpers.js
 *
 * Fixture construction for policy tests.
 *
 * Every rule is tested against both outcomes — a changeset that violates it
 * and a changeset that does not — because a check that never returns anything
 * passes a one-sided test suite forever while enforcing nothing.
 */

"use strict";

const { syntheticContext } = require("../engine/context");
const { loadManifest } = require("../engine/manifest");

const REPO_ROOT = require("node:path").resolve(__dirname, "..", "..");

/** Turn `["line one", "line two"]` into added-line records from `start`. */
function added(lines, start = 1) {
  return lines.map((text, index) => ({ line: start + index, text }));
}

function removed(lines, start = 1) {
  return lines.map((text, index) => ({ line: start + index, text }));
}

function file(path, options = {}) {
  return {
    path,
    status: options.status || "modified",
    oldPath: options.oldPath || null,
    binary: Boolean(options.binary),
    added: options.added ? added(options.added, options.addedFrom) : [],
    removed: options.removed ? removed(options.removed, options.removedFrom) : [],
  };
}

function context(partial) {
  return syntheticContext({ repoRoot: REPO_ROOT, ...partial });
}

function ruleFor(id) {
  const ruleSet = loadManifest(REPO_ROOT);
  const rule = ruleSet.rules.find((candidate) => candidate.id === id);
  if (!rule) throw new Error(`no rule "${id}" in the manifest`);
  return rule;
}

/** Run a check with the options the shipped manifest actually gives it. */
function runRule(id, ctx) {
  const rule = ruleFor(id);
  const check = require(`../engine/checks/${rule.check}`);
  return check.run(ctx, rule.options);
}

module.exports = { added, removed, file, context, runRule, ruleFor, REPO_ROOT, loadManifest };
