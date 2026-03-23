---
title: 'Runbook: Circuit Breaker Open/Half-Open'
category: general
last_updated: 2026-02-04
description: 'Alert Names: CircuitBreakerOpen, CircuitBreakerHalfOpen'
version: 1.6.0
tags: [sheets, prometheus]
---

# Runbook: Circuit Breaker Open/Half-Open

**Alert Names:** `CircuitBreakerOpen`, `CircuitBreakerHalfOpen`
**Severity:** Critical (Open), Warning (Half-Open)
**Component:** Resilience
**Threshold:** Circuit breaker state >= 2 (Open) or == 1 (Half-Open)

## Impact

**Circuit Breaker Open:**

- Requests to the failing service are being rejected immediately
- Service is degraded for affected operations
- User requests may fail or have reduced functionality

**Circuit Breaker Half-Open:**

- Circuit breaker is testing recovery
- Limited requests are being allowed through
- Service may still experience intermittent failures

## Circuit Breaker States

- **CLOSED (0)**: Normal operation, all requests allowed
- **HALF_OPEN (1)**: Testing recovery, limited requests allowed
- **OPEN (2)**: Failing, all requests rejected immediately

## Symptoms

- Dashboard shows circuit breaker in OPEN or HALF_OPEN state
- Specific operations failing consistently
- Error messages indicating circuit breaker rejection
- Downstream service unreachable or timing out

## Diagnosis

### 1. Identify Which Circuit Breaker

```bash
# Check all circuit breaker states
curl http://localhost:3000/metrics/circuit-breakers | jq

# Expected output shows all circuit breakers and their states
```

### 2. Check Circuit Breaker Metrics

```bash
# View circuit breaker state metric
curl http://localhost:3000/metrics | grep servalsheets_circuit_breaker_state

# Check transition count (how many times it's opened)
curl http://localhost:3000/metrics | grep circuit_breaker_transitions
```

### 3. Review Error Logs

```bash
# Check logs for circuit breaker events
kubectl logs -n servalsheets deployment/servalsheets | grep "circuit.*breaker"

# Look for the root cause errors that triggered the breaker
kubectl logs -n servalsheets deployment/servalsheets | grep ERROR | tail -50
```

### 4. Check Downstream Service Health

**For Google Sheets API:**

```bash
# Test API connectivity
curl -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/test-id" \
  -w "\nHTTP Status: %{http_code}\n"
```

**For other services:**
Check the specific service health endpoint mentioned in the circuit breaker name.

## Resolution Steps

### For Google Sheets API Circuit Breaker

#### Step 1: Verify Google API Status

```bash
# Check official status page
# https://www.google.com/appsstatus/dashboard

# Check if quota is exceeded
curl http://localhost:3000/metrics | grep rate_limit_hits_total
```

#### Step 2: Check Authentication

```bash
# Verify credentials are valid
curl http://localhost:3000/health/ready | jq '.checks[] | select(.name == "auth")'

# Refresh OAuth token if needed
npm run auth:refresh
```

#### Step 3: Reset Circuit Breaker (Manual Override)

**⚠️ Only do this if root cause is identified and resolved:**

```bash
# Restart the service to reset circuit breakers
kubectl rollout restart deployment/servalsheets -n servalsheets

# Or use API endpoint (if implemented)
curl -X POST http://localhost:3000/circuit-breakers/reset \
  -H "Content-Type: application/json" \
  -d '{"circuit": "google_sheets_api"}'
```

#### Step 4: Monitor Recovery

```bash
# Watch circuit breaker state
watch 'curl -s http://localhost:3000/metrics | grep circuit_breaker_state'

# State should transition: OPEN (2) → HALF_OPEN (1) → CLOSED (0)
```

### For Half-Open State

The circuit breaker is automatically testing recovery. **Do not interfere unless:**

1. **It's stuck in half-open for > 10 minutes:**

   ```bash
   # Check if test requests are succeeding
   kubectl logs -n servalsheets deployment/servalsheets | grep "half.*open"

   # If stuck, investigate why test requests are failing
   ```

2. **Test requests are failing:**
   - Verify downstream service is actually healthy
   - Check authentication/permissions
   - Review error logs for specific failure reasons

## Common Causes and Solutions

### Cause 1: Google API Rate Limiting

**Symptoms:** High `rate_limit_hits_total` metric

**Solution:**

```bash
# Enable caching
kubectl set env deployment/servalsheets CACHE_ENABLED=true

# Increase batch efficiency
kubectl set env deployment/servalsheets ADAPTIVE_BATCHING=true

# Reduce max concurrent requests
kubectl set env deployment/servalsheets MAX_CONCURRENT_REQUESTS=10
```

### Cause 2: Authentication Token Expired

**Symptoms:** 401 errors in logs

**Solution:**

```bash
# Refresh OAuth token
npm run auth:refresh

# Update service account credentials
kubectl create secret generic google-creds \
  --from-file=credentials.json \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart service
kubectl rollout restart deployment/servalsheets
```

### Cause 3: Network Connectivity Issues

**Symptoms:** Timeout errors, connection refused

**Solution:**

```bash
# Check network policies
kubectl get networkpolicies -n servalsheets

# Test connectivity from pod
kubectl exec -it deployment/servalsheets -- curl -v https://sheets.googleapis.com/

# Check DNS resolution
kubectl exec -it deployment/servalsheets -- nslookup sheets.googleapis.com
```

### Cause 4: Downstream Service Degradation

**Symptoms:** Slow responses, timeouts

**Solution:**

```bash
# Increase timeout thresholds temporarily
kubectl set env deployment/servalsheets API_TIMEOUT_MS=30000

# Enable retry logic
kubectl set env deployment/servalsheets RETRY_ENABLED=true RETRY_MAX_ATTEMPTS=3

# Monitor if breaker closes with new settings
```

## Circuit Breaker Configuration

Default configuration (in code):

```typescript
{
  failureThreshold: 5,       // Open after 5 failures
  successThreshold: 2,       // Close after 2 successes in half-open
  timeout: 60000,            // Try half-open after 60s
  resetTimeout: 30000        // Reset failure count after 30s success
}
```

**Adjust via environment:**

```bash
kubectl set env deployment/servalsheets \
  CIRCUIT_BREAKER_FAILURE_THRESHOLD=10 \
  CIRCUIT_BREAKER_TIMEOUT=120000
```

## Prevention

1. **Implement gradual backoff:**
   - Circuit breaker will auto-recover
   - Don't manually reset unless necessary

2. **Add monitoring:**
   - Alert on circuit breaker transitions
   - Track failure patterns leading to opens

3. **Improve resilience:**
   - Add caching to reduce API calls
   - Implement request queuing
   - Use adaptive batching

4. **Health checks:**
   - Add synthetic monitoring for critical paths
   - Proactive failure detection

## Post-Incident

1. **Analyze failure pattern:**

   ```bash
   # Export circuit breaker metrics for time range
   curl "http://prometheus:9090/api/v1/query_range?query=servalsheets_circuit_breaker_state&start=$START&end=$END&step=15s"
   ```

2. **Update thresholds if needed:**
   - If too sensitive: Increase failure threshold
   - If too slow: Decrease failure threshold

3. **Document incident:**
   - Root cause analysis
   - Time to detection
   - Time to resolution
   - Prevention measures

## Related Runbooks

- [High Error Rate](./high-error-rate.md)
- [Auth Failures](./auth-failures.md)
- [Google API Errors](./google-api-errors.md)
- [Quota Near Limit](./quota-near-limit.md)

## Metrics to Monitor

- `servalsheets_circuit_breaker_state`
- `servalsheets_errors_by_type_total`
- `servalsheets_google_api_calls_total{status="error"}`
- `servalsheets_rate_limit_hits_total`

## Escalation

- **On-call engineer** (first 15 minutes)
- **Team lead** (if circuit stays open > 30 minutes)
- **Engineering manager** (if business impact is significant)
