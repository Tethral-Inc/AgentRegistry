terraform {
  required_version = ">= 1.7"
  backend "s3" {
    bucket = "tethral-terraform-state"
    key    = "acr/staging/terraform.tfstate"
    region = "us-east-1"
  }
}

variable "cockroach_connection_string" {
  type      = string
  sensitive = true
}
variable "cloudflare_account_id" {
  type = string
}
variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "slack_webhook_url" {
  type      = string
  sensitive = true
}

module "cloudflare" {
  source     = "../../modules/cloudflare"
  account_id = var.cloudflare_account_id
  api_token  = var.cloudflare_api_token
}

module "aws" {
  source                      = "../../modules/aws"
  cockroach_connection_string = var.cockroach_connection_string
  slack_webhook_url           = var.slack_webhook_url
}
