---
title: 'Runbook: Low Cache Hit Rate'
category: general
last_updated: 2026-02-04
description: 'Alert Name: LowCacheHitRate'
version: 1.6.0
tags: [grafana]
---

# Runbook: Low Cache Hit Rate

**Alert Name:** `LowCacheHitRate`
**Severity:** Info
**Component:** Caching
**Threshold:** Cache hit rate < 50% for 15 minutes

## Impact

Excessive Google API calls leading to higher latency, quota consumption, and costs. Degraded performance due to cache ineffectiveness.

## Symptoms

- Cache hit rate below 50%
- Increased Google API call volume
- Higher latency on read operations
- Increased quota consumption
- Elevated API costs

## Diagnosis

### 1. Check Cache Performance

```bash
# Check current cache hit rate
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_cache_hits_total[5m])/(rate(servalsheets_cache_hits_total[5m])+rate(servalsheets_cache_misses_total[5m]))*100'

# Check cache size and evictions
curl http://localhost:3000/metrics | grep servalsheets_cache

# View in Grafana
# Navigate to: Performance Dashboard > Cache Performance
```

### 2. Identify Cache Inefficiency Causes

**Common causes:**

- Cache size too small (frequent evictions)
- TTL too short (premature expiration)
- Access patterns not cache-friendly
- Cache warming not implemented
- High write-to-read ratio

```bash
# Check cache evictions
curl http://localhost:3000/metrics | grep servalsheets_cache_evictions_total

# Check cache size vs capacity
curl http://localhost:3000/metrics | grep servalsheets_cache_size
curl http://localhost:3000/metrics | grep servalsheets_cache_capacity

# Review access patterns
kubectl logs -n servalsheets deployment/servalsheets | grep "cache" | tail -100
```

### 3. Analyze Cache Keys

```bash
# Check what's being cached
# Look for patterns in cache misses
kubectl logs -n servalsheets deployment/servalsheets | grep "cache_miss"

# Common patterns:
# - Unique spreadsheet IDs (low reuse)
# - Frequent updates (cache invalidation)
# - Large ranges (can't cache effectively)
```

### 4. Check Write Patterns

```bash
# High write volume invalidates cache
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_tool_calls_total{action=~"update|append|clear"}[5m])'

# Check mutation rate
curl http://localhost:3000/metrics | grep servalsheets_mutations_total
```

## Resolution Steps

### Step 1: Increase Cache Size

```bash
# Increase max cache entries
kubectl set env deployment/servalsheets CACHE_MAX_SIZE=2000 -n servalsheets

# Increase memory limit if needed
kubectl set resources deployment/servalsheets -n servalsheets --limits=memory=2Gi
```

### Step 2: Optimize Cache TTL

```bash
# Increase TTL for stable data
kubectl set env deployment/servalsheets CACHE_TTL=1800 -n servalsheets

# Longer TTL for metadata (rarely changes)
kubectl set env deployment/servalsheets METADATA_CACHE_TTL=3600 -n servalsheets

# Shorter TTL for frequently updated data
kubectl set env deployment/servalsheets VOLATILE_CACHE_TTL=300 -n servalsheets
```

### Step 3: Implement ETag-Based Caching

```bash
# Enable ETag support for conditional requests
kubectl set env deployment/servalsheets ETAG_CACHE_ENABLED=true -n servalsheets

# This allows cache validation without fetching full data
# HTTP 304 Not Modified responses are fast
```

### Step 4: Add Cache Warming

```bash
# Prefetch commonly accessed spreadsheets
kubectl set env deployment/servalsheets ENABLE_CACHE_WARMING=true -n servalsheets

# Configure warming strategy
kubectl set env deployment/servalsheets CACHE_WARM_STRATEGY=frequent_access -n servalsheets

# Warm on startup
kubectl set env deployment/servalsheets CACHE_WARM_ON_STARTUP=true -n servalsheets
```

### Step 5: Optimize Cache Strategy

**Implement tiered caching:**

```bash
# L1: In-memory cache (fast, small)
# L2: Redis cache (slower, larger)
kubectl set env deployment/servalsheets ENABLE_REDIS_CACHE=true -n servalsheets
kubectl set env deployment/servalsheets REDIS_URL=redis://redis:6379 -n servalsheets

# L1 cache for hot data
kubectl set env deployment/servalsheets L1_CACHE_SIZE=500 -n servalsheets
kubectl set env deployment/servalsheets L1_CACHE_TTL=300 -n servalsheets

# L2 cache for warm data
kubectl set env deployment/servalsheets L2_CACHE_TTL=3600 -n servalsheets
```

**Implement selective caching:**

```bash
# Cache read-only operations aggressively
# Skip caching for write operations
# Cache metadata longer than data

# Enable smart invalidation
kubectl set env deployment/servalsheets ENABLE_SMART_INVALIDATION=true -n servalsheets

# Only invalidate affected ranges, not entire spreadsheet
```

## Prevention

1. **Design cache-friendly architecture:**
   - Separate metadata from data caching
   - Use granular cache keys (range-level, not spreadsheet-level)
   - Implement cache-aside pattern
   - Use write-through caching for consistency

2. **Implement cache monitoring:**

   ```bash
   # Monitor these metrics:
   # - Cache hit rate (target > 80%)
   # - Cache eviction rate
   # - Cache size utilization
   # - TTL effectiveness
   ```

3. **Optimize cache keys:**
   - Use normalized ranges (A1:B10 = B10:A1)
   - Hash large keys for efficiency
   - Include version/etag in cache key for invalidation

4. **Add cache analytics:**

   ```typescript
   // Track what's being cached and why misses occur
   recordCacheMiss(reason: 'not_found' | 'expired' | 'evicted', key: string);
   ```

5. **Implement stale-while-revalidate:**

   ```typescript
   // Serve stale cache while fetching fresh data
   const cached = await cache.get(key);
   if (cached && cached.age < staleThreshold) {
     // Return cached, refresh in background
     backgroundRefresh(key);
     return cached.value;
   }
   ```

## Post-Incident

1. Analyze cache access patterns
2. Identify optimization opportunities
3. Review cache configuration
4. Implement recommended caching strategies
5. Add tests for cache effectiveness

## Related Runbooks

- [High Latency](./high-latency.md)
- [Quota Near Limit](./quota-near-limit.md)
- [Slow Google API](./slow-google-api.md)

## Metrics to Monitor

- `servalsheets_cache_hits_total`
- `servalsheets_cache_misses_total`
- `servalsheets_cache_hit_rate`
- `servalsheets_cache_evictions_total`
- `servalsheets_cache_size`
- `servalsheets_cache_ttl_expiration_total`

## Cache Performance Targets

- **Hit Rate:** > 80% (target), > 50% (acceptable)
- **Eviction Rate:** < 5% of cache size per hour
- **Memory Usage:** < 500MB for cache
- **Average Lookup Time:** < 1ms

## Cache Configuration Guidelines

| Cache Type    | Size | TTL   | Use Case                       |
| ------------- | ---- | ----- | ------------------------------ |
| Metadata      | 1000 | 3600s | Spreadsheet properties, schema |
| Read Data     | 2000 | 1800s | Cell values, ranges            |
| API Responses | 1000 | 600s  | Full API response bodies       |
| ETags         | 5000 | 7200s | Conditional request validation |

## Cache Key Design

**Good cache keys:**

- `metadata:${spreadsheetId}` (spreadsheet metadata)
- `range:${spreadsheetId}:${normalizedRange}` (range data)
- `etag:${spreadsheetId}:${range}` (etag for conditional request)

**Bad cache keys:**

- `${spreadsheetId}` (too coarse, low reuse)
- `${timestamp}:${spreadsheetId}` (never reused)
- `${requestId}` (unique per request)

## Optimization Checklist

- [ ] Cache size adequate (< 5% eviction rate)
- [ ] TTL appropriate for data volatility
- [ ] ETag caching enabled
- [ ] Metadata cached separately
- [ ] Cache warming implemented
- [ ] Smart invalidation enabled
- [ ] Tiered caching for large deployments
- [ ] Cache metrics monitored
- [ ] Hit rate > 80%

## Escalation

- **On-call engineer** (if hit rate < 30%)
- **Performance team** (for architecture changes)
- **Engineering manager** (if requires significant refactoring)
