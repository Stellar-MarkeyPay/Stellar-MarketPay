#!/usr/bin/env node
/*
 * policy/cli.js
 *
 * The one entrypoint. The Husky hooks and the required CI check both invoke
 * this file with the same manifest and differ only in `--stage`; nothing else
 * may run a policy check. Adding a second entrypoint would recreate exactly
 * the drift this engine exists to prevent, which is why the parity test
 * asserts that no other file in the repository loads policy/engine.
 *
 *   node policy/cli.js check --stage ci --source range --base origin/main
 *   node policy/cli.js check --stage pre-commit --source staged
 *   node policy/cli.js measure            # what each rule would fire on today
 *   node policy/cli.js scan-history       # credentials already in history
 *   node policy/cli.js catalogue --write  # regenerate docs/POLICY_CATALOGUE.md
 *   node policy/cli.js catalogue --check  # fail if it has drifted
 *   node policy/cli.js integrity --write  # record hook + engine digests
 *   node policy/cli.js overrides          # audit the exception list
 */

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { buildContext, syntheticContext, git } = require("./engine/context");
const { loadManifest, STAGES } = require("./engine/manifest");
const { loadOverrides, isExpired } = require("./engine/severity");
const { run: runEngine } = require("./engine");
const report = require("./engine/report");

const ENGINE_ROOT = path.resolve(__dirname, "..");

/**
 * The tree being judged, and the tree the rules come from.
 *
 * They are usually the same. In CI they are not: the workflow checks the base
 * branch out separately and runs *its* engine and *its* manifest against the
 * pull request's changeset. A pull request that edits policies.json to delete
 * the rule it is violating therefore changes nothing about the check judging
 * it — the rule set is whatever main already agreed to.
 */
function resolveRoots(options) {
  const repoRoot = path.resolve(
    options["repo-root"] || process.env.POLICY_REPO_ROOT || ENGINE_ROOT
  );
  const policyRoot = path.resolve(
    options["policy-root"] || process.env.POLICY_POLICY_ROOT || ENGINE_ROOT
  );
  return { repoRoot, policyRoot };
}

/**
 * `--base auto` resolves the merge base against the integration branch, so a
 * hook and a CI job describe the changeset the same way without the hook
 * hard-coding a branch name that may not exist locally.
 */
function resolveBase(repoRoot, requested) {
  if (requested && requested !== "auto") return requested;
  for (const candidate of ["origin/main", "origin/develop", "main", "develop"]) {
    const mergeBase = git(["merge-base", "HEAD", candidate], {
      cwd: repoRoot,
      allowFailure: true,
    }).trim();
    if (mergeBase) return mergeBase;
  }
  // A shallow clone or a fresh repository with a single commit: fall back to
  // the empty tree so the whole history is the changeset rather than silently
  // evaluating nothing.
  return git(["hash-object", "-t", "tree", "/dev/null"], { cwd: repoRoot }).trim();
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }
    const [flag, inline] = token.slice(2).split("=");
    if (inline !== undefined) {
      options[flag] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[flag] = true;
      continue;
    }
    options[flag] = next;
    index += 1;
  }
  return options;
}

function fail(message) {
  process.stderr.write(`policy: ${message}\n`);
  process.exit(2);
}

function readCommitMessage(options) {
  const file = options["commit-msg-file"] || process.env.POLICY_COMMIT_MSG_FILE;
  if (file && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  return process.env.POLICY_COMMIT_MSG || "";
}

/**
 * The pull request body is an acknowledgement surface (see storage-compat-ack)
 * and is only available in CI, where the workflow passes it through the
 * environment. Its absence never changes detection — a rule that needs it
 * simply finds no acknowledgement, exactly as it would locally.
 */
function readPrBody(options) {
  if (typeof options["pr-body"] === "string") return options["pr-body"];
  const file = process.env.POLICY_PR_BODY_FILE;
  if (file && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  return process.env.POLICY_PR_BODY || "";
}

function commandCheck(options) {
  const stage = options.stage;
  if (!stage) fail(`--stage is required (one of ${STAGES.join(", ")})`);
  if (!STAGES.includes(stage)) fail(`unknown stage "${stage}" (expected ${STAGES.join(", ")})`);

  const { repoRoot, policyRoot } = resolveRoots(options);
  const source = options.source || (stage === "ci" ? "range" : "staged");
  const dryRun = Boolean(options["dry-run"]) || process.env.POLICY_DRY_RUN === "1";

  const ruleSet = loadManifest(policyRoot);
  // Overrides come from the policy root too: an exception has to be merged
  // before it applies, so a pull request cannot grant itself one.
  const { overrides } = loadOverrides(policyRoot);

  const context = buildContext({
    repoRoot,
    source,
    base: source === "range" ? resolveBase(repoRoot, options.base) : options.base,
    head: options.head,
    commitMessage: readCommitMessage(options),
    prBody: readPrBody(options),
  });

  const result = runEngine({ repoRoot, context, stage, dryRun, ruleSet, overrides });
  emit(result, options);
  return result.exitCode;
}

function emit(result, options) {
  const format = options.format || (process.env.GITHUB_ACTIONS === "true" ? "github" : "text");

  if (format === "json") {
    process.stdout.write(`${report.renderJson(result)}\n`);
  } else if (format === "github") {
    const annotations = report.renderGithub(result);
    if (annotations) process.stdout.write(`${annotations}\n`);
    process.stdout.write(`${report.renderText(result)}\n`);
  } else if (format === "markdown") {
    process.stdout.write(`${report.renderMarkdown(result)}\n`);
  } else {
    process.stdout.write(`${report.renderText(result, { colour: process.stdout.isTTY })}\n`);
  }

  if (options["json-out"]) {
    fs.writeFileSync(options["json-out"], `${report.renderJson(result)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report.renderMarkdown(result)}\n`);
  }
}

/**
 * Warn-only measurement.
 *
 * Rolling a rule out as a wall of failures gets it rolled back, so every rule
 * is measured against real history before its severity is raised. This walks
 * the last N commits, evaluates each as its own changeset, and counts how
 * often each rule would have fired. The numbers in docs/POLICY_ROLLOUT.md come
 * from this command.
 */
function commandMeasure(options) {
  const depth = Number(options.depth || 100);
  const { repoRoot: REPO_ROOT } = resolveRoots(options);
  const ruleSet = loadManifest(REPO_ROOT);
  const stage = options.stage || "ci";

  const revisions = git(["log", "--format=%H", "--no-merges", `-${depth}`], { cwd: REPO_ROOT })
    .split("\n")
    .filter(Boolean);

  const counts = new Map(ruleSet.rules.map((rule) => [rule.id, 0]));
  const examples = new Map();

  for (const revision of revisions) {
    let context;
    try {
      context = buildContext({
        repoRoot: REPO_ROOT,
        source: "range",
        base: `${revision}^`,
        head: revision,
      });
    } catch {
      continue; // root commit has no parent
    }
    const result = runEngine({ repoRoot: REPO_ROOT, context, stage, dryRun: true, ruleSet });
    const fired = new Set(result.findings.map((finding) => finding.rule));
    for (const rule of fired) {
      counts.set(rule, (counts.get(rule) || 0) + 1);
      if (!examples.has(rule)) {
        const finding = result.findings.find((candidate) => candidate.rule === rule);
        examples.set(rule, `${revision.slice(0, 8)} ${finding.path || "(changeset)"}`);
      }
    }
  }

  const rows = ruleSet.rules.map((rule) => ({
    rule: rule.id,
    stage,
    commitsInspected: revisions.length,
    wouldFireOn: counts.get(rule.id) || 0,
    rate: `${(((counts.get(rule.id) || 0) / revisions.length) * 100).toFixed(1)}%`,
    firstExample: examples.get(rule.id) || "",
    currentSeverity: rule.stages[stage] || "off",
  }));

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    `Warn-only measurement over the last ${revisions.length} non-merge commits, stage "${stage}"\n\n`
  );
  process.stdout.write("| rule | would fire on | rate | current severity | first example |\n");
  process.stdout.write("| --- | --- | --- | --- | --- |\n");
  for (const row of rows) {
    process.stdout.write(
      `| \`${row.rule}\` | ${row.wouldFireOn}/${row.commitsInspected} | ${row.rate} | ` +
        `${row.currentSeverity} | ${row.firstExample || "—"} |\n`
    );
  }
  return 0;
}

/**
 * Scan history for credentials.
 *
 * The no-secrets rule stops the next one; this finds the last one. Every
 * commit is evaluated as its own changeset, so a credential that was added
 * and later deleted is still reported — deleting it did not revoke it.
 */
function commandScanHistory(options) {
  const { repoRoot, policyRoot } = resolveRoots(options);
  const depth = Number(options.depth || 0);
  const ruleSet = loadManifest(policyRoot);
  const secretsOnly = {
    ...ruleSet,
    rules: ruleSet.rules.filter((rule) => rule.check === "no-secrets"),
  };
  if (secretsOnly.rules.length === 0) fail("no no-secrets rule in the manifest");

  const args = ["log", "--format=%H", "--all"];
  if (depth > 0) args.push(`-${depth}`);
  const revisions = git(args, { cwd: repoRoot }).split("\n").filter(Boolean);

  const findings = [];
  const seen = new Set();

  for (const revision of revisions) {
    let context;
    try {
      context = buildContext({
        repoRoot,
        source: "range",
        base: `${revision}^`,
        head: revision,
      });
    } catch {
      continue; // root commit
    }
    const result = runEngine({
      repoRoot,
      context,
      stage: "ci",
      dryRun: true,
      ruleSet: secretsOnly,
      overrides: [],
    });
    for (const finding of result.findings) {
      const key = `${finding.path}:${finding.line}:${finding.evidence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        commit: revision,
        path: finding.path,
        line: finding.line,
        message: finding.message,
      });
    }
  }

  const payload = { commitsScanned: revisions.length, findings };
  if (options["json-out"]) {
    fs.writeFileSync(options["json-out"], `${JSON.stringify(payload, null, 2)}\n`);
  }

  process.stdout.write(
    `policy: scanned ${revisions.length} commit(s); ${findings.length} distinct finding(s)\n`
  );
  for (const finding of findings) {
    process.stdout.write(`  ${finding.commit.slice(0, 8)} ${finding.path}:${finding.line}\n`);
    process.stdout.write(`    ${finding.message}\n`);
  }
  if (findings.length > 0) {
    process.stderr.write(
      "policy: rotate every credential listed above. Removing it from the tree does not " +
        "revoke it — see docs/SECRET_RESPONSE.md.\n"
    );
    return 1;
  }
  return 0;
}

const CATALOGUE_PATH = "docs/POLICY_CATALOGUE.md";
const CATALOGUE_MARKER = "<!-- policy:rules -->";

/**
 * Render the rule sections of the catalogue from the manifest.
 *
 * The catalogue is generated rather than written by hand so a rule's stated
 * rationale cannot drift from the rule that is actually enforced. The prose
 * around the marker is hand-written and preserved; everything after it is
 * replaced.
 */
function renderCatalogue(ruleSet) {
  const lines = [];
  lines.push("| Rule | pre-commit | commit-msg | pre-push | CI |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const rule of ruleSet.rules) {
    lines.push(
      `| [\`${rule.id}\`](#${rule.id}) | ${rule.stages["pre-commit"] || "off"} | ` +
        `${rule.stages["commit-msg"] || "off"} | ${rule.stages["pre-push"] || "off"} | ` +
        `${rule.stages.ci || "off"} |`
    );
  }
  for (const rule of ruleSet.rules) {
    lines.push("", `### ${rule.id}`, "", `**${rule.title}**`, "");
    if (rule.incident) lines.push(`> **Incident.** ${rule.incident}`, "");
    lines.push(`**Why.** ${rule.rationale}`, "", `**Fix.** ${rule.remediation}`, "");
    lines.push(
      `**Severity.** pre-commit \`${rule.stages["pre-commit"] || "off"}\`, ` +
        `commit-msg \`${rule.stages["commit-msg"] || "off"}\`, ` +
        `pre-push \`${rule.stages["pre-push"] || "off"}\`, CI \`${rule.stages.ci || "off"}\`.`
    );
    lines.push(
      "",
      `**Tests.** \`policy/tests/checks.test.js\` covers both outcomes: a changeset that ` +
        `violates \`${rule.id}\` and one that does not.`
    );
  }
  return lines.join("\n");
}

function commandCatalogue(options) {
  const { policyRoot, repoRoot } = resolveRoots(options);
  const ruleSet = loadManifest(policyRoot);
  const generated = renderCatalogue(ruleSet);

  if (!options.write && !options.check) {
    process.stdout.write(`${generated}\n`);
    return 0;
  }

  const target = path.join(repoRoot, CATALOGUE_PATH);
  if (!fs.existsSync(target)) fail(`${CATALOGUE_PATH} not found`);
  const existing = fs.readFileSync(target, "utf8");
  const markerAt = existing.indexOf(CATALOGUE_MARKER);
  if (markerAt === -1) {
    fail(`${CATALOGUE_PATH} has no "${CATALOGUE_MARKER}" marker to write the rule sections after`);
  }
  const preamble = existing.slice(0, markerAt + CATALOGUE_MARKER.length);
  const next = `${preamble}\n\n${generated}\n`;

  if (options.write) {
    fs.writeFileSync(target, next);
    process.stdout.write(`policy: regenerated the rule sections of ${CATALOGUE_PATH}\n`);
    return 0;
  }

  // Prettier owns the formatting of every Markdown file here and pads table
  // cells to align them, so compare the content rather than the bytes.
  const normalise = (text) =>
    text
      .split("\n")
      .map((line) =>
        line
          .replace(/[ \t]+/g, " ")
          .replace(/ *\| */g, "|")
          // Prettier also widens a table's separator row to the column width.
          .replace(/^\|(?:-+\|)+$/, (row) => row.replace(/-+/g, "-"))
          .trim()
      )
      .join("\n")
      .trimEnd();

  if (normalise(existing) === normalise(next)) {
    process.stdout.write(`policy: ${CATALOGUE_PATH} matches the manifest\n`);
    return 0;
  }
  process.stderr.write(
    `policy: ${CATALOGUE_PATH} has drifted from policy/policies.json. A rule whose documented ` +
      `rationale is not the rationale being enforced is worse than no documentation.\n` +
      `Regenerate it with:\n  npm run policy:catalogue -- --write\n`
  );
  return 1;
}

function governedFiles(patterns, REPO_ROOT) {
  // `--others --exclude-standard` so a governed file counts from the moment it
  // is written, not from the moment it is staged. Recording it only after
  // `git add` would leave a window where a new hook is unverified.
  const tracked = git(["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
  })
    .split("\n")
    .filter(Boolean);
  return [...new Set(tracked)]
    .filter((file) => patterns.some((pattern) => file === pattern || file.startsWith(pattern)))
    .sort();
}

function commandIntegrity(options) {
  const { repoRoot: REPO_ROOT } = resolveRoots(options);
  const ruleSet = loadManifest(REPO_ROOT);
  const rule = ruleSet.rules.find((candidate) => candidate.check === "hook-integrity");
  const patterns = (rule && rule.options.governs) || [".husky/", "policy/engine/"];
  const manifestPath = (rule && rule.options.manifestPath) || "policy/integrity.json";

  const files = {};
  for (const file of governedFiles(patterns, REPO_ROOT)) {
    files[file] = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(REPO_ROOT, file)))
      .digest("hex");
  }

  const payload = {
    $comment:
      "SHA-256 of every file that governs the policy gate. Regenerate with " +
      "`npm run policy:integrity -- --write` whenever a hook or the engine changes, so the " +
      "new digest lands in the diff a reviewer reads. Verified by the hook-integrity rule.",
    algorithm: "sha256",
    generatedFrom: patterns,
    files,
  };

  const target = path.join(REPO_ROOT, manifestPath);

  if (options.write) {
    fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(
      `policy: recorded ${Object.keys(files).length} digests in ${manifestPath}\n`
    );
    return 0;
  }

  // Compare the recorded digests, not the bytes of the file: Prettier owns the
  // formatting of every JSON file in this repository, and a whitespace-only
  // difference is not a tampered hook.
  const existing = fs.existsSync(target)
    ? JSON.parse(fs.readFileSync(target, "utf8")).files || {}
    : {};
  const recorded = Object.keys(existing).sort();
  const expected = Object.keys(files).sort();
  const drifted = expected.filter((file) => existing[file] !== files[file]);
  const missing = recorded.filter((file) => !(file in files));

  if (drifted.length === 0 && missing.length === 0 && recorded.length === expected.length) {
    process.stdout.write(`policy: ${manifestPath} is up to date (${expected.length} files)\n`);
    return 0;
  }

  for (const file of drifted) process.stderr.write(`policy: digest changed or missing: ${file}\n`);
  for (const file of missing) process.stderr.write(`policy: recorded but gone: ${file}\n`);
  process.stderr.write(
    `policy: ${manifestPath} is stale. Regenerate it with:\n  npm run policy:integrity -- --write\n`
  );
  return 1;
}

function commandOverrides(options) {
  const { policyRoot } = resolveRoots(options);
  const { overrides, overridesPath } = loadOverrides(policyRoot);
  if (overrides.length === 0) {
    process.stdout.write(`policy: no overrides recorded in ${overridesPath}\n`);
    return 0;
  }
  const now = new Date();
  let expired = 0;
  process.stdout.write(`policy: ${overrides.length} override(s) in ${overridesPath}\n\n`);
  for (const override of overrides) {
    const dead = isExpired(override, now);
    if (dead) expired += 1;
    process.stdout.write(
      `${dead ? "EXPIRED" : "active "} ${override.id}  rule=${override.rule}  ` +
        `expires=${override.expires}\n` +
        `          held by ${override.actor}, approved by ${override.approvedBy}\n` +
        `          reason: ${override.reason}\n` +
        (override.issue ? `          issue: ${override.issue}\n` : "") +
        "\n"
    );
  }
  if (expired > 0) {
    process.stderr.write(
      `policy: ${expired} override(s) have expired. Remove them or renew them with a fresh ` +
        `approval.\n`
    );
    return 1;
  }
  return 0;
}

function main(argv) {
  const options = parseArgs(argv);
  const command = options._[0] || "check";

  switch (command) {
    case "check":
      return commandCheck(options);
    case "measure":
      return commandMeasure(options);
    case "scan-history":
      return commandScanHistory(options);
    case "catalogue":
      return commandCatalogue(options);
    case "integrity":
      return commandIntegrity(options);
    case "overrides":
      return commandOverrides(options);
    default:
      fail(
        `unknown command "${command}" ` +
          `(check, measure, scan-history, catalogue, integrity, overrides)`
      );
      return 2;
  }
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`policy: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { main, parseArgs, syntheticContext, resolveRoots, resolveBase };
