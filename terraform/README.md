# Infrastructure as Code with Terraform

Issue #263: Define the whole infrastructure as code with Terraform.

## Overview

All cloud infrastructure is defined in Terraform under `terraform/`. The
configuration uses AWS as the cloud provider with reusable modules and
separate environment configurations for development, staging, and production.

## Directory Structure

```
terraform/
  main.tf                    # Root module — provider config, module invocations
  variables.tf               # Input variables
  outputs.tf                 # Output values
  modules/
    vpc/                     # VPC, subnets, NAT, flow logs
    eks/                     # EKS cluster, node groups, IAM
    rds/                     # PostgreSQL (RDS), secrets
    redis/                   # ElastiCache Redis
    s3/                      # State bucket + DynamoDB lock table
    route53/                 # DNS, ACM certificates
    secrets/                 # External Secrets Operator + vault integration
  environments/
    development/             # Dev tfvars + backend config
    staging/                 # Staging tfvars + backend config
    production/              # Production tfvars + backend config
  scripts/
    bootstrap-state.sh       # One-time state backend setup
    detect-drift.sh          # Daily drift detection
    validate.sh              # CI validation (fmt, validate)
```

## Quick Start

### 1. Bootstrap state backend (once)

```bash
export AWS_PROFILE=stellar-marketpay
bash terraform/scripts/bootstrap-state.sh development
```

### 2. Deploy an environment

```bash
cd terraform/environments/development
terraform init -backend-config=backend.hcl
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

### 3. Configure kubectl

```bash
aws eks update-kubeconfig --name development-stellar-marketpay --region us-east-1
```

## Environments

| Environment | VPC CIDR    | EKS Nodes | RDS Class    | Redis Class    | Multi-AZ |
| ----------- | ----------- | --------- | ------------ | -------------- | -------- |
| development | 10.0.0.0/16 | 1-5       | db.t3.medium | cache.t3.micro | No       |
| staging     | 10.1.0.0/16 | 2-8       | db.t3.large  | cache.t3.small | Yes      |
| production  | 10.2.0.0/16 | 3-20      | db.r5.xlarge | cache.r5.large | Yes      |

## Remote State

- **Backend**: S3 with DynamoDB locking
- **Bucket**: `stellar-marketpay-terraform-state-<env>`
- **Lock table**: `stellar-marketpay-terraform-locks`
- **Encryption**: AES-256 (S3) + KMS (at rest)

## Secrets Management

- Secrets stored in AWS Secrets Manager
- External Secrets Operator syncs to Kubernetes Secrets
- ClusterSecretStore `marketpay-global-secrets` connects both layers
- No credentials stored in plain text in Terraform state or code

## CI/CD Automation

| Event                       | Action                                            |
| --------------------------- | ------------------------------------------------- |
| Pull request (terraform/**) | Validate + Plan for all environments              |
| Push to main (terraform/**) | Apply to dev + staging (parallel, dev first)      |
| Push to main (terraform/**) | Apply to production (after dev + staging succeed) |
| Daily cron (06:00 UTC)      | Drift detection on all environments               |

### Production approvals

Production apply requires a GitHub environment approval gate. The workflow
waits for dev and staging to succeed before proceeding.

## Drift Detection

Run manually:

```bash
bash terraform/scripts/detect-drift.sh development
```

Automated via `terraform.yml` workflow on a daily cron schedule. Drift alerts
are sent to Discord when detected.

## Cost Estimation

Before applying, review the plan output for cost information. The RDS and
ElastiCache instance classes directly impact monthly costs. Use smaller
instances in development to minimize costs.

## Rebuild from Zero

See `terraform/REBUILD_RUNBOOK.md` for the full procedure to rebuild the
entire infrastructure from scratch.
