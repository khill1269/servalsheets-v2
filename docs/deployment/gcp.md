---
title: GCP Deployment (Terraform)
category: general
last_updated: 2026-01-31
description: Deploy ServalSheets on Google Cloud using Cloud Run with Terraform.
version: 1.6.0
tags: [deployment, sheets]
---

# GCP Deployment (Terraform)

Deploy ServalSheets on Google Cloud using Cloud Run with Terraform.

## Architecture

```
┌───────────────────────────────────────────────────────┐
│                    Cloud Run                          │
│  ┌─────────────────────────────────────────────────┐  │
│  │              Managed Instances                  │  │
│  │    ┌────────┐  ┌────────┐  ┌────────┐          │  │
│  │    │Instance│  │Instance│  │Instance│  ...     │  │
│  │    └────────┘  └────────┘  └────────┘          │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                              │
│                        ▼                              │
│              Google Sheets API                        │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │             Secret Manager                       │  │
│  │  • Google Credentials  • OAuth Secrets          │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

## Prerequisites

- GCP project with billing enabled
- gcloud CLI configured
- Terraform 1.5+

## Quick Start

```bash
cd deployment/terraform/gcp

# Create terraform.tfvars
cat > terraform.tfvars << EOF
project_id           = "your-project-id"
region               = "us-central1"
environment          = "prod"
container_image      = "gcr.io/your-project/servalsheets:1.6.0"
domain_name          = "sheets.example.com"
oauth_client_id      = "your-client-id"
oauth_client_secret  = "your-client-secret"
EOF

# Add service account JSON
echo 'service_account_json = <<EOF
{
  "type": "service_account",
  ...
}
EOF' >> terraform.tfvars

# Deploy
terraform init
terraform plan
terraform apply
```

## Resources Created

| Resource          | Description                     |
| ----------------- | ------------------------------- |
| Cloud Run Service | Serverless container deployment |
| Secret Manager    | Secure credential storage       |
| Service Account   | IAM for the service             |
| Domain Mapping    | Custom domain (optional)        |

## Configuration

### Variables

| Variable        | Description       | Default       |
| --------------- | ----------------- | ------------- |
| `project_id`    | GCP project ID    | Required      |
| `region`        | GCP region        | `us-central1` |
| `min_instances` | Minimum instances | `1`           |
| `max_instances` | Maximum instances | `10`          |
| `cpu`           | CPU allocation    | `1`           |
| `memory`        | Memory allocation | `1Gi`         |

### Scaling

Cloud Run automatically scales based on:

- Concurrent requests
- CPU utilization
- Custom metrics

```hcl
scaling {
  min_instance_count = 1
  max_instance_count = 10
}
```

## Operations

### View Logs

```bash
gcloud run services logs read servalsheets-prod \
  --region us-central1 \
  --limit 100
```

### Update Image

```bash
gcloud run deploy servalsheets-prod \
  --image gcr.io/your-project/servalsheets:1.7.0 \
  --region us-central1
```

### View Service

```bash
gcloud run services describe servalsheets-prod \
  --region us-central1
```

## Custom Domain

```bash
# Map domain
gcloud run domain-mappings create \
  --service servalsheets-prod \
  --domain sheets.example.com \
  --region us-central1

# Get DNS records
gcloud run domain-mappings describe \
  --domain sheets.example.com \
  --region us-central1
```

## Cost Estimate

Cloud Run is **usage-based**:

| Usage                | Monthly Cost |
| -------------------- | ------------ |
| Light (1000 req/day) | ~$1-5        |
| Medium (10K req/day) | ~$10-30      |
| Heavy (100K req/day) | ~$50-100     |

Key factors:

- CPU seconds used
- Memory GB-seconds
- Request count
- Minimum instances (if set > 0)

## Advantages over AWS

- **Simpler setup** - No VPC/NAT required
- **Lower cost** - Scale to zero
- **Faster cold starts** - ~100ms
- **Native Google integration** - Same project as Sheets API

## Next Steps

- [AWS](./aws) - ECS Fargate alternative
- [Monitoring](./monitoring) - Cloud Monitoring setup
