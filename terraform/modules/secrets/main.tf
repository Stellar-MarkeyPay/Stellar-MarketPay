data "aws_caller_identity" "current" {}

resource "helm_release" "external_secrets" {
  name       = "external-secrets"
  repository = "https://charts.external-secrets.io"
  chart      = "external-secrets"
  version    = "0.9.13"
  namespace  = "external-secrets"

  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }
}

resource "kubernetes_namespace" "app" {
  metadata {
    name = "stellar-marketpay"

    labels = {
      environment = var.environment
    }
  }

  depends_on = [helm_release.external_secrets]
}

resource "aws_secretsmanager_secret" "backend" {
  name                    = "${var.environment}/stellar-marketpay/backend"
  recovery_window_in_days = var.environment == "production" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "backend" {
  secret_id = aws_secretsmanager_secret.backend.id
  secret_string = jsonencode({
    DATABASE_URL          = "postgresql://${var.db_username}:${var.db_host}:${var.db_port}/${var.db_name}"
    REDIS_URL             = "redis://${var.redis_host}:${var.redis_port}"
    JWT_SECRET            = "CHANGE_ME_IN_PRODUCTION"
    CONTRACT_ID           = ""
    PINATA_API_KEY        = ""
    PINATA_SECRET_KEY     = ""
    CLOUDFLARE_ZONE_ID    = ""
    CLOUDFLARE_API_TOKEN  = ""
    FASTLY_SERVICE_ID     = ""
    FASTLY_API_TOKEN      = ""
    CDN_WEBHOOK_SECRET    = ""
  })
}

resource "kubernetes_manifest" "cluster_secret_store" {
  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ClusterSecretStore"
    metadata = {
      name = "marketpay-global-secrets"
    }
    spec = {
      provider = {
        aws = {
          service = "SecretsManager"
          region  = var.region
          auth = {
            jwt = {
              serviceAccountRef = {
                name      = "external-secrets"
                namespace = "external-secrets"
              }
            }
          }
        }
      }
    }
  }

  depends_on = [helm_release.external_secrets]
}

resource "kubernetes_manifest" "backend_external_secret" {
  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "marketpay-backend-secrets"
      namespace = "stellar-marketpay"
    }
    spec = {
      refreshInterval = "5m"
      secretStoreRef = {
        name = "marketpay-global-secrets"
        kind = "ClusterSecretStore"
      }
      target = {
        name           = "backend-secrets"
        creationPolicy = "Owner"
      }
      data = [
        {
          secretKey = "DATABASE_URL"
          remoteRef = {
            key      = aws_secretsmanager_secret.backend.name
            property = "DATABASE_URL"
          }
        },
        {
          secretKey = "JWT_SECRET"
          remoteRef = {
            key      = aws_secretsmanager_secret.backend.name
            property = "JWT_SECRET"
          }
        }
      ]
    }
  }

  depends_on = [kubernetes_namespace.app, kubernetes_manifest.cluster_secret_store]
}
