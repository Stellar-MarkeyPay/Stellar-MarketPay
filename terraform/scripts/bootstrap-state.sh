!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Bootstrap the Terraform remote state backend.
# Run this ONCE before any `terraform init`.
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

ENVIRONMENT="${1:?Usage: bootstrap-state.sh <environment>}"
REGION="${AWS_REGION:-us-east-1}"
BUCKET="stellar-marketpay-terraform-state"
LOCK_TABLE="stellar-marketpay-terraform-locks"

echo "Bootstrapping state for: $ENVIRONMENT"

# S3 bucket
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Creating S3 bucket: $BUCKET"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"

  aws s3api put-bucket-versioning \
    --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled

  aws s3api put-bucket-encryption \
    --bucket "$BUCKET" \
    --server-side-encryption-configuration '{
      "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]
    }'

  aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,BlockPublicPolicy=true,IgnorePublicAcls=true,RestrictPublicBuckets=true"

  echo "S3 bucket created and configured."
else
  echo "S3 bucket already exists."
fi

# DynamoDB lock table
if ! aws dynamodb describe-table --table-name "$LOCK_TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "Creating DynamoDB table: $LOCK_TABLE"
  aws dynamodb create-table \
    --table-name "$LOCK_TABLE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION"

  echo "DynamoDB table created."
else
  echo "DynamoDB table already exists."
fi

echo ""
echo "State backend bootstrapped. Now run:"
echo "  cd terraform/environments/$ENVIRONMENT"
echo "  terraform init -backend-config=backend.hcl"
echo "  terraform plan -var-file=terraform.tfvars"
echo "  terraform apply -var-file=terraform.tfvars"
