/*
 * policy/engine/report.js
 *
 * Rendering.
 *
 * The catalogue's rule is that a failure names the file, the rule and the fix
 * — never just a rule identifier. That is not politeness: a message a
 * contributor cannot act on gets the rule disabled, and a disabled rule
 * enforces nothing. Every renderer here carries all three.
 */

"use strict";

const ESC = String.fromCharCode(27);
const COLOURS = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  yellow: `${ESC}[33m`,
  green: `${ESC}[32m`,
  cyan: `${ESC}[36m`,
};

function paint(enabled, colour, text) {
  return enabled ? `${COLOURS[colour]}${text}${COLOURS.reset}` : text;
}

function ruleById(ruleSet, id) {
  return ruleSet.rules.find((rule) => rule.id === id) || null;
}

function renderText(result, { colour = false } = {}) {
  const lines = [];
  const header = `policy ${result.ruleSet.version} · stage ${result.stage}`;
  lines.push(
    paint(colour, "bold", header) + (result.dryRun ? paint(colour, "dim", " · dry run") : "")
  );

  if (result.findings.length === 0) {
    lines.push(paint(colour, "green", "  All policies passed."));
    return lines.join("\n");
  }

  const order = { error: 0, warn: 1, off: 2 };
  const sorted = [...result.findings].sort(
    (left, right) => order[left.severity] - order[right.severity]
  );

  for (const finding of sorted) {
    const rule = ruleById(result.ruleSet, finding.rule);
    const label = finding.severity === "error" ? "error" : "warn";
    const tint = finding.severity === "error" ? "red" : "yellow";
    const where = finding.path
      ? `${finding.path}${finding.line ? `:${finding.line}` : ""}`
      : "(changeset)";

    lines.push("");
    lines.push(
      `${paint(colour, tint, label)} ${paint(colour, "bold", finding.rule)} ` +
        `${paint(colour, "cyan", where)}`
    );
    lines.push(`  ${finding.message}`);
    const fix = finding.remediationHint || (rule && rule.remediation);
    if (fix) lines.push(`  ${paint(colour, "dim", "fix:")} ${fix}`);
    if (rule && rule.rationale) {
      lines.push(`  ${paint(colour, "dim", "why:")} ${rule.rationale}`);
    }
    if (finding.override) {
      lines.push(
        `  ${paint(colour, "dim", "override:")} ${finding.override.id} approved by ` +
          `${finding.override.approvedBy} for ${finding.override.actor}, expires ` +
          `${finding.override.expires} — ${finding.override.reason}`
      );
    }
    if (finding.expiredOverride) {
      lines.push(
        `  ${paint(colour, "dim", "note:")} override ${finding.expiredOverride} has expired and ` +
          `no longer applies.`
      );
    }
  }

  for (const entry of result.audit) {
    lines.push("");
    if (entry.kind === "expired-override") {
      lines.push(
        `${paint(colour, "yellow", "audit")} override ${entry.override} for rule ` +
          `${entry.rule} expired on ${entry.expires} (held by ${entry.actor}). Remove it or ` +
          `renew it with a fresh approval.`
      );
    } else if (entry.kind === "unused-override") {
      lines.push(
        `${paint(colour, "dim", "audit")} override ${entry.override} for rule ${entry.rule} ` +
          `matched nothing (held by ${entry.actor}, expires ${entry.expires}). It can probably ` +
          `be removed.`
      );
    }
  }

  lines.push("");
  const summary =
    `${result.errors.length} error(s), ${result.warnings.length} warning(s)` +
    (result.dryRun && result.errors.length > 0 ? " — dry run, not blocking" : "");
  lines.push(paint(colour, result.errors.length > 0 ? "red" : "yellow", summary));
  if (!result.dryRun && result.errors.length > 0) {
    lines.push(
      paint(
        colour,
        "dim",
        "Bypassing this locally does not remove the violation; the same rule set runs as a " +
          "required check on the pull request."
      )
    );
  }
  return lines.join("\n");
}

/** GitHub Actions workflow commands, so findings annotate the diff directly. */
function renderGithub(result) {
  const lines = [];
  for (const finding of result.findings) {
    if (finding.severity === "off") continue;
    const level = finding.severity === "error" ? "error" : "warning";
    const parameters = [`title=policy/${finding.rule}`];
    if (finding.path) parameters.push(`file=${finding.path}`);
    if (finding.line) parameters.push(`line=${finding.line}`);
    const rule = ruleById(result.ruleSet, finding.rule);
    const fix = finding.remediationHint || (rule && rule.remediation) || "";
    const body = `${finding.message}${fix ? ` Fix: ${fix}` : ""}`.replace(/\r?\n/g, "%0A");
    lines.push(`::${level} ${parameters.join(",")}::${body}`);
  }
  return lines.join("\n");
}

/** Markdown for a pull request summary; also what the job summary renders. */
function renderMarkdown(result) {
  const lines = [`### Policy gate — \`${result.stage}\` · rule set \`${result.ruleSet.version}\``];
  if (result.dryRun) lines.push("", "_Dry run: reporting only, nothing is blocked._");

  if (result.findings.length === 0) {
    lines.push("", "All policies passed.");
    return lines.join("\n");
  }

  lines.push("", "| | Rule | Location | Finding |", "| --- | --- | --- | --- |");
  for (const finding of result.findings) {
    const icon = finding.severity === "error" ? "🔴" : "🟡";
    const where = finding.path
      ? `\`${finding.path}${finding.line ? `:${finding.line}` : ""}\``
      : "_changeset_";
    const rule = ruleById(result.ruleSet, finding.rule);
    const fix = finding.remediationHint || (rule && rule.remediation) || "";
    const cell = `${finding.message}<br/>**Fix:** ${fix}`.replace(/\|/g, "\\|");
    lines.push(`| ${icon} | \`${finding.rule}\` | ${where} | ${cell} |`);
  }

  lines.push(
    "",
    `${result.errors.length} error(s), ${result.warnings.length} warning(s). ` +
      `Rules and their rationale: [docs/POLICY_CATALOGUE.md](docs/POLICY_CATALOGUE.md).`
  );
  return lines.join("\n");
}

function renderJson(result) {
  return JSON.stringify(
    {
      version: result.ruleSet.version,
      stage: result.stage,
      dryRun: result.dryRun,
      errors: result.errors.length,
      warnings: result.warnings.length,
      findings: result.findings.map((finding) => ({
        rule: finding.rule,
        severity: finding.severity,
        path: finding.path,
        line: finding.line,
        message: finding.message,
        remediation: finding.remediationHint,
        override: finding.override ? finding.override.id : null,
      })),
      audit: result.audit,
    },
    null,
    2
  );
}

module.exports = { renderText, renderGithub, renderMarkdown, renderJson };
