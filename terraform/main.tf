# ──────────────────────────────────────────────────────────────────────
# Stellar MarketPay — Terraform Root Module
# Issue #263: Define the whole infrastructure as code with Terraform
# ──────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "stellar-marketpay"
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "Stellar-MarkeyPay/Stellar-MarketPay"
    }
  }
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)

    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 3)
}

module "vpc" {
  source = "./modules/vpc"

  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = local.azs
}

module "eks" {
  source = "./modules/eks"

  environment         = var.environment
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  node_instance_types = var.eks_node_instance_types
  node_desired_size   = var.eks_node_desired_size
  node_min_size       = var.eks_node_min_size
  node_max_size       = var.eks_node_max_size
}

module "rds" {
  source = "./modules/rds"

  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  eks_security_group = module.eks.node_security_group_id
  db_name            = var.db_name
  db_username        = var.db_username
  db_instance_class  = var.db_instance_class
  db_engine_version  = var.db_engine_version
  db_multi_az        = var.db_multi_az
  db_backup_retention = var.db_backup_retention
}

module "redis" {
  source = "./modules/redis"

  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  eks_security_group = module.eks.node_security_group_id
  node_type          = var.redis_node_type
}

module "s3" {
  source = "./modules/s3"

  environment = var.environment
  account_id  = local.account_id
}

module "route53" {
  source = "./modules/route53"

  environment    = var.environment
  domain_name    = var.domain_name
  alb_dns_name   = module.eks.alb_dns_name
  alb_zone_id    = module.eks.alb_zone_id
}

module "secrets" {
  source = "./modules/secrets"

  environment        = var.environment
  region             = var.aws_region
  db_name            = var.db_name
  db_username        = var.db_username
  db_host            = module.rds.endpoint
  db_port            = module.rds.port
  redis_host         = module.redis.endpoint
  redis_port         = module.redis.port
}
