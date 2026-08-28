# The Policy Engine

Why the rules that gate a merge are defined once, and what it took to make
"once" true.

- **Rules and their rationale:** [POLICY_CATALOGUE.md](POLICY_CATALOGUE.md)
- **Server-side enforcement:** [BRANCH_PROTECTION.md](BRANCH_PROTECTION.md)
- **Local hook runner:** [GIT_HOOKS_AND_COMMITS.md](GIT_HOOKS_AND_COMMITS.md)

## The problem

Git hooks are advisory. `git commit --no-verify` skips every one of them,
hooks live in `.git/` and are never cloned, and a contributor can delete them.
Whatever the hooks guarantee, they guarantee it only about contributors who
cooperate — which is not the standard a repository holding escrowed-funds code
needs.

This repository has already demonstrated the failure mode. Between 2026-07-29
and 2026-07-30, five merges reached `main` with all three CI jobs red,
including one that dropped struct fields while keeping every call site, leaving
the contract uncompilable. PR #96 merged before its CI run reported. Local
hooks would not have prevented any of it.

So the goal is not "more hooks". It is a single rule set that executes
identically in three places — the local hook, the CI job, and the server-side
gate — so that bypassing a hook changes _when a contributor learns they are
wrong_, never _whether the rule holds_.

## Architecture

```
policy/
  policies.json        the rule set: id, rationale, remediation, per-stage severity
  overrides.json       time-limited, audited exceptions
  secrets-allowlist.json
  integrity.json       SHA-256 of every file that governs the gate
  cli.js               the ONE entrypoint; hooks and CI both call this
  engine/
    diff.js            unified-diff parser
    context.js         builds the changeset a check sees
    manifest.js        loads and validates policies.json
    severity.js        stage severity + override application
    index.js           evaluate() and decide()
    report.js          text / GitHub annotations / Markdown / JSON
    checks/            one file per rule; detection logic only
  tests/               both outcomes for every rule, plus the parity suite
```

The important split is between `evaluate()` and `decide()`:

```js
const findings = evaluate(context, ruleSet); // what is true of this changeset
const { decided } = decide(findings, ruleSet, stage, overrides); // what to do about it
```

`evaluate()` has no notion of where it is running. `decide()` maps findings
onto a stage's severities. That is the entire parity mechanism, and everything
below is a consequence of it.

## Why parity is structural, not a promise

Four things are enforced, each by a test in `policy/tests/parity.test.js`:

1. **Detection cannot see the stage.** A check's signature is
   `run(context, options)`. The context carries a changeset and a view of the
   repository — never a stage. A test asserts that no check file mentions
   `stage` outside a comment, and that every registered check takes exactly two
   parameters. There is no channel through which a check could behave
   differently locally.

2. **The same changeset yields the same findings at every stage.** For a
   fixture that violates most of the rule set, the findings are compared
   across every stage each rule is active at. They must be identical, byte for
   byte, in rule, path, line and message.

3. **A local warning is the finding CI errors on.** For every error CI would
   report, the `pre-push` stage must report the same finding. If it did not,
   `--no-verify` would be hiding a violation rather than deferring it — which
   is the property the whole design exists to guarantee.

4. **There is exactly one implementation.** Every rule maps to exactly one
   registered check and every check to exactly one rule. Nothing outside
   `policy/` imports the engine; everything else shells out to `policy/cli.js`.

Run them:

```bash
npm run policy:test
```

## Stages

| Stage        | Source                                                | Where it runs  |
| ------------ | ----------------------------------------------------- | -------------- |
| `pre-commit` | staged index                                          | local hook     |
| `commit-msg` | staged index + the message being written              | local hook     |
| `pre-push`   | `merge-base..HEAD`                                    | local hook     |
| `ci`         | `base..head` of the pull request or merge-queue entry | required check |

`commit-msg` exists because one rule — `storage-compat-ack` — takes the commit
message as input. Giving it a stage where the message exists is the difference
between "you will be told at push time" and "you can fix it as you type".

## What makes the gate unbypassable

A hook cannot be trusted, so the server enforces. Three properties, in
[`.github/workflows/policy.yml`](../.github/workflows/policy.yml) and
[`.github/branch-protection.json`](../.github/branch-protection.json):

**Policy is evaluated from the base branch.** The workflow checks the base out
separately and runs _its_ engine and _its_ manifest against the pull request's
changeset:

```bash
node "$policy_root/policy/cli.js" check --stage ci \
  --repo-root  "$GITHUB_WORKSPACE"   \  # the tree being judged
  --policy-root "$policy_root"          # the rules doing the judging
```

A pull request that deletes the rule it violates is still judged by the rule
`main` already agreed to. Overrides come from the base for the same reason: an
exception must be merged, and therefore reviewed, before it applies.

> **The one exception, stated plainly.** `policy/secrets-allowlist.json` is
> read from the head, so a contributor can justify a new documentation
> placeholder in the same change that introduces it. That is a deliberate hole,
> and it is bounded: every entry requires a `reason`, and the loader refuses an
> entry broad enough to disable the scanner (`**`, `*`, and similar). The
> residual risk is a narrowly-scoped allowlist entry landing with a reviewed
> diff — which is the same risk as any other reviewed line.

**The gate runs in the merge queue.** Two individually green pull requests can
combine into a broken `main`; that is exactly what produced the
dropped-declarations merge. `policy.yml` triggers on `merge_group`, and so do
`ci.yml` and `quality-gates.yml` — a required check that does not run in the
queue leaves the queue unable to ever satisfy protection.

**Checks must have reported, not been requested.** Auto-merge is off and the
merge queue is the supported path to unattended merging. PR #96's path is
closed. See [BRANCH_PROTECTION.md](BRANCH_PROTECTION.md).

## The engine checks itself

`policy/integrity.json` records a SHA-256 for every file that governs the gate
— the hooks, the engine, the manifest and the CLI. The `hook-integrity` rule
recomputes them.

This does not stop anyone changing a hook. It stops the change from being
_silent_: editing one means regenerating the manifest, which puts the new
digest in the diff a reviewer reads.

```bash
npm run policy:integrity              # verify
npm run policy:integrity -- --write   # record, after an intended change
```

## Introducing a rule without a wall of failures

A policy system that arrives as a hundred red builds gets reverted. Every rule
here was measured against real history before its severity was chosen:

```bash
npm run policy:measure          # last 150 non-merge commits, per-rule hit rate
```

The output is a table of "would have fired on N of 150 commits", and it is
what the rollout table in the catalogue is built from. A new rule should:

1. Ship at `warn` everywhere, including CI.
2. Be measured. If it fires on more than a few percent of commits, either the
   rule is too broad or there is a backlog to pay down first.
3. Be promoted to `error` in CI once the measurement is clean, with the
   promotion condition written into the catalogue.

`--dry-run` reports everything and blocks nothing, for trying a severity
change before committing to it:

```bash
node policy/cli.js check --stage ci --source range --base auto --dry-run
```

## Adding a rule

1. Write `policy/engine/checks/<name>.js` exporting `RULE` and
   `run(context, options)`. Return violations built with the shared
   `violation()` helper so every finding has a path, a line and a fix.
2. Register it in `policy/engine/checks/index.js`.
3. Add the rule to `policy/policies.json` with a rationale, a remediation and
   per-stage severity. The manifest loader rejects a rule missing any of them,
   an unknown stage, an unknown severity, or a rule that is `off` everywhere.
4. Add tests for **both** outcomes in `policy/tests/checks.test.js`, named
   `"<rule-id>: fires …"` and `"<rule-id>: passes …"` — the parity suite
   asserts both exist.
5. Regenerate the derived files:

   ```bash
   npm run policy:catalogue -- --write
   npm run policy:integrity -- --write
   ```

## Trade-offs worth knowing about

**JSON, not YAML, and no dependencies.** The engine runs on Node's standard
library alone. A gate that cannot run until a lockfile resolves is a gate that
stops running the day a registry has a bad afternoon — and the CI job would
then be green-by-absence. The cost is JSON's lack of comments, paid with
`$comment` fields and a generated catalogue.

**Keyword matching, not parsing.** `contract-entrypoint-tests` looks for
`pub fn`; it does not parse Rust. A parser that disagrees with `rustc` is worse
than a keyword match that occasionally asks for a test that was not strictly
needed. The same reasoning applies to the SQL and JavaScript rules.

**Shape comparison for stored types.** `storage-compat-ack` reads the type
declaration before and after the change rather than the diff, because a `-U0`
hunk shows changed lines without the declaration they belong to — and it is the
declaration, not the line, that decides whether deployed ledger entries still
decode.

**`hook-integrity` compares against the head's manifest.** Comparing against
the base's would fail every legitimate hook change. Base-branch evaluation plus
a visible digest in the diff is the control; the digest alone is not.

**Findings are never silenced.** An override downgrades an error to a warning
that still prints, with the approver and the expiry attached. Making an
exception invisible is how it becomes permanent.
