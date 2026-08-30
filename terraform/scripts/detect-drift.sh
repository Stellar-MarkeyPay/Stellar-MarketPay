!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Drift detection — compares live infrastructure against Terraform state.
# Exits non-zero if drift is detected. Run via CI on a daily cron.
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

ENVIRONMENT="${1:?Usage: detect-drift.sh <environment>}"
TF_DIR="$(dirname "$0")/../environments/$ENVIRONMENT"

echo "=== Drift detection for: $ENVIRONMENT ==="

cd "$TF_DIR"

terraform init -backend-config=backend.hcl -input=false -no-color 2>&1

OUTPUT=$(terraform plan -detailed-exitcode -input=false -no-color 2>&1) || EXIT_CODE=$?

case "${EXIT_CODE:-0}" in
  0)
    echo "No drift detected."
    ;;
  2)
    echo "DRIFT DETECTED!"
    echo ""
    echo "$OUTPUT"
    echo ""
    echo "::error::Infrastructure drift detected in $ENVIRONMENT. Apply Terraform to reconcile."
    exit 1
    ;;
  *)
    echo "Terraform plan failed."
    echo "$OUTPUT"
    exit 1
    ;;
esac
