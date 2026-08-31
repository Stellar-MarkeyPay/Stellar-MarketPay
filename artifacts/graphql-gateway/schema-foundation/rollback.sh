#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PATCH="$ROOT/artifacts/graphql-gateway/schema-foundation/graphql-schema-foundation.patch"
ARTIFACT_DIR="artifacts/graphql-gateway/schema-foundation"

cd "$ROOT"

if [[ "${1:-}" == "--check" ]]; then
  git apply --reverse --check "$PATCH"
  echo "Rollback check passed: the functional patch can be reversed cleanly."
  exit 0
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Rollback requires a clean tracked worktree. Commit or stash tracked changes first." >&2
  exit 1
fi

git apply --reverse "$PATCH"
git rm -r --ignore-unmatch -- "$ARTIFACT_DIR"
echo "GraphQL schema-foundation changes were reversed. Review and commit the rollback."
