# `policy/`

The merge policy set: one definition, executed by the local hooks and by the
required CI check.

| File                     | What it is                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `policies.json`          | **The rule set.** Rule ids, rationale, remediation, per-stage severity. Versioned.        |
| `overrides.json`         | Time-limited, audited exceptions. Read from the base branch.                              |
| `secrets-allowlist.json` | Justified non-secrets for the `no-secrets` rule.                                          |
| `integrity.json`         | SHA-256 of every file that governs the gate. Generated.                                   |
| `cli.js`                 | The one entrypoint. Hooks and CI both call this.                                          |
| `engine/`                | Loader, evaluator, reporters. `engine/checks/` holds detection logic — one file per rule. |
| `tests/`                 | Both outcomes for every rule, plus the parity suite.                                      |

```bash
pnpm policy:check          # this branch, pre-push severities
pnpm policy:ci             # this branch, CI severities
pnpm policy:test           # rule tests + parity suite
pnpm policy:measure        # how often each rule would fire, over history
pnpm policy:overrides      # audit the exception list
pnpm policy:integrity      # verify hook and engine digests
pnpm policy:catalogue -- --write   # regenerate docs/POLICY_CATALOGUE.md
```

Documentation:

- **[docs/POLICY_CATALOGUE.md](../docs/POLICY_CATALOGUE.md)** — every rule and why it exists
- **[docs/POLICY_ENGINE.md](../docs/POLICY_ENGINE.md)** — architecture, the parity argument, trade-offs
- **[docs/BRANCH_PROTECTION.md](../docs/BRANCH_PROTECTION.md)** — server-side enforcement and the merge queue
- **[docs/COMMIT_SIGNING.md](../docs/COMMIT_SIGNING.md)** — enrolment
- **[docs/SECRET_RESPONSE.md](../docs/SECRET_RESPONSE.md)** — what to do when a credential leaks
- **[docs/PROVENANCE.md](../docs/PROVENANCE.md)** — attesting and verifying the release wasm

## The one-paragraph version

`evaluate(context, ruleSet)` answers "what is true of this changeset?" and has
no idea where it is running. `decide(findings, ruleSet, stage, overrides)`
answers "what should happen about it here?". Detection is identical everywhere;
only severity varies. That is why bypassing a hook changes _when_ you learn
about a violation and never _whether_ it is enforced — and it is asserted by
tests, not promised in a README.
