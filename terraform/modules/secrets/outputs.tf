output "namespace" {
  value = kubernetes_namespace.app.metadata[0].name
}

output "backend_secret_arn" {
  value = aws_secretsmanager_secret.backend.arn
}
