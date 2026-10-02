# Git hooks, commit conventions, and budgets

Husky is only the portable Git entry point. The hook engine in `scripts/hooks/` owns staged-content
isolation, project routing, caching, lifecycle handling, and timing. It deliberately does not use
`lint-staged`.

## Setup and diagnosis

Install the root tools and the dependency trees you plan to edit:

```bash
pnpm install
pnpm --filter frontend install
pnpm --filter backend install
pnpm hooks:doctor
```

`pnpm install --ignore-scripts` skips Husky's `prepare` lifecycle. The checkout then looks healthy but
has no active hooks. `pnpm hooks:doctor` reports this case, a missing generated Husky runtime,
CRLF or non-executable hook files, missing per-project tools, and a `core.hooksPath` claimed by
another hook manager. It prints a command for each repair.

The launchers contain no developer-specific NVM, Cargo, or Python path. The shared launcher accepts
`NODE_BINARY`, then checks `PATH`, Volta, asdf, and installed NVM versions for Node 22.12 or newer.
JavaScript tools resolve from the owning project's `node_modules`; Cargo is also searched in
rustup's standard directory. This matters in GUI Git clients, whose `PATH` is commonly smaller than
a terminal session's.

## Architecture and trade-offs

### Pre-commit: check the index and never rewrite the worktree

The pre-commit budget is **2 seconds** for a typical warm, single-project commit.

The engine exports the Git index into a temporary directory with `git checkout-index`. ESLint,
Prettier, rustfmt, and Python syntax checks run there, so `git add -p` is handled correctly: tools
see the staged blob, not an unstaged working-tree version of the same file. Paths containing spaces
or non-ASCII characters remain individual process arguments instead of being interpolated into a
shell command.

Formatters are check-only. They never use `--write`, stash, or re-stage. A formatting failure asks
the contributor to format and select the hunks again. This is less automatic than rewriting a file,
but it cannot accidentally include an unstaged hunk. It also provides a strong interruption
guarantee: the hook has no operation that changes the index, working tree, or stash. A SIGINT test
records all three, interrupts a live hook, and requires byte-for-byte equality afterward.

| Staged path                                         | Check                                   |
| --------------------------------------------------- | --------------------------------------- |
| Supported text (`js`, `ts`, `json`, Markdown, YAML) | Root Prettier `--check`                 |
| Frontend JS/TS                                      | Frontend ESLint                         |
| Backend `src/` or `tests/` JS                       | Backend ESLint                          |
| Rust                                                | `rustfmt --check` on owning-crate paths |
| Python                                              | `python -m py_compile`                  |

The engine reads the owning `Cargo.toml` edition and invokes `rustfmt` on the staged Rust paths with
that edition and the crate directory as its configuration search path. This includes a newly added,
not-yet-referenced module without applying the wrong edition or ignoring `rustfmt.toml`. Rust tools
resolve only when a staged Rust path needs them; a frontend-only contributor does not need Rust.

### Why Clippy is not pre-commit

The baseline that motivated this design was:

| Check                         |               Cold |        Warm |
| ----------------------------- | -----------------: | ----------: |
| `cargo clippy -- -D warnings` |               54 s | about 1.9 s |
| `cargo test --features std`   | about 20 s compile |       0.3 s |
| Backend Jest with coverage    |         about 20 s |  about 20 s |
| Frontend Jest                 |                  — | about 2.6 s |
| Next build                    |                  — |  about 55 s |

Clippy is whole-crate work. A one-line staged change still lints the full contract, and the first
commit after a clone, `cargo clean`, or dependency invalidation pays the 54-second cold path. That
cannot meet the pre-commit budget. Pre-commit therefore runs rustfmt, pre-push runs contract tests,
and CI runs `cargo clippy --all-targets --features std -- -D warnings` with a controlled runner
cache.

Contract tests use `.git/marketpay-hooks/cargo-target` rather than a temporary snapshot's `target/`.
Pre-push also reuses a detached, hard-reset worktree at a repository-specific stable path below the
platform temporary directory, so Cargo sees a stable source path while staged future work and the
contributor's checkout remain isolated. It lives outside `.git` because Jest intentionally ignores
source trees nested inside Git metadata. The worktree and `.git/marketpay-hooks/cargo-target`
survive hook runs. If `sccache` is installed, the engine selects it as `RUSTC_WRAPPER`; otherwise
Cargo's persistent incremental artifacts still reduce repeat builds. Compiler and wrapper versions
are included in the result key.

### Published implementation measurements

These measurements were recorded on 2026-08-28 on Linux with Node 24.18, Cargo 1.97, and the
repository's installed lockfiles. They are end-to-end hook timings, not estimates:

| Routed pre-push case                                | Observed time |
| --------------------------------------------------- | ------------: |
| Backend adjacent unit test                          |        0.69 s |
| Frontend related Jest tests                         |        2.00 s |
| Full contract suite, empty persistent Cargo target  |      103.48 s |
| Full suite after moving to a new stable source path |       51.84 s |
| Routed contract verification, stable path warm      |        4.34 s |
| Unchanged contract result-cache replay              |      near 0 s |

The true first Rust run can exceed the 30-second warm budget because it must build the dependency
graph; the hook reports the complete timing breakdown rather than concealing that cost. The
mitigation is the persistent Cargo target, stable detached source path, optional `sccache`, and
content-exact result cache. Pre-push runs the library, differential, regression, and V2 integration
suites; the long invariant-fuzz target, Clippy, and the complete suite remain required in CI. This
cut measured warm contract verification to 4.34 seconds, while an unchanged replay is close to
free. Neither `cargo clean` in the contributor checkout nor partial-staging isolation deletes the
hook-owned cache.

### Pre-push: route the complete push range

The pre-push budget is **30 seconds** for a warm, single-project push. The hook consumes Git's
pre-push ref records and diffs each local ref from its merge-base with the remote SHA. For a new
remote ref, it uses the configured upstream, remote tracking branch, or remote default branch in
that order. It does not use `HEAD~1`; a multi-commit push is checked as one change.

Paths map to `frontend`, `backend`, `contracts`, and `ml`. Cross-project pushes run the union.
Workflows, root dependency/format configuration, Husky launchers, and the hook engine route all
projects. Documentation-only changes do not start unrelated test suites.

Pre-push hard-resets a persistent detached Git worktree to the root checkout's resolved `HEAD`.
Staged future work and unstaged changes are excluded from the pushed checks, while stable source
paths preserve compiler incrementality. The detached worktree is cleaned before use and contains
no contributor-authored state.

| Project   | Pre-push check                                          |
| --------- | ------------------------------------------------------- |
| Frontend  | Jest tests related to changed JS/TS/JSON, in-band       |
| Backend   | Jest tests related to changed JS/JSON, without coverage |
| Contracts | Fast library, differential, regression, and V2 tests    |
| ML        | Python byte-code compilation                            |

Jest configuration, dependency manifests, shared root files, deletions, or project changes that
cannot be mapped to a module deliberately fall back to that project's full suite. This keeps the
ordinary path incremental without letting an ambiguous dependency change receive a narrower check.

Coverage, Clippy, invariant fuzzing, complete suites, builds, accessibility, E2E, visual tests,
cargo-audit, and deployment validation remain CI responsibilities because their costs exceed the
local budget.

### Exact result caching

Successful results live in `.git/marketpay-hooks/cache-v1.json`, never in the worktree. A step key
is SHA-256 over these length-delimited fields:

1. cache schema;
2. content hash of every `scripts/hooks/*.mjs` engine module;
3. step name and exact command;
4. tool, compiler, and sccache version output;
5. Git mode, object ID, stage, and path for every input source, lockfile, manifest, and relevant
   configuration file;
6. a hash of the process environment supplied to the check, excluding hook-engine control flags.

Pre-commit signatures come from the index; pre-push signatures come from `HEAD`. Git blob IDs make
content identity exact, while the other fields ensure a configuration or tool upgrade cannot reuse
an old result. Only status 0 is cached. Set `MARKETPAY_HOOK_CACHE=0` for an uncached diagnostic run.

### Timing and budget enforcement

Every step is appended to `.git/marketpay-hooks/timings.jsonl` with duration, cache status, exit
status, total time, and budget result. Records stay local and are never uploaded. Any future
aggregation must be explicit opt-in.

An over-budget hook prints its per-step breakdown. It warns locally so a legitimate multi-project
push is not rejected solely for being broad. CI sets `MARKETPAY_HOOK_ENFORCE_BUDGET=1`, and the test
suite requires a representative pre-commit to remain below two seconds. Set the same variable
locally to turn a warning into a blocking result.

## Git lifecycle behavior

| State                           | Behavior                                                    |
| ------------------------------- | ----------------------------------------------------------- |
| Normal commit or amend          | Validate the staged index                                   |
| Merge with unresolved conflicts | Stop and list conflicts                                     |
| Resolved merge or cherry-pick   | Validate staged content; cache keeps replays cheap          |
| Interactive rebase              | Skip repeated checks; pre-push validates the complete range |
| Bisect automation               | Skip the commit hook; pre-push remains the final local gate |
| Generated merge/revert message  | Skip commitlint                                             |
| `fixup!` / `squash!` message    | Skip commitlint for autosquash                              |

Generated messages are detected from Git state and standard subjects. Ordinary messages use the
repository-local commitlint CLI.

## Conventional commits

Ordinary commit messages use:

```text
<type>(<optional-scope>): <short description>
```

Supported types are `build`, `ci`, `chore`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
`style`, and `test`. Run `pnpm commit` for the interactive prompt.

## Portability and direct commands

`.gitattributes` forces LF for hooks and source scripts. The hook test job runs on Linux, macOS,
and Windows. Tests cover spaces and non-ASCII paths, staged-only snapshots, multi-commit routing,
cache invalidation, generated messages, the two-second budget, and SIGINT work preservation where
POSIX signals are available.

```bash
pnpm hooks:pre-commit
pnpm hooks:pre-push
pnpm hooks:doctor
pnpm test:hooks
```

Git's `--no-verify` remains available for exceptional operational use. Server-side CI independently
runs formatting, lint, tests, Clippy, builds, and commit-message checks, so bypassing a local hook
does not bypass repository quality gates.
