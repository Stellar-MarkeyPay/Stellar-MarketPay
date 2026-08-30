export const CACHE_SCHEMA = "marketpay-hooks-v1";

export const BUDGETS_MS = Object.freeze({
  "pre-commit": 2_000,
  "pre-push": 30_000,
});

export const PROJECTS = Object.freeze(["frontend", "backend", "contracts", "ml"]);

const BROAD_PATHS = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".prettierignore",
  ".prettierrc.json",
  "package.json",
  "package-lock.json",
]);

const BROAD_PREFIXES = [".github/workflows/", ".husky/", "scripts/hooks/"];

export function normalisePath(file) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isBroadPath(file) {
  const path = normalisePath(file);
  return BROAD_PATHS.has(path) || BROAD_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function projectForPath(file) {
  const path = normalisePath(file);
  return PROJECTS.find((project) => path === project || path.startsWith(`${project}/`)) ?? null;
}

export function classifyPaths(files) {
  const paths = [...new Set(files.map(normalisePath))].sort();
  const broad = paths.some(isBroadPath);
  const projects = new Set(broad ? PROJECTS : []);

  for (const file of paths) {
    const project = projectForPath(file);
    if (project) projects.add(project);
  }

  return {
    paths,
    broad,
    projects: PROJECTS.filter((project) => projects.has(project)),
  };
}

export function isPrettierPath(file) {
  return /\.(?:c?js|mjs|jsx|ts|tsx|json|md|ya?ml)$/i.test(file);
}

export function isFrontendLintPath(file) {
  return /^frontend\/.*\.(?:js|jsx|ts|tsx)$/i.test(normalisePath(file));
}

export function isBackendLintPath(file) {
  return /^backend\/(?:src|tests)\/.*\.js$/i.test(normalisePath(file));
}

export function isPythonPath(file) {
  return /\.py$/i.test(file);
}

export function rustCratesForPaths(files) {
  const crates = new Set();
  for (const rawPath of files) {
    const file = normalisePath(rawPath);
    if (/^contracts\/marketpay-contract\/.*\.rs$/i.test(file)) crates.add("marketpay-contract");
    if (/^contracts\/marketpay-spec\/.*\.rs$/i.test(file)) crates.add("marketpay-spec");
  }
  return [...crates].sort();
}

export const PROJECT_INPUTS = Object.freeze({
  frontend: [
    "frontend",
    "package.json",
    "package-lock.json",
    ".editorconfig",
    ".prettierrc.json",
    "scripts/hooks",
  ],
  backend: [
    "backend",
    "package.json",
    "package-lock.json",
    ".editorconfig",
    ".prettierrc.json",
    "scripts/hooks",
  ],
  contracts: ["contracts/marketpay-contract", "contracts/marketpay-spec", "scripts/hooks"],
  ml: ["ml", "scripts/hooks"],
});
