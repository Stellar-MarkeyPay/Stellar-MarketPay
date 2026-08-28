#!/usr/bin/env bash
#
# scripts/apply-branch-protection.sh
#
# Applies — or audits — the branch protection recorded in
# .github/branch-protection.json.
#
# Server-side settings normally live only in GitHub's UI, where a change
# produces no diff, names no author and survives no review. Keeping the
# intended state in a committed file and reconciling against it turns "who
# turned off the required check, and when" into a question with an answer.
#
#   bash scripts/apply-branch-protection.sh --verify   # report drift, exit 1
#   bash scripts/apply-branch-protection.sh --apply    # reconcile
#
# Requires the gh CLI, authenticated with admin rights on the repository.
# Rationale for each setting: docs/BRANCH_PROTECTION.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/.github/branch-protection.json"
MODE="verify"
REPO="${POLICY_REPO:-}"

usage() {
  sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --verify) MODE="verify" ;;
    --repo) REPO="$2"; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown argument: $1" >&2; usage 1 ;;
  esac
  shift
done

command -v gh >/dev/null 2>&1 || {
  echo "branch-protection: the gh CLI is required (https://cli.github.com)." >&2
  exit 2
}
command -v jq >/dev/null 2>&1 || {
  echo "branch-protection: jq is required." >&2
  exit 2
}
[ -f "$CONFIG" ] || { echo "branch-protection: $CONFIG not found." >&2; exit 2; }

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi
echo "branch-protection: repository $REPO, mode $MODE"

drift=0

for branch in $(jq -r '.branches | keys[]' "$CONFIG"); do
  desired="$(jq -c --arg b "$branch" '.branches[$b] | with_entries(select(.key | startswith("$") | not))' "$CONFIG")"

  # The protection payload and the merge-queue payload are different APIs.
  protection="$(echo "$desired" | jq -c 'del(.merge_queue, .allow_auto_merge)')"

  echo
  echo "── $branch"

  actual="$(gh api "repos/$REPO/branches/$branch/protection" 2>/dev/null || echo '{}')"

  compare() {
    local field="$1" want got
    want="$(echo "$protection" | jq -c --arg f "$field" '.[$f] // null')"
    [ "$want" = "null" ] && return 0
    got="$(echo "$actual" | jq -c --arg f "$field" '
      if $f == "required_status_checks" then
        (.required_status_checks | if . == null then null else {strict, contexts: (.contexts // [] | sort)} end)
      elif $f == "required_pull_request_reviews" then
        (.required_pull_request_reviews | if . == null then null else
          {required_approving_review_count, dismiss_stale_reviews, require_code_owner_reviews} end)
      elif ($f | test("^(enforce_admins|required_signatures|allow_force_pushes|allow_deletions|required_linear_history|block_creations|required_conversation_resolution)$")) then
        (.[$f].enabled // null)
      else .[$f] // null end')"
    if [ "$field" = "required_status_checks" ]; then
      want="$(echo "$want" | jq -c '{strict, contexts: (.contexts | sort)}')"
    fi
    if [ "$want" != "$got" ]; then
      echo "   drift  $field"
      echo "     want: $want"
      echo "     got:  $got"
      drift=1
    else
      echo "   ok     $field"
    fi
  }

  for field in required_status_checks required_pull_request_reviews required_signatures \
               enforce_admins allow_force_pushes allow_deletions required_linear_history \
               required_conversation_resolution; do
    compare "$field"
  done

  if [ "$MODE" = "apply" ]; then
    echo "   applying protection…"
    echo "$protection" | gh api -X PUT "repos/$REPO/branches/$branch/protection" \
      -H "Accept: application/vnd.github+json" --input - >/dev/null
    echo "   applied"

    if [ "$(echo "$desired" | jq -r '.merge_queue.enabled // false')" = "true" ]; then
      # The merge queue is configured through the rulesets/branch settings UI
      # or the GraphQL API depending on plan; the REST surface is not stable
      # across plans, so this is reported rather than silently skipped.
      echo "   NOTE: merge queue must be enabled for '$branch' in repository settings."
      echo "         Desired: $(echo "$desired" | jq -c '.merge_queue | with_entries(select(.key | startswith("$") | not))')"
    fi
    if [ "$(echo "$desired" | jq -r '.allow_auto_merge')" = "false" ]; then
      gh api -X PATCH "repos/$REPO" -f allow_auto_merge=false >/dev/null
      echo "   auto-merge disabled"
    fi
  fi
done

echo
if [ "$MODE" = "verify" ] && [ "$drift" -ne 0 ]; then
  echo "branch-protection: configuration has drifted from .github/branch-protection.json." >&2
  echo "branch-protection: reconcile with: bash scripts/apply-branch-protection.sh --apply" >&2
  exit 1
fi
echo "branch-protection: done"
