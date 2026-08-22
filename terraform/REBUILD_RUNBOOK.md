# Rebuild From Zero Runbook

Step-by-step procedure to rebuild the entire infrastructure from nothing.

**Estimated time**: ~45 minutes (excluding DNS propagation)

**Prerequisites**:

- AWS CLI configured with admin access
- Terraform >= 1.5.0 installed
- kubectl installed
- Helm 3.x installed
- Access to the GitHub repository secrets

## Phase 1: State Backend (5 minutes)

```bash
# Bootstrap the state backend for all environments
export AWS_PROFILE=stellar-marketpay
export AWS_REGION=us-east-1

bash terraform/scripts/bootstrap-state.sh development
bash terraform/scripts/bootstrap-state.sh staging
bash terraform/scripts/bootstrap-state.sh production
```

## Phase 2: Development Environment (15 minutes)

```bash
cd terraform/environments/development

# Initialize and deploy
terraform init -backend-config=backend.hcl
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars

# Configure kubectl
aws eks update-kubeconfig --name development-stellar-marketpay --region us-east-1

# Verify cluster
kubectl get nodes
kubectl get pods -A
```

### Install platform components

```bash
# NGINX Ingress Controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true

# Argo Rollouts
helm repo add argo https://argoproj.github.io/argo-helm
helm install argo-rollouts argo/argo-rollouts \
  --namespace argo-rollouts --create-namespace

# External Secrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace

# K8GB (GSLB)
helm repo add k8gb https://k8gb.io
helm install k8gb k8gb/k8gb \
  --namespace k8gb --create-namespace
```

### Deploy application

```bash
# Apply Kustomize manifests
kubectl apply -k k8s/overlays/primary

# Verify
kubectl get rollouts -n stellar-marketpay
kubectl get ingress -n stellar-marketpay
kubectl get externalsecrets -n stellar-marketpay
```

## Phase 3: Staging Environment (15 minutes)

```bash
cd terraform/environments/staging

terraform init -backend-config=backend.hcl
terraform apply -var-file=terraform.tfvars

aws eks update-kubeconfig --name staging-stellar-marketpay --region us-east-1

# Install platform components (same as development)
kubectl apply -k k8s/overlays/primary
```

## Phase 4: Production Environment (15 minutes)

```bash
cd terraform/environments/production

terraform init -backend-config=backend.hcl
terraform plan -var-file=terraform.tfvars
# Manual approval required via GitHub environment gate
terraform apply -var-file=terraform.tfvars

aws eks update-kubeconfig --name production-stellar-marketpay --region us-east-1

# Install platform components
kubectl apply -k k8s/overlays/primary
kubectl apply -k k8s/overlays/secondary
```

## Phase 5: Verification

```bash
# DNS
dig marketpay.example.com +short

# Health checks
curl -s https://marketpay.example.com/api/health

# Monitoring
kubectl get pods -n monitoring
curl -s http://prometheus:9090/api/v1/targets | jq '.data.activeTargets[] | select(.health=="up") | .scrapeUrl' | wc -l

# Drift check
bash terraform/scripts/detect-drift.sh production
```

## Rollback Procedure

If something fails during rebuild:

1. **Terraform**: `terraform destroy -var-file=terraform.tfvars` in the affected environment
2. **Kubernetes**: `kubectl delete -k k8s/overlays/primary` to remove app resources
3. **State**: State is preserved in S3 — re-run `terraform init` to reconnect

## Timing Results

| Phase                   | Duration    |
| ----------------------- | ----------- |
| State backend bootstrap | 5 min       |
| Development environment | 15 min      |
| Staging environment     | 15 min      |
| Production environment  | 15 min      |
| Verification            | 5 min       |
| **Total**               | **~55 min** |
