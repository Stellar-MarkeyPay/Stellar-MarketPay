/*
 * policy/engine/checks/helpers.js
 *
 * Shared predicates for policy checks. Kept deliberately small: anything a
 * single check needs belongs in that check, so a rule's behaviour can be read
 * in one file.
 */

"use strict";

/**
 * Translate a restricted glob into a regular expression.
 *
 * Supports `**` (any depth, including none), `*` (one path segment) and `?`.
 * Deliberately not a full glob implementation — policy paths are written by
 * the people who maintain this repository, and a small, predictable subset is
 * easier to reason about than brace expansion and negation.
 */
function globToRegExp(pattern) {
  let out = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          // `a/**/b` should also match `a/b`, so swallow the following slash
          // and make the whole segment optional.
          index += 1;
          out += "(?:.*/)?";
        } else {
          // A trailing `**` means "everything below here", files included.
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

const globCache = new Map();

function matchesGlob(target, pattern) {
  let regex = globCache.get(pattern);
  if (!regex) {
    regex = globToRegExp(pattern);
    globCache.set(pattern, regex);
  }
  return regex.test(target);
}

function matchesAny(target, patterns) {
  return (patterns || []).some((pattern) => matchesGlob(target, pattern));
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\//i;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;

/** A path that holds tests, across all three subprojects' conventions. */
function isTestPath(target) {
  if (TEST_FILE.test(target)) return true;
  if (TEST_PATH.test(target)) return true;
  if (/_tests?\.rs$/.test(target)) return true;
  if (/(^|\/)test_[^/]+\.py$/.test(target)) return true;
  return false;
}

/** Every line the changeset introduces or removes for a file. */
function touchedLines(file) {
  return [...file.added, ...file.removed];
}

/** Violation constructor, so every check produces the same shape. */
function violation(rule, { path: target, line, message, remediationHint, evidence }) {
  return {
    rule,
    path: target || null,
    line: typeof line === "number" ? line : null,
    message,
    remediationHint: remediationHint || null,
    evidence: evidence || null,
  };
}

module.exports = { globToRegExp, matchesGlob, matchesAny, isTestPath, touchedLines, violation };
