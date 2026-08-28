import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BUDGETS_MS,
  PROJECT_INPUTS,
  classifyPaths,
  isBackendLintPath,
  isFrontendLintPath,
  isPrettierPath,
  isPythonPath,
  rustCratesForPaths,
} from "./config.mjs";
import { ResultCache, appendTiming, cacheKey } from "./cache.mjs";
import {
  conflictedPaths,
  exportHeadWorktree,
  exportIndexSnapshot,
  gitDir,
  indexSignature,
  operationState,
  stagedChangedPaths,
  stagedPaths,
  treeSignature,
} from "./git.mjs";

let activeCleanup = null;
let signalHandlersInstalled = false;

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.once(signal, () => {
      try {
        activeCleanup?.();
      } finally {
        process.exit(code);
      }
    });
  }
}

function isExecutable(file) {
  try {
    accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findCommand(name) {
  const extensionCandidates = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  if (name === "cargo" || name === "rustfmt")
    pathEntries.unshift(path.join(homedir(), ".cargo", "bin"));

  for (const directory of pathEntries) {
    for (const extension of extensionCandidates) {
      const candidate = path.join(directory, `${name}${extension}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function nodeTool(root, relativePath, installCommand) {
  const file = path.join(root, ...relativePath.split("/"));
  if (!existsSync(file)) {
    throw new Error(`Missing local tool ${relativePath}. Run: ${installCommand}`);
  }
  return { executable: process.execPath, prefixArgs: [file] };
}

function commandVersion(executable, args = ["--version"], cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    return `unavailable:${result.error?.message || result.status}`;
  const version = `${result.stdout || result.stderr}`.trim();
  return executable === process.execPath ? `node ${process.version} | ${version}` : version;
}

function linkDirectory(source, destination) {
  if (!existsSync(source) || existsSync(destination)) return;
  mkdirSync(path.dirname(destination), { recursive: true });
  symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
}

function linkDependencyTrees(root, snapshot) {
  for (const directory of ["node_modules", "frontend/node_modules", "backend/node_modules"]) {
    linkDirectory(path.join(root, directory), path.join(snapshot, directory));
  }
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(milliseconds < 100 ? 3 : 2)}s`;
}

function spawnStep(step) {
  const result = spawnSync(step.executable, [...(step.prefixArgs || []), ...step.args], {
    cwd: step.cwd,
    env: { ...process.env, ...step.env },
    stdio: "inherit",
    windowsHide: false,
  });
  if (result.error) {
    console.error(`[hooks] ${step.name}: ${result.error.message}`);
    return 127;
  }
  if (result.signal) {
    console.error(`[hooks] ${step.name}: terminated by ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

function executeSteps({ root, hook, steps, budget = BUDGETS_MS[hook] }) {
  const cache = new ResultCache(root);
  const started = performance.now();
  const timings = [];
  let status = 0;

  for (const step of steps) {
    const cacheable = step.cacheable !== false && process.env.MARKETPAY_HOOK_CACHE !== "0";
    const key = cacheable
      ? cacheKey({
          root,
          step: step.name,
          command: step.command,
          toolVersion: step.toolVersion,
          inputSignature: step.inputSignature,
        })
      : null;

    if (cacheable && cache.has(step.name, key)) {
      console.log(`[hooks] ${step.name}: cached`);
      timings.push({ name: step.name, durationMs: 0, cached: true, status: 0 });
      continue;
    }

    console.log(`[hooks] ${step.name}`);
    const stepStarted = performance.now();
    const stepStatus = spawnStep(step);
    const durationMs = Math.round(performance.now() - stepStarted);
    timings.push({ name: step.name, durationMs, cached: false, status: stepStatus });
    console.log(
      `[hooks] ${step.name}: ${stepStatus === 0 ? "passed" : "failed"} (${formatDuration(durationMs)})`
    );

    if (stepStatus !== 0) {
      status = stepStatus;
      break;
    }
    if (cacheable) cache.put(step.name, key);
  }

  const totalMs = Math.round(performance.now() - started);
  const overBudget = totalMs > budget;
  if (overBudget) {
    console.warn(
      `[hooks] ${hook} exceeded its ${formatDuration(budget)} budget: ${formatDuration(totalMs)}`
    );
    for (const timing of timings) {
      console.warn(
        `  ${timing.name.padEnd(24)} ${timing.cached ? "cached" : formatDuration(timing.durationMs)}`
      );
    }
    if (process.env.MARKETPAY_HOOK_ENFORCE_BUDGET === "1" && status === 0) status = 1;
  }

  const report = {
    timestamp: new Date().toISOString(),
    hook,
    budgetMs: budget,
    totalMs,
    overBudget,
    status,
    steps: timings,
  };
  appendTiming(root, report);
  return report;
}

function stagedStepSignature(root, inputPaths, configPaths = []) {
  return indexSignature(root, [...new Set([...inputPaths, ...configPaths])]);
}

function preCommitSteps(root, snapshot, files) {
  const steps = [];
  const prettierFiles = files.filter(isPrettierPath);
  if (prettierFiles.length > 0) {
    const tool = nodeTool(root, "node_modules/prettier/bin/prettier.cjs", "npm ci");
    steps.push({
      name: "prettier-staged",
      command: `prettier --check ${prettierFiles.join(" ")}`,
      toolVersion: commandVersion(tool.executable, [...tool.prefixArgs, "--version"], root),
      inputSignature: stagedStepSignature(root, prettierFiles, [
        ".prettierrc.json",
        ".prettierignore",
        ".editorconfig",
        "package-lock.json",
      ]),
      ...tool,
      args: ["--check", "--", ...prettierFiles],
      cwd: snapshot,
    });
  }

  const frontendFiles = files.filter(isFrontendLintPath);
  if (frontendFiles.length > 0) {
    const projectFiles = frontendFiles.map((file) => `./${file.slice("frontend/".length)}`);
    const tool = nodeTool(
      root,
      "frontend/node_modules/eslint/bin/eslint.js",
      "npm --prefix frontend ci"
    );
    steps.push({
      name: "frontend-eslint-staged",
      command: `eslint ${frontendFiles.join(" ")}`,
      toolVersion: commandVersion(tool.executable, [...tool.prefixArgs, "--version"], root),
      inputSignature: stagedStepSignature(root, frontendFiles, [
        "frontend/.eslintrc.json",
        "frontend/package.json",
        "frontend/package-lock.json",
      ]),
      ...tool,
      args: projectFiles,
      cwd: path.join(snapshot, "frontend"),
    });
  }

  const backendFiles = files.filter(isBackendLintPath);
  if (backendFiles.length > 0) {
    const projectFiles = backendFiles.map((file) => `./${file.slice("backend/".length)}`);
    const tool = nodeTool(
      root,
      "backend/node_modules/eslint/bin/eslint.js",
      "npm --prefix backend ci"
    );
    steps.push({
      name: "backend-eslint-staged",
      command: `eslint ${backendFiles.join(" ")}`,
      toolVersion: commandVersion(tool.executable, [...tool.prefixArgs, "--version"], root),
      inputSignature: stagedStepSignature(root, backendFiles, [
        "backend/.eslintrc.json",
        "backend/package.json",
        "backend/package-lock.json",
      ]),
      ...tool,
      args: projectFiles,
      cwd: path.join(snapshot, "backend"),
    });
  }

  for (const crate of rustCratesForPaths(files)) {
    const rustfmt = findCommand("rustfmt");
    if (!rustfmt)
      throw new Error(
        "Rust files are staged but rustfmt was not found. Install the rustfmt rustup component, then retry."
      );
    const manifest = `contracts/${crate}/Cargo.toml`;
    const manifestText = readFileSync(path.join(snapshot, manifest), "utf8");
    const edition = /^edition\s*=\s*"(2015|2018|2021|2024)"/m.exec(manifestText)?.[1] || "2015";
    const crateFiles = files.filter(
      (file) => file.startsWith(`contracts/${crate}/`) && /\.rs$/i.test(file)
    );
    const configPath = [
      `contracts/${crate}/rustfmt.toml`,
      `contracts/${crate}/.rustfmt.toml`,
      "contracts/rustfmt.toml",
      "contracts/.rustfmt.toml",
      "rustfmt.toml",
      ".rustfmt.toml",
    ].find((file) => existsSync(path.join(snapshot, file)));
    const args = ["--check", "--edition", edition];
    if (configPath) args.push("--config-path", configPath);
    args.push(...crateFiles);
    steps.push({
      name: `rustfmt-${crate}`,
      command: `rustfmt --check --edition ${edition} ${crateFiles.join(" ")}`,
      toolVersion: commandVersion(rustfmt, ["--version"], root),
      inputSignature: stagedStepSignature(root, [`contracts/${crate}`]),
      executable: rustfmt,
      args,
      cwd: snapshot,
    });
  }

  const pythonFiles = files.filter(isPythonPath);
  if (pythonFiles.length > 0) {
    const python =
      findCommand(process.platform === "win32" ? "python" : "python3") || findCommand("python");
    if (!python) throw new Error("Python files are staged but Python 3 was not found.");
    steps.push({
      name: "python-syntax-staged",
      command: `python -m py_compile ${pythonFiles.join(" ")}`,
      toolVersion: commandVersion(python, ["--version"], root),
      inputSignature: stagedStepSignature(root, pythonFiles),
      executable: python,
      args: ["-m", "py_compile", ...pythonFiles.map((file) => path.resolve(snapshot, file))],
      cwd: snapshot,
    });
  }

  return steps;
}

function rustEnvironment(root) {
  const directory = path.join(gitDir(root), "marketpay-hooks", "cargo-target");
  mkdirSync(directory, { recursive: true });
  const env = { CARGO_TARGET_DIR: directory, CARGO_INCREMENTAL: "1" };
  const sccache = findCommand("sccache");
  if (sccache) env.RUSTC_WRAPPER = sccache;
  return { env, sccache };
}

function policyStep(root, stage) {
  const cli = path.join(root, "policy", "cli.js");
  if (!existsSync(cli)) return null;
  const args =
    stage === "pre-commit"
      ? [cli, "check", "--stage", "pre-commit", "--source", "staged"]
      : [cli, "check", "--stage", "pre-push", "--source", "range", "--base", "auto"];
  return {
    name: `policy-${stage}`,
    command: `node policy/cli.js ${args.slice(1).join(" ")}`,
    toolVersion: `node ${process.version}`,
    inputSignature: "uncached-policy-evaluation",
    executable: process.execPath,
    args,
    cwd: root,
    cacheable: false,
  };
}

function relatedJestArgs(snapshot, route, project, baseArgs) {
  const projectFiles = route.paths
    .filter((file) => file.startsWith(`${project}/`))
    .map((file) => file.slice(project.length + 1));
  const configurationChanged = projectFiles.some((file) =>
    /^(?:package(?:-lock)?\.json|jest\.config\.[cm]?js|tsconfig\.json|next\.config\.[cm]?js)$/.test(
      file
    )
  );
  const related = projectFiles.filter(
    (file) =>
      /\.(?:c?js|mjs|jsx|ts|tsx|json)$/i.test(file) &&
      existsSync(path.join(snapshot, project, file))
  );
  if (route.broad || configurationChanged || related.length === 0) return baseArgs;
  return [
    ...baseArgs,
    "--findRelatedTests",
    ...related.map((file) => path.resolve(snapshot, project, file)),
    "--passWithNoTests",
  ];
}

function backendJestArgs(snapshot, route) {
  const baseArgs = ["--runInBand", "--coverage=false"];
  const projectFiles = route.paths
    .filter((file) => file.startsWith("backend/"))
    .map((file) => file.slice("backend/".length));
  const directTests = new Set();

  for (const file of projectFiles) {
    if (!existsSync(path.join(snapshot, "backend", file))) continue;
    if (/\.(?:test|spec)(?:\.[^.]+)?\.js$/i.test(file)) {
      directTests.add(file);
      continue;
    }
    if (!file.endsWith(".js")) continue;
    const directory = path.posix.dirname(file);
    const stem = path.posix.basename(file, ".js");
    const absoluteDirectory = path.join(snapshot, "backend", directory);
    for (const entry of readdirSync(absoluteDirectory)) {
      if (entry === `${stem}.test.js` || entry.startsWith(`${stem}.test.`)) {
        directTests.add(path.posix.join(directory, entry));
      }
    }
  }

  if (directTests.size > 0 && !route.broad) {
    return [
      ...baseArgs,
      "--runTestsByPath",
      ...[...directTests].sort().map((file) => path.resolve(snapshot, "backend", file)),
    ];
  }

  const related = relatedJestArgs(snapshot, route, "backend", baseArgs);
  return related === baseArgs ? ["--coverage=false", "--maxWorkers=50%", "--forceExit"] : related;
}

function prePushSteps(root, snapshot, route) {
  const steps = [];
  const head = "HEAD";
  const { projects } = route;

  if (projects.includes("frontend")) {
    const tool = nodeTool(
      root,
      "frontend/node_modules/jest/bin/jest.js",
      "npm --prefix frontend ci"
    );
    const args = relatedJestArgs(snapshot, route, "frontend", ["--ci", "--runInBand"]);
    steps.push({
      name: "frontend-tests",
      command: `frontend jest ${args.join(" ")}`,
      toolVersion: commandVersion(tool.executable, [...tool.prefixArgs, "--version"], root),
      inputSignature: treeSignature(root, head, PROJECT_INPUTS.frontend),
      ...tool,
      args,
      cwd: path.join(snapshot, "frontend"),
    });
  }

  if (projects.includes("backend")) {
    const tool = nodeTool(root, "backend/node_modules/jest/bin/jest.js", "npm --prefix backend ci");
    const args = backendJestArgs(snapshot, route);
    steps.push({
      name: "backend-unit-tests",
      command: `backend jest ${args.join(" ")}`,
      toolVersion: commandVersion(tool.executable, [...tool.prefixArgs, "--version"], root),
      inputSignature: treeSignature(root, head, PROJECT_INPUTS.backend),
      ...tool,
      args,
      cwd: path.join(snapshot, "backend"),
      env: { NODE_ENV: "test" },
    });
  }

  if (projects.includes("contracts")) {
    const cargo = findCommand("cargo");
    if (!cargo) throw new Error("Contract changes are being pushed but cargo was not found.");
    const { env, sccache } = rustEnvironment(root);
    const versions = [
      commandVersion(cargo, ["--version"], root),
      commandVersion(findCommand("rustc") || "rustc", ["--version"], root),
      sccache ? commandVersion(sccache, ["--version"], root) : "sccache:not-installed",
    ].join(" | ");
    steps.push({
      name: "contract-tests",
      command:
        "cargo test --features std --lib --test differential --test regressions --test v2_escrow --test v2_properties",
      toolVersion: versions,
      inputSignature: treeSignature(root, head, PROJECT_INPUTS.contracts),
      executable: cargo,
      args: [
        "test",
        "--manifest-path",
        "contracts/marketpay-contract/Cargo.toml",
        "--features",
        "std",
        "--lib",
        "--test",
        "differential",
        "--test",
        "regressions",
        "--test",
        "v2_escrow",
        "--test",
        "v2_properties",
      ],
      cwd: snapshot,
      env,
    });
  }

  if (projects.includes("ml")) {
    const python =
      findCommand(process.platform === "win32" ? "python" : "python3") || findCommand("python");
    if (!python) throw new Error("ML changes are being pushed but Python 3 was not found.");
    steps.push({
      name: "ml-syntax",
      command: "python -m compileall -q ml",
      toolVersion: commandVersion(python, ["--version"], root),
      inputSignature: treeSignature(root, head, PROJECT_INPUTS.ml),
      executable: python,
      args: ["-m", "compileall", "-q", "ml"],
      cwd: snapshot,
      env: {
        PYTHONPYCACHEPREFIX: path.join(gitDir(root), "marketpay-hooks", "python-cache"),
      },
    });
  }

  const policy = policyStep(root, "pre-push");
  if (policy) steps.push(policy);

  return steps;
}

async function optionalTestDelay() {
  const delay = Number(process.env.MARKETPAY_HOOK_TEST_DELAY_MS || 0);
  if (Number.isFinite(delay) && delay > 0) {
    console.log(`[hooks] test delay: ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export async function runPreCommit(root) {
  installSignalHandlers();
  const conflicts = conflictedPaths(root);
  if (conflicts.length > 0) {
    throw new Error(`Resolve staged conflicts before committing:\n  ${conflicts.join("\n  ")}`);
  }

  const state = operationState(root);
  if (state.rebase || state.bisect) {
    const operation = state.rebase ? "rebase" : "bisect";
    console.log(
      `[hooks] pre-commit skipped during ${operation}; pre-push validates the complete range.`
    );
    return { status: 0, skipped: operation, totalMs: 0, steps: [] };
  }

  const changedFiles = stagedChangedPaths(root);
  if (changedFiles.length === 0) {
    console.log("[hooks] pre-commit: no staged files");
    return { status: 0, totalMs: 0, steps: [] };
  }

  const files = stagedPaths(root);
  const route = classifyPaths(changedFiles);
  console.log(`[hooks] staged projects: ${route.projects.join(", ") || "repository files only"}`);
  const snapshot = exportIndexSnapshot(root);
  activeCleanup = snapshot.cleanup;
  try {
    linkDependencyTrees(root, snapshot.path);
    await optionalTestDelay();
    const steps = preCommitSteps(root, snapshot.path, files);
    const policy = policyStep(root, "pre-commit");
    if (policy) steps.push(policy);
    return executeSteps({ root, hook: "pre-commit", steps });
  } finally {
    activeCleanup = null;
    snapshot.cleanup();
  }
}

export async function runPrePush(root, files) {
  installSignalHandlers();
  const route = classifyPaths(files);
  console.log(`[hooks] pushed projects: ${route.projects.join(", ") || "repository files only"}`);

  const snapshot = exportHeadWorktree(root, "HEAD");
  activeCleanup = snapshot.cleanup;
  try {
    linkDependencyTrees(root, snapshot.path);
    await optionalTestDelay();
    const steps = prePushSteps(root, snapshot.path, route);
    if (steps.length === 0) return { status: 0, totalMs: 0, steps: [] };
    return executeSteps({ root, hook: "pre-push", steps });
  } finally {
    activeCleanup = null;
    snapshot.cleanup();
  }
}
