resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.environment}-redis-subnet"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.environment}-redis-"
  vpc_id      = var.vpc_id
  description = "Redis security group"

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.eks_security_group]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.environment}-redis-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${var.environment}-stellar-marketpay"
  engine               = "redis"
  node_type            = var.node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  tags = {
    Name = "${var.environment}-redis"
  }
}
