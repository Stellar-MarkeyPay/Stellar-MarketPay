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

variable "db_name" {
  type    = string
  default = "stellarwork"
}

variable "db_username" {
  type    = string
  default = "stellarwork"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.medium"
}

variable "db_engine_version" {
  type    = string
  default = "16.3"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_backup_retention" {
  type    = number
  default = 7
}
