---
title: Helm Chart Deployment
category: general
last_updated: 2026-01-31
description: Deploy ServalSheets using Helm for templated, repeatable Kubernetes deployments.
version: 1.6.0
tags: [deployment, prometheus, kubernetes]
---

# Helm Chart Deployment

Deploy ServalSheets using Helm for templated, repeatable Kubernetes deployments.

## Prerequisites

- Kubernetes 1.23+
- Helm 3.8+

## Installation

### From Local Chart

```bash
# Install
helm install servalsheets ./deployment/helm/servalsheets \
  --namespace servalsheets \
  --create-namespace \
  -f values.yaml
```

### Basic Configuration

Create `values.yaml`:

```yaml
replicaCount: 2

image:
  repository: servalsheets
  tag: '1.6.0'

config:
  logLevel: info
  httpPort: 3000

oauth:
  existingSecret: oauth-secrets
  redirectUri: https://sheets.example.com/callback

google:
  existingSecret: google-credentials

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: sheets.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: servalsheets-tls
      hosts:
        - sheets.example.com

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10

serviceMonitor:
  enabled: true
```

## Common Operations

### Upgrade

```bash
helm upgrade servalsheets ./deployment/helm/servalsheets \
  --namespace servalsheets \
  -f values.yaml
```

### Rollback

```bash
helm rollback servalsheets 1 --namespace servalsheets
```

### Uninstall

```bash
helm uninstall servalsheets --namespace servalsheets
```

### View Values

```bash
helm get values servalsheets --namespace servalsheets
```

## Key Parameters

| Parameter                | Description               | Default          |
| ------------------------ | ------------------------- | ---------------- |
| `replicaCount`           | Number of pods            | `2`              |
| `image.repository`       | Container image           | `servalsheets`   |
| `image.tag`              | Image tag                 | Chart appVersion |
| `config.logLevel`        | Log level                 | `info`           |
| `ingress.enabled`        | Enable ingress            | `false`          |
| `autoscaling.enabled`    | Enable HPA                | `true`           |
| `serviceMonitor.enabled` | Prometheus ServiceMonitor | `false`          |

See [values.yaml](https://github.com/khill1269/servalsheets/blob/main/deployment/helm/servalsheets/values.yaml) for all options.

## Production Configuration

```yaml
# production-values.yaml
replicaCount: 3

resources:
  requests:
    cpu: 1000m
    memory: 1Gi
  limits:
    cpu: 4000m
    memory: 4Gi

autoscaling:
  minReplicas: 3
  maxReplicas: 20

podDisruptionBudget:
  enabled: true
  minAvailable: 2

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: servalsheets
          topologyKey: kubernetes.io/hostname
```

## Next Steps

- [AWS](./aws) - Terraform for ECS
- [GCP](./gcp) - Terraform for Cloud Run
- [Monitoring](./monitoring) - Observability
