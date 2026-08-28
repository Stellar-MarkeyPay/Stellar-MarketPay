const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGES = ["frontend", "backend"];

const SHARED_DEPS = {
  "@stellar/stellar-sdk": "^12.0.0",
  axios: "^1.7.2",
  "date-fns-tz": "^3.2.0",
};

function getPackageJson(dir) {
  const file = path.join(ROOT, dir, "package.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function setVersions() {
  let driftFound = false;

  for (const pkgDir of PACKAGES) {
    const pkg = getPackageJson(pkgDir);
    if (!pkg) continue;

    for (const [dep, version] of Object.entries(SHARED_DEPS)) {
      const current = pkg.dependencies?.[dep];
      if (current && current !== version) {
        console.warn(`[drift] ${pkgDir}: ${dep} is ${current}, expected ${version}`);
        pkg.dependencies[dep] = version;
        driftFound = true;
      }
    }

    fs.writeFileSync(
      path.join(ROOT, pkgDir, "package.json"),
      JSON.stringify(pkg, null, 2) + "\n"
    );
  }

  if (driftFound) {
    console.log("Dependency versions aligned.");
  } else {
    console.log("No dependency drift detected.");
  }
}

function checkLockfile() {
  try {
    execSync("git diff --quiet pnpm-lock.yaml", { stdio: "ignore" });
    console.log("Lockfile is clean.");
  } catch {
    console.warn("[drift] pnpm-lock.yaml has uncommitted changes.");
  }
}

setVersions();
checkLockfile();
