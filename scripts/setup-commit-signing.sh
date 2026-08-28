#!/usr/bin/env bash
#
# scripts/setup-commit-signing.sh
#
# One-time commit-signing enrolment.
#
# Signing is a policy this repository intends to enforce server-side, and a
# security control that contributors have to configure is a control that
# quietly does not exist. This script makes enrolment a single command:
# it finds or creates an SSH signing key, configures git to use it, writes the
# allowed-signers file so `git log --show-signature` verifies locally, and
# prints the one manual step — uploading the public key to GitHub.
#
#   npm run policy:signing-setup            # SSH signing (recommended)
#   npm run policy:signing-setup -- --gpg   # GPG, if you already use it
#
# See docs/COMMIT_SIGNING.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METHOD="ssh"
KEY="${SIGNING_KEY:-$HOME/.ssh/id_ed25519_signing}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh) METHOD="ssh" ;;
    --gpg) METHOD="gpg" ;;
    --key) KEY="$2"; shift ;;
    -h|--help) sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '\n%s\n' "$*"; }

if [ "$METHOD" = "gpg" ]; then
  command -v gpg >/dev/null 2>&1 || { echo "gpg is not installed." >&2; exit 2; }
  keyid="$(gpg --list-secret-keys --keyid-format=long 2>/dev/null \
    | awk '/^sec/ {split($2, a, "/"); print a[2]; exit}')"
  if [ -z "$keyid" ]; then
    say "No GPG secret key found. Create one with:"
    echo "  gpg --full-generate-key      # choose ed25519, no expiry shorter than a year"
    echo "Then re-run this script."
    exit 1
  fi
  git -C "$ROOT" config user.signingkey "$keyid"
  git -C "$ROOT" config gpg.format openpgp
  git -C "$ROOT" config commit.gpgsign true
  git -C "$ROOT" config tag.gpgsign true
  say "Configured GPG signing with key $keyid."
  say "Upload the public key to GitHub (Settings → SSH and GPG keys → New GPG key):"
  echo
  gpg --armor --export "$keyid"
  exit 0
fi

# SSH signing. Preferred: most contributors already have an SSH key workflow,
# git verifies it with no keyserver, and GitHub accepts the same key for
# signing and for authentication.
command -v ssh-keygen >/dev/null 2>&1 || { echo "ssh-keygen is not installed." >&2; exit 2; }

git_version="$(git --version | awk '{print $3}')"
case "$git_version" in
  1.*|2.[0-9].*|2.1[0-9].*|2.2[0-9].*|2.3[0-3].*)
    echo "SSH signing needs git >= 2.34 (found $git_version). Upgrade git, or use --gpg." >&2
    exit 2
    ;;
esac

if [ ! -f "$KEY" ]; then
  say "Creating a signing key at $KEY"
  ssh-keygen -t ed25519 -C "$(git config user.email) (commit signing)" -f "$KEY"
fi

git -C "$ROOT" config gpg.format ssh
git -C "$ROOT" config user.signingkey "$KEY.pub"
git -C "$ROOT" config commit.gpgsign true
git -C "$ROOT" config tag.gpgsign true

# Without an allowed-signers file, `git log --show-signature` reports every
# signature as untrusted — including your own — which trains people to ignore
# the warning the policy engine prints.
ALLOWED="$HOME/.config/git/allowed_signers"
mkdir -p "$(dirname "$ALLOWED")"
email="$(git -C "$ROOT" config user.email)"
entry="$email $(cat "$KEY.pub")"
if ! grep -qxF "$entry" "$ALLOWED" 2>/dev/null; then
  printf '%s\n' "$entry" >> "$ALLOWED"
fi
git -C "$ROOT" config gpg.ssh.allowedSignersFile "$ALLOWED"

say "Configured SSH commit signing."
echo "  key:             $KEY.pub"
echo "  allowed signers: $ALLOWED"

say "One manual step remains — add the key to GitHub TWICE:"
echo "  Settings → SSH and GPG keys → New SSH key"
echo "    1. Key type: 'Signing Key'   (this is what verifies your commits)"
echo "    2. Key type: 'Authentication Key'  (optional, if you also push over SSH)"
echo
cat "$KEY.pub"

say "Verify it works:"
echo "  git commit --allow-empty -m 'chore(hooks): verify signing' && git log --show-signature -1"
echo "  npm run policy:check      # the signed-commits rule should stop warning"
