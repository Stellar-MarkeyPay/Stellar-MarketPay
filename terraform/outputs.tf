output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "eks_cluster_name" {
  description = "Name of the EKS cluster"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "Endpoint of the EKS cluster"
  value       = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  description = "Endpoint of the RDS PostgreSQL instance"
  value       = module.rds.endpoint
}

output "rds_port" {
  description = "Port of the RDS PostgreSQL instance"
  value       = module.rds.port
}

output "redis_endpoint" {
  description = "Endpoint of the ElastiCache Redis cluster"
  value       = module.redis.endpoint
}

output "redis_port" {
  description = "Port of the ElastiCache Redis cluster"
  value       = module.redis.port
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket"
  value       = module.s3.bucket_name
}

output "route53_zone_id" {
  description = "Route53 hosted zone ID"
  value       = module.route53.zone_id
}

output "secrets_namespace" {
  description = "Kubernetes namespace for External Secrets"
  value       = module.secrets.namespace
}
