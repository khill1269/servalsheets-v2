---
title: Degradation Modes
description: How ServalSheets behaves under various failure conditions
category: runbook
tags: [degradation, circuit-breaker, rate-limiting, error-handling, monitoring]
author: Claude Sonnet 4.5
date: 2026-02-16
last_updated: 2026-02-16
---

# Degradation Modes

**Purpose**: Document how ServalSheets behaves under various failure conditions and what clients should expect.

---

## Circuit Breaker OPEN

### When It Happens

- After 5 consecutive failures to Google API
- Circuit transitions to OPEN state for 30 seconds (configurable)

### Behavior

- **Immediate**: All requests fail fast without calling Google API
- **Error Response**: `RATE_LIMITED` with `circuitBreakerState: "open"`
- **Retry Guidance**: Wait until `nextAttempt` time before retrying
- **Auto-Recovery**: After timeout, circuit transitions to HALF_OPEN
  - First request is allowed through (test request)
  - If successful, circuit CLOSES
  - If fails, circuit reopens for another timeout period

### Client Response

```json
{
  "code": "RATE_LIMITED",
  "message": "Rate limit exceeded for requests quota. Retry after 30 seconds.",
  "details": {
    "circuitBreakerState": "open",
    "retryAfterMs": 30000,
    "resetTime": "2026-02-16T20:35:00.000Z"
  }
}
```

### Best Practice

- **Don't retry immediately** - Circuit breaker is protecting against cascading failures
- **Wait for `retryAfterMs`** before retrying
- **Use batch operations** to reduce API call volume when circuit closes

---

## Rate Limit Exceeded

### When It Happens

- Google Sheets API quota exhausted (read/write/requests)
- HTTP 429 response from Google API

### Behavior

- **Auto-retry**: First 3 attempts with exponential backoff
- **After retries**: Returns `RATE_LIMITED` error with retry guidance
- **Circuit breaker**: May open if rate limits persist (5+ failures)

### Error Response

```json
{
  "code": "RATE_LIMITED",
  "message": "Rate limit exceeded for write quota. Retry after 60 seconds.",
  "retryable": true,
  "retryStrategy": "wait_for_reset",
  "resolution": "Wait 60 seconds, then retry. Use batch operations to reduce API calls.",
  "resolutionSteps": [
    "1. Wait 60 seconds before retrying",
    "2. Use batch operations (sheets_data with action 'batch_read' or 'batch_write')",
    "3. Enable caching to avoid redundant requests",
    "4. Consider using exponential backoff for retries",
    "5. Check quota usage in Google Cloud Console"
  ],
  "details": {
    "quotaType": "write",
    "retryAfterMs": 60000,
    "resetTime": "2026-02-16T20:31:00.000Z",
    "circuitBreakerState": "closed"
  }
}
```

### Quota Limits (Google Sheets API)

| Quota Type     | Limit (per minute) | Impact                           |
| -------------- | ------------------ | -------------------------------- |
| Read requests  | 60                 | Read operations (get, batch_get) |
| Write requests | 60                 | Write/update operations          |
| Total requests | 300                | All API calls combined           |

### Best Practice

- **Batch operations**: Use `batch_read`, `batch_write` instead of multiple individual calls
- **Caching**: Enable request deduplication (automatic in ServalSheets)
- **Exponential backoff**: Wait progressively longer between retries

---

## Auth Token Expired

### When It Happens

- OAuth2 access token expires (typically after 1 hour)
- Token revoked by user
- Invalid/missing credentials

### Behavior

- **Auto-refresh**: Token automatically refreshed if refresh token available
- **Proactive refresh**: Token refreshed 5 minutes before expiration (TokenManager)
- **If refresh fails**: Returns `PERMISSION_DENIED` error

### Error Response

```json
{
  "code": "PERMISSION_DENIED",
  "message": "Authentication required. Please login to continue.",
  "category": "auth",
  "severity": "high",
  "retryable": false,
  "resolution": "Login via: npm run auth",
  "resolutionSteps": [
    "1. Run: npm run auth",
    "2. Complete OAuth2 flow in browser",
    "3. Restart server"
  ]
}
```

### Token Lifecycle

```
User Login
  ↓
Access Token (1 hour) + Refresh Token (persistent)
  ↓
After 55 minutes → Auto-refresh (TokenManager)
  ↓
New Access Token (1 hour)
  ↓
Repeat until refresh token expires/revoked
```

### Best Practice

- **Monitor token expiry**: ServalSheets logs token refresh events
- **Handle `PERMISSION_DENIED`**: Prompt user to re-authenticate
- **Don't retry**: Auth failures won't resolve without user action

---

## Redis Unavailable

### When It Happens

- Redis server down/unreachable
- Connection timeout
- Redis credentials invalid

### Behavior

- **Graceful degradation**: ServalSheets operates without Redis
- **Features disabled**:
  - Per-user rate limiting (falls back to global limits)
  - Distributed caching (falls back to in-memory LRU cache)
  - Webhook queue persistence (webhooks stored in-memory only)
- **No error returned**: Clients unaffected (except webhook reliability)

### Logging

```
WARN: Redis connection failed, using in-memory fallback
WARN: Per-user rate limiting disabled (Redis unavailable)
```

### Impact Matrix

| Feature       | With Redis               | Without Redis              |
| ------------- | ------------------------ | -------------------------- |
| Rate limiting | Per-user (isolated)      | Global (shared)            |
| Caching       | Distributed (persistent) | In-memory (volatile)       |
| Webhooks      | Persistent queue         | In-memory queue            |
| Sessions      | Persistent               | In-memory                  |
| Performance   | Optimal                  | Degraded (memory pressure) |

### Best Practice

- **Monitor Redis**: Set up health checks and alerting
- **Restart server**: When Redis restored (to resume optimal operation)
- **Don't rely on webhooks**: When Redis down, server restart loses webhook queue

---

## HTTP/2 Connection Reset

### When It Happens

- Google API closes idle HTTP/2 connections (after 5+ minutes)
- Network interruption
- Proxy/firewall termination

### Behavior

- **Auto-reset**: Connections reset after 3 consecutive errors
- **Proactive keepalive**: Periodic pings maintain connection health
- **Transparent recovery**: Clients unaffected (request automatically retried)

### Logging

```
WARN: Consecutive error threshold reached, triggering connection reset
INFO: HTTP/2 connection reset (reason: consecutive_errors)
```

### Best Practice

- **Nothing required**: Handled automatically
- **Monitor logs**: Frequent resets may indicate network issues

---

## Disk Space Exhausted

### When It Happens

- `/tmp/` or `~/.servalsheets/` fills up
- Log rotation disabled

### Behavior

- **Pre-flight check**: Warns if directory not writable (non-critical)
- **Runtime**: Write operations fail (snapshots, history, cache persistence)

### Error Response

```json
{
  "code": "INTERNAL_ERROR",
  "message": "Failed to write snapshot",
  "details": {
    "reason": "ENOSPC: no space left on device"
  }
}
```

### Best Practice

- **Monitor disk usage**: Especially `/tmp/` and `~/.servalsheets/`
- **Log rotation**: Enable log rotation in production
- **Cleanup**: Old snapshots and history automatically pruned (configurable retention)

---

## Degradation Mode Summary

| Failure Mode         | Retryable | Auto-Recovery            | Client Action             |
| -------------------- | --------- | ------------------------ | ------------------------- |
| Circuit Breaker OPEN | Yes       | After timeout (30s)      | Wait, don't retry         |
| Rate Limit Exceeded  | Yes       | After quota reset        | Wait, use batching        |
| Auth Token Expired   | No        | Auto-refresh if possible | Re-authenticate           |
| Redis Unavailable    | N/A       | When Redis restored      | Monitor, restart optional |
| HTTP/2 Reset         | Yes       | Automatic                | None (transparent)        |
| Disk Space           | No        | Manual cleanup           | Free disk space           |

---

## Monitoring & Alerting

### Key Metrics

- `circuit_breaker_state{name="google-api"}` - Monitor for OPEN state
- `google_api_rate_limit_total` - Track rate limit hits
- `token_refresh_failures_total` - Auth health
- `redis_connection_status` - Redis availability
- `http2_connection_resets_total` - Network health

### Alert Thresholds

- Circuit breaker OPEN for > 1 minute
- Rate limit exceeded > 10 times/hour
- Token refresh failures > 3 consecutive
- Redis down for > 5 minutes

---

## FAQ

**Q: How do I know if the circuit breaker is open?**
A: Check error response for `"circuitBreakerState": "open"` in `details` object.

**Q: Can I disable the circuit breaker?**
A: Not recommended. Set `CIRCUIT_BREAKER_THRESHOLD=999` to effectively disable (emergency only).

**Q: What happens if I retry during circuit breaker OPEN?**
A: Request fails immediately without calling Google API. Wait for `retryAfterMs` period.

**Q: How do I monitor degradation modes?**
A: Use Prometheus metrics endpoint (`GET /metrics`) or check logs for degradation warnings.

**Q: Does ServalSheets require Redis?**
A: No, it's optional. Without Redis, you get in-memory fallbacks with reduced reliability.

---

**Last Updated**: 2026-02-16
**See Also**:

- [Error Handling Guide](../knowledge/api/error-handling.md)
- [Circuit Breaker Configuration](../development/CONFIGURATION.md#circuit-breaker)
- [Monitoring Setup](../deployment/MONITORING.md)
