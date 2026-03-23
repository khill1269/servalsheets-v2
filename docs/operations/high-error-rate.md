---
title: High Error Rate Runbook
category: runbook
last_updated: 2026-01-31
description: '- Severity: Critical'
version: 1.6.0
tags: [sheets, docker]
estimated_time: 15-30 minutes
---

# High Error Rate Runbook

## Alert Details

- **Severity**: Critical
- **Component**: API
- **Trigger**: Error rate > 5% for 2 minutes
- **Alert Rule**: `HighErrorRate` in `servalsheets_critical` group

## Symptoms

### User-Visible

- Operations failing with error responses
- Timeouts on requests
- Inconsistent behavior
- Permission denied errors
- Data not updating

### System Symptoms

- High error counter in metrics
- Error logs increasing
- Circuit breakers may be opening
- Queue backing up
- Increased latency

## Impact

- **User Impact**: Users unable to complete operations successfully, 5%+ of requests failing
- **Business Impact**: Service degradation, potential data loss, user trust impact
- **SLA Impact**: Violates 95% success rate SLO

## Investigation Steps

### 1. Check Alert Details

```bash
# View current alert status
curl http://localhost:9090/api/v1/alerts | \
  jq '.data.alerts[] | select(.labels.alertname=="HighErrorRate")'

# Check current error rate
curl 'http://localhost:9090/api/v1/query?query=(rate(servalsheets_tool_calls_total{status="error"}[5m])/rate(servalsheets_tool_calls_total[5m]))*100' | \
  jq '.data.result[0].value[1]'
```

### 2. Review Error Logs

```bash
# Check recent error logs (last 100 entries)
tail -100 /var/log/servalsheets/app.log | jq 'select(.level=="error")'

# Group errors by type
tail -1000 /var/log/servalsheets/app.log | \
  jq -r 'select(.level=="error") | .error.code' | \
  sort | uniq -c | sort -rn

# Check most recent errors
tail -20 /var/log/servalsheets/app.log | \
  jq 'select(.level=="error") | {time: .timestamp, code: .error.code, message: .error.message, tool: .operation}'
```

### 3. Check Metrics Dashboard

```bash
# View error rate by tool
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_tool_calls_total{status="error"}[5m])' | \
  jq '.data.result[] | {tool: .metric.tool, action: .metric.action, rate: .value[1]}'

# Check error types
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_errors_by_type_total[5m])' | \
  jq '.data.result[] | {error_type: .metric.error_type, tool: .metric.tool, rate: .value[1]}'

# Check Google API errors
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_google_api_calls_total{status="error"}[5m])' | \
  jq '.data.result[] | {method: .metric.method, rate: .value[1]}'
```

### 4. Check Service Health

```bash
# Check service health endpoint
curl http://localhost:3000/health/ready | jq .

# Check if service is responding
curl -I http://localhost:3000/health/live

# Check process status
ps aux | grep servalsheets
```

### 5. Check External Dependencies

```bash
# Check Google API status
curl https://status.cloud.google.com/incidents.json | \
  jq '.[] | select(.service_name=="Google Sheets API")'

# Test Google API connectivity
curl -I https://sheets.googleapis.com/v4/spreadsheets

# Check OAuth token validity (from logs)
tail -100 /var/log/servalsheets/app.log | \
  jq 'select(.message | contains("authentication"))'
```

## Common Causes

### 1. Google API Issues (40%)

- **Symptoms**: High `GoogleAPIErrorRate` alert also firing
- **Check**: Google API status dashboard
- **Errors**: 429 Rate Limit, 503 Service Unavailable

### 2. Authentication Failures (30%)

- **Symptoms**: `HighAuthenticationFailureRate` alert firing
- **Check**: OAuth token expiration, credential validity
- **Errors**: 401 Unauthorized, 403 Forbidden

### 3. Permission Issues (15%)

- **Symptoms**: Specific spreadsheets failing consistently
- **Check**: Service account permissions, spreadsheet sharing
- **Errors**: 403 Permission Denied

### 4. Rate Limiting (10%)

- **Symptoms**: `APIQuotaNearLimit` alert firing
- **Check**: Current quota usage
- **Errors**: 429 Too Many Requests

### 5. Code Bugs/Regressions (5%)

- **Symptoms**: Started after recent deployment
- **Check**: Recent commits, new code paths
- **Errors**: Various, check error types

## Resolution Steps

### Immediate Actions

#### 1. Determine Error Pattern

```bash
# Get most common error type
COMMON_ERROR=$(tail -1000 /var/log/servalsheets/app.log | \
  jq -r 'select(.level=="error") | .error.code' | \
  sort | uniq -c | sort -rn | head -1 | awk '{print $2}')

echo "Most common error: $COMMON_ERROR"
```

#### 2. For Authentication Errors (401/403)

```bash
# Check token status
curl http://localhost:3000/health/ready | jq '.checks.auth'

# Refresh OAuth tokens
# (Manual action: re-authenticate if needed)
# Or restart service to trigger token refresh
docker-compose restart servalsheets
```

#### 3. For Rate Limiting (429)

```bash
# Check current rate
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_google_api_calls_total[1m])' | \
  jq '.data.result[0].value[1]'

# If over limit, enable request queuing or reduce rate
# Update environment variable and restart
export SERVALSHEETS_WRITES_PER_MINUTE=40
docker-compose restart servalsheets
```

#### 4. For Google API Outage

```bash
# If Google API is down, enable circuit breaker
# Circuit breaker should automatically open
# Monitor circuit breaker state
curl 'http://localhost:9090/api/v1/query?query=servalsheets_circuit_breaker_state' | jq .

# Wait for Google API to recover
# Circuit breaker will automatically attempt recovery
```

#### 5. For Code Bug

```bash
# Check recent deployments
git log --since="1 hour ago" --oneline

# If recent deployment, consider rollback
git revert <commit-hash>
docker-compose build servalsheets
docker-compose restart servalsheets

# Monitor error rate after rollback
watch -n 10 'curl -s "http://localhost:9090/api/v1/query?query=(rate(servalsheets_tool_calls_total{status=\"error\"}[5m])/rate(servalsheets_tool_calls_total[5m]))*100" | jq ".data.result[0].value[1]"'
```

### Root Cause Investigation

#### 1. Detailed Error Analysis

```bash
# Export recent errors for analysis
tail -5000 /var/log/servalsheets/app.log | \
  jq 'select(.level=="error")' > /tmp/recent-errors.jsonl

# Analyze error patterns
cat /tmp/recent-errors.jsonl | \
  jq -r '{time: .timestamp, tool: .operation, code: .error.code, message: .error.message}' | \
  jq -s 'group_by(.code) | map({error_code: .[0].code, count: length, examples: .[0:3]})'
```

#### 2. Check for Correlation

```bash
# Check if errors correlate with high load
curl 'http://localhost:9090/api/v1/query_range?query=rate(servalsheets_tool_calls_total[5m])&start='$(date -u -d '1 hour ago' +%s)'&end='$(date -u +%s)'&step=60s' | \
  jq '.data.result[0].values'

# Check if errors correlate with specific tools
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_tool_calls_total{status="error"}[5m]) by (tool, action)' | \
  jq '.data.result | sort_by(.value[1] | tonumber) | reverse'
```

#### 3. Review Recent Changes

```bash
# Check recent deployments
git log --since="24 hours ago" --pretty=format:"%h %s (%an)" --no-merges

# Check recent configuration changes
git diff HEAD~5 HEAD -- src/config/

# Review recent commits for suspicious changes
git show <commit-hash>
```

### Long-term Fixes

#### 1. Improve Error Handling

```typescript
// Add retry logic for transient errors
import { retry } from '@/utils/retry';

const result = await retry(async () => await googleSheetsAPI.spreadsheets.get({ spreadsheetId }), {
  maxAttempts: 3,
  delayMs: 1000,
  backoff: 'exponential',
  retryableErrors: ['RATE_LIMIT_EXCEEDED', 'SERVICE_UNAVAILABLE'],
});
```

#### 2. Add Circuit Breaker

```typescript
// Protect against cascading failures
import { circuitBreaker } from '@/utils/circuit-breaker';

const result = await circuitBreaker.execute(
  'google-sheets-api',
  async () => await googleSheetsAPI.call(),
  {
    failureThreshold: 5,
    resetTimeout: 60000,
  }
);
```

#### 3. Improve Rate Limiting

```typescript
// Add adaptive rate limiting
import { adaptiveRateLimiter } from '@/utils/rate-limiter';

const limiter = adaptiveRateLimiter({
  baseRate: 60,
  minRate: 30,
  maxRate: 90,
  adjustmentFactor: 0.1,
});

await limiter.acquire();
```

#### 4. Add Better Logging

```typescript
// Add structured error context
logger.error('API call failed', {
  operation: 'sheets_core:read',
  spreadsheetId: redact(spreadsheetId),
  error: {
    code: error.code,
    message: error.message,
    statusCode: error.statusCode,
    retryable: isRetryable(error),
  },
  context: {
    userId: redact(userId),
    requestId: requestId,
    attemptNumber: attemptNumber,
  },
});
```

#### 5. Implement Graceful Degradation

```typescript
// Fall back to cached data when API fails
try {
  const data = await googleSheetsAPI.get(spreadsheetId);
  cache.set(spreadsheetId, data);
  return data;
} catch (error) {
  if (isRetryable(error)) {
    logger.warn('API failed, returning cached data', { error });
    const cached = cache.get(spreadsheetId);
    if (cached) return cached;
  }
  throw error;
}
```

## Verification

### 1. Error Rate Returned to Normal

```bash
# Check current error rate
curl 'http://localhost:9090/api/v1/query?query=(rate(servalsheets_tool_calls_total{status="error"}[5m])/rate(servalsheets_tool_calls_total[5m]))*100' | \
  jq '.data.result[0].value[1]'

# Target: < 5%
```

### 2. Alert Resolved

```bash
# Check alert status
curl http://localhost:9090/api/v1/alerts | \
  jq '.data.alerts[] | select(.labels.alertname=="HighErrorRate") | .state'

# Should be: "inactive" or not present
```

### 3. Service Health Normal

```bash
# Check all health checks
curl http://localhost:3000/health/ready | jq '.healthy'

# Should be: true
```

### 4. No Recent Errors

```bash
# Check last 10 minutes for errors
tail -100 /var/log/servalsheets/app.log | \
  jq 'select(.level=="error")' | wc -l

# Should be: 0 or very low
```

## Related Alerts

- **CircuitBreakerOpen** - May fire if error rate causes circuit breaker to open
- **GoogleAPIErrorRate** - May fire if errors are from Google API
- **HighAuthenticationFailureRate** - May fire if errors are auth-related
- **RequestQueueBackup** - May fire as errors slow down processing

## Escalation

- **Level 1 (0-15 min)**: On-call engineer investigates and attempts immediate fixes
- **Level 2 (15-30 min)**: Team lead joins, coordinates with Google Cloud support if needed
- **Level 3 (30+ min)**: Senior engineer/Architect, consider rollback or emergency maintenance

## Post-Incident

### 1. Document Incident

- Record timeline of events
- Document root cause
- Note resolution steps taken
- Update runbook with learnings

### 2. Create Post-Mortem

- What happened?
- What was the root cause?
- How was it detected?
- How was it resolved?
- What can be improved?

### 3. Implement Improvements

- Add monitoring for root cause
- Implement preventive measures
- Update alert thresholds if needed
- Add automated remediation

## Prevention

1. **Monitor Google API Status**: Set up proactive monitoring of Google API status
2. **Regular Token Refresh**: Implement automatic token refresh before expiration
3. **Rate Limit Buffer**: Keep rate limiting well below Google's limits
4. **Circuit Breakers**: Ensure circuit breakers are properly configured
5. **Staging Testing**: Test all changes in staging before production
6. **Gradual Rollouts**: Use canary deployments for risky changes

## References

- [Google Sheets API Status](https://status.cloud.google.com/)
- [ServalSheets Monitoring Guide](../guides/MONITORING.md)
- [Error Handling Best Practices](../guides/ERROR_HANDLING.md)
- [Rate Limiting Configuration](../guides/RATE_LIMITING.md)
- [Circuit Breaker Documentation](../guides/CIRCUIT_BREAKER.md)

## Quick Command Reference

```bash
# Check current error rate
curl 'http://localhost:9090/api/v1/query?query=(rate(servalsheets_tool_calls_total{status="error"}[5m])/rate(servalsheets_tool_calls_total[5m]))*100' | jq '.data.result[0].value[1]'

# View recent errors
tail -100 /var/log/servalsheets/app.log | jq 'select(.level=="error")'

# Restart service
docker-compose restart servalsheets

# Check service health
curl http://localhost:3000/health/ready | jq .

# Monitor recovery
watch -n 10 'curl -s "http://localhost:9090/api/v1/query?query=(rate(servalsheets_tool_calls_total{status=\"error\"}[5m])/rate(servalsheets_tool_calls_total[5m]))*100" | jq ".data.result[0].value[1]"'
```
