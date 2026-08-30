/*
 * Check: no-secrets
 *
 * Credentials must not reach git history.
 *
 * A secret that lands in a commit is not removed by deleting it in the next
 * one: the object stays reachable through the reflog, every fork, and every
 * CI cache. Revocation, not redaction, is the only fix — so the cheapest place
 * to stop it is before the commit exists, and the only reliable place is the
 * server, which is why this rule runs at both.
 *
 * Detection is pattern matching *and* entropy. Patterns catch the credentials
 * whose shape is known (AWS, GitHub, Slack, Stellar seeds, PEM blocks);
 * entropy catches the ones whose shape is not. Entropy alone is noise, so it
 * only applies to the value side of a credential-shaped assignment, and only
 * after the placeholder filter has run — this repository is full of
 * documentation placeholders and the signal has to stay actionable.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { matchesAny, violation } = require("./helpers");

const RULE = "no-secrets";

const PATTERNS = [
  { name: "AWS access key id", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Stripe secret key", regex: /\b(?:sk|rk)_live_[0-9A-Za-z]{24,}\b/ },
  { name: "private key block", regex: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/ },
  { name: "Stellar secret seed", regex: /\bS[A-Z2-7]{55}\b/ },
  {
    name: "database URL with inline password",
    regex:
      /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/]+:([^@\s]{6,})@([^\s/:?"'`]+)/,
    // The password is the only part that matters; a connection string whose
    // password is `change-me` is a template, and the Kubernetes manifests in
    // this repository are full of them.
    sensitiveGroup: 1,
    // A loopback DSN is a developer's own machine. Flagging `.env.example`,
    // docker-compose defaults and the CI service container's credentials
    // teaches contributors that the scanner is wrong, which is how a real
    // finding gets skimmed past later.
    skipIf: (match) => /^(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(match[2]),
  },
];

// The left-hand side of an assignment that would hold a credential.
//
// The alternatives are deliberately specific. An earlier draft matched a bare
// "auth", which fired on `author_address` and `authenticatorData` — neither a
// credential. A scanner that cries wolf on ordinary field names is a scanner
// contributors learn to skim past.
const CREDENTIAL_KEY =
  /\b([A-Za-z0-9_.-]*(?:secret|token|passwd|password|passphrase|api[_-]?key|access[_-]?key|private[_-]?key|signing[_-]?key|credential|authorization|auth[_-]?token)[A-Za-z0-9_.-]*)\b\s*[:=]\s*["'`]?([^\s"'`,;)]{12,})["'`]?/i;

// Values that look like credentials but are documentation. Kept broad on
// purpose: a false negative here is one line a reviewer still sees, while a
// false positive trains contributors to ignore the scanner.
const PLACEHOLDER =
  /^(?:\$\{|<|\{\{|%\()|(?:change[_-]?me|example|sample|placeholder|redacted|dummy|fake|your[_-]?|my[_-]?|xxx+|\.\.\.|todo|replace[_-]?me|insert[_-]?|test[_-]?(?:secret|token|key|password)|ci[_-]test|localhost|null|none|undefined|true|false)/i;

// A path allowlist entry that would match most of the repository.
const TOO_BROAD = /^(?:\*+|\*\*\/\*+|\.\/?\*+|[a-z]+\/\*\*)?$|^\*\*$|^\*$|^\*\*\/\*$/i;

const BASE64ISH = /^[A-Za-z0-9+/=_-]+$/;
const HEXISH = /^[0-9a-fA-F]+$/;

/** Shannon entropy in bits per character. */
function shannonEntropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function looksGenerated(value, minEntropy) {
  if (value.length < 20) return false;
  if (!BASE64ISH.test(value) && !HEXISH.test(value)) return false;
  // A long run of one character is padding or a redaction bar, not a key.
  if (/(.)\1{5,}/.test(value)) return false;
  const distinct = new Set(value).size;
  if (distinct < 8) return false;
  return shannonEntropy(value) >= minEntropy;
}

function loadAllowlist(context, options) {
  const configured = options.allowlistPath || "policy/secrets-allowlist.json";
  const absolute = path.isAbsolute(configured)
    ? configured
    : path.join(context.repoRoot, configured);

  let raw = {};
  if (fs.existsSync(absolute)) {
    raw = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } else {
    const inTree = context.readFile(configured);
    if (inTree) raw = JSON.parse(inTree);
  }

  const entries = Array.isArray(raw.allow) ? raw.allow : [];
  const kinds = { paths: [], literals: new Set(), patterns: [] };

  entries.forEach((entry, index) => {
    // Every entry needs a reason. An allowlist nobody can justify is the
    // scanner being switched off one line at a time, and it is the first
    // thing to read when a real credential slips through.
    if (!entry || typeof entry.value !== "string" || typeof entry.reason !== "string") {
      throw new Error(
        `policy: ${configured} entry ${index} needs a "value" and a "reason". ` +
          `An unjustified allowlist entry is the scanner being disabled quietly.`
      );
    }
    if (entry.kind === "path") {
      // The allowlist is read from the pull request's own tree, so a
      // contributor can justify a new placeholder in the same change that
      // introduces it. That is only safe while an entry cannot be broad
      // enough to switch the scanner off wholesale.
      if (TOO_BROAD.test(entry.value)) {
        throw new Error(
          `policy: ${configured} entry ${index} allows "${entry.value}", which is broad enough ` +
            `to disable the scanner. Allow a specific file or literal instead.`
        );
      }
      kinds.paths.push(entry.value);
    } else if (entry.kind === "literal") kinds.literals.add(entry.value);
    else if (entry.kind === "pattern") {
      kinds.patterns.push(new RegExp(entry.value, entry.flags || ""));
    } else {
      throw new Error(
        `policy: ${configured} entry ${index} has kind "${entry.kind}"; ` +
          `expected "path", "literal" or "pattern".`
      );
    }
  });

  return kinds;
}

function allowed(allowlist, filePath, text) {
  if (matchesAny(filePath, allowlist.paths)) return true;
  if (allowlist.literals.has(text.trim())) return true;
  return allowlist.patterns.some((pattern) => pattern.test(text));
}

function run(context, options) {
  const minEntropy = typeof options.minEntropy === "number" ? options.minEntropy : 4.0;
  const allowlist = loadAllowlist(context, options);
  const results = [];

  for (const file of context.changes) {
    if (file.status === "deleted" || file.binary) continue;
    if (matchesAny(file.path, allowlist.paths)) continue;

    for (const { line, text } of file.added) {
      if (text.length > 4096) continue; // minified bundle, not a hand-written secret
      if (allowed(allowlist, file.path, text)) continue;

      const matched = PATTERNS.map((pattern) => ({
        pattern,
        match: pattern.regex.exec(text),
      })).find(({ pattern, match }) => {
        if (!match) return false;
        if (pattern.skipIf && pattern.skipIf(match)) return false;
        if (!pattern.sensitiveGroup) return true;
        const value = match[pattern.sensitiveGroup];
        return Boolean(value) && !PLACEHOLDER.test(value);
      });
      if (matched) {
        results.push(
          violation(RULE, {
            path: file.path,
            line,
            message:
              `${file.path}:${line} adds what looks like a ${matched.pattern.name}. A credential in a ` +
              `commit must be treated as disclosed even if the commit is amended away.`,
            remediationHint:
              `Remove the value, load it from the environment, and rotate the credential. ` +
              `See docs/SECRET_RESPONSE.md. If it is a documentation placeholder, add it to ` +
              `policy/secrets-allowlist.json with a reason.`,
            evidence: matched.pattern.name,
          })
        );
        continue;
      }

      const assignment = CREDENTIAL_KEY.exec(text);
      if (!assignment) continue;
      const [, key, value] = assignment;
      if (PLACEHOLDER.test(value)) continue;
      if (!looksGenerated(value, minEntropy)) continue;

      results.push(
        violation(RULE, {
          path: file.path,
          line,
          message:
            `${file.path}:${line} assigns a high-entropy value to "${key}" ` +
            `(${shannonEntropy(value).toFixed(2)} bits/char over ${value.length} characters).`,
          remediationHint:
            `Move the value to an environment variable or secret store and rotate it. If it is ` +
            `a placeholder, add it to policy/secrets-allowlist.json with a reason.`,
          evidence: key,
        })
      );
    }
  }

  return results;
}

module.exports = { RULE, run, shannonEntropy, looksGenerated };
