---
title: AWS Deployment (Terraform)
category: general
last_updated: 2026-01-31
description: Deploy ServalSheets on AWS using ECS Fargate with Terraform.
version: 1.6.0
tags: [deployment, sheets]
---

# AWS Deployment (Terraform)

Deploy ServalSheets on AWS using ECS Fargate with Terraform.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                          VPC                                │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │    Public Subnets    │  │      Private Subnets         │ │
│  │  ┌────────────────┐  │  │  ┌────────────────────────┐  │ │
│  │  │      ALB       │──┼──┼──│    ECS Fargate Tasks   │  │ │
│  │  └────────────────┘  │  │  └────────────────────────┘  │ │
│  │  ┌────────────────┐  │  │              │               │ │
│  │  │  NAT Gateway   │  │  │              ▼               │ │
│  │  └────────────────┘  │  │     Google Sheets API        │ │
│  └──────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- AWS CLI configured
- Terraform 1.5+
- ACM certificate for HTTPS
- Google service account in Secrets Manager

## Quick Start

```bash
cd deployment/terraform/aws

# Create terraform.tfvars
cat > terraform.tfvars << EOF
environment                    = "prod"
region                         = "us-east-1"
container_image                = "ghcr.io/khill1269/servalsheets:1.6.0"
domain_name                    = "sheets.example.com"
certificate_arn                = "arn:aws:acm:us-east-1:123456789:certificate/xxx"
google_credentials_secret_arn  = "arn:aws:secretsmanager:us-east-1:123456789:secret:google"
oauth_client_id                = "your-client-id"
oauth_client_secret            = "your-client-secret"
EOF

# Deploy
terraform init
terraform plan
terraform apply
```

## Resources Created

| Resource        | Description                                  |
| --------------- | -------------------------------------------- |
| VPC             | Isolated network with public/private subnets |
| ECS Cluster     | Fargate cluster with Container Insights      |
| ALB             | Application Load Balancer with HTTPS         |
| ECS Service     | Auto-scaling Fargate tasks                   |
| Secrets Manager | OAuth credentials storage                    |
| CloudWatch      | Logs and metrics                             |
| IAM             | Task execution and task roles                |

## Configuration

### Variables

| Variable        | Description      | Default     |
| --------------- | ---------------- | ----------- |
| `environment`   | Environment name | `prod`      |
| `region`        | AWS region       | `us-east-1` |
| `desired_count` | Task count       | `2`         |
| `cpu`           | Task CPU units   | `512`       |
| `memory`        | Task memory (MB) | `1024`      |

### Scaling

```hcl
# Auto-scaling based on CPU/memory
resource "aws_appautoscaling_policy" "cpu" {
  target_tracking_scaling_policy_configuration {
    target_value = 70
  }
}
```

## Operations

### View Logs

```bash
aws logs tail /ecs/servalsheets-prod --follow
```

### Update Image

```bash
# Update terraform.tfvars
container_image = "ghcr.io/khill1269/servalsheets:1.7.0"

# Apply
terraform apply
```

### Force Deployment

```bash
aws ecs update-service \
  --cluster servalsheets-prod-cluster \
  --service servalsheets-prod-service \
  --force-new-deployment
```

## Cost Estimate

| Component             | Monthly Cost |
| --------------------- | ------------ |
| ECS Fargate (2 tasks) | ~$30         |
| ALB                   | ~$20         |
| NAT Gateway           | ~$35         |
| CloudWatch            | ~$5          |
| **Total**             | ~$90/month   |

## Next Steps

- [GCP](./gcp) - Cloud Run alternative
- [Monitoring](./monitoring) - CloudWatch dashboards
