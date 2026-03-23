# ServalSheets Helm Chart

Production-grade Google Sheets MCP Server with enterprise features.

## Prerequisites

- Kubernetes 1.23+
- Helm 3.8+
- Google Cloud service account with Sheets API access

## Installation

### Add the repository (when published)

```bash
helm repo add servalsheets https://charts.servalsheets.dev
helm repo update
```

### Install from local chart

```bash
# Create namespace
kubectl create namespace servalsheets

# Create secrets
kubectl create secret generic google-credentials \
  --namespace servalsheets \
  --from-file=service-account.json=/path/to/service-account.json

kubectl create secret generic oauth-secrets \
  --namespace servalsheets \
  --from-literal=client-id=YOUR_CLIENT_ID \
  --from-literal=client-secret=YOUR_CLIENT_SECRET \
  --from-literal=session-secret=$(openssl rand -hex 32)

# Install
helm install servalsheets ./deployment/helm/servalsheets \
  --namespace servalsheets \
  --set google.existingSecret=google-credentials \
  --set oauth.existingSecret=oauth-secrets \
  --set oauth.redirectUri=https://your-domain.com/callback
```

## Configuration

See [values.yaml](./values.yaml) for the full list of configurable parameters.

### Key Parameters

| Parameter                 | Description                      | Default            |
| ------------------------- | -------------------------------- | ------------------ |
| `replicaCount`            | Number of replicas               | `2`                |
| `image.repository`        | Container image                  | `servalsheets`     |
| `image.tag`               | Image tag                        | `Chart.AppVersion` |
| `config.logLevel`         | Log level                        | `info`             |
| `config.httpPort`         | HTTP port                        | `3000`             |
| `autoscaling.enabled`     | Enable HPA                       | `true`             |
| `autoscaling.minReplicas` | Minimum replicas                 | `2`                |
| `autoscaling.maxReplicas` | Maximum replicas                 | `10`               |
| `ingress.enabled`         | Enable ingress                   | `false`            |
| `serviceMonitor.enabled`  | Enable Prometheus ServiceMonitor | `false`            |

### Production Values Example

```yaml
# production-values.yaml
replicaCount: 3

image:
  repository: ghcr.io/khill1269/servalsheets
  tag: '1.6.0'

config:
  logLevel: warn
  corsAllowedOrigins: 'https://your-domain.com'

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: sheets.your-domain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: servalsheets-tls
      hosts:
        - sheets.your-domain.com

oauth:
  existingSecret: oauth-secrets
  redirectUri: https://sheets.your-domain.com/callback
  allowedRedirectUris: https://sheets.your-domain.com/callback

google:
  existingSecret: google-credentials

resources:
  requests:
    cpu: 1000m
    memory: 1Gi
  limits:
    cpu: 4000m
    memory: 4Gi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20

serviceMonitor:
  enabled: true
```

Install with production values:

```bash
helm install servalsheets ./deployment/helm/servalsheets \
  --namespace servalsheets \
  -f production-values.yaml
```

## Upgrading

```bash
helm upgrade servalsheets ./deployment/helm/servalsheets \
  --namespace servalsheets \
  -f production-values.yaml
```

## Uninstalling

```bash
helm uninstall servalsheets --namespace servalsheets
kubectl delete namespace servalsheets
```

## Monitoring

When `serviceMonitor.enabled=true`, metrics are exposed at `/metrics` and can be scraped by Prometheus Operator.

### Key Metrics

- `servalsheets_requests_total` - Total API requests
- `servalsheets_request_duration_seconds` - Request latency histogram
- `servalsheets_google_api_calls_total` - Google Sheets API calls
- `servalsheets_rate_limit_remaining` - Remaining rate limit quota

## Troubleshooting

### Check pod status

```bash
kubectl get pods -n servalsheets
kubectl describe pod -n servalsheets <pod-name>
```

### View logs

```bash
kubectl logs -n servalsheets -l app.kubernetes.io/name=servalsheets -f
```

### Health check

```bash
kubectl exec -n servalsheets deploy/servalsheets -- curl -s localhost:3000/health
```

## License

MIT
