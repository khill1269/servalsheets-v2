# ServalSheets GCP Terraform Module (Cloud Run)

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

# Variables
variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "container_image" {
  description = "Container image for ServalSheets"
  type        = string
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 10
}

variable "cpu" {
  description = "CPU allocation (e.g., 1, 2, 4)"
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory allocation (e.g., 512Mi, 1Gi, 2Gi)"
  type        = string
  default     = "1Gi"
}

variable "service_account_json" {
  description = "Google service account JSON for Sheets API"
  type        = string
  sensitive   = true
}

variable "oauth_client_id" {
  description = "OAuth client ID"
  type        = string
  sensitive   = true
}

variable "oauth_client_secret" {
  description = "OAuth client secret"
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Custom domain name (optional)"
  type        = string
  default     = ""
}

variable "allow_unauthenticated" {
  description = "Allow unauthenticated access"
  type        = bool
  default     = true
}

# Locals
locals {
  service_name = "servalsheets-${var.environment}"
  common_labels = {
    project     = "servalsheets"
    environment = var.environment
    managed-by  = "terraform"
  }
}

# Enable required APIs
resource "google_project_service" "run" {
  project = var.project_id
  service = "run.googleapis.com"

  disable_dependent_services = false
  disable_on_destroy         = false
}

resource "google_project_service" "secretmanager" {
  project = var.project_id
  service = "secretmanager.googleapis.com"

  disable_dependent_services = false
  disable_on_destroy         = false
}

# Secrets
resource "google_secret_manager_secret" "google_credentials" {
  project   = var.project_id
  secret_id = "${local.service_name}-google-credentials"

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "google_credentials" {
  secret      = google_secret_manager_secret.google_credentials.id
  secret_data = var.service_account_json
}

resource "google_secret_manager_secret" "oauth_client_id" {
  project   = var.project_id
  secret_id = "${local.service_name}-oauth-client-id"

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "oauth_client_id" {
  secret      = google_secret_manager_secret.oauth_client_id.id
  secret_data = var.oauth_client_id
}

resource "google_secret_manager_secret" "oauth_client_secret" {
  project   = var.project_id
  secret_id = "${local.service_name}-oauth-client-secret"

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "oauth_client_secret" {
  secret      = google_secret_manager_secret.oauth_client_secret.id
  secret_data = var.oauth_client_secret
}

resource "google_secret_manager_secret" "session_secret" {
  project   = var.project_id
  secret_id = "${local.service_name}-session-secret"

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.secretmanager]
}

resource "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret_version" "session_secret" {
  secret      = google_secret_manager_secret.session_secret.id
  secret_data = random_password.session_secret.result
}

# Service Account for Cloud Run
resource "google_service_account" "cloud_run" {
  project      = var.project_id
  account_id   = "${local.service_name}-sa"
  display_name = "ServalSheets Cloud Run Service Account"
}

# Grant secret access
resource "google_secret_manager_secret_iam_member" "google_credentials" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.google_credentials.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "oauth_client_id" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.oauth_client_id.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "oauth_client_secret" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.oauth_client_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "session_secret" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.session_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Cloud Run Service
resource "google_cloud_run_v2_service" "main" {
  project  = var.project_id
  name     = local.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.container_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "HTTP_PORT"
        value = "3000"
      }

      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      env {
        name  = "LOG_FORMAT"
        value = "json"
      }

      env {
        name = "OAUTH_REDIRECT_URI"
        value = var.domain_name != "" ? "https://${var.domain_name}/callback" : ""
      }

      env {
        name = "ALLOWED_REDIRECT_URIS"
        value = var.domain_name != "" ? "https://${var.domain_name}/callback" : ""
      }

      env {
        name = "CORS_ALLOWED_ORIGINS"
        value = var.domain_name != "" ? "https://${var.domain_name}" : ""
      }

      env {
        name = "GOOGLE_APPLICATION_CREDENTIALS_JSON"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_credentials.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OAUTH_CLIENT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.oauth_client_id.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OAUTH_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.oauth_client_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "SESSION_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.session_secret.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 3000
        }
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 3000
        }
        initial_delay_seconds = 30
        timeout_seconds       = 5
        period_seconds        = 30
        failure_threshold     = 3
      }
    }

    timeout = "300s"

    labels = local.common_labels
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  labels = local.common_labels

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_version.google_credentials,
    google_secret_manager_secret_version.oauth_client_id,
    google_secret_manager_secret_version.oauth_client_secret,
    google_secret_manager_secret_version.session_secret,
  ]
}

# Allow unauthenticated access (if enabled)
resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.main.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Custom domain mapping (optional)
resource "google_cloud_run_domain_mapping" "main" {
  count    = var.domain_name != "" ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = var.domain_name

  metadata {
    namespace = var.project_id
    labels    = local.common_labels
  }

  spec {
    route_name = google_cloud_run_v2_service.main.name
  }
}

# Outputs
output "service_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.main.uri
}

output "service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_v2_service.main.name
}

output "service_account_email" {
  description = "Service account email"
  value       = google_service_account.cloud_run.email
}

output "domain_status" {
  description = "Custom domain mapping status"
  value       = var.domain_name != "" ? google_cloud_run_domain_mapping.main[0].status : null
}
