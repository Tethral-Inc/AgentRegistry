variable "account_id" { type = string }
variable "api_token" { type = string; sensitive = true }

terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare"; version = "~> 4.0" }
  }
}

provider "cloudflare" { api_token = var.api_token }

resource "cloudflare_workers_kv_namespace" "skill_cache" {
  account_id = var.account_id
  title      = "acr-skill-cache"
}
resource "cloudflare_workers_kv_namespace" "threat_state" {
  account_id = var.account_id
  title      = "acr-threat-state"
}
resource "cloudflare_workers_kv_namespace" "system_health_cache" {
  account_id = var.account_id
  title      = "acr-system-health-cache"
}
resource "cloudflare_workers_kv_namespace" "rate_limits" {
  account_id = var.account_id
  title      = "acr-rate-limits"
}
resource "cloudflare_workers_kv_namespace" "skill_version" {
  account_id = var.account_id
  title      = "acr-skill-version"
}

resource "cloudflare_r2_bucket" "receipt_archives" {
  account_id = var.account_id
  name       = "acr-receipt-archives"
}

output "kv_ids" {
  value = {
    skill_cache   = cloudflare_workers_kv_namespace.skill_cache.id
    threat_state  = cloudflare_workers_kv_namespace.threat_state.id
    system_health = cloudflare_workers_kv_namespace.system_health_cache.id
    rate_limits   = cloudflare_workers_kv_namespace.rate_limits.id
    skill_version = cloudflare_workers_kv_namespace.skill_version.id
  }
}
