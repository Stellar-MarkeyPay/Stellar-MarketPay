# Commit Signing

Author identity in git is a self-declared string. `git config user.email` takes
whatever you type. For a repository whose code holds escrowed funds, "who
wrote the change that moved the money" needs an answer that survives scrutiny,
and a signature is that answer.

## Enrol once

```bash
npm run policy:signing-setup          # SSH signing (recommended)
npm run policy:signing-setup -- --gpg # GPG, if you already use it
```

The script creates a signing key if you do not have one, configures git to
sign every commit and tag, writes the allowed-signers file so
`git log --show-signature` verifies locally, and prints the public key to
upload.

Then, in GitHub → Settings → SSH and GPG keys → **New SSH key**, add the
printed key with key type **Signing Key**. This is separate from an
authentication key; GitHub will accept the same key material for both, but the
signing entry is what makes your commits show as Verified.

Confirm:

```bash
git commit --allow-empty -m "chore(hooks): verify signing"
git log --show-signature -1
npm run policy:check    # the signed-commits rule should stop warning
```

## Why SSH rather than GPG

Both work; the script supports both. SSH is the default because it needs no
keyserver, no expiry management and no separate agent, and most contributors
already have an SSH key workflow. GPG is better if your organisation already
runs a keyring — in which case you already know that.

Sigstore `gitsign` is a third option, and the right one if you want keyless,
short-lived certificates tied to an OIDC identity. It is not the default here
because it requires an interactive OIDC flow per commit, which is hostile to
the rebase-heavy workflow this repository uses.

## What is verified, and where

The `signed-commits` rule reads git's own `%G?` verification status, so it
reports what the _verifier's_ keyring says rather than what the commit claims:

| Code | Meaning                                | Accepted |
| ---- | -------------------------------------- | -------- |
| `G`  | good signature                         | yes      |
| `U`  | good signature, key not marked trusted | yes      |
| `X`  | good signature, expired                | no       |
| `Y`  | good signature, expired key            | no       |
| `R`  | good signature, revoked key            | no       |
| `B`  | bad signature                          | no       |
| `E`  | cannot check — key missing             | no       |
| `N`  | no signature                           | no       |

Locally the keyring is yours, which is precisely why the local check is a
warning: it can tell you your own signing setup is broken before you push
twenty commits with it, and it cannot tell you anything about anyone else.
Enforcement is server-side.

## Rollout

The rule ships at `warn`, because no commit in this repository's 559-commit
history is signed and turning it on today would block every contributor at
once. The promotion path is written down rather than left to whoever notices:

1. Contributors enrol. `npm run policy:measure` shows the rate falling as they
   do.
2. When the measurement is clean, `signed-commits` moves to `error` at the `ci`
   stage in `policy/policies.json`.
3. `required_signatures` in
   [`.github/branch-protection.json`](../.github/branch-protection.json) moves
   to `true`, and `bash scripts/apply-branch-protection.sh --apply` puts it on
   the server. From that point GitHub itself rejects an unsigned push to a
   protected branch, and the policy rule becomes the thing that tells you _why_
   rather than the thing that stops you.

Step 3 is the one that matters. Steps 1 and 2 are how you get there without a
revolt.

## Re-signing an existing branch

```bash
git rebase --exec "git commit --amend --no-edit -S" origin/main
```

This rewrites the commits, so do it before the branch has been reviewed, or
tell your reviewer.

## What signing does not give you

A signature proves a commit came from a particular key. It does not prove the
key belongs to the person named in the author field, that the holder intended
what the diff does, or that the change was reviewed. It removes one specific
lie — an attacker or a mistake attributing a change to someone who did not
write it — and it makes the audit trail behind
[build provenance](PROVENANCE.md) mean something. It is a foundation, not a
guarantee.
