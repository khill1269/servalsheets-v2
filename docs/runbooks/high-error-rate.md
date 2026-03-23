---
title: 'Runbook: High Error Rate'
category: general
last_updated: 2026-02-04
description: 'Alert Name: HighErrorRate'
version: 1.6.0
tags: [grafana]
---

# Runbook: High Error Rate

**Alert Name:** `HighErrorRate`
**Severity:** Critical
**Component:** API
**Threshold:** > 5% error rate over 5 minutes

## Impact

Users are experiencing failed operations. This is a critical business impact requiring immediate attention.

## Symptoms

- Error rate exceeds 5% of all requests
- Multiple users reporting failures
- Dashboard shows elevated error metrics
- Logs showing increased error patterns

## Diagnosis

### 1. Check Error Distribution

```bash
# View recent errors in logs
kubectl logs -n servalsheets deployment/servalsheets --tail=100 | grep ERROR

# Check error types in Grafana
# Navigate to: Errors Dashboard > Error Distribution by Type
```

### 2. Check Google API Status

```bash
# Check Google API Health
curl https://status.cloud.google.com/

# Check Sheets API specifically
# https://www.google.com/appsstatus/dashboard
```

### 3. Review Authentication Status

```bash
# Check health endpoint
curl http://localhost:3000/health/ready | jq '.checks[] | select(.name == "auth")'

# Expected output: {"status": "ok", "name": "auth"}
```

### 4. Check Recent Deployments

```bash
# Check recent deployment history
kubectl rollout history deployment/servalsheets -n servalsheets

# Check pod events
kubectl get events -n servalsheets --sort-by='.lastTimestamp' | tail -20
```

## Resolution Steps

### Step 1: Identify Error Pattern

Check the error distribution dashboard:

- **Authentication errors** → See [Auth Failures Runbook](./auth-failures.md)
- **Permission errors** → Check service account permissions
- **Rate limit errors** → See [Quota Near Limit Runbook](./quota-near-limit.md)
- **Network errors** → Check connectivity to Google APIs
- **Validation errors** → Check for malformed requests

### Step 2: Immediate Mitigation

**If authentication issue:**

```bash
# Refresh OAuth credentials
npm run auth:refresh

# Restart service to pick up new credentials
kubectl rollout restart deployment/servalsheets -n servalsheets
```

**If rate limiting:**

```bash
# Enable/tune caching
kubectl set env deployment/servalsheets CACHE_ENABLED=true -n servalsheets

# Reduce batch sizes temporarily
kubectl set env deployment/servalsheets MAX_BATCH_SIZE=50 -n servalsheets
```

**If Google API issue:**

```bash
# Enable circuit breaker failover
kubectl set env deployment/servalsheets CIRCUIT_BREAKER_ENABLED=true -n servalsheets

# Add retry delays
kubectl set env deployment/servalsheets RETRY_DELAY_MS=5000 -n servalsheets
```

### Step 3: Rollback if Recent Deployment

```bash
# If error rate spiked after deployment
kubectl rollout undo deployment/servalsheets -n servalsheets

# Monitor error rate after rollback
watch 'curl -s http://localhost:3000/metrics | grep servalsheets_tool_calls_total'
```

### Step 4: Scale Resources

```bash
# If resource exhaustion
kubectl scale deployment/servalsheets --replicas=5 -n servalsheets

# Check if errors decrease
```

## Prevention

1. **Enable pre-deployment testing:**

   ```bash
   npm run test:integration
   npm run test:live-api
   ```

2. **Implement gradual rollouts:**
   - Use canary deployments
   - Monitor error rates during rollout
   - Auto-rollback on threshold breach

3. **Improve monitoring:**
   - Set up error budget tracking
   - Enable SLI/SLO alerts
   - Configure PagerDuty integration

4. **Add circuit breakers:**
   Ensure all external API calls use circuit breakers

## Post-Incident

1. Update error budget tracking
2. Document root cause in incident report
3. Create Jira ticket for preventive measures
4. Review and update this runbook if needed

## Related Runbooks

- [Auth Failures](./auth-failures.md)
- [Circuit Breaker](./circuit-breaker.md)
- [Service Down](./service-down.md)
- [Google API Errors](./google-api-errors.md)

## Metrics to Monitor

- `servalsheets_tool_calls_total{status="error"}`
- `servalsheets_errors_by_type_total`
- `servalsheets_google_api_calls_total{status="error"}`

## Escalation

- **On-call engineer** (first 15 minutes)
- **Team lead** (if not resolved in 30 minutes)
- **Engineering manager** (if not resolved in 1 hour)
- **CTO** (if business impact exceeds SLO)
