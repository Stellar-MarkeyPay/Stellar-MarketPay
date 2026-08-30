variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "eks_security_group" {
  type = string
}

variable "node_type" {
  type    = string
  default = "cache.t3.micro"
}
