---
title: 'Runbook: Google API Quota Near Limit'
category: general
last_updated: 2026-02-04
description: 'Alert Name: QuotaNearLimit'
version: 1.6.0
tags: [sheets, grafana]
---

# Runbook: Google API Quota Near Limit

**Alert Name:** `QuotaNearLimit`
**Severity:** Warning
**Component:** Google API
**Threshold:** > 80% of daily quota consumed with > 4 hours remaining

## Impact

Risk of hitting Google API quota limits, which would cause service disruption. Operations may start failing with 429 rate limit errors.

## Symptoms

- API quota consumption > 80%
- Increasing rate limit errors (429)
- Dashboard showing quota warnings
- Google Cloud Console quota metrics elevated

## Diagnosis

### 1. Check Current Quota Usage

```bash
# Check quota metrics
curl http://localhost:3000/metrics | grep servalsheets_quota_usage

# Check rate limit errors
curl http://localhost:3000/metrics | grep servalsheets_rate_limit_hits_total

# View in Grafana
# Navigate to: Overview Dashboard > Google API Metrics > Quota Usage
```

### 2. Identify Heavy Usage Patterns

```bash
# Check most frequent API calls
curl 'http://localhost:9090/api/v1/query?query=topk(10,rate(servalsheets_google_api_calls_total[5m]))'

# Check logs for large operations
kubectl logs -n servalsheets deployment/servalsheets | grep "quota" | tail -50

# Identify users/operations causing high quota usage
kubectl logs -n servalsheets deployment/servalsheets | grep "spreadsheetId" | sort | uniq -c | sort -rn | head -20
```

### 3. Check Google Cloud Console

```bash
# View quota in Google Cloud Console
# Navigate to: APIs & Services > Dashboard > Google Sheets API
# Check: Queries per day, Queries per 100 seconds per user
```

### 4. Review Caching Effectiveness

```bash
# Check cache hit rate
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_cache_hits_total[5m])/rate(servalsheets_cache_requests_total[5m])*100'

# Low hit rate (<50%) indicates cache not working effectively
```

## Resolution Steps

### Step 1: Enable Aggressive Caching

```bash
# Increase cache size
kubectl set env deployment/servalsheets CACHE_MAX_SIZE=2000 -n servalsheets

# Increase cache TTL
kubectl set env deployment/servalsheets CACHE_TTL=1800 -n servalsheets

# Enable ETag caching for all reads
kubectl set env deployment/servalsheets ETAG_CACHE_ENABLED=true -n servalsheets
```

### Step 2: Enable Batching and Request Merging

```bash
# Enable request batching
kubectl set env deployment/servalsheets ENABLE_BATCHING=true -n servalsheets

# Enable request deduplication
kubectl set env deployment/servalsheets ENABLE_REQUEST_DEDUP=true -n servalsheets

# Increase batch window to merge more requests
kubectl set env deployment/servalsheets BATCH_WINDOW_MS=200 -n servalsheets
```

### Step 3: Implement Rate Limiting

```bash
# Add client-side rate limiting
kubectl set env deployment/servalsheets MAX_REQUESTS_PER_MINUTE=60 -n servalsheets

# Add exponential backoff
kubectl set env deployment/servalsheets RETRY_DELAY_MS=1000 -n servalsheets
kubectl set env deployment/servalsheets RETRY_MAX_ATTEMPTS=3 -n servalsheets
```

### Step 4: Throttle Non-Critical Operations

```bash
# Prioritize critical operations
# Delay batch operations, analytics, background tasks

# Check for runaway operations
kubectl logs -n servalsheets deployment/servalsheets | grep "cells.affected" | awk '{if($NF>10000)print}'

# If found, investigate and potentially kill long-running operations
```

### Step 5: Request Quota Increase

If quota increase needed:

1. Go to Google Cloud Console
2. Navigate to: APIs & Services > Google Sheets API > Quotas
3. Click "Edit Quotas"
4. Request increase for:
   - Queries per day
   - Queries per 100 seconds per user
5. Provide justification (business need, user count)

## Prevention

1. **Implement quota monitoring:**

   ```bash
   # Set up alerts at 50%, 70%, 80%, 90% thresholds
   # Enable daily quota usage reports
   ```

2. **Optimize caching strategy:**
   - Enable ETag-based caching for all reads
   - Cache spreadsheet metadata
   - Cache schema information
   - Implement stale-while-revalidate pattern

3. **Enable request optimization:**
   - Batch multiple operations
   - Deduplicate identical requests
   - Merge overlapping range requests
   - Use field masks to fetch only needed data

4. **Implement usage patterns analysis:**

   ```bash
   # Weekly review of API usage patterns
   npm run analyze:quota-usage
   ```

5. **Add circuit breakers:**
   - Prevent quota exhaustion from runaway operations
   - Fail fast when quota is depleted
   - Enable fallback to cached data

## Post-Incident

1. Analyze what caused quota spike
2. Implement optimizations to reduce API calls
3. Review and optimize caching strategy
4. Consider requesting permanent quota increase
5. Add regression tests for quota-heavy operations

## Related Runbooks

- [Google API Errors](./google-api-errors.md)
- [Slow Google API](./slow-google-api.md)
- [Low Cache Hit Rate](./low-cache-hit-rate.md)
- [High Error Rate](./high-error-rate.md)

## Metrics to Monitor

- `servalsheets_quota_usage_percent`
- `servalsheets_google_api_calls_total`
- `servalsheets_rate_limit_hits_total`
- `servalsheets_cache_hit_rate`
- `servalsheets_batch_efficiency`
- `servalsheets_request_dedup_rate`

## Google Sheets API Quotas (Default)

- **Queries per day:** 500,000,000
- **Queries per 100 seconds per user:** 500
- **Queries per 100 seconds:** 2,500

**Note:** Actual quotas may vary based on your Google Cloud project configuration.

## Optimization Targets

- **Cache hit rate:** > 80%
- **Batch efficiency:** > 70%
- **Request deduplication:** > 30%
- **Quota usage:** < 70% during normal operations

## Escalation

- **On-call engineer** (immediate)
- **Engineering manager** (if requires code changes)
- **Google Cloud account manager** (for quota increase)
- **CTO** (if service disruption imminent)
