# ServalSheets Terraform Deployment

Enterprise-grade infrastructure as code for deploying ServalSheets.

## Modules

### AWS (ECS Fargate)

Full production deployment on AWS using:

- **ECS Fargate** - Serverless container orchestration
- **Application Load Balancer** - HTTPS termination and health checks
- **Auto Scaling** - CPU and memory-based scaling (2-10 instances)
- **Secrets Manager** - Secure credential storage
- **CloudWatch** - Logging and monitoring
- **VPC** - Isolated network with public/private subnets

### GCP (Cloud Run)

Full production deployment on GCP using:

- **Cloud Run** - Serverless container platform
- **Secret Manager** - Secure credential storage
- **Custom Domain Mapping** - Optional custom domain support
- **Auto Scaling** - Request-based scaling (1-10 instances)

## Prerequisites

1. **Terraform** >= 1.5.0
2. **Cloud Provider CLI**
   - AWS: `aws configure`
   - GCP: `gcloud auth application-default login`
3. **Container Image** - ServalSheets image pushed to a registry
4. **Google Service Account** - With Sheets API access
5. **OAuth Credentials** - Google OAuth 2.0 client

## Quick Start

### AWS

```bash
cd deployment/terraform/aws

# Create terraform.tfvars
cat > terraform.tfvars << EOF
environment                    = "prod"
region                         = "us-east-1"
container_image                = "ghcr.io/khill1269/servalsheets:1.6.0"
domain_name                    = "sheets.example.com"
certificate_arn                = "arn:aws:acm:us-east-1:123456789:certificate/xxx"
google_credentials_secret_arn  = "arn:aws:secretsmanager:us-east-1:123456789:secret:google-creds"
oauth_client_id                = "your-client-id"
oauth_client_secret            = "your-client-secret"
EOF

# Deploy
terraform init
terraform plan
terraform apply
```

### GCP

```bash
cd deployment/terraform/gcp

# Create terraform.tfvars
cat > terraform.tfvars << EOF
project_id           = "your-project-id"
region               = "us-central1"
environment          = "prod"
container_image      = "gcr.io/your-project/servalsheets:1.6.0"
domain_name          = "sheets.example.com"
service_account_json = file("path/to/service-account.json")
oauth_client_id      = "your-client-id"
oauth_client_secret  = "your-client-secret"
EOF

# Deploy
terraform init
terraform plan
terraform apply
```

## Configuration

### AWS Variables

| Variable          | Description         | Default       |
| ----------------- | ------------------- | ------------- |
| `environment`     | Environment name    | `prod`        |
| `region`          | AWS region          | `us-east-1`   |
| `vpc_cidr`        | VPC CIDR block      | `10.0.0.0/16` |
| `container_image` | Container image     | -             |
| `desired_count`   | Desired task count  | `2`           |
| `cpu`             | Task CPU units      | `512`         |
| `memory`          | Task memory (MB)    | `1024`        |
| `domain_name`     | Domain name         | -             |
| `certificate_arn` | ACM certificate ARN | -             |

### GCP Variables

| Variable          | Description              | Default       |
| ----------------- | ------------------------ | ------------- |
| `project_id`      | GCP project ID           | -             |
| `region`          | GCP region               | `us-central1` |
| `environment`     | Environment name         | `prod`        |
| `container_image` | Container image          | -             |
| `min_instances`   | Minimum instances        | `1`           |
| `max_instances`   | Maximum instances        | `10`          |
| `cpu`             | CPU allocation           | `1`           |
| `memory`          | Memory allocation        | `1Gi`         |
| `domain_name`     | Custom domain (optional) | `""`          |

## Architecture

### AWS

```
┌─────────────────────────────────────────────────────────────┐
│                          VPC                                │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │    Public Subnets    │  │      Private Subnets         │ │
│  │  ┌────────────────┐  │  │  ┌────────────────────────┐  │ │
│  │  │      ALB       │  │  │  │    ECS Fargate Tasks   │  │ │
│  │  │  (HTTPS/HTTP)  │──┼──┼──│   ┌────┐  ┌────┐      │  │ │
│  │  └────────────────┘  │  │  │   │Task│  │Task│ ...  │  │ │
│  │         │            │  │  │   └────┘  └────┘      │  │ │
│  │  ┌────────────────┐  │  │  └────────────────────────┘  │ │
│  │  │  NAT Gateway   │  │  │              │               │ │
│  │  └────────────────┘  │  │              ▼               │ │
│  └──────────────────────┘  │     Google Sheets API        │ │
│                            └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### GCP

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

## Security Considerations

1. **Secrets** - All credentials stored in cloud secret managers
2. **Network** - Private subnets for workloads (AWS)
3. **IAM** - Least privilege service accounts
4. **TLS** - HTTPS enforced with automatic certificate management
5. **Scaling** - Auto-scaling with defined limits

## Monitoring

### AWS

- CloudWatch Logs: `/ecs/servalsheets-{env}`
- Container Insights enabled by default
- ALB access logs (configure S3 bucket)

### GCP

- Cloud Logging: Automatic from Cloud Run
- Cloud Monitoring: Built-in metrics
- Error Reporting: Automatic exception tracking

## Cost Optimization

### AWS

- Use Fargate Spot for non-production
- Right-size CPU/memory based on actual usage
- Enable auto-scaling with appropriate thresholds

### GCP

- Use CPU idle mode (enabled by default)
- Set appropriate min instances (0 for dev)
- Use committed use discounts for production

## Troubleshooting

### AWS

```bash
# Check task status
aws ecs describe-tasks --cluster servalsheets-prod-cluster --tasks $(aws ecs list-tasks --cluster servalsheets-prod-cluster --query 'taskArns[0]' --output text)

# View logs
aws logs tail /ecs/servalsheets-prod --follow
```

### GCP

```bash
# Check service status
gcloud run services describe servalsheets-prod --region us-central1

# View logs
gcloud run services logs read servalsheets-prod --region us-central1 --limit 100
```

## License

MIT
