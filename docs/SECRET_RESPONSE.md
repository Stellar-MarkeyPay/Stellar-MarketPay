# Secrets: Prevention and Response

A credential in a commit is disclosed the moment it is pushed. Deleting it in
the next commit does not revoke it: the object stays reachable through the
reflog, through every fork, through every CI cache, and through anyone who
pulled in between. **Rotation is the only fix.**

Everything below exists to make that sentence rare.

## Four layers

| Layer                        | Where                                | Bypassable                   |
| ---------------------------- | ------------------------------------ | ---------------------------- |
| `no-secrets` at `pre-commit` | local hook, before the commit exists | yes, with `--no-verify`      |
| `no-secrets` at `ci`         | required check on every pull request | no                           |
| GitHub push protection       | GitHub, on receipt of the push       | no (org setting)             |
| `secret-history-scan`        | scheduled workflow over all history  | n/a — it reports, you rotate |

The local scan is a courtesy that saves you a rotation. The CI scan is the
control. Push protection is an independent backstop that does not depend on
this repository's code being correct. The history scan answers a different
question: not "did we stop the next one" but "what is already out there".

## How detection works

Pattern matching _and_ entropy, because neither alone is enough.

**Patterns** catch credentials whose shape is known — AWS access key ids,
GitHub tokens, Slack tokens, Google API keys, Stripe live keys, PEM private-key
blocks, Stellar secret seeds, and database URLs with an inline password.

**Entropy** catches the ones whose shape is not. Shannon entropy alone is
noise — a UUID, a git SHA and a base64 image are all high-entropy — so it is
applied only to the value side of a credential-shaped assignment
(`*secret*`, `*token*`, `*password*`, `*api_key*`, `*private_key*`, and
similar), only above 20 characters, and only after the placeholder filter.

**Placeholders are filtered before anything fires.** `change-me`, `${VAR}`,
`<your-token>`, `example-secret`, and loopback database URLs are documentation,
and this repository is full of them. A scanner that cries wolf on
`.env.example` is a scanner people learn to skim past, so the filter is broad
on purpose.

Measured result: zero findings across all 559 commits of history, while still
flagging a genuine key with a different value in the same file as an
allowlisted one.

## The allowlist

`policy/secrets-allowlist.json`. Every entry needs a `reason` and the engine
refuses to load one without it — an allowlist nobody can justify is the
scanner being switched off one line at a time.

```json
{
  "kind": "literal",
  "value": "const ADMIN_SECRET = \"S…\";",
  "reason": "Fixed testnet-only Playwright keypair with no funds and no mainnet use…"
}
```

Three kinds: `literal` (an exact line), `path` (a file or glob), `pattern` (a
regex). Prefer `literal` — allowing a path allows everything that will ever be
added to it. The loader rejects a path entry broad enough to disable the
scanner (`**`, `*`, and similar).

The allowlist is read from the pull request's own tree, so a placeholder can be
justified in the change that introduces it. That is a deliberate trade-off; see
[POLICY_ENGINE.md](POLICY_ENGINE.md#what-makes-the-gate-unbypassable).

## If a real credential is committed

Work in this order. The first two steps are the only ones that reduce risk;
the rest is cleanup.

**1. Rotate it. Now.** Before you fix the code, before you rewrite history,
before you tell anyone. Every minute the old credential is valid is a minute
it can be used. If you cannot rotate it yourself, escalate immediately — see
[SECURITY.md](../SECURITY.md).

**2. Assess exposure.** Was the commit pushed? Was the branch public? How long
was it reachable? Check the provider's audit log for use of the credential
between the commit timestamp and the rotation. Assume disclosure; look for
evidence of _use_.

**3. Remove it from the code.** Load it from the environment or a secret
store. Add a placeholder if the file is documentation, with an allowlist entry
and a reason.

**4. Decide about history.** Rewriting history with `git filter-repo` or BFG
invalidates every open pull request, every signature and every build
attestation pointing at the rewritten commits, and does nothing about forks or
caches. Rewrite only when the credential cannot be rotated — a hard-coded key
in a deployed artefact, say. Otherwise rotation is sufficient and rewriting is
theatre with a cost.

**5. Write it down.** Note what leaked, when, when it was rotated, and what
the scanner missed. If the scanner missed it, that is a rule change — open a
pull request against `policy/engine/checks/no-secrets.js` with a test for the
pattern.

## Running the scans

```bash
node policy/cli.js scan-history              # every commit, every branch
node policy/cli.js scan-history --depth 200  # recent history only
npm run policy:check                         # the current branch
```

The scheduled scan runs Mondays at 03:00 UTC and can be triggered from the
Actions tab. It is not a required check: it walks the entire history, so it
does not belong on the critical path of a pull request, and its findings need a
rotation rather than a code change.

## Push protection

Enable **Settings → Code security → Secret scanning → Push protection** at the
organisation level. It is independent of this repository's code, catches
provider patterns GitHub knows about that this engine does not, and it fires on
receipt of the push rather than after it.

When it blocks a push, the response is the procedure above — rotate first. The
"allow this secret" escape hatch in the push-protection UI should be used only
for a value you have confirmed is not a credential, and the same value should
then be added to `policy/secrets-allowlist.json` with a reason so the local
scan stops asking.
