#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { diagnose, printDiagnosis } from "./doctor.mjs";
import { affectedPushPaths, locateRoot, operationState } from "./git.mjs";
import { runPreCommit, runPrePush } from "./runner.mjs";

export function isGeneratedCommitMessage(firstLine, state = {}) {
  return (
    state.merge ||
    state.revert ||
    /^(?:Merge\b|Revert\s+")/.test(firstLine) ||
    /^(?:fixup|squash)!\s/.test(firstLine)
  );
}

function readStdin() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function runCommitlint(root, messageFile) {
  const firstLine = readFileSync(messageFile, "utf8").split(/\r?\n/, 1)[0];
  if (isGeneratedCommitMessage(firstLine, operationState(root))) {
    console.log(`[hooks] commit-msg skipped for generated message: ${firstLine}`);
    return 0;
  }

  const cli = path.join(root, "node_modules", "@commitlint", "cli", "cli.js");
  if (!existsSync(cli)) throw new Error("commitlint is not installed. Run: npm ci");
  const result = spawnSync(process.execPath, [cli, "--edit", messageFile], {
    cwd: root,
    stdio: "inherit",
    windowsHide: false,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function runCommitMessagePolicy(root, messageFile) {
  const cli = path.join(root, "policy", "cli.js");
  if (!existsSync(cli)) return 0;
  const result = spawnSync(
    process.execPath,
    [cli, "check", "--stage", "commit-msg", "--source", "staged", "--commit-msg-file", messageFile],
    { cwd: root, stdio: "inherit", windowsHide: false }
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main() {
  const command = process.argv[2];
  const originalCwd = process.cwd();
  const messageArgument = process.argv[3];
  const root = locateRoot(originalCwd);
  process.chdir(root);

  if (command === "pre-commit") return (await runPreCommit(root)).status;
  if (command === "pre-push") {
    const remoteName = process.argv[3] || "origin";
    const files = affectedPushPaths(root, readStdin(), remoteName);
    return (await runPrePush(root, files)).status;
  }
  if (command === "commit-msg") {
    if (!messageArgument) throw new Error("commit-msg requires the commit message file path");
    const messageFile = path.resolve(originalCwd, messageArgument);
    const commitlintStatus = runCommitlint(root, messageFile);
    if (commitlintStatus !== 0) return commitlintStatus;
    return runCommitMessagePolicy(root, messageFile);
  }
  if (command === "doctor") return printDiagnosis(diagnose(root));

  console.error("Usage: node scripts/hooks/cli.mjs <pre-commit|pre-push|commit-msg|doctor>");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error) => {
      console.error(`[hooks] ${error.message}`);
      process.exitCode = 1;
    });
}
