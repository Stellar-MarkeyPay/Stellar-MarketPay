#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
PATCH="$ROOT/artifacts/enterprise-federation/foundation/enterprise-federation-foundation.patch"
case "${1:---check}" in
  --check)
    git -C "$ROOT" apply --reverse --check "$PATCH"
    echo "Rollback check passed: the enterprise federation foundation patch can be reversed."
    ;;
  --apply)
    git -C "$ROOT" apply --reverse "$PATCH"
    echo "Enterprise federation foundation source changes rolled back."
    ;;
  *)
    echo "usage: $0 [--check|--apply]" >&2
    exit 2
    ;;
esac
