# PR: Make Git hooks fast, staged-content-correct, and portable

## Summary

This replaces the repository's broad, worktree-mutating `lint-staged` setup with a small hook engine
that validates exactly what Git will commit, routes work to affected projects, caches successful
results by content, and enforces explicit performance budgets.

Husky remains the entry point, while `scripts/hooks/` owns isolation, routing, lifecycle behavior,
tool resolution, caching, timing, and diagnostics.

## Problem fixed

The previous hooks had four reliability problems:

1. `lint-staged` could stash and rewrite partially staged files, risking hidden work and invalidating
   build caches.
2. Pre-commit ran whole-project Rust work, including cold Clippy paths that could take nearly a
   minute.
3. Pre-push always ran every project's fast suite and only considered the current checkout, rather
   than the complete range being pushed.
4. Hook launchers hard-coded one developer's NVM version and did not diagnose skipped or shadowed
   installations.

## What changed

### Pre-commit

- Exports the Git index to an isolated temporary snapshot.
- Materializes blobs directly from Git objects so Windows checkout conversion cannot change staged
  LF bytes to CRLF before validation.
- Runs check-only Prettier, project-local ESLint, crate-aware `rustfmt`, and Python syntax checks.
- Selects tools only when files owned by that project are staged.
- Never stashes, rewrites, or re-stages contributor files.
- Rejects unresolved conflicts and skips repeated checks during rebase and bisect replay.
- Enforces a 2-second representative warm-commit budget in the regression suite.

### Commit message

- Uses the repository-local commitlint executable.
- Accepts generated merge/revert messages and autosquash `fixup!`/`squash!` subjects.
- Uses the same portable Node launcher as the other hooks.

### Pre-push

- Reads Git's pre-push ref records and compares each ref with the remote merge-base.
- Includes every commit in a multi-commit push instead of using `HEAD~1`.
- Routes frontend, backend, contract, and ML changes independently; cross-project changes run the
  union and shared configuration changes run all projects.
- Validates a detached, hard-reset `HEAD` worktree, excluding staged or unstaged future work.
- Runs related frontend tests, adjacent/related backend tests, fast contract verification, or ML
  compilation as applicable.
- Keeps invariant fuzzing, Clippy, coverage, builds, accessibility, E2E, and visual testing in CI.

### Exact caching and timing

- Stores local-only results in `.git/marketpay-hooks/cache-v1.json`.
- Keys include engine content, exact command, tool versions, environment, Git blob/mode entries,
  lockfiles, manifests, and relevant configuration.
- Records per-step timing in `.git/marketpay-hooks/timings.jsonl`.
- Warns with a breakdown above the 30-second pre-push budget; CI can make budget regressions block.
- Uses `.git/marketpay-hooks/cargo-target` and a stable detached source path for Rust incrementality.

### Portability and diagnosis

- Adds LF rules for hooks and source scripts in `.gitattributes`.
- Resolves Node 22.12+ through `NODE_BINARY`, `PATH`, Volta, asdf, or installed NVM versions.
- Resolves JavaScript tools from the owning dependency tree and Cargo from standard rustup paths.
- Adds `npm run hooks:doctor` to report missing Husky setup, `npm ci --ignore-scripts`, conflicting
  `core.hooksPath`, CRLF, executable-bit problems, missing dependencies, and optional Rust caches.
- Adds hook-engine CI coverage on Ubuntu, macOS, and Windows.

### Shared merge-policy integration

- Runs the repository policy CLI from the hook engine at `pre-commit`, `commit-msg`, and
  `pre-push`, keeping local and CI enforcement on the same entrypoint.
- Keeps policy evaluation uncached so changes to staged input, commit trailers, overrides, and the
  pushed range are evaluated every time.
- Regenerates the hook-integrity manifest for the portable Husky launchers.

## Measurements

Measured on Linux with Node 24.18 and Cargo 1.97:

| Routed case                              | Observed time |
| ---------------------------------------- | ------------: |
| Backend adjacent unit tests              |        0.69 s |
| Frontend related tests                   |        2.00 s |
| Warm contract verification               |        4.34 s |
| Unchanged successful result-cache replay |      near 0 s |

The completely cold contract dependency build remains longer than the local budget. The persistent
target directory, stable source path, optional `sccache`, and exact result cache make subsequent
runs survivable without moving whole-crate Clippy into pre-commit.

## Verification

- Hook engine: 20 tests passed on Linux, macOS, and Windows.
- Policy engine and local/CI parity: 70 tests passed.
- Partial staging: staged blob validated while an unstaged hunk remained unchanged.
- Work preservation: staged diff, worktree diff, and stash list remained byte-identical after
  SIGINT.
- Lifecycle: merge, revert, amend, cherry-pick, rebase, bisect, and unresolved conflicts covered.
- Routing: multi-commit ranges, deletions, shared files, and cross-project changes covered.
- Portability: spaces, non-ASCII paths, LF/executable checks, and minimal GUI-style `PATH` covered.
- Backend: 61 suites / 559 tests passed; 1 suite / 1 test skipped.
- Frontend: unit, accessibility, type, lint, production build, Storybook, E2E, and visual checks
  passed.
- Contracts: tests, Clippy, WASM check/build, and cargo-audit passed.
- Repository formatting and whitespace checks passed.

## Trade-offs

- Formatters are check-only. Contributors format and re-stage failed files deliberately; the hook
  never risks including an unstaged hunk.
- Long invariant fuzzing and Clippy remain in CI so ordinary commits and pushes stay within their
  agreed budgets.
- `sccache` is optional. The persistent Cargo target works without it, and `hooks:doctor` reports
  whether the extra cache is available.

## Reviewer entry points

- `scripts/hooks/runner.mjs` — staged and pre-push execution.
- `scripts/hooks/git.mjs` — snapshots, lifecycle state, and push-range calculation.
- `scripts/hooks/cache.mjs` — exact cache keys and timing records.
- `scripts/hooks/doctor.mjs` — installation diagnostics.
- `scripts/hooks/tests/` — correctness, lifecycle, interruption, routing, and budget regression.
- `docs/GIT_HOOKS_AND_COMMITS.md` — contributor-facing architecture and measurements.
