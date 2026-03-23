---
title: 'Runbook: High Latency'
category: general
last_updated: 2026-02-04
description: 'Alert Name: HighLatency'
version: 1.6.0
tags: [grafana]
---

# Runbook: High Latency

**Alert Name:** `HighLatency`
**Severity:** Warning
**Component:** Performance
**Threshold:** P95 > 3s or P99 > 5s for 5 minutes

## Impact

Users experiencing slow responses. Degraded user experience. May lead to timeouts and client disconnections.

## Symptoms

- P95 latency exceeds 3 seconds
- P99 latency exceeds 5 seconds
- Slow dashboard response
- Users reporting "sluggish" operations
- Request queue buildup

## Diagnosis

### 1. Check Latency Metrics

```bash
# Check current P95/P99 latency
curl 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,servalsheets_tool_call_duration_seconds_bucket)'

# View in Grafana
# Navigate to: Performance Dashboard > Latency Percentiles
```

### 2. Identify Slow Operations

```bash
# Check slowest tools
curl http://localhost:3000/metrics | grep servalsheets_tool_call_duration_seconds_sum

# View slow operations in logs
kubectl logs -n servalsheets deployment/servalsheets | grep "duration" | sort -k5 -n | tail -20

# Grafana query for slowest operations
# Navigate to: Performance Dashboard > Top 10 Slowest Operations
```

### 3. Check Google API Latency

```bash
# Check Google API response times
curl 'http://localhost:9090/api/v1/query?query=servalsheets_google_api_duration_seconds'

# View in Grafana
# Navigate to: Performance Dashboard > Google API Latency
```

### 4. Check System Resources

```bash
# Check CPU and memory
kubectl top pods -n servalsheets

# Check database/cache performance
curl http://localhost:3000/metrics | grep cache_hits_total
```

## Resolution Steps

### Step 1: Identify Bottleneck

**Check cache performance:**

```bash
# Low cache hit rate?
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_cache_hits_total[5m])/rate(servalsheets_cache_requests_total[5m])'

# If < 50%, see: Low Cache Hit Rate Runbook
```

**Check Google API delays:**

```bash
# Google API slow?
curl 'http://localhost:9090/api/v1/query?query=servalsheets_google_api_duration_seconds{quantile="0.95"}'

# If > 1s, see: Slow Google API Runbook
```

**Check request queue:**

```bash
# Queue backup?
curl http://localhost:3000/metrics | grep servalsheets_queue_pending

# If > 50, need to scale or optimize
```

### Step 2: Quick Optimizations

**Enable/optimize caching:**

```bash
# Increase cache size
kubectl set env deployment/servalsheets CACHE_MAX_SIZE=1000 -n servalsheets

# Increase cache TTL for reads
kubectl set env deployment/servalsheets CACHE_TTL=600 -n servalsheets
```

**Enable batching:**

```bash
# Ensure batching is enabled
kubectl set env deployment/servalsheets ENABLE_BATCHING=true -n servalsheets

# Tune batch window
kubectl set env deployment/servalsheets BATCH_WINDOW_MS=100 -n servalsheets
```

**Enable parallel execution:**

```bash
# Increase concurrency
kubectl set env deployment/servalsheets MAX_CONCURRENT_OPERATIONS=10 -n servalsheets
```

### Step 3: Scale Resources

**Horizontal scaling:**

```bash
# Add more replicas
kubectl scale deployment/servalsheets --replicas=5 -n servalsheets

# Monitor if latency improves
```

**Vertical scaling:**

```bash
# Increase CPU limits
kubectl set resources deployment/servalsheets -n servalsheets --limits=cpu=2000m

# Monitor performance improvement
```

### Step 4: Database Optimization

**If using external database:**

```bash
# Check connection pool size
kubectl set env deployment/servalsheets DB_POOL_SIZE=20 -n servalsheets

# Enable query caching
kubectl set env deployment/servalsheets DB_CACHE_ENABLED=true -n servalsheets
```

## Prevention

1. **Implement performance budgets:**
   - P95 < 500ms for read operations
   - P95 < 2000ms for write operations
   - Monitor and alert on SLO breaches

2. **Enable caching layers:**
   - ETag-based caching for reads
   - Schema caching
   - Metadata caching
   - Set appropriate TTLs

3. **Optimize batch operations:**
   - Adaptive batch windows
   - Request deduplication
   - Parallel execution
   - Smart request merging

4. **Add performance tests:**

   ```bash
   npm run test:performance
   npm run test:load
   ```

5. **Regular performance profiling:**

   ```bash
   # Generate flame graphs weekly
   npm run profile
   ```

## Post-Incident

1. Identify specific slow operations from traces
2. Optimize slow code paths
3. Add performance regression tests
4. Update caching strategies
5. Review and tune monitoring thresholds

## Related Runbooks

- [Memory Exhaustion](./memory-exhaustion.md)
- [Low Cache Hit Rate](./low-cache-hit-rate.md)
- [Slow Google API](./slow-google-api.md)
- [Google API Errors](./google-api-errors.md)

## Metrics to Monitor

- `servalsheets_tool_call_duration_seconds` (histogram)
- `servalsheets_google_api_duration_seconds` (histogram)
- `servalsheets_queue_pending`
- `servalsheets_cache_hit_rate`
- `servalsheets_batch_efficiency`
- `servalsheets_parallel_execution_duration_seconds`

## Performance Targets

- **P50:** < 100ms
- **P95:** < 500ms (reads), < 2000ms (writes)
- **P99:** < 1000ms (reads), < 5000ms (writes)
- **Timeout:** 30s (hard limit)

## Escalation

- **On-call engineer** (if P95 > 5s)
- **Performance team** (if sustained > 30 minutes)
- **Engineering manager** (if SLO breach)
