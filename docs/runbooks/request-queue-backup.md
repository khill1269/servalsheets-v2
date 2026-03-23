---
title: 'Runbook: Request Queue Backup'
category: general
last_updated: 2026-02-24
description: 'Alert Name: RequestQueueBackup'
version: 1.7.0
tags: [performance, queue, backpressure]
---

# Runbook: Request Queue Backup

**Alert Name:** `RequestQueueBackup`
**Severity:** Warning
**Component:** Request processing / BatchingSystem
**Threshold:** Pending batch queue depth > 500 operations OR batch wait time P95 > 500ms

## Impact

Tool calls are taking longer than expected to process. Users experience increased latency.
Under severe backup, requests may begin timing out (default client timeout: 30s).
Batch operations (format, write, dimensions) are most affected.

## Symptoms

- Tool call latency increasing steadily
- `servalsheets_batching_pending_operations` gauge rising
- `servalsheets_batch_queue_wait_p95` metric exceeding 500ms
- Circuit breaker NOT open (this is a queue issue, not an API error)
- Error rate stable (requests are slow, not failing)

## Diagnosis

### Step 1 — Confirm it's a queue backup, not an API issue

```bash
# Check circuit breaker states
curl http://localhost:3000/metrics | grep circuit_breaker_state

# Check batch queue depth
curl http://localhost:3000/metrics | grep batching_pending

# Check error rate (should be low if pure queue backup)
curl http://localhost:3000/metrics | grep tool_call_errors_total
```

### Step 2 — Identify the slow batch type

```bash
# Which operation types are backing up?
curl http://localhost:3000/metrics | grep batch_execution_duration_seconds
```

Common culprits:

- `batchUpdate` batches: format/dimension operations waiting for Google API
- `values.batchGet` batches: read operations under high load
- `values.update` batches: write operations with high cell counts

### Step 3 — Check Google API quota headroom

```bash
curl http://localhost:3000/metrics | grep quota_usage_percent
```

If quota usage > 80%, see `quota-near-limit.md` runbook.

### Step 4 — Check memory pressure

```bash
curl http://localhost:3000/health/detailed | jq '.memory'
```

High memory (> 1.5GB) causes GC pauses that back up the queue.
See `memory-exhaustion.md` if memory is high.

## Resolution Steps

### Option A — Reduce batch window (fast relief)

Temporarily reduce the batch accumulation window to process smaller batches faster:

```bash
# Restart with shorter batch window
BATCH_WINDOW_MS=20 npm start

# Default is 50ms; reduce to 20ms under load
```

**Tradeoff:** Smaller batches = more API calls, higher quota usage.
Only use when queue backup is severe (> 1000 pending operations).

### Option B — Scale horizontally

If a single instance is overloaded:

1. Deploy an additional instance behind the load balancer
2. Ensure Redis is configured for shared state (`CACHE_REDIS_ENABLED=true`)
3. Monitor that session state is correctly distributed

### Option C — Enable request rate limiting

If a single user is generating excess load:

```bash
# Check per-user request rates
curl http://localhost:3000/metrics | grep user_request_rate
```

Reduce per-user limit temporarily via `MAX_REQUESTS_PER_USER_PER_MINUTE` env var.

### Option D — Drain and restart (last resort)

1. Stop accepting new connections: `kill -SIGUSR2 <pid>` (triggers graceful drain)
2. Wait for active requests to complete (up to 10s drain timeout)
3. Restart process: `systemctl restart servalsheets`

## Prevention

- Set `BATCH_MAX_OPERATIONS=50` (default 100) to reduce worst-case batch processing time
- Enable Redis caching to reduce repeat read volume: `CACHE_REDIS_ENABLED=true`
- Configure `MAX_CONCURRENT_REQUESTS=50` (default 100) to apply backpressure at entry
- Monitor `servalsheets_batching_pending_operations` — alert at > 200 (Warning), > 500 (Critical)

## Post-Incident

1. Review batch operation counts during incident window
2. Identify which tool/action generated the spike
3. Check if a new deployment correlates with the backup
4. Consider adding rate limits to the highest-volume operation
5. File post-mortem if duration > 15 minutes: `.github/INCIDENT_TEMPLATE/post-mortem.md`

## Related Runbooks

- `high-latency.md` — if P99 latency is also elevated
- `quota-near-limit.md` — if quota is also near limit
- `memory-exhaustion.md` — if memory is also high
- `circuit-breaker.md` — if circuit breakers trip during the backup

## Metrics to Monitor

| Metric | Warning | Critical |
|--------|---------|----------|
| `servalsheets_batching_pending_operations` | > 200 | > 500 |
| `servalsheets_batch_wait_duration_p95_ms` | > 300ms | > 500ms |
| `servalsheets_tool_call_duration_p99_ms` | > 5000ms | > 10000ms |
| `servalsheets_active_requests` | > 80 | > 100 |

## Escalation

- **L1 (0–15 min):** On-call engineer — apply Option A (reduce batch window)
- **L2 (15–30 min):** Team lead — consider horizontal scaling (Option B)
- **L3 (30+ min):** Engineering manager — evaluate rate limiting and root cause
