/*
 * Check: contract-entrypoint-tests
 *
 * A change to a public contract entrypoint must arrive with a test change.
 *
 * Incident: the "dropped multisig" merge removed declarations from the
 * contract while leaving every call site in place. The contract did not
 * compile. No test changed, so nothing in the pull request drew attention to
 * the removal.
 */

"use strict";

const { matchesAny, violation } = require("./helpers");

const RULE = "contract-entrypoint-tests";

// `pub fn` at the top level of a `#[contractimpl]` block. Matching the keyword
// rather than parsing Rust is intentional: a parser that disagrees with rustc
// is worse than a keyword match that occasionally asks for a test.
const ENTRYPOINT = /^\s*pub\s+fn\s+([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/;

function entrypointNames(lines) {
  const names = new Set();
  for (const { text } of lines) {
    const match = ENTRYPOINT.exec(text);
    if (match) names.add(match[1]);
  }
  return names;
}

function run(context, options) {
  const sources = options.sources || ["contracts/marketpay-contract/src/lib.rs"];
  const testGlobs = options.testGlobs || ["contracts/marketpay-contract/tests/**"];

  const touched = context.changes.filter((file) => matchesAny(file.path, sources));
  if (touched.length === 0) return [];

  const changedEntrypoints = new Map();
  for (const file of touched) {
    const names = new Set([...entrypointNames(file.added), ...entrypointNames(file.removed)]);
    if (names.size > 0) changedEntrypoints.set(file, names);
  }
  if (changedEntrypoints.size === 0) return [];

  const testChanged =
    context.changes.some((file) => matchesAny(file.path, testGlobs)) ||
    // A test added inline in the same Rust file counts; the contract keeps
    // unit tests in `mod tests` next to the code they cover.
    touched.some((file) => file.added.some(({ text }) => /#\[\s*test\s*\]/.test(text)));

  if (testChanged) return [];

  const results = [];
  for (const [file, names] of changedEntrypoints) {
    const listed = [...names].sort().join(", ");
    results.push(
      violation(RULE, {
        path: file.path,
        line: file.added[0] ? file.added[0].line : null,
        message:
          `${file.path} adds or changes the public entrypoint(s) ${listed}, but the ` +
          `changeset contains no test change.`,
        remediationHint:
          `Add or update a test in ${testGlobs[0]} covering ${listed}, or a #[test] in ` +
          `${file.path} itself.`,
        evidence: listed,
      })
    );
  }
  return results;
}

module.exports = { RULE, run };
