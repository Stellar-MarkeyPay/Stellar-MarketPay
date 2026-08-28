import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findCommand } from "./runner.mjs";
import { git, gitDir } from "./git.mjs";

function versionMajor(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return { major, minor };
}

function result(level, label, detail, fix = null) {
  return { level, label, detail, fix };
}

export function diagnose(root) {
  const results = [];
  const nodeVersion = versionMajor(process.version);
  const nodeSupported =
    nodeVersion.major > 22 || (nodeVersion.major === 22 && nodeVersion.minor >= 12);
  results.push(
    nodeSupported
      ? result("pass", "Node.js", process.version)
      : result(
          "fail",
          "Node.js",
          `${process.version} is too old for the installed commitlint`,
          "Install or activate Node.js 22.12 or newer."
        )
  );

  const hooksPath = git(root, ["config", "--get", "core.hooksPath"], { allowFailure: true });
  if (!hooksPath) {
    results.push(
      result(
        "fail",
        "Git hooks",
        "core.hooksPath is unset; install scripts may have been skipped",
        "Run: npm run prepare"
      )
    );
  } else if (hooksPath.replaceAll("\\", "/").replace(/\/$/, "") !== ".husky/_") {
    results.push(
      result(
        "fail",
        "Git hooks",
        `core.hooksPath=${hooksPath} shadows Husky`,
        "Remove the conflicting hooksPath, then run: npm run prepare"
      )
    );
  } else {
    results.push(result("pass", "Git hooks", "core.hooksPath=.husky/_"));
  }

  const generatedHook = path.join(root, ".husky", "_", "h");
  results.push(
    existsSync(generatedHook)
      ? result("pass", "Husky runtime", ".husky/_/h exists")
      : result("fail", "Husky runtime", ".husky/_/h is missing", "Run: npm run prepare")
  );

  for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
    const file = path.join(root, ".husky", hook);
    if (!existsSync(file)) {
      results.push(result("fail", hook, "hook file is missing", "Restore it from Git."));
      continue;
    }
    const content = readFileSync(file);
    const mode = git(root, ["ls-files", "-s", "--", `.husky/${hook}`], {
      allowFailure: true,
    }).split(" ")[0];
    if (content.includes(13)) {
      results.push(result("fail", hook, "contains CRLF", "Run: git add --renormalize .husky"));
    } else if (mode !== "100755") {
      results.push(
        result(
          "fail",
          hook,
          `Git mode is ${mode || "untracked"}`,
          `Run: git update-index --chmod=+x .husky/${hook}`
        )
      );
    } else {
      results.push(result("pass", hook, "LF and executable"));
    }
  }

  const launcher = path.join(root, "scripts", "hooks", "launch.sh");
  if (!existsSync(launcher)) {
    results.push(result("fail", "Hook launcher", "scripts/hooks/launch.sh is missing"));
  } else if (readFileSync(launcher).includes(13)) {
    results.push(
      result("fail", "Hook launcher", "contains CRLF", "Run: git add --renormalize scripts/hooks")
    );
  } else {
    try {
      accessSync(launcher, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      results.push(result("pass", "Hook launcher", "LF and executable"));
    } catch {
      results.push(
        result(
          "fail",
          "Hook launcher",
          "is not executable",
          "Run: chmod +x scripts/hooks/launch.sh"
        )
      );
    }
  }

  const prettier = path.join(root, "node_modules", "prettier", "bin", "prettier.cjs");
  results.push(
    existsSync(prettier)
      ? result("pass", "Root dependencies", "Prettier is installed locally")
      : result("fail", "Root dependencies", "root node_modules is missing", "Run: npm ci")
  );

  for (const project of ["frontend", "backend"]) {
    const modules = path.join(root, project, "node_modules");
    results.push(
      existsSync(modules)
        ? result("pass", `${project} dependencies`, "installed")
        : result(
            "warn",
            `${project} dependencies`,
            "not installed; hooks need them only when that project changes",
            `Run: npm --prefix ${project} ci`
          )
    );
  }

  const cargo = findCommand("cargo");
  results.push(
    cargo
      ? result("pass", "Rust toolchain", cargo)
      : result(
          "warn",
          "Rust toolchain",
          "not found; required only for contract changes",
          "Install rustup with rustfmt."
        )
  );

  const sccache = findCommand("sccache");
  results.push(
    sccache
      ? result("pass", "sccache", sccache)
      : result(
          "warn",
          "sccache",
          "not installed; the persistent Cargo target cache is still active",
          "Optional: install sccache for faster dependency rebuilds."
        )
  );

  const gitState = path.join(gitDir(root), "marketpay-hooks");
  results.push(result("pass", "Local state", gitState));
  return results;
}

export function printDiagnosis(results) {
  const icons = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  for (const item of results) {
    console.log(`${icons[item.level].padEnd(4)} ${item.label}: ${item.detail}`);
    if (item.fix) console.log(`     ${item.fix}`);
  }
  const failures = results.filter((item) => item.level === "fail").length;
  const warnings = results.filter((item) => item.level === "warn").length;
  console.log(`\nHook doctor: ${failures} failure(s), ${warnings} warning(s)`);
  return failures === 0 ? 0 : 1;
}
