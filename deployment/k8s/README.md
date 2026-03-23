# Kubernetes Deployment

This directory contains Kubernetes manifests for deploying ServalSheets in production.

## Prerequisites

- Kubernetes cluster (1.24+)
- kubectl configured
- Secrets created (see below)
- Ingress controller (nginx recommended)
- cert-manager for TLS certificates

## Quick Start

### 1. Create Namespace

```bash
kubectl create namespace servalsheets
```

### 2. Create Secrets

**Google Service Account**:

```bash
kubectl create secret generic google-credentials \
  --from-file=service-account.json=/path/to/your/service-account.json \
  -n servalsheets
```

**OAuth Secrets**:

```bash
kubectl create secret generic oauth-secrets \
  --from-literal=client-id="your-oauth-client-id" \
  --from-literal=client-secret="your-oauth-client-secret" \
  --from-literal=session-secret="$(openssl rand -base64 32)" \
  -n servalsheets
```

### 3. Update Configuration

Edit the manifests to update:

- `servalsheets.example.com` → your actual domain
- Resource limits (if needed)
- Environment variables

### 4. Deploy

```bash
# Apply all manifests
kubectl apply -f k8s/

# Or apply individually
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

### 5. Verify Deployment

```bash
# Check pods
kubectl get pods -n servalsheets

# Check services
kubectl get svc -n servalsheets

# Check ingress
kubectl get ingress -n servalsheets

# View logs
kubectl logs -f deployment/servalsheets -n servalsheets

# Check health
kubectl exec -it deployment/servalsheets -n servalsheets -- wget -q -O- http://localhost:3000/health
```

## Files

- **deployment.yaml**: Main application deployment with HPA
- **service.yaml**: ClusterIP service with session affinity
- **ingress.yaml**: Ingress with TLS and rate limiting
- **README.md**: This file

## Horizontal Pod Autoscaling

The HPA is configured to:

- Min replicas: 2
- Max replicas: 10
- Scale up: When CPU > 70% or Memory > 80%
- Scale down: Gradually after 5 minutes of low usage

## Health Checks

- **Liveness Probe**: Checks `/health` every 10s
- **Readiness Probe**: Checks `/health` every 5s
- Ensures zero-downtime deployments

## Rolling Updates

Configured for zero-downtime updates:

- `maxSurge: 1` - One extra pod during update
- `maxUnavailable: 0` - No pods unavailable during update
- `terminationGracePeriodSeconds: 30` - Wait 30s for graceful shutdown

## Security

- Runs as non-root user (UID 1000)
- Read-only credential volumes
- Network policies (add network-policy.yaml for isolation)
- TLS enforced via Ingress

## Monitoring

The deployment is annotated for Prometheus scraping:

```yaml
prometheus.io/scrape: 'true'
prometheus.io/port: '3000'
prometheus.io/path: '/metrics'
```

## Troubleshooting

**Pods not starting**:

```bash
kubectl describe pod -n servalsheets
kubectl logs -n servalsheets -l app=servalsheets
```

**Ingress not working**:

```bash
kubectl describe ingress servalsheets -n servalsheets
# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager
```

**OAuth errors**:

- Verify secrets are correct: `kubectl get secret oauth-secrets -n servalsheets -o yaml`
- Check redirect URI matches Google Cloud Console configuration
- Ensure domain in Ingress matches OAUTH_REDIRECT_URI

## Production Recommendations

1. **Use a managed Redis** for session storage across pods:

   ```yaml
   - name: REDIS_URL
     value: 'redis://redis-master:6379'
   ```

2. **Enable Pod Disruption Budget**:

   ```yaml
   apiVersion: policy/v1
   kind: PodDisruptionBudget
   metadata:
     name: servalsheets-pdb
   spec:
     minAvailable: 1
     selector:
       matchLabels:
         app: servalsheets
   ```

3. **Add Resource Quotas** to namespace

4. **Configure log aggregation** (Fluent Bit, Loki, etc.)

5. **Set up monitoring** (Prometheus + Grafana)

## Further Reading

- [Production Deployment Guide](../PRODUCTION_DEPLOYMENT_GUIDE.md)
- [Production Checklist](../PRODUCTION_CHECKLIST.md)
- [Monitoring Guide](../MONITORING.md)
