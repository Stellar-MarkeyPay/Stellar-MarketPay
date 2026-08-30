/**
 * src/plugins/securityScan.js
 *
 * Static analysis gate a plugin submission must pass before it can enter
 * review (Issue #322, "implement a review process including automated
 * security scanning of submitted code").
 *
 * This is a coarse, deliberately conservative textual/AST scan — it is a
 * gate, not the sandbox. The actual safety property ("untrusted code cannot
 * escape") comes from sandbox.js's worker-isolate + mediated-broker design,
 * which holds even if this scanner has false negatives. This scan exists to
 * reject the cheap, common cases early (a plugin that literally imports
 * `fs`, or calls `eval`) with a clear reviewer-facing reason, before a human
 * reviewer's time is spent on it, and to make an obviously malicious
 * submission bounce immediately rather than reach a sandboxed run at all.
 *
 * Uses Node's own `acorn`-free approach: since parsing arbitrary submitted
 * JS with a real parser to inspect its AST is the more thorough option and
 * this project doesn't otherwise depend on a JS parser, we use Node's
 * built-in `vm.Script` compilation (which fully parses the source and
 * throws on syntax errors) for a syntax check, and pattern-match the
 * disallowed surface directly. A determined attacker can obfuscate past a
 * textual scan; they cannot escape the worker sandbox that runs the code
 * regardless of what this scan finds, which is the actual safety boundary.
 */
"use strict";

const vm = require("node:vm");

/** Node builtins a plugin must never import — sandbox.js's worker also has
 *  none of these wired in, so a reference to them is either a submission
 *  that will simply throw ReferenceError at runtime, or a deliberate probe
 *  worth flagging to a reviewer before it's published. */
const FORBIDDEN_MODULES = [
  "fs",
  "node:fs",
  "child_process",
  "node:child_process",
  "net",
  "node:net",
  "http",
  "node:http",
  "https",
  "node:https",
  "dgram",
  "node:dgram",
  "cluster",
  "node:cluster",
  "worker_threads",
  "node:worker_threads",
  "vm",
  "node:vm",
  "module",
  "node:module",
  "process",
];

const FORBIDDEN_PATTERNS = [
  { re: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, kind: "require", captureModule: true },
  { re: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, kind: "dynamic-import", captureModule: true },
  { re: /\beval\s*\(/g, kind: "eval", message: "eval() is not permitted" },
  {
    re: /\bnew\s+Function\s*\(/g,
    kind: "function-constructor",
    message: "the Function constructor is not permitted",
  },
  {
    re: /\bprocess\s*\.\s*(binding|mainModule|_linkedBinding)\b/g,
    kind: "process-internals",
    message: "access to process internals is not permitted",
  },
  {
    re: /\b__proto__\b|\bObject\s*\.\s*setPrototypeOf\b/g,
    kind: "prototype-tamper",
    message: "prototype manipulation is not permitted",
  },
];

const MAX_SOURCE_BYTES = 512 * 1024;

/**
 * Scan one plugin's `index.js` source. Returns `{ passed, findings }` where
 * each finding is `{ kind, message, line }`. Never throws on malformed
 * input — a syntax error is itself a finding, not an exception the caller
 * has to catch.
 */
function scanSource(source) {
  const findings = [];

  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    return {
      passed: false,
      findings: [{ kind: "too-large", message: `source exceeds ${MAX_SOURCE_BYTES} bytes` }],
    };
  }

  try {
    // Parses (but does not execute) the source, catching syntax errors and
    // obvious top-level issues before this ever reaches the sandbox.
    new vm.Script(source, { filename: "index.js" });
  } catch (err) {
    return { passed: false, findings: [{ kind: "syntax-error", message: err.message }] };
  }

  const lineOf = (index) => source.slice(0, index).split("\n").length;

  for (const pattern of FORBIDDEN_PATTERNS) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(source))) {
      if (pattern.captureModule) {
        const moduleName = match[1];
        if (FORBIDDEN_MODULES.includes(moduleName)) {
          findings.push({
            kind: pattern.kind,
            message: `${pattern.kind === "require" ? "require" : "import"} of forbidden module "${moduleName}"`,
            line: lineOf(match.index),
          });
        } else if (!moduleName.startsWith("marketpay:")) {
          // Any import other than the SDK's own namespace is at minimum a
          // reviewer question: it names a module the sandbox does not
          // provide, so at best it errors at runtime, at worst it's probing
          // for something not in FORBIDDEN_MODULES's explicit list.
          findings.push({
            kind: "unrecognized-import",
            message: `import of "${moduleName}" is not a recognized plugin SDK module`,
            line: lineOf(match.index),
          });
        }
      } else {
        findings.push({ kind: pattern.kind, message: pattern.message, line: lineOf(match.index) });
      }
    }
  }

  return { passed: findings.length === 0, findings };
}

module.exports = { scanSource, FORBIDDEN_MODULES, MAX_SOURCE_BYTES };
