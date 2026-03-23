# ServalSheets Deployment Guide

Enterprise deployment options for ServalSheets MCP Server.

## Deployment Options

| Method                            | Best For                 | Complexity | Scalability |
| --------------------------------- | ------------------------ | ---------- | ----------- |
| [Docker](#docker)                 | Single server, dev/test  | ⭐         | ⭐⭐        |
| [Docker Compose](#docker-compose) | Small teams, staging     | ⭐⭐       | ⭐⭐        |
| [Kubernetes](#kubernetes)         | Production, multi-tenant | ⭐⭐⭐     | ⭐⭐⭐⭐⭐  |
| [Helm](#helm)                     | K8s with GitOps          | ⭐⭐⭐     | ⭐⭐⭐⭐⭐  |
| [AWS (Terraform)](#aws-terraform) | AWS-native production    | ⭐⭐⭐⭐   | ⭐⭐⭐⭐⭐  |
| [GCP (Terraform)](#gcp-terraform) | GCP-native production    | ⭐⭐⭐⭐   | ⭐⭐⭐⭐⭐  |
| [PM2](#pm2)                       | Node.js process manager  | ⭐⭐       | ⭐⭐⭐      |

## Quick Start

### Docker

```bash
# Build
docker build -t servalsheets:latest .

# Run with service account
docker run -d \
  -p 3000:3000 \
  -v /path/to/service-account.json:/etc/google/service-account.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/etc/google/service-account.json \
  servalsheets:latest
```

### Docker Compose

```bash
# Copy environment file
cp .env.docker.example .env

# Edit with your credentials
vim .env

# Start
docker-compose up -d
```

### Kubernetes

```bash
# Create namespace
kubectl create namespace servalsheets

# Apply manifests
kubectl apply -f deployment/k8s/
```

### Helm

```bash
# Install from local chart
helm install servalsheets ./deployment/helm/servalsheets \
  --namespace servalsheets \
  --create-namespace \
  -f my-values.yaml
```

### AWS (Terraform)

```bash
cd deployment/terraform/aws
terraform init
terraform apply
```

### GCP (Terraform)

```bash
cd deployment/terraform/gcp
terraform init
terraform apply
```

### PM2

```bash
# Install PM2
npm install -g pm2

# Start with ecosystem config
pm2 start deployment/pm2/ecosystem.config.js
```

## Detailed Documentation

| Component  | Documentation                                                           |
| ---------- | ----------------------------------------------------------------------- |
| Docker     | [deployment/docker/](./docker/)                                         |
| Kubernetes | [deployment/k8s/README.md](./k8s/README.md)                             |
| Helm Chart | [deployment/helm/servalsheets/README.md](./helm/servalsheets/README.md) |
| Terraform  | [deployment/terraform/README.md](./terraform/README.md)                 |
| PM2        | [deployment/pm2/](./pm2/)                                               |
| Prometheus | [deployment/prometheus/README.md](./prometheus/README.md)               |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Load Balancer                            │
│                    (ALB / Cloud LB / Ingress)                   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ServalSheets Instances                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Instance 1  │  │  Instance 2  │  │  Instance N  │  ...     │
│  │   (HTTP)     │  │   (HTTP)     │  │   (HTTP)     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│    Google Sheets API    │     │    Redis (Optional)     │
│                         │     │    Session Storage      │
└─────────────────────────┘     └─────────────────────────┘
```

## Security Checklist

- [ ] Use service account with minimal permissions
- [ ] Enable OAuth 2.1 for user authentication
- [ ] Configure HTTPS/TLS termination
- [ ] Set up secret management (K8s Secrets, AWS Secrets Manager, etc.)
- [ ] Enable network policies / security groups
- [ ] Configure rate limiting
- [ ] Set up audit logging
- [ ] Enable Prometheus metrics

## Environment Variables

| Variable                         | Required  | Description                            |
| -------------------------------- | --------- | -------------------------------------- |
| `NODE_ENV`                       | Yes       | Environment (production, development)  |
| `HTTP_PORT`                      | Yes       | HTTP server port (default: 3000)       |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes\*     | Path to service account JSON           |
| `OAUTH_CLIENT_ID`                | For OAuth | Google OAuth client ID                 |
| `OAUTH_CLIENT_SECRET`            | For OAuth | Google OAuth client secret             |
| `SESSION_SECRET`                 | For OAuth | Session encryption secret              |
| `OAUTH_REDIRECT_URI`             | For OAuth | OAuth callback URL                     |
| `CORS_ALLOWED_ORIGINS`           | No        | Allowed CORS origins                   |
| `RATE_LIMIT_WINDOW_MS`           | No        | Rate limit window (default: 60000)     |
| `RATE_LIMIT_MAX_REQUESTS`        | No        | Max requests per window (default: 100) |
| `LOG_LEVEL`                      | No        | Log level (default: info)              |
| `LOG_FORMAT`                     | No        | Log format (json, text)                |
| `REDIS_URL`                      | No        | Redis URL for HA sessions              |

\*Or `GOOGLE_APPLICATION_CREDENTIALS_JSON` for JSON content directly

## Health Checks

All deployments should configure health checks:

| Endpoint       | Purpose    | Expected Response |
| -------------- | ---------- | ----------------- |
| `GET /health`  | Liveness   | `200 OK`          |
| `GET /ready`   | Readiness  | `200 OK`          |
| `GET /metrics` | Prometheus | Metrics payload   |

## Monitoring

### Prometheus + Grafana

```bash
cd deployment/prometheus
docker-compose up -d
```

Access:

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin/admin)
- AlertManager: http://localhost:9093

### Key Metrics

| Metric                                  | Description         |
| --------------------------------------- | ------------------- |
| `servalsheets_requests_total`           | Total API requests  |
| `servalsheets_request_duration_seconds` | Request latency     |
| `servalsheets_google_api_calls_total`   | Google API calls    |
| `servalsheets_rate_limit_remaining`     | Rate limit quota    |
| `servalsheets_errors_total`             | Error count by type |

## Scaling Guidelines

| Load                       | Instances | CPU | Memory |
| -------------------------- | --------- | --- | ------ |
| Light (<100 req/min)       | 1-2       | 0.5 | 512Mi  |
| Medium (100-500 req/min)   | 2-4       | 1   | 1Gi    |
| Heavy (500-2000 req/min)   | 4-10      | 2   | 2Gi    |
| Enterprise (>2000 req/min) | 10+       | 4   | 4Gi    |

## Troubleshooting

### Common Issues

1. **OAuth callback fails**
   - Verify `OAUTH_REDIRECT_URI` matches Google Console
   - Check `ALLOWED_REDIRECT_URIS` includes the callback URL

2. **Rate limit errors**
   - Enable request deduplication
   - Increase `RATE_LIMIT_MAX_REQUESTS`
   - Check Google API quota

3. **Connection timeouts**
   - Verify network egress to Google APIs
   - Check security group / firewall rules

4. **Memory issues**
   - Increase container memory limits
   - Enable response compression

### Debug Commands

```bash
# Check health
curl http://localhost:3000/health

# View logs (Docker)
docker logs servalsheets -f

# View logs (K8s)
kubectl logs -n servalsheets -l app=servalsheets -f

# Check metrics
curl http://localhost:3000/metrics
```

## License

MIT
