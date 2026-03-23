---
title: 'Runbook: Slow Google API Calls'
category: general
last_updated: 2026-02-04
description: 'Alert Name: SlowGoogleApi'
version: 1.6.0
tags: [api, sheets, grafana]
---

# Runbook: Slow Google API Calls

**Alert Name:** `SlowGoogleApi`
**Severity:** Warning
**Component:** Google API
**Threshold:** P95 Google API latency > 2s for 10 minutes

## Impact

Slow Google API responses causing increased overall latency. User operations taking longer than expected. Risk of timeouts on complex operations.

## Symptoms

- Google API P95 latency exceeds 2 seconds
- Overall application latency increased
- Operations timing out
- Dashboard showing Google API slowness
- Users reporting "slow" spreadsheet operations

## Diagnosis

### 1. Check Google API Latency

```bash
# Check current Google API latency
curl 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,servalsheets_google_api_duration_seconds_bucket)'

# Check latency by method
curl http://localhost:3000/metrics | grep servalsheets_google_api_duration_seconds_sum

# View in Grafana
# Navigate to: Performance Dashboard > Google API Latency
```

### 2. Identify Slow Operations

```bash
# Find slowest API methods
curl 'http://localhost:9090/api/v1/query?query=topk(10,servalsheets_google_api_duration_seconds_sum)'

# Check logs for slow operations
kubectl logs -n servalsheets deployment/servalsheets | grep "google_api" | grep "duration" | sort -k6 -rn | head -20

# Common slow operations:
# - spreadsheets.get (fetching large spreadsheets)
# - values.batchUpdate (large batch writes)
# - spreadsheets.batchUpdate (complex formatting)
```

### 3. Check Google API Status

```bash
# Check Google Workspace Status Dashboard
curl -s https://www.google.com/appsstatus/dashboard/incidents | jq '.[] | select(.service == "Google Sheets")'

# Or visit: https://www.google.com/appsstatus/dashboard
# Look for: Service disruptions, Performance issues
```

### 4. Check Network Path

```bash
# Test latency to Google APIs
time curl -I https://sheets.googleapis.com/v4/spreadsheets/test

# Check for network issues
traceroute sheets.googleapis.com

# Check DNS resolution time
time nslookup sheets.googleapis.com
```

## Resolution Steps

### Step 1: Enable Aggressive Caching

```bash
# Increase cache size for API responses
kubectl set env deployment/servalsheets CACHE_MAX_SIZE=2000 -n servalsheets

# Increase cache TTL
kubectl set env deployment/servalsheets CACHE_TTL=1800 -n servalsheets

# Enable ETag caching for reads
kubectl set env deployment/servalsheets ETAG_CACHE_ENABLED=true -n servalsheets

# Cache metadata aggressively
kubectl set env deployment/servalsheets METADATA_CACHE_TTL=3600 -n servalsheets
```

### Step 2: Optimize Request Patterns

**Use field masks to fetch less data:**

```bash
# Configure default field masks
kubectl set env deployment/servalsheets USE_FIELD_MASKS=true -n servalsheets

# Examples of field masks:
# - spreadsheets.get: fields=properties,sheets(properties)
# - values.get: fields=values,range
# This reduces response size and improves latency
```

**Enable request batching:**

```bash
# Batch multiple operations
kubectl set env deployment/servalsheets ENABLE_BATCHING=true -n servalsheets

# Increase batch size (but not too large)
kubectl set env deployment/servalsheets MAX_BATCH_SIZE=100 -n servalsheets
```

**Reduce request sizes:**

```bash
# Limit max cells per request
kubectl set env deployment/servalsheets MAX_CELLS_PER_REQUEST=10000 -n servalsheets

# Paginate large reads
kubectl set env deployment/servalsheets ENABLE_PAGINATION=true -n servalsheets
```

### Step 3: Add Timeouts and Circuit Breakers

```bash
# Add aggressive timeouts
kubectl set env deployment/servalsheets GOOGLE_API_TIMEOUT=10000 -n servalsheets

# Enable circuit breaker
kubectl set env deployment/servalsheets CIRCUIT_BREAKER_ENABLED=true -n servalsheets

# Configure circuit breaker for slow operations
kubectl set env deployment/servalsheets CIRCUIT_BREAKER_SLOW_CALL_THRESHOLD=5000 -n servalsheets
```

### Step 4: Parallel Execution

```bash
# Enable parallel execution for independent operations
kubectl set env deployment/servalsheets ENABLE_PARALLEL_EXECUTION=true -n servalsheets

# Increase concurrency
kubectl set env deployment/servalsheets MAX_CONCURRENT_OPERATIONS=10 -n servalsheets
```

### Step 5: Regional Optimization

**If using specific Google Cloud region:**

```bash
# Ensure application is in same region as most users
# Consider multi-region deployment for global users

# Check if Google API regional endpoints help
# (Note: Sheets API doesn't have regional endpoints)
```

## Prevention

1. **Implement proactive caching:**
   - ETag-based caching for all reads
   - Cache spreadsheet metadata
   - Prefetch commonly accessed spreadsheets
   - Implement stale-while-revalidate pattern

2. **Optimize API usage:**
   - Always use field masks
   - Batch operations when possible
   - Paginate large reads
   - Limit cell counts per operation

3. **Add performance monitoring:**

   ```bash
   # Set up alerts at multiple thresholds
   # P95 > 1s (warning)
   # P95 > 2s (critical)
   # Track Google API status proactively
   ```

4. **Implement request optimization:**
   - Request deduplication
   - Request merging for overlapping ranges
   - Prefetching for predictable access patterns

5. **Add distributed tracing:**

   ```typescript
   // Trace Google API calls
   await instrumentedApiCall(
     'spreadsheets.get',
     async () => {
       return await sheets.spreadsheets.get({
         spreadsheetId,
         fields: 'properties,sheets(properties)',
       });
     },
     { spreadsheetId }
   );
   ```

## Post-Incident

1. Analyze slow operations from traces
2. Identify optimization opportunities
3. Review and optimize field masks
4. Consider caching strategies for slow operations
5. Document patterns that cause slowness

## Related Runbooks

- [High Latency](./high-latency.md)
- [Google API Errors](./google-api-errors.md)
- [Quota Near Limit](./quota-near-limit.md)
- [Low Cache Hit Rate](./low-cache-hit-rate.md)

## Metrics to Monitor

- `servalsheets_google_api_duration_seconds` (histogram)
- `servalsheets_google_api_calls_total`
- `servalsheets_cache_hit_rate`
- `servalsheets_batch_efficiency`
- `servalsheets_parallel_execution_duration_seconds`
- `servalsheets_field_mask_usage_total`

## Performance Targets

- **P50:** < 200ms
- **P95:** < 1000ms
- **P99:** < 2000ms
- **Timeout:** 10s (configurable)

## Common Slow Operations

| Operation                  | Typical Latency | Optimization                           |
| -------------------------- | --------------- | -------------------------------------- |
| `spreadsheets.get`         | 200-500ms       | Use field masks, cache metadata        |
| `values.get`               | 100-300ms       | Cache reads, use ETags                 |
| `values.update`            | 300-800ms       | Batch updates, reduce cell count       |
| `values.batchUpdate`       | 500-2000ms      | Optimize batch size, parallelize       |
| `spreadsheets.batchUpdate` | 800-3000ms      | Reduce complexity, use smaller batches |

## Optimization Checklist

- [ ] Field masks enabled for all reads
- [ ] ETag caching enabled
- [ ] Metadata caching enabled
- [ ] Request batching enabled
- [ ] Parallel execution for independent ops
- [ ] Circuit breakers configured
- [ ] Timeouts set appropriately
- [ ] Cache hit rate > 80%
- [ ] Batch efficiency > 70%

## Escalation

- **On-call engineer** (if P95 > 2s sustained)
- **Performance team** (for optimization work)
- **Engineering manager** (if code changes needed)
- **Google Cloud support** (if Google API issue)
