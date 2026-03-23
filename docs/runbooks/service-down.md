---
title: 'Runbook: Service Down'
category: general
last_updated: 2026-02-04
description: 'Alert Name: ServiceDown'
version: 1.6.0
tags: [prometheus, docker, kubernetes]
---

# Runbook: Service Down

**Alert Name:** `ServiceDown`
**Severity:** Critical
**Component:** Availability
**Threshold:** Service unreachable for 1 minute

## Impact

**COMPLETE OUTAGE**

- All user requests are failing
- No API operations possible
- Users experiencing "service unavailable" errors
- Revenue impact if monetized

## Symptoms

- Health check endpoints returning 503 or timing out
- Prometheus showing `up{job="servalsheets"} == 0`
- Load balancer marking pods as unhealthy
- No logs being generated (process crashed)

## Immediate Actions (First 60 seconds)

### 1. Check Service Status

```bash
# Check if pods are running
kubectl get pods -n servalsheets

# Check pod status and restarts
kubectl get pods -n servalsheets -o wide

# Expected output:
# NAME                            READY   STATUS    RESTARTS
# servalsheets-5d6b7f8c9d-abc12   1/1     Running   0
```

### 2. Check Recent Events

```bash
# Get recent Kubernetes events
kubectl get events -n servalsheets --sort-by='.lastTimestamp' | tail -20

# Look for:
# - OOMKilled
# - CrashLoopBackOff
# - ImagePullBackOff
# - Evicted
```

### 3. Quick Health Check

```bash
# Try to access health endpoint
curl -v http://servalsheets-service:3000/health/live

# From outside cluster
curl -v https://your-domain.com/health/live
```

## Diagnosis

### Pod Status: CrashLoopBackOff

**Cause:** Application is crashing on startup

**Diagnosis:**

```bash
# Check pod logs
kubectl logs -n servalsheets deployment/servalsheets --tail=100

# Check previous crash logs
kubectl logs -n servalsheets deployment/servalsheets --previous

# Common issues:
# - Missing environment variables
# - Invalid configuration
# - Database connection failure
# - Authentication failure on startup
```

**Resolution:**

```bash
# Check required env vars are set
kubectl get deployment/servalsheets -n servalsheets -o jsonpath='{.spec.template.spec.containers[0].env[*].name}'

# Check secrets exist
kubectl get secrets -n servalsheets

# Verify config maps
kubectl get configmaps -n servalsheets

# If missing, apply configs:
kubectl apply -f deployment/k8s/
```

### Pod Status: OOMKilled

**Cause:** Pod exceeded memory limit

**Diagnosis:**

```bash
# Check memory limits
kubectl get pod -n servalsheets -o jsonpath='{.items[0].spec.containers[0].resources.limits.memory}'

# Check actual memory usage before crash
kubectl top pod -n servalsheets
```

**Resolution:**

```bash
# Temporarily increase memory limit
kubectl set resources deployment/servalsheets \
  --limits=memory=2Gi \
  --requests=memory=1Gi \
  -n servalsheets

# Check if pod starts successfully
kubectl get pods -n servalsheets -w
```

### Pod Status: ImagePullBackOff

**Cause:** Cannot pull Docker image

**Diagnosis:**

```bash
# Check image name
kubectl get deployment/servalsheets -n servalsheets \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Check image pull secrets
kubectl get deployment/servalsheets -n servalsheets \
  -o jsonpath='{.spec.template.spec.imagePullSecrets}'
```

**Resolution:**

```bash
# Verify image exists
docker pull your-registry/servalsheets:tag

# If secret issue, recreate:
kubectl create secret docker-registry regcred \
  --docker-server=your-registry \
  --docker-username=user \
  --docker-password=pass \
  -n servalsheets

# Update deployment to use secret
kubectl patch deployment/servalsheets -n servalsheets \
  -p '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"regcred"}]}}}}'
```

### No Pods Running

**Cause:** Deployment deleted or scaled to 0

**Diagnosis:**

```bash
# Check deployment exists
kubectl get deployment -n servalsheets

# Check replica count
kubectl get deployment/servalsheets -n servalsheets \
  -o jsonpath='{.spec.replicas}'
```

**Resolution:**

```bash
# If deployment missing, recreate
kubectl apply -f deployment/k8s/deployment.yaml

# If scaled to 0, scale up
kubectl scale deployment/servalsheets --replicas=3 -n servalsheets

# Watch pods start
kubectl get pods -n servalsheets -w
```

### Pods Running But Unhealthy

**Cause:** Liveness/Readiness probes failing

**Diagnosis:**

```bash
# Check probe configuration
kubectl describe pod -n servalsheets deployment/servalsheets | grep -A 5 "Liveness"
kubectl describe pod -n servalsheets deployment/servalsheets | grep -A 5 "Readiness"

# Check probe failure reasons
kubectl describe pod -n servalsheets deployment/servalsheets | grep -A 10 "Events"

# Test probes manually
kubectl exec -it deployment/servalsheets -n servalsheets -- \
  curl http://localhost:3000/health/live
```

**Resolution:**

```bash
# If authentication issue (common for readiness probe)
# Check Google credentials are mounted
kubectl get deployment/servalsheets -n servalsheets \
  -o jsonpath='{.spec.template.spec.volumes}'

# Recreate secret if missing
kubectl create secret generic google-creds \
  --from-file=credentials.json \
  -n servalsheets

# Restart pods
kubectl rollout restart deployment/servalsheets -n servalsheets
```

## Common Resolution Patterns

### Pattern 1: Complete Restart

```bash
# Delete all pods (deployment will recreate)
kubectl delete pods -n servalsheets -l app=servalsheets

# Or rollout restart
kubectl rollout restart deployment/servalsheets -n servalsheets

# Wait for healthy status
kubectl wait --for=condition=available deployment/servalsheets -n servalsheets --timeout=300s
```

### Pattern 2: Rollback Recent Deployment

```bash
# Check rollout history
kubectl rollout history deployment/servalsheets -n servalsheets

# Rollback to previous version
kubectl rollout undo deployment/servalsheets -n servalsheets

# Rollback to specific revision
kubectl rollout undo deployment/servalsheets --to-revision=3 -n servalsheets

# Monitor rollback
kubectl rollout status deployment/servalsheets -n servalsheets
```

### Pattern 3: Check Node Resources

```bash
# Check node resources
kubectl top nodes

# Check if node is full
kubectl describe nodes | grep -A 5 "Allocated resources"

# If node is full, add nodes or move pods
kubectl drain node-name --ignore-daemonsets
```

### Pattern 4: Network Issues

```bash
# Check service
kubectl get svc -n servalsheets

# Test service connectivity
kubectl run test-pod --image=curlimages/curl -it --rm -- \
  curl http://servalsheets-service.servalsheets.svc.cluster.local:3000/health/live

# Check ingress
kubectl get ingress -n servalsheets

# Test ingress
curl -v https://your-domain.com/health/live
```

## Quick Recovery Script

```bash
#!/bin/bash
# Quick recovery script for service down

set -e

NAMESPACE="servalsheets"
DEPLOYMENT="servalsheets"

echo "Checking pod status..."
kubectl get pods -n $NAMESPACE

echo "Checking recent events..."
kubectl get events -n $NAMESPACE --sort-by='.lastTimestamp' | tail -10

echo "Checking logs..."
kubectl logs -n $NAMESPACE deployment/$DEPLOYMENT --tail=50

echo "Attempting restart..."
kubectl rollout restart deployment/$DEPLOYMENT -n $NAMESPACE

echo "Waiting for rollout..."
kubectl rollout status deployment/$DEPLOYMENT -n $NAMESPACE --timeout=5m

echo "Verifying health..."
kubectl exec -n $NAMESPACE deployment/$DEPLOYMENT -- \
  curl -f http://localhost:3000/health/live

echo "Service recovered!"
```

## Prevention

1. **Add readiness probes with proper timeouts:**

   ```yaml
   readinessProbe:
     httpGet:
       path: /health/ready
       port: 3000
     initialDelaySeconds: 10
     periodSeconds: 5
     failureThreshold: 3
   ```

2. **Set resource limits to prevent OOM:**

   ```yaml
   resources:
     requests:
       memory: '512Mi'
       cpu: '250m'
     limits:
       memory: '2Gi'
       cpu: '1000m'
   ```

3. **Add PodDisruptionBudget:**

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

4. **Enable auto-restart:**

   ```yaml
   spec:
     template:
       spec:
         restartPolicy: Always
   ```

5. **Add HPA for auto-scaling:**

   ```bash
   kubectl autoscale deployment/servalsheets \
     --min=2 --max=10 --cpu-percent=70 \
     -n servalsheets
   ```

## Post-Incident

1. **Root cause analysis:**
   - Review logs leading to crash
   - Check resource usage trends
   - Identify configuration issues

2. **Update monitoring:**
   - Add alerting for leading indicators
   - Improve health check coverage
   - Set up synthetic monitoring

3. **Document lessons learned:**
   - What caused the outage
   - How it was detected
   - Time to resolution
   - Prevention measures added

4. **Update error budget:**
   - Calculate downtime duration
   - Update SLO tracking
   - Review error budget remaining

## Related Runbooks

- [High Error Rate](./high-error-rate.md)
- [Circuit Breaker](./circuit-breaker.md)
- [Memory Exhaustion](./memory-exhaustion.md)

## Metrics to Monitor

- `up{job="servalsheets"}`
- `kube_pod_status_phase{namespace="servalsheets"}`
- `kube_deployment_status_replicas_available{namespace="servalsheets"}`

## Escalation

- **On-call engineer** (immediate)
- **Team lead** (if not resolved in 5 minutes)
- **Engineering manager** (if not resolved in 15 minutes)
- **CTO** (if downtime exceeds 30 minutes)
- **Executive team** (if business impact is severe)

## Communication Template

```
INCIDENT: ServalSheets Service Down

Status: INVESTIGATING / IDENTIFIED / MONITORING / RESOLVED
Started: [timestamp]
Impact: All API requests failing

Current Actions:
- [Action 1]
- [Action 2]

ETA: [estimated time to resolution]

Updates: [link to status page]
```
