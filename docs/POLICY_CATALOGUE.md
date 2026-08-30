# Policy Catalogue

Every merge policy this repository enforces, why it exists, and what it costs
you when it fires.

The rule sections below are **generated from `policy/policies.json`** — the
same file the local hooks and the required CI check load. Nothing here is
written twice, so a rule's stated rationale cannot drift from the rule that is
actually enforced. Regenerate after changing the manifest:

```bash
npm run policy:catalogue -- --write
```

For how the engine works and why it is built this way, see
[POLICY_ENGINE.md](POLICY_ENGINE.md). For the local hook runner these rules
plug into, see [GIT_HOOKS_AND_COMMITS.md](GIT_HOOKS_AND_COMMITS.md).

## How to read a rule

Each rule carries four things:

- **Why** — the reasoning. If you disagree with a rule, this is the paragraph
  to argue with. Rules that turn out to be wrong should be changed, not
  bypassed.
- **Fix** — what to actually do. A failure message that names only a rule
  identifier is a defect in the rule; open an issue if you hit one.
- **Severity, per stage** — `error` blocks, `warn` prints, `off` does not run.
  A rule is defined once and can be a warning locally and an error in CI. It is
  never _detected_ differently: a rule that warns at `pre-push` and errors in CI
  finds exactly the same thing in both places.
- **Tests** — every rule has a test for both outcomes, in
  `policy/tests/checks.test.js`. A rule with only a failing-case test gets
  disabled the week it blocks something legitimate; a rule with only a
  passing-case test silently stops enforcing.

## Stages

| Stage        | Runs                                                      | Blocks                        |
| ------------ | --------------------------------------------------------- | ----------------------------- |
| `pre-commit` | local hook, on the staged changeset                       | bypassable with `--no-verify` |
| `commit-msg` | local hook, with the message you are writing              | bypassable with `--no-verify` |
| `pre-push`   | local hook, on the whole branch                           | bypassable with `--no-verify` |
| `ci`         | required check on the pull request and in the merge queue | not bypassable                |

`--no-verify` remains available and is not a policy violation. It changes
_when_ you find out about a violation, never whether the violation is
enforced: the same rule set runs as a required check, from the base branch, on
every pull request and every merge-queue entry.

## Overrides

A rule that is wrong for one specific change should be overridden, not
deleted. Overrides live in `policy/overrides.json` and every entry must name:

| Field        | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `id`         | Stable identifier, referenced in the finding output                      |
| `rule`       | The rule being overridden                                                |
| `paths`      | Optional. Scopes the override to specific files; omit to cover the rule  |
| `reason`     | Why this change is the exception                                         |
| `actor`      | Who holds it                                                             |
| `approvedBy` | Who approved it                                                          |
| `expires`    | `YYYY-MM-DD`, inclusive. An override without an expiry is a deleted rule |
| `issue`      | Optional link to the tracking issue                                      |

Three properties make overrides safe to have:

1. **They downgrade; they never silence.** An overridden error prints as a
   warning with the approver's name and the expiry attached. An invisible
   exception becomes a permanent one.
2. **They come from the base branch.** A pull request cannot grant itself an
   override — the exception has to be merged first, which means reviewed first.
3. **They are audited.** `npm run policy:overrides` fails on an expired entry,
   and every run reports overrides that matched nothing, which is how the
   periodic review finds rules the repository has grown out of.

```bash
npm run policy:overrides   # audit the exception list
```

## Rollout status

Every rule was measured against real history before its severity was set:

```bash
npm run policy:measure     # how often each rule would fire, over 150 commits
```

The measurement at the time of writing, against the last 150 non-merge
commits. The threshold used to pick a severity was written down before the
numbers were: **a rule firing on more than about 5% of commits ships `warn`,
because at that rate it is either too broad or there is a backlog to pay down
first.**

| Rule                        | Would have fired on | CI severity | Reasoning                                                                                                                                                                                |
| --------------------------- | ------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract-entrypoint-tests` | 2 / 150 (1.3%)      | `error`     | Low rate, high consequence, precise detection.                                                                                                                                           |
| `storage-compat-ack`        | 6 / 150 (4.0%)      | `error`     | Every hit is a genuine change to an already-deployed shape; the fix is one commit trailer.                                                                                               |
| `cargo-lock-integrity`      | 0 / 150             | `error`     | Nothing in recent history violates it.                                                                                                                                                   |
| `migration-down-tested`     | 23 / 150 (15.3%)    | `warn`      | Above the threshold, and honestly so: almost no migration in this repository has ever been covered by a test. Structural findings are real; the "no migration test" clause is a backlog. |
| `new-module-tests`          | 13 / 150 (8.7%)     | `warn`      | Above the threshold, with 69 pre-existing untested modules behind it.                                                                                                                    |
| `no-wallclock-tests`        | 2 / 150 (1.3%)      | `error`     | Both hits are real time bombs, one of them still in the tree at `backend/src/services/retainerService.test.js:919`.                                                                      |
| `no-root-scripts`           | 1 / 150 (0.7%)      | `error`     | The one hit is `append_type.py`, the incident that motivated the rule.                                                                                                                   |
| `no-secrets`                | 0 / 150             | `error`     | Zero false positives across all 559 commits of history — after four rounds of narrowing, recorded in the rule's source.                                                                  |
| `signed-commits`            | 150 / 150           | `warn`      | No commit in this repository's history is signed.                                                                                                                                        |
| `hook-integrity`            | not measurable      | `error`     | Cannot be evaluated against history that predates the manifest.                                                                                                                          |

Reproduce it yourself; the numbers move as the repository does:

```bash
npm run policy:measure
```

### Promotion conditions

Four rules are deliberately still `warn`. The condition for promoting each is
written down rather than left to whoever notices first:

| Rule                    | Promotes to `error` when                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migration-down-tested` | `backend/src/db/migrate.test.js` covers the up-and-down cycle for the migration set, so the rule's test clause stops reporting a backlog.                                                                                      |
| `new-module-tests`      | The untested-service and untested-route count reaches zero, or a dated backlog issue closes.                                                                                                                                   |
| `signed-commits`        | Every active contributor has enrolled a key — see [COMMIT_SIGNING.md](COMMIT_SIGNING.md) — at which point `required_signatures` in [`.github/branch-protection.json`](../.github/branch-protection.json) also flips to `true`. |

Promoting a rule is a one-line change to `policy/policies.json` followed by
`npm run policy:catalogue -- --write`. It is reviewable, attributable and
revertible like any other code, which is the point of the rule set being data.

<!-- policy:rules -->

| Rule                                                      | pre-commit | commit-msg | pre-push | CI    |
| --------------------------------------------------------- | ---------- | ---------- | -------- | ----- |
| [`contract-entrypoint-tests`](#contract-entrypoint-tests) | warn       | off        | warn     | error |
| [`storage-compat-ack`](#storage-compat-ack)               | off        | warn       | warn     | error |
| [`cargo-lock-integrity`](#cargo-lock-integrity)           | warn       | off        | error    | error |
| [`migration-down-tested`](#migration-down-tested)         | warn       | off        | warn     | warn  |
| [`new-module-tests`](#new-module-tests)                   | warn       | off        | warn     | warn  |
| [`no-wallclock-tests`](#no-wallclock-tests)               | warn       | off        | warn     | error |
| [`no-root-scripts`](#no-root-scripts)                     | error      | off        | error    | error |
| [`no-secrets`](#no-secrets)                               | error      | off        | error    | error |
| [`signed-commits`](#signed-commits)                       | off        | off        | warn     | warn  |
| [`hook-integrity`](#hook-integrity)                       | off        | off        | warn     | error |

### contract-entrypoint-tests

**Public contract entrypoints ship with a test change**

> **Incident.** The dropped-multisig merge removed public declarations from lib.rs while leaving every call site intact. The contract did not compile on main.

**Why.** An entrypoint is the contract's ABI. Adding, removing or changing one changes what deployed clients can call and what the escrow will do with their funds. A change to that surface with no test change means nothing executed the new behaviour before it was merged.

**Fix.** Add or update a test in contracts/marketpay-contract/tests/ covering the entrypoint, or a #[test] beside it in src/lib.rs.

**Severity.** pre-commit `warn`, commit-msg `off`, pre-push `warn`, CI `error`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `contract-entrypoint-tests` and one that does not.

### storage-compat-ack

**Stored-type shape changes carry a storage-compatibility acknowledgement**

> **Incident.** Escrow gained a v2 schema alongside live v1 ledger entries; the migration path was designed, but nothing in the tooling required it to be.

**Why.** Escrow, DataKey and the other #[contracttype] values are persisted in ledger entries by deployed contracts. Changing a field is not a refactor — existing entries were written with the old layout and must still decode, or be migrated. The acknowledgement forces the author to state which, in writing, where a reviewer reads it.

**Fix.** Add a 'Storage-Compat: <how existing entries decode, and the migration if they do not>' trailer to a commit in the change, or to the pull request body. The commit-msg hook checks it as you write the message.

**Severity.** pre-commit `off`, commit-msg `warn`, pre-push `warn`, CI `error`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `storage-compat-ack` and one that does not.

### cargo-lock-integrity

**Cargo.lock stays committed and version requirements stay bounded**

> **Incident.** soroban-env-host declares ed25519-dalek = ">=2.0.0". An unpinned resolve pulled a 3.x that does not compile against env-host, and the Rust job broke with no change to this repository.

**Why.** The contract is a deployable artefact, so its build must be reproducible from the tree. A deleted lock, a lock that moves without its manifest, or a new unbounded requirement each reintroduce a build whose result depends on the day it runs.

**Fix.** Keep Cargo.lock committed, include the Cargo.toml change that caused any re-resolve, and give every requirement an upper bound.

**Severity.** pre-commit `warn`, commit-msg `off`, pre-push `error`, CI `error`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `cargo-lock-integrity` and one that does not.

### migration-down-tested

**Database migrations ship with a tested down migration**

> **Incident.** npm run migrate:rollback exists and is part of the documented rollback path, but nothing required a down migration to be written or executed.

**Why.** A forward migration with no reverse is a deploy with no rollback. A reverse that no test ever executes is a rollback nobody has run — which is discovered during the incident it was meant to resolve.

**Fix.** Create the matching .down.sql reversing every forward statement in the opposite order, and add a case to backend/src/db/migrate.test.js that applies the up and then the down.

**Severity.** pre-commit `warn`, commit-msg `off`, pre-push `warn`, CI `warn`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `migration-down-tested` and one that does not.

### new-module-tests

**New backend services and routes arrive with a test file**

**Why.** Thirty services and thirty-nine routes are currently untested. The rule is not retroactive and does not ask anyone to backfill them; it fires only on files a change adds, so the debt stops growing while it is paid down.

**Fix.** Add <module>.test.js beside the new file. It is picked up by the existing backend Jest suite with no configuration.

**Severity.** pre-commit `warn`, commit-msg `off`, pre-push `warn`, CI `warn`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `new-module-tests` and one that does not.

### no-wallclock-tests

**Tests do not assert against the current wall clock**

> **Incident.** Two separate time-bomb tests have broken main in this repository. Both passed in review and failed later, on a day nobody had changed the code.

**Why.** A test whose result depends on when it runs does not test the code. It converts a passing suite into a scheduled outage, and the failure arrives attached to whichever innocent pull request happened to run next.

**Fix.** Freeze time (jest.useFakeTimers / jest.setSystemTime, or an injected clock) and assert against the frozen value.

**Severity.** pre-commit `warn`, commit-msg `off`, pre-push `warn`, CI `error`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `no-wallclock-tests` and one that does not.

### no-root-scripts

**One-off scripts do not live at the repository root**

> **Incident.** Stray root-level scripts have had to be cleaned up once already.

**Why.** A script at the root is outside every subproject's linter and test runner, so it rots unnoticed, and it is among the first things a new contributor sees. scripts/ exists and is covered.

**Fix.** Move it under scripts/ — or delete it if it was genuinely a one-off — and reference it from a package.json script so it is discoverable.

**Severity.** pre-commit `error`, commit-msg `off`, pre-push `error`, CI `error`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `no-root-scripts` and one that does not.

### no-secrets

**Credentials never enter git history**

**Why.** A secret in a commit is disclosed the moment it is pushed, and stays reachable through the reflog, every fork and every CI cache. Deleting it in the next commit does not revoke it. The local scan is a courtesy that saves a rotation; the server-side scan is the control.

**Fix.** Remove the value, load it from the environment or a secret store, and rotate the credential — see docs/SECRET_RESPONSE.md. If it is a documentation placeholder, add it to policy/secrets-allowlist.json with a reason.

**Severity.** pre-commit `error`, commit-msg `off`, pre-push `error`, CI `error`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `no-secrets` and one that does not.

### signed-commits

**Commits on protected branches are signed**

**Why.** Author identity in git is a self-declared string. For a repository holding escrowed-funds code, 'who wrote the change that moved the money' needs an answer that survives scrutiny. Enforcement is server-side; the local run exists to tell a contributor their signing setup is broken before they push twenty commits with it.

**Fix.** Enrol a key once with docs/COMMIT_SIGNING.md (npm run policy:signing-setup), then re-sign the range: git rebase --exec "git commit --amend --no-edit -S" <base>.

**Severity.** pre-commit `off`, commit-msg `off`, pre-push `warn`, CI `warn`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `signed-commits` and one that does not.

### hook-integrity

**Hook scripts and policy definitions are themselves verified**

**Why.** A hook that reports success without running anything is a supply-chain problem, and it is invisible because everything looks green. Recording a digest does not stop a hook from changing; it stops the change from being silent, by putting the new digest in the diff a reviewer reads.

**Fix.** If the change to the hook or the policy set is intended, regenerate the manifest: npm run policy:integrity -- --write.

**Severity.** pre-commit `off`, commit-msg `off`, pre-push `warn`, CI `error`.

**Tests.** `policy/tests/checks.test.js` covers both outcomes: a changeset that violates `hook-integrity` and one that does not.
