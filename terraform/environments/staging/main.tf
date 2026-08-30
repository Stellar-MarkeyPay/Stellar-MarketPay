module "infra" {
  source = "../../"

  environment          = var.environment
  aws_region           = var.aws_region
  vpc_cidr             = var.vpc_cidr
  eks_node_instance_types = var.eks_node_instance_types
  eks_node_desired_size   = var.eks_node_desired_size
  eks_node_min_size       = var.eks_node_min_size
  eks_node_max_size       = var.eks_node_max_size
  db_name                = var.db_name
  db_username            = var.db_username
  db_instance_class      = var.db_instance_class
  db_engine_version      = var.db_engine_version
  db_multi_az            = var.db_multi_az
  db_backup_retention    = var.db_backup_retention
  redis_node_type        = var.redis_node_type
  domain_name            = var.domain_name
}

variable "environment" {
  default = "staging"
}

variable "aws_region" {
  default = "us-east-1"
}

variable "vpc_cidr" {
  default = "10.1.0.0/16"
}

variable "eks_node_instance_types" {
  default = ["t3.large"]
}

variable "eks_node_desired_size" {
  default = 3
}

variable "eks_node_min_size" {
  default = 2
}

variable "eks_node_max_size" {
  default = 8
}

variable "db_name" {
  default = "stellarwork"
}

variable "db_username" {
  default = "stellarwork"
}

variable "db_instance_class" {
  default = "db.t3.large"
}

variable "db_engine_version" {
  default = "16.3"
}

variable "db_multi_az" {
  default = true
}

variable "db_backup_retention" {
  default = 14
}

variable "redis_node_type" {
  default = "cache.t3.small"
}

variable "domain_name" {
  default = "staging.marketpay.example.com"
}
