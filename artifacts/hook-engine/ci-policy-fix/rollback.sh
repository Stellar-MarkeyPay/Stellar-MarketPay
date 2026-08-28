#!/usr/bin/env sh
set -eu

ROOT=$(git rev-parse --show-toplevel)
PATCH="$ROOT/artifacts/hook-engine/ci-policy-fix/ci-policy-integration.patch"
MODE=${1:---apply}

case "$MODE" in
  --check)
    git -C "$ROOT" apply --check --reverse "$PATCH"
    printf '%s\n' 'Rollback check passed: the CI policy integration patch can be reversed.'
    ;;
  --apply)
    git -C "$ROOT" apply --check --reverse "$PATCH"
    git -C "$ROOT" apply --reverse "$PATCH"
    printf '%s\n' 'Rollback applied: the pre-repair hook and manifest files were restored.'
    ;;
  *)
    printf 'Usage: %s [--check|--apply]\n' "$0" >&2
    exit 2
    ;;
esac
