/*
 * policy/tests/engine.test.js
 *
 * The machinery around the rules: the diff parser they read, the manifest
 * that configures them, the overrides that soften them and the dry-run mode
 * that introduces them.
 *
 * These are the parts whose failure is silent. A rule that stops firing is
 * indistinguishable from a repository that stopped violating it, so the
 * engine's own behaviour is pinned here.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseDiff } = require("../engine/diff");
const { loadManifest, ManifestError } = require("../engine/manifest");
const { applySeverity, loadOverrides, isExpired } = require("../engine/severity");
const { evaluate, decide, run: runEngine } = require("../engine");
const { globToRegExp, matchesGlob } = require("../engine/checks/helpers");
const report = require("../engine/report");
const { context, file, REPO_ROOT } = require("./helpers");

function withTempManifest(contents, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-"));
  fs.mkdirSync(path.join(dir, "policy"));
  fs.writeFileSync(
    path.join(dir, "policy", "policies.json"),
    typeof contents === "string" ? contents : JSON.stringify(contents)
  );
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const VALID_RULE = {
  id: "no-root-scripts",
  title: "t",
  rationale: "r",
  remediation: "f",
  check: "no-root-scripts",
  stages: { ci: "error" },
};

test("diff: reads added lines with their new-file line numbers", () => {
  const raw = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -10,0 +11,2 @@",
    "+const x = 1;",
    "+const y = 2;",
  ].join("\n");
  const [parsed] = parseDiff(raw);
  assert.equal(parsed.path, "src/a.js");
  assert.equal(parsed.status, "modified");
  assert.deepEqual(
    parsed.added.map((entry) => entry.line),
    [11, 12]
  );
});

test("diff: distinguishes added, deleted and renamed files", () => {
  const raw = [
    "diff --git a/new.js b/new.js",
    "new file mode 100644",
    "@@ -0,0 +1 @@",
    "+hello",
    "diff --git a/gone.js b/gone.js",
    "deleted file mode 100644",
    "@@ -1 +0,0 @@",
    "-bye",
    "diff --git a/old.js b/moved.js",
    "similarity index 98%",
    "rename from old.js",
    "rename to moved.js",
  ].join("\n");
  const parsed = parseDiff(raw);
  assert.deepEqual(
    parsed.map((entry) => [entry.path, entry.status]),
    [
      ["new.js", "added"],
      ["gone.js", "deleted"],
      ["moved.js", "renamed"],
    ]
  );
  assert.equal(parsed[2].oldPath, "old.js");
});

test("diff: does not mistake the +++ header for an added line", () => {
  const raw = ["diff --git a/a.js b/a.js", "--- a/a.js", "+++ b/a.js", "@@ -1 +1 @@", "+x"].join(
    "\n"
  );
  const [parsed] = parseDiff(raw);
  assert.deepEqual(
    parsed.added.map((entry) => entry.text),
    ["x"]
  );
});

test("glob: ** matches files below a directory as well as the directory", () => {
  assert.ok(matchesGlob("contracts/marketpay-contract/tests/v2_escrow.rs", "contracts/**"));
  assert.ok(matchesGlob("a/b/c.js", "a/**/c.js"));
  assert.ok(matchesGlob("a/c.js", "a/**/c.js"));
  assert.ok(matchesGlob("x/y.snap", "**/*.snap"));
  assert.equal(matchesGlob("other/c.js", "a/**"), false);
  assert.equal(globToRegExp("a/*.js").test("a/b/c.js"), false);
});

test("manifest: rejects an unknown stage rather than silently disabling a rule", () => {
  withTempManifest(
    { version: "1.0.0", rules: [{ ...VALID_RULE, stages: { "pre-comit": "warn" } }] },
    (dir) => {
      assert.throws(() => loadManifest(dir), ManifestError, /unknown stage/);
    }
  );
});

test("manifest: rejects an unknown severity", () => {
  withTempManifest(
    { version: "1.0.0", rules: [{ ...VALID_RULE, stages: { ci: "fatal" } }] },
    (dir) => {
      assert.throws(() => loadManifest(dir), ManifestError, /unknown severity/);
    }
  );
});

test("manifest: rejects a rule that is off everywhere", () => {
  withTempManifest(
    { version: "1.0.0", rules: [{ ...VALID_RULE, stages: { ci: "off" } }] },
    (dir) => {
      assert.throws(() => loadManifest(dir), ManifestError, /off. at every stage/);
    }
  );
});

test("manifest: rejects duplicate rule ids and non-semver versions", () => {
  withTempManifest({ version: "1.0.0", rules: [VALID_RULE, VALID_RULE] }, (dir) => {
    assert.throws(() => loadManifest(dir), ManifestError, /duplicate/);
  });
  withTempManifest({ version: "1", rules: [VALID_RULE] }, (dir) => {
    assert.throws(() => loadManifest(dir), ManifestError, /semver/);
  });
});

test("manifest: requires a rationale and a remediation on every rule", () => {
  for (const field of ["rationale", "remediation", "title"]) {
    const rule = { ...VALID_RULE };
    delete rule[field];
    withTempManifest({ version: "1.0.0", rules: [rule] }, (dir) => {
      assert.throws(() => loadManifest(dir), ManifestError, new RegExp(field));
    });
  }
});

test("the shipped manifest loads and every rule is versioned", () => {
  const ruleSet = loadManifest(REPO_ROOT);
  assert.match(ruleSet.version, /^\d+\.\d+\.\d+$/);
  assert.ok(ruleSet.rules.length >= 10);
});

const ruleSet = loadManifest(REPO_ROOT);

function rootScriptChangeset() {
  return context({ changes: [file("cleanup.sh", { status: "added" })] });
}

test("severity: an override downgrades an error to a visible warning", () => {
  const findings = evaluate(rootScriptChangeset(), ruleSet);
  const override = {
    id: "OVR-TEST",
    rule: "no-root-scripts",
    reason: "migration in flight",
    actor: "ada@example.com",
    approvedBy: "grace@example.com",
    expires: "2999-01-01",
  };
  const { decided } = decide(findings, ruleSet, "ci", [override]);
  const finding = decided.find((entry) => entry.rule === "no-root-scripts");
  assert.equal(finding.severity, "warn");
  assert.equal(finding.override.id, "OVR-TEST");
});

test("severity: an expired override does not apply, and is reported", () => {
  const findings = evaluate(rootScriptChangeset(), ruleSet);
  const override = {
    id: "OVR-OLD",
    rule: "no-root-scripts",
    reason: "was needed once",
    actor: "ada@example.com",
    approvedBy: "grace@example.com",
    expires: "2000-01-01",
  };
  const { decided, audit } = decide(findings, ruleSet, "ci", [override]);
  const finding = decided.find((entry) => entry.rule === "no-root-scripts");
  assert.equal(finding.severity, "error");
  assert.equal(finding.expiredOverride, "OVR-OLD");
  assert.ok(audit.some((entry) => entry.kind === "expired-override"));
});

test("severity: an override that matches nothing is surfaced for review", () => {
  const override = {
    id: "OVR-STALE",
    rule: "no-root-scripts",
    reason: "no longer needed",
    actor: "ada@example.com",
    approvedBy: "grace@example.com",
    expires: "2999-01-01",
  };
  const { audit } = applySeverity([], ruleSet.rules, "ci", [override]);
  assert.deepEqual(
    audit.map((entry) => entry.kind),
    ["unused-override"]
  );
});

test("severity: a path-scoped override does not cover the whole rule", () => {
  const findings = evaluate(
    context({
      changes: [file("cleanup.sh", { status: "added" }), file("other.sh", { status: "added" })],
    }),
    ruleSet
  );
  const override = {
    id: "OVR-SCOPED",
    rule: "no-root-scripts",
    paths: ["cleanup.sh"],
    reason: "scoped",
    actor: "ada@example.com",
    approvedBy: "grace@example.com",
    expires: "2999-01-01",
  };
  const { decided } = decide(findings, ruleSet, "ci", [override]);
  const byPath = Object.fromEntries(decided.map((entry) => [entry.path, entry.severity]));
  assert.equal(byPath["cleanup.sh"], "warn");
  assert.equal(byPath["other.sh"], "error");
});

test("severity: expiry is inclusive of the day named", () => {
  const override = { expires: "2026-08-28" };
  assert.equal(isExpired(override, new Date("2026-08-28T23:00:00Z")), false);
  assert.equal(isExpired(override, new Date("2026-08-29T00:00:01Z")), true);
});

test("overrides: an entry missing an approver or an expiry is refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-ovr-"));
  fs.mkdirSync(path.join(dir, "policy"));
  const write = (payload) =>
    fs.writeFileSync(path.join(dir, "policy", "overrides.json"), JSON.stringify(payload));

  write({ overrides: [{ id: "a", rule: "no-root-scripts", reason: "x", actor: "y" }] });
  assert.throws(() => loadOverrides(dir), /approvedBy/);

  write({
    overrides: [
      {
        id: "a",
        rule: "no-root-scripts",
        reason: "x",
        actor: "y",
        approvedBy: "z",
        expires: "soon",
      },
    ],
  });
  assert.throws(() => loadOverrides(dir), /YYYY-MM-DD/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("the shipped override list is valid and every entry is live", () => {
  const { overrides } = loadOverrides(REPO_ROOT);
  const expired = overrides.filter((override) => isExpired(override, new Date()));
  assert.deepEqual(
    expired.map((override) => override.id),
    [],
    "expired overrides must be removed or renewed, not left in the file"
  );
});

test("dry run reports every finding but never blocks", () => {
  const result = runEngine({
    repoRoot: REPO_ROOT,
    context: rootScriptChangeset(),
    stage: "ci",
    dryRun: true,
    ruleSet,
    overrides: [],
  });
  assert.ok(result.errors.length > 0, "dry run must still surface the finding");
  assert.equal(result.exitCode, 0, "dry run must not block");
});

test("a live run blocks on an error and passes on a clean changeset", () => {
  // Scoped to one rule on purpose. The full set includes hook-integrity, which
  // reads the working tree, so a whole-manifest run here would assert on the
  // state of the checkout rather than on the evaluator's exit codes.
  const single = {
    ...ruleSet,
    rules: ruleSet.rules.filter((rule) => rule.id === "no-root-scripts"),
  };

  const blocked = runEngine({
    repoRoot: REPO_ROOT,
    context: rootScriptChangeset(),
    stage: "ci",
    ruleSet: single,
    overrides: [],
  });
  assert.equal(blocked.exitCode, 1);

  const clean = runEngine({
    repoRoot: REPO_ROOT,
    context: context({ changes: [file("README.md", { added: ["# hello"] })] }),
    stage: "ci",
    ruleSet: single,
    overrides: [],
  });
  assert.equal(clean.exitCode, 0);
  assert.deepEqual(clean.findings, []);
});

test("a check that throws is reported, and the other rules still run", () => {
  const broken = {
    version: "9.9.9",
    rules: [
      { ...VALID_RULE, id: "boom", check: "no-secrets", options: { allowlistPath: "/nope.json" } },
      { ...VALID_RULE },
    ],
  };
  // A missing allowlist is tolerated; force a genuine failure instead.
  const original = require("../engine/checks/no-secrets").run;
  require("../engine/checks/no-secrets").run = () => {
    throw new Error("synthetic");
  };
  try {
    const findings = evaluate(rootScriptChangeset(), broken);
    assert.ok(findings.some((finding) => finding.engineError));
    assert.ok(
      findings.some((finding) => finding.rule === "no-root-scripts"),
      "one broken check must not stop the others from enforcing"
    );
  } finally {
    require("../engine/checks/no-secrets").run = original;
  }
});

test("every finding names the file, the rule and the fix", () => {
  const result = runEngine({
    repoRoot: REPO_ROOT,
    context: rootScriptChangeset(),
    stage: "ci",
    ruleSet,
    overrides: [],
  });
  const text = report.renderText(result);
  assert.match(text, /no-root-scripts/);
  assert.match(text, /cleanup\.sh/);
  assert.match(text, /fix:/);
  assert.match(text, /why:/);

  const github = report.renderGithub(result);
  assert.match(github, /^::error title=policy\/no-root-scripts,file=cleanup\.sh::/m);

  const json = JSON.parse(report.renderJson(result));
  assert.equal(json.findings[0].rule, "no-root-scripts");
  assert.ok(json.findings[0].remediation);

  assert.match(report.renderMarkdown(result), /\*\*Fix:\*\*/);
});
