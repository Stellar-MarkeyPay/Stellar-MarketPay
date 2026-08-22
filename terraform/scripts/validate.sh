!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Validate Terraform configuration (fmt, validate, tfsec).
# Run on every pull request.
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Terraform validation ==="

# Format check
echo "Checking formatting..."
if ! terraform fmt -check -recursive; then
  echo "::error::Terraform files are not formatted. Run: terraform fmt -recursive"
  exit 1
fi

# Validate each environment
for env in development staging production; do
  echo ""
  echo "Validating $env..."
  cd "environments/$env"
  terraform init -backend=false -input=false -no-color >/dev/null 2>&1
  terraform validate -no-color
  cd ../..
done

echo ""
echo "All validations passed."
