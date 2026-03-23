---
title: 'Runbook: Google API Errors'
category: general
last_updated: 2026-02-04
description: 'Alert Name: GoogleApiErrors'
version: 1.6.0
tags: [api, sheets, grafana]
---

# Runbook: Google API Errors

**Alert Name:** `GoogleApiErrors`
**Severity:** Warning
**Component:** Google API Integration
**Threshold:** > 2% error rate on Google API calls for 5 minutes

## Impact

Operations are failing due to Google API issues. Users experiencing failed spreadsheet operations. May indicate Google API degradation or configuration issues.

## Symptoms

- Google API error rate exceeds 2%
- Specific error codes: 401, 403, 404, 429, 500, 503
- Dashboard showing elevated Google API errors
- Logs showing repeated API failures

## Diagnosis

### 1. Check Error Rate and Types

```bash
# Check Google API error rate
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_google_api_calls_total{status="error"}[5m])'

# Check error distribution by type
curl http://localhost:3000/metrics | grep servalsheets_google_api_errors_by_code

# View in Grafana
# Navigate to: Errors Dashboard > Google API Errors
```

### 2. Identify Error Codes

**Common error codes and meanings:**

- **401 Unauthorized:** Authentication token invalid or expired
- **403 Forbidden:** Permission denied, insufficient scopes
- **404 Not Found:** Spreadsheet or sheet doesn't exist
- **429 Too Many Requests:** Rate limit exceeded
- **500 Internal Server Error:** Google API internal issue
- **503 Service Unavailable:** Google API temporarily unavailable

### 3. Check Google API Status

```bash
# Check Google API status page
curl -s https://www.google.com/appsstatus/dashboard/incidents | jq

# Or visit: https://status.cloud.google.com
# Check: Google Sheets API status
```

### 4. Review Authentication Status

```bash
# Check OAuth token validity
curl http://localhost:3000/health/ready | jq '.checks[] | select(.name == "auth")'

# Check token expiration
kubectl logs -n servalsheets deployment/servalsheets | grep "token" | tail -20
```

## Resolution Steps

### Step 1: Authentication Issues (401)

```bash
# Refresh OAuth credentials
npm run auth:refresh

# Verify token scopes
# Navigate to: https://myaccount.google.com/permissions
# Ensure ServalSheets has required scopes:
# - https://www.googleapis.com/auth/spreadsheets
# - https://www.googleapis.com/auth/drive.readonly (if needed)

# Restart service to pick up new token
kubectl rollout restart deployment/servalsheets -n servalsheets
```

### Step 2: Permission Issues (403)

```bash
# Check if service account has required permissions
# For user OAuth: Verify user granted all required scopes
# For service account: Verify spreadsheet is shared with service account email

# Grant permissions
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/editor"

# Or share spreadsheet directly with service account
# In Google Sheets: Share > Add service account email > Editor access
```

### Step 3: Rate Limiting (429)

```bash
# Enable rate limiting protection
kubectl set env deployment/servalsheets ENABLE_RATE_LIMIT_PROTECTION=true -n servalsheets

# Increase retry delays
kubectl set env deployment/servalsheets RETRY_DELAY_MS=5000 -n servalsheets
kubectl set env deployment/servalsheets RETRY_MAX_ATTEMPTS=5 -n servalsheets

# Enable exponential backoff
kubectl set env deployment/servalsheets RETRY_BACKOFF_MULTIPLIER=2 -n servalsheets

# See: Quota Near Limit Runbook for full mitigation
```

### Step 4: Google API Degradation (500, 503)

```bash
# Enable circuit breaker
kubectl set env deployment/servalsheets CIRCUIT_BREAKER_ENABLED=true -n servalsheets

# Tune circuit breaker settings
kubectl set env deployment/servalsheets CIRCUIT_BREAKER_FAILURE_THRESHOLD=5 -n servalsheets
kubectl set env deployment/servalsheets CIRCUIT_BREAKER_TIMEOUT=30000 -n servalsheets

# Enable fallback to cached data
kubectl set env deployment/servalsheets ENABLE_CACHE_FALLBACK=true -n servalsheets
```

### Step 5: Not Found Errors (404)

```bash
# These indicate application logic issues
# Check logs for spreadsheet IDs causing 404s
kubectl logs -n servalsheets deployment/servalsheets | grep "404" | grep "spreadsheetId"

# Review recent operations for invalid spreadsheet IDs
# May need to improve validation or error handling
```

## Prevention

1. **Implement robust authentication:**
   - Token refresh before expiration
   - Automatic retry on 401 with token refresh
   - Monitor token expiration time

2. **Add permission validation:**
   - Pre-validate spreadsheet access
   - Clear error messages for permission issues
   - Incremental authorization for additional scopes

3. **Enable protective measures:**
   - Circuit breakers for Google API calls
   - Rate limiting to prevent quota exhaustion
   - Exponential backoff with jitter
   - Request deduplication

4. **Improve monitoring:**
   - Alert on sustained error rates
   - Track error codes separately
   - Monitor Google API status proactively
   - Set up SLOs for API success rate

5. **Add resilience patterns:**

   ```typescript
   // Example: Retry with exponential backoff
   await withCircuitBreaker('spreadsheets.get', async () => {
     return await withRetry(() => sheetsApi.get(spreadsheetId), {
       maxAttempts: 3,
       backoff: 'exponential',
     });
   });
   ```

## Post-Incident

1. Categorize errors by type and root cause
2. Implement fixes for preventable errors
3. Improve error messages for user-facing errors
4. Add tests for error scenarios
5. Update monitoring and alerting thresholds

## Related Runbooks

- [Auth Failures](./auth-failures.md)
- [Quota Near Limit](./quota-near-limit.md)
- [Slow Google API](./slow-google-api.md)
- [Circuit Breaker](./circuit-breaker.md)
- [High Error Rate](./high-error-rate.md)

## Metrics to Monitor

- `servalsheets_google_api_calls_total{status="error"}`
- `servalsheets_google_api_errors_by_code`
- `servalsheets_rate_limit_hits_total`
- `servalsheets_retry_attempts_total`
- `servalsheets_circuit_breaker_state`
- `servalsheets_auth_failures_total`

## Error Code Reference

| Code | Meaning        | Action                            |
| ---- | -------------- | --------------------------------- |
| 401  | Unauthorized   | Refresh OAuth token               |
| 403  | Forbidden      | Check permissions/scopes          |
| 404  | Not Found      | Validate spreadsheet ID           |
| 429  | Rate Limit     | Enable rate limiting, caching     |
| 500  | Internal Error | Enable circuit breaker, retry     |
| 503  | Unavailable    | Wait and retry, check status page |

## SLO Targets

- **Success Rate:** > 99.5%
- **Auth Success:** > 99.9%
- **Permission Success:** > 99.5%
- **Availability:** > 99.9%

## Escalation

- **On-call engineer** (immediate)
- **Team lead** (if auth/permission issue)
- **Engineering manager** (if code changes needed)
- **Google Cloud support** (if Google API issue)
- **CTO** (if sustained outage)
