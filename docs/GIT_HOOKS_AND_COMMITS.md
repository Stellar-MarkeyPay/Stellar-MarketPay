# 🛠️ Git Hooks, Commit Conventions & Release Automation

Stellar MarketPay enforces consistent quality gates locally using **Husky**, **lint-staged**, **commitlint**, and **Prettier**, and automatically manages releases with **commit-and-tag-version**.

---

## ⚡ Quick Setup

Hooks are automatically installed when running `npm install` (via the `prepare` script):

```bash
npm install
```

---

## 💬 Conventional Commits & Interactive Prompt

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
<type>(<scope>): <short description>
```

### Supported Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style / formatting (no logic change)
- `refactor`: Code refactoring without changing functionality
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Build system or dependency updates
- `ci`: CI configuration or GitHub Actions updates
- `chore`: Maintenance tasks

### Supported Scopes (Optional)

- `frontend`, `backend`, `contracts`, `ci`, `k8s`, `deps`, `docs`, `release`, `hooks`, `security`, `sla`, `chaos`, `auth`, `escrow`, `dispute`, `profile`, `ratings`, `config`

### Interactive Prompt (Commitizen)

To construct valid commit messages interactively without memorizing the format:

```bash
npm run commit
```

---

## 🪝 Local Git Hooks

### 1. `pre-commit` (lint-staged)

Runs fast checks only on staged files before every commit:

- **Frontend / Backend JS/TS**: Runs ESLint (`--fix`) and Prettier (`--write`).
- **Soroban Contracts (Rust)**: Runs `cargo fmt` and `cargo clippy`.
- **Markdown & JSON**: Runs Prettier formatting.
- **Measured Runtime**: `< 2.5 seconds` for typical staged commits.

### 2. `commit-msg` (commitlint)

Validates that the commit message satisfies Conventional Commits specification.

### 3. `pre-push` (fast test suite)

Runs fast unit test suites (`npm run test:fast`) across subprojects before pushing to remote, while excluding slow E2E or chaos test suites.

---

## 🚪 Escape Hatch & Guidelines

In exceptional situations (e.g. emergency hotfix during an active outage, saving incomplete WIP stashes, or local environment toolchain issues), hooks can be bypassed using the `--no-verify` flag:

```bash
git commit -m "fix(hotfix): emergency patch" --no-verify
git push --no-verify
```

> ⚠️ **Legitimacy Rules**:
>
> - Using `--no-verify` is **prohibited** for standard feature work or to mask broken tests/lint failures.
> - CI runs quality gates independently on pull requests, so bypassing hooks locally will still enforce commit and format checks on server-side PR builds.

---

## 🚀 Releases & Changelog Generation

SemVer versioning and `CHANGELOG.md` updates are driven by commit history:

```bash
npm run release       # Auto-detect version bump & update changelog
npm run release:patch # Patch bump (1.0.1)
npm run release:minor # Minor bump (1.1.0)
npm run release:major # Major bump (2.0.0)
```
