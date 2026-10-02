# Branch Protection & Merge Queue

The server-side half of the merge gate. Hooks are advisory; this is the part
nobody can skip.

Desired state lives in
[`.github/branch-protection.json`](../.github/branch-protection.json) —
committed, reviewable and revertible like any other code, because a setting
changed in GitHub's UI produces no diff, names no author and survives no
review.

```bash
bash scripts/apply-branch-protection.sh --verify   # report drift, exit 1
bash scripts/apply-branch-protection.sh --apply    # reconcile
```

Both need the `gh` CLI authenticated with admin rights on the repository.

## What is required on `main`

| Setting                            | Value                                                                    | Why                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Required checks                    | `Merge policy`, `Local/CI parity`, the three CI jobs, both quality gates | Every policy is mirrored by a required check. A rule that only a hook enforces is not enforced.   |
| `strict` (up to date before merge) | `true`                                                                   | A policy that passed against a stale base has not been evaluated against what will actually land. |
| Merge queue                        | enabled                                                                  | Two individually passing pull requests can still combine into a broken `main`.                    |
| Auto-merge                         | disabled                                                                 | PR #96 merged before its run reported.                                                            |
| Linear history                     | `true`                                                                   | The queue squashes; a linear history keeps `base..head` ranges meaningful for the policy engine.  |
| Force pushes / deletions           | denied                                                                   | A rewritten protected branch invalidates every signature and every attestation pointing at it.    |
| Conversation resolution            | required                                                                 | Review comments are part of the gate for `storage-compat-ack` acknowledgements.                   |
| Signed commits                     | see [COMMIT_SIGNING.md](COMMIT_SIGNING.md)                               | Currently `false`; flip after enrolment.                                                          |

## Closing the PR #96 path

PR #96 merged before its CI run reported. Three settings close that path
together, and all three are needed:

1. **The checks are required.** A required check that has not reported is not
   satisfied, so the merge button is unavailable rather than optimistic.
2. **Auto-merge is off.** GitHub's auto-merge waits for checks to be
   _requested and then complete_, but a check that is never requested — because
   a workflow's trigger did not match — never blocks it. Disabling it removes
   the ambiguity.
3. **The merge queue is the supported unattended path.** The queue builds the
   combined result and waits for its own required checks to report on that
   result. `check_response_timeout_minutes` bounds how long it waits before
   ejecting an entry rather than merging it.

For the queue to work, every required check must also trigger on
`merge_group` — otherwise a queued entry can never satisfy protection and the
queue stalls indefinitely. `policy.yml`, `ci.yml` and `quality-gates.yml` all
do.

## Preventing two green branches from breaking main

This is the class of failure that produced the dropped-declarations merge: one
pull request removed declarations, another kept using them, and each was green
against a base that did not contain the other.

The merge queue tests the _combined_ result. Configuration:

```json
"merge_queue": {
  "merge_method": "SQUASH",
  "grouping_strategy": "ALLGREEN",
  "max_entries_to_build": 5,
  "min_entries_to_merge_wait_minutes": 5,
  "check_response_timeout_minutes": 60
}
```

`ALLGREEN` means a failing entry invalidates the batch rather than being
merged with whatever else happened to be alongside it — slower, and correct.

The merge queue is enabled through repository settings or rulesets, not
through the branch-protection REST API. `apply-branch-protection.sh` reports
the desired configuration rather than silently pretending to have applied it.

## Administrator override

**Decision: `enforce_admins` is `false`.** Administrators can bypass required
checks.

This is deliberate, and the reasoning should be arguable rather than assumed.
The full CI suite includes Playwright, Storybook and a Rust build; it takes
tens of minutes. During a production incident affecting escrowed funds, a
twenty-minute wait to land a one-line revert is itself a risk. The bypass
exists for that case.

The cost is real: the bypass exists at all, and a bypass nobody notices is
indistinguishable from no protection. That is why it is paired with:

- **Every bypass is logged.** GitHub records administrator overrides in the
  audit log. Review them at the same cadence as the override audit below.
- **The bypass is not the override mechanism.** A rule that is wrong for a
  specific change goes in `policy/overrides.json`, where it is scoped, dated,
  attributed and reported. Admin bypass is for outages, not for disagreement.
- **Force pushes stay denied even for admins**, so a bypass cannot rewrite
  history to hide itself.

Who holds administrator rights should be reviewed on the same schedule as the
overrides. If the list is longer than the set of people who would be paged for
an escrow incident, it is too long.

## Reviewing overrides and bypasses

Monthly, or after any incident:

```bash
pnpm policy:overrides          # expired and never-matched exceptions
gh api /orgs/<org>/audit-log --method GET -f phrase='action:protected_branch'
```

Two questions to ask of the output:

- Which overrides expired without anyone renewing them? Those rules were
  probably fine; delete the exception.
- Which rule accumulates overrides? That rule is probably wrong. Fix the rule
  rather than the contributors — the catalogue's **Why** paragraph is the thing
  to argue with.

## Drift

Configuration applied by hand drifts. The `--verify` mode compares live
settings against the committed file and exits non-zero on any difference, so
it can be run on a schedule or before a release:

```bash
bash scripts/apply-branch-protection.sh --verify
```

A drift report naming a setting nobody remembers changing is the signal this
file exists to produce.
