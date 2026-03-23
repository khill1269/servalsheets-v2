---
title: 'Runbook: Memory Exhaustion'
category: general
last_updated: 2026-02-04
description: 'Alert Name: MemoryExhaustion'
version: 1.6.0
tags: [grafana]
---

# Runbook: Memory Exhaustion

**Alert Name:** `MemoryExhaustion`
**Severity:** Critical
**Component:** Application
**Threshold:** Memory usage > 1.5GB for 5 minutes

## Impact

Application may crash or experience degraded performance. User operations may fail or timeout. High risk of service disruption.

## Symptoms

- Memory usage exceeds 1.5GB threshold
- Slow response times
- Request timeouts
- Increased garbage collection activity
- Potential process crashes or restarts

## Diagnosis

### 1. Check Current Memory Usage

```bash
# Check Node.js heap usage
curl http://localhost:3000/metrics | grep nodejs_heap_size_total_bytes

# Check process memory
curl http://localhost:3000/metrics | grep process_resident_memory_bytes

# View in Grafana
# Navigate to: Overview Dashboard > Memory Usage
```

### 2. Identify Memory Leaks

```bash
# Check for memory growth over time
curl http://localhost:3000/metrics | grep nodejs_heap_space_size_used_bytes

# Generate heap snapshot (requires heap profiler)
kill -USR2 $(pgrep -f 'node.*server')
```

### 3. Check Active Sessions

```bash
# Check session count
curl http://localhost:3000/metrics | grep servalsheets_active_sessions

# Check for leaked sessions
curl http://localhost:3000/health/ready | jq '.checks[] | select(.name == "memory")'
```

### 4. Review Recent Activity

```bash
# Check for large batch operations
kubectl logs -n servalsheets deployment/servalsheets --tail=100 | grep "batch"

# Check for large spreadsheet operations
kubectl logs -n servalsheets deployment/servalsheets | grep "cells.affected"
```

## Resolution Steps

### Step 1: Immediate Mitigation

**Restart the service:**

```bash
# Graceful restart (allows in-flight requests to complete)
kubectl rollout restart deployment/servalsheets -n servalsheets

# Force restart if hung
kubectl delete pod -n servalsheets -l app=servalsheets
```

### Step 2: Reduce Memory Pressure

**Tune caching:**

```bash
# Reduce cache size
kubectl set env deployment/servalsheets CACHE_MAX_SIZE=500 -n servalsheets

# Reduce cache TTL
kubectl set env deployment/servalsheets CACHE_TTL=300 -n servalsheets
```

**Limit batch sizes:**

```bash
# Reduce max batch size
kubectl set env deployment/servalsheets MAX_BATCH_SIZE=50 -n servalsheets

# Reduce concurrent batches
kubectl set env deployment/servalsheets MAX_CONCURRENT_BATCHES=5 -n servalsheets
```

### Step 3: Scale Horizontally

```bash
# Add more replicas to distribute load
kubectl scale deployment/servalsheets --replicas=5 -n servalsheets

# Monitor memory across pods
kubectl top pods -n servalsheets
```

### Step 4: Clear Sessions

```bash
# Clear old sessions (if session management enabled)
curl -X POST http://localhost:3000/admin/clear-sessions

# Or restart with fresh state
kubectl rollout restart deployment/servalsheets -n servalsheets
```

## Prevention

1. **Enable memory limits:**

   ```yaml
   # In deployment manifest
   resources:
     limits:
       memory: 2Gi
     requests:
       memory: 512Mi
   ```

2. **Implement memory monitoring:**
   - Set up proactive alerts at 70% and 85% thresholds
   - Monitor heap growth trends
   - Track garbage collection metrics

3. **Optimize caching:**
   - Implement LRU eviction
   - Set appropriate TTLs
   - Monitor cache hit rates

4. **Limit operation sizes:**
   - Enforce max cells per operation
   - Stream large responses
   - Implement pagination for large datasets

5. **Regular heap snapshots:**

   ```bash
   # Schedule daily heap snapshots
   npm run snapshot:heap
   # Analyze trends weekly
   ```

## Post-Incident

1. Analyze heap snapshot to identify leak source
2. Document root cause and fix in code
3. Add regression test for memory leak
4. Update monitoring thresholds if needed
5. Review and optimize memory-intensive operations

## Related Runbooks

- [High Latency](./high-latency.md)
- [Service Down](./service-down.md)
- [Circuit Breaker](./circuit-breaker.md)

## Metrics to Monitor

- `process_resident_memory_bytes`
- `nodejs_heap_size_total_bytes`
- `nodejs_heap_size_used_bytes`
- `nodejs_gc_duration_seconds`
- `servalsheets_active_sessions`
- `servalsheets_cache_size`

## Escalation

- **On-call engineer** (immediate)
- **Team lead** (if not resolved in 15 minutes)
- **Engineering manager** (if requires code fix)
- **CTO** (if service becomes unavailable)
