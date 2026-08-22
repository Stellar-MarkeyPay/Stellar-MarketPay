output "cluster_name" {
  value = aws_eks_cluster.main.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.main.endpoint
}

output "cluster_ca_certificate" {
  value = aws_eks_cluster.main.certificate_authority[0].data
}

output "cluster_security_group_id" {
  value = aws_security_group.eks_cluster.id
}

output "node_security_group_id" {
  value = aws_security_group.eks_nodes.id
}

output "node_role_arn" {
  value = aws_iam_role.eks_nodes.arn
}

output "alb_dns_name" {
  value = "PLACEHOLDER_ALB_DNS"
}

output "alb_zone_id" {
  value = "PLACEHOLDER_ALB_ZONE_ID"
}
