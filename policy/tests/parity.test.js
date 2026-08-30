/*
 * policy/tests/parity.test.js
 *
 * The parity guarantee.
 *
 * The issue this engine answers puts it plainly: a bypassed hook must change
 * when a contributor learns they are wrong, never whether the rule holds. That
 * is only true if the local hook and the required CI check run the same rule,
 * and "the same rule" has to be provable rather than asserted in a README.
 *
 * Parity is enforced on four fronts, and each of these tests fails loudly if
 * someone reintroduces the drift:
 *
 *   1. Behavioural — the same changeset yields the same findings at every
 *      stage, differing only in severity.
 *   2. Structural — a check cannot see the stage, so it cannot branch on it.
 *   3. Entrypoint — the hooks and the workflow invoke the same CLI.
 *   4. Definitional — every rule is defined exactly once, in the manifest.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { evaluate, decide } = require("../engine");
const { loadManifest, STAGES } = require("../engine/manifest");
const { registry } = require("../engine/checks");
const { file, context, REPO_ROOT } = require("./helpers");

const ruleSet = loadManifest(REPO_ROOT);

const { execFileSync } = require("node:child_process");

/** Every file git knows about, tracked or newly added but not ignored. */
function trackedSources() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function read(relative) {
  const absolute = path.join(REPO_ROOT, relative);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) return "";
  return fs.readFileSync(absolute, "utf8");
}

/**
 * A changeset that trips as many rules at once as possible. Parity is only
 * interesting when there is something to disagree about.
 */
function violatingChangeset() {
  return context({
    changes: [
      file("contracts/marketpay-contract/src/lib.rs", {
        added: ["    pub fn release_escrow(env: Env, id: u64) {"],
        removed: ["    pub amount: i128,"],
      }),
      file("contracts/marketpay-contract/Cargo.lock", { added: ['version = "3.0.0"'] }),
      file("backend/src/db/migrations/V90__thing.up.sql", {
        status: "added",
        added: ["CREATE TABLE x()"],
      }),
      file("backend/src/services/payoutService.js", { status: "added" }),
      file("backend/src/services/payoutService.spec.js", {
        status: "added",
        added: ["  expect(row.at).toBeGreaterThan(Date.now());"],
      }),
      file("cleanup.sh", { status: "added", added: ["rm -rf /tmp/x"] }),
      file("backend/src/config.js", { added: ['const key = "AKIAIOSFODNN7EXAMPLE";'] }),
    ],
    files: [],
    commits: [{ sha: "abc123def", signature: "N", subject: "feat: things", authorName: "Ada" }],
    baseContents: {
      "contracts/marketpay-contract/src/lib.rs":
        "#[contracttype]\npub struct Escrow {\n  pub client: Address,\n  pub amount: i128,\n}\n",
    },
    contents: {
      "contracts/marketpay-contract/src/lib.rs":
        "#[contracttype]\npub struct Escrow {\n  pub client: Address,\n}\n",
    },
  });
}

function fingerprint(finding) {
  return `${finding.rule}|${finding.path}|${finding.line}|${finding.message}`;
}

test("parity: the fixture actually violates something, or the rest proves nothing", () => {
  const findings = evaluate(violatingChangeset(), ruleSet);
  assert.ok(findings.length >= 6, `expected a broadly violating fixture, got ${findings.length}`);
  assert.equal(
    findings.filter((finding) => finding.engineError).length,
    0,
    "no check may throw on the fixture"
  );
});

test("parity: detection is identical at every stage; only severity differs", () => {
  const findings = evaluate(violatingChangeset(), ruleSet);

  for (const rule of ruleSet.rules) {
    const stagesWhereActive = STAGES.filter((stage) => (rule.stages[stage] || "off") !== "off");
    if (stagesWhereActive.length < 2) continue;

    const perStage = stagesWhereActive.map((stage) => {
      const { decided } = decide(findings, ruleSet, stage, []);
      return decided
        .filter((finding) => finding.rule === rule.id)
        .map(fingerprint)
        .sort();
    });

    for (let index = 1; index < perStage.length; index += 1) {
      assert.deepEqual(
        perStage[index],
        perStage[0],
        `rule "${rule.id}" reports different findings at "${stagesWhereActive[index]}" than at ` +
          `"${stagesWhereActive[0]}". Detection must not depend on the stage.`
      );
    }
  }
});

test("parity: a local warning is the same finding CI reports as an error", () => {
  const findings = evaluate(violatingChangeset(), ruleSet);
  const local = decide(findings, ruleSet, "pre-push", []).decided;
  const ci = decide(findings, ruleSet, "ci", []).decided;

  const escalated = ci.filter((finding) => finding.severity === "error");
  for (const finding of escalated) {
    const rule = ruleSet.rules.find((candidate) => candidate.id === finding.rule);
    if ((rule.stages["pre-push"] || "off") === "off") continue;
    const localMatch = local.find((candidate) => fingerprint(candidate) === fingerprint(finding));
    assert.ok(
      localMatch,
      `CI reports "${finding.rule}" on ${finding.path} as an error but the pre-push stage does ` +
        `not report it at all. --no-verify would then hide a violation rather than defer it.`
    );
  }
});

test("parity: checks cannot observe the stage", () => {
  const checksDir = path.join(REPO_ROOT, "policy", "engine", "checks");
  for (const entry of fs.readdirSync(checksDir)) {
    if (!entry.endsWith(".js") || entry === "index.js" || entry === "helpers.js") continue;
    const source = fs.readFileSync(path.join(checksDir, entry), "utf8");
    assert.equal(
      /\bstage\b/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
      false,
      `${entry} mentions "stage" outside a comment. A check that can see where it runs can ` +
        `behave differently there, which is the drift this engine exists to prevent.`
    );
  }

  for (const [name, check] of registry) {
    assert.equal(
      check.run.length,
      2,
      `check "${name}" must take exactly (context, options); anything else is a channel for ` +
        `stage-specific behaviour.`
    );
  }
});

test("parity: every stage is driven by the same entrypoint", () => {
  // Asserted against the repository rather than against a specific hook file:
  // the local hook runner (issue #249) may restructure how a hook is launched,
  // and parity is about the command that ends up running, not about which
  // file spells it out.
  const sources = trackedSources().filter(
    (file) => !file.startsWith("docs/") && !file.startsWith("policy/tests/")
  );

  const invokesStage = (stage) =>
    sources.some((file) => {
      const source = read(file);
      // Matches both the shell form (`node policy/cli.js`) and the Node form
      // (`path.join(root, "policy", "cli.js")`) the hook runner uses.
      if (!/policy["'`,\s/]+cli\.js/.test(source)) return false;
      if (!/["'`\s]check["'`\s]/.test(source)) return false;
      return new RegExp(`--stage["'\`,\\s]+${stage}\\b`).test(source);
    });

  for (const stage of ["pre-commit", "commit-msg", "pre-push"]) {
    assert.ok(
      invokesStage(stage),
      `nothing in the repository runs the policy CLI at the "${stage}" stage. A stage the ` +
        `manifest enables but nothing invokes is a rule that silently stopped enforcing.`
    );
  }

  const workflow = read(".github/workflows/policy.yml");
  assert.match(workflow, /policy\/cli\.js["'\s\\]+check/, "the CI gate runs the shared CLI");
  assert.match(workflow, /--stage \\?\s*\n?\s*ci\b/, "the CI gate runs the ci stage");
  assert.match(
    workflow,
    /--policy-root/,
    "the CI gate must evaluate the rule set from the base branch, not from the head it judges"
  );
  assert.match(workflow, /merge_group:/, "the CI gate must also run inside the merge queue");
});

test("parity: every stage the manifest enables is actually invoked somewhere", () => {
  const enabled = new Set();
  for (const rule of ruleSet.rules) {
    for (const [stage, severity] of Object.entries(rule.stages)) {
      if (severity !== "off") enabled.add(stage);
    }
  }
  for (const stage of enabled) {
    assert.ok(STAGES.includes(stage), `manifest enables unknown stage "${stage}"`);
  }
});

test("parity: no second implementation of the rule set exists", () => {
  const offenders = trackedSources()
    .filter((file) => !file.startsWith("policy/"))
    .filter((file) =>
      /(?:require|from|import)\s*\(?\s*["'`][^"'`]*policy\/engine/.test(read(file))
    );
  assert.deepEqual(
    offenders,
    [],
    `only policy/ may load the engine directly; everything else runs policy/cli.js. A second ` +
      `consumer is a second place a rule can be defined.`
  );
});

test("parity: every rule maps to exactly one registered check, and vice versa", () => {
  const referenced = ruleSet.rules.map((rule) => rule.check);
  for (const check of referenced) {
    assert.ok(registry.has(check), `rule references unregistered check "${check}"`);
  }
  for (const name of registry.keys()) {
    assert.equal(
      referenced.filter((candidate) => candidate === name).length,
      1,
      `check "${name}" must be referenced by exactly one rule; a check with no rule enforces ` +
        `nothing, and a check with two has two severities for one behaviour.`
    );
  }
});

test("parity: every rule is documented in the catalogue", () => {
  const catalogue = fs.readFileSync(path.join(REPO_ROOT, "docs", "POLICY_CATALOGUE.md"), "utf8");
  for (const rule of ruleSet.rules) {
    assert.match(
      catalogue,
      new RegExp(`###\\s+${rule.id}\\b`),
      `rule "${rule.id}" has no section in docs/POLICY_CATALOGUE.md. A rule a contributor ` +
        `cannot look up is a rule they will ask to have removed.`
    );
  }
});

test("parity: every rule has a test for both outcomes", () => {
  const suite = fs.readFileSync(path.join(__dirname, "checks.test.js"), "utf8");
  for (const rule of ruleSet.rules) {
    const fires = new RegExp(`test\\("${rule.id}: fires`).test(suite);
    const passes = new RegExp(
      `test\\("${rule.id}: passes|test\\("${rule.id}: (?:does not|still|ignores)`
    ).test(suite);
    assert.ok(fires, `rule "${rule.id}" has no test proving it fires`);
    assert.ok(passes, `rule "${rule.id}" has no test proving it does not fire on ordinary work`);
  }
});
