---
title: ServalSheets Metrics Reference
category: runbook
last_updated: 2026-01-31
description: Complete reference for all Prometheus metrics exposed by ServalSheets MCP Server.
version: 1.6.0
tags: [prometheus, grafana]
estimated_time: 15-30 minutes
---

# ServalSheets Metrics Reference

Complete reference for all Prometheus metrics exposed by ServalSheets MCP Server.

## Accessing Metrics

```bash
# HTTP endpoint
GET http://localhost:3000/metrics

# Example with curl
curl http://localhost:3000/metrics
```

## Metrics Inventory

### Tool Call Metrics

#### `servalsheets_tool_calls_total` (Counter)

Total number of tool calls by tool, action, and status.

**Labels**: `tool`, `action`, `status` (success/error)
**Helper**: `recordToolCall(tool, action, status, durationSeconds)`

```promql
# Tool call rate by status
rate(servalsheets_tool_calls_total[5m])

# Error rate
rate(servalsheets_tool_calls_total{status="error"}[5m])
```

#### `servalsheets_tool_call_duration_seconds` (Histogram)

Tool call duration distribution in seconds.

**Labels**: `tool`, `action`
**Buckets**: 0.1, 0.5, 1, 2, 5, 10, 30
**Helper**: `recordToolCall(tool, action, status, durationSeconds)`

```promql
# 95th percentile latency
histogram_quantile(0.95, rate(servalsheets_tool_call_duration_seconds_bucket[5m]))
```

#### `servalsheets_tool_call_latency_summary` (Summary) 🆕

Tool call latency with pre-computed percentiles (more efficient than histogram).

**Labels**: `tool`, `action`
**Percentiles**: 0.5, 0.9, 0.95, 0.99
**Helper**: `recordToolCallLatency(tool, action, durationSeconds)`

```promql
# P99 latency for sheets.read
servalsheets_tool_call_latency_summary{tool="sheets",action="read",quantile="0.99"}
```

### Error Metrics

#### `servalsheets_errors_by_type_total` (Counter) 🆕

Total errors categorized by error type, tool, and action.

**Labels**: `error_type`, `tool`, `action`
**Helper**: `recordError(errorType, tool, action)`

```promql
# Error rate by type
rate(servalsheets_errors_by_type_total[5m])

# Top error types
topk(5, sum by (error_type) (rate(servalsheets_errors_by_type_total[5m])))
```

**Common Error Types**:

- `ValidationError` - Input validation failures
- `AuthenticationError` - Auth failures
- `RateLimitError` - API rate limits hit
- `PermissionError` - Insufficient permissions
- `NotFoundError` - Resource not found

### Google API Metrics

#### `servalsheets_google_api_calls_total` (Counter)

Total Google API calls by method and status.

**Labels**: `method`, `status` (success/error)
**Helper**: `recordGoogleApiCall(method, status, durationSeconds)`

```promql
# API call rate
rate(servalsheets_google_api_calls_total[5m])

# API error rate
rate(servalsheets_google_api_calls_total{status="error"}[5m])
```

#### `servalsheets_google_api_duration_seconds` (Histogram)

Google API call duration distribution.

**Labels**: `method`
**Buckets**: 0.1, 0.5, 1, 2, 5
**Helper**: `recordGoogleApiCall(method, status, durationSeconds)`

```promql
# Average API latency
rate(servalsheets_google_api_duration_seconds_sum[5m]) / rate(servalsheets_google_api_duration_seconds_count[5m])
```

### Circuit Breaker Metrics

#### `servalsheets_circuit_breaker_state` (Gauge)

Circuit breaker state (0=closed, 1=half_open, 2=open).

**Labels**: `circuit`
**Helper**: `updateCircuitBreakerMetric(circuit, state)`

```promql
# Open circuits
servalsheets_circuit_breaker_state{state="open"}

# Alert on open circuit
servalsheets_circuit_breaker_state == 2
```

### Cache Metrics

#### `servalsheets_cache_hits_total` (Counter)

Total cache hits by namespace.

**Labels**: `namespace`
**Helper**: `updateCacheMetrics(namespace, hits, misses, sizeBytes)`

```promql
# Cache hit rate
rate(servalsheets_cache_hits_total[5m]) / (rate(servalsheets_cache_hits_total[5m]) + rate(servalsheets_cache_misses_total[5m]))
```

#### `servalsheets_cache_misses_total` (Counter)

Total cache misses by namespace.

**Labels**: `namespace`
**Helper**: `updateCacheMetrics(namespace, hits, misses, sizeBytes)`

```promql
# Cache miss rate
rate(servalsheets_cache_misses_total[5m])
```

#### `servalsheets_cache_size_bytes` (Gauge)

Current cache size in bytes by namespace.

**Labels**: `namespace`
**Helper**: `updateCacheMetrics(namespace, hits, misses, sizeBytes)`

```promql
# Total cache size across all namespaces
sum(servalsheets_cache_size_bytes)
```

#### `servalsheets_cache_evictions_total` (Counter) 🆕

Total cache entries evicted by reason.

**Labels**: `reason`
**Helper**: `recordCacheEviction(reason)`

```promql
# Eviction rate by reason
rate(servalsheets_cache_evictions_total[5m])
```

**Common Reasons**:

- `size_limit` - Cache size exceeded
- `ttl_expired` - Entry TTL expired
- `manual` - Manual eviction

### Queue Metrics

#### `servalsheets_queue_size` (Gauge)

Current request queue size.

**Helper**: `updateQueueMetrics(size, pending)`

```promql
# Current queue size
servalsheets_queue_size

# Alert on high queue size
servalsheets_queue_size > 100
```

#### `servalsheets_queue_pending` (Gauge)

Current pending requests in queue.

**Helper**: `updateQueueMetrics(size, pending)`

```promql
# Current pending requests
servalsheets_queue_pending
```

#### `servalsheets_request_queue_depth` (Gauge) 🆕

Current number of requests in queue (unified metric).

**Helper**: `updateRequestQueueDepth(depth)`

```promql
# Current queue depth
servalsheets_request_queue_depth

# Average queue depth over time
avg_over_time(servalsheets_request_queue_depth[5m])
```

### Session Metrics

#### `servalsheets_sessions_total` (Gauge)

Total active OAuth sessions.

```promql
# Active sessions
servalsheets_sessions_total

# Alert on session leak
servalsheets_sessions_total > 1000
```

### Batch Operation Metrics

#### `servalsheets_batch_requests_total` (Counter)

Total batch requests by operation type.

**Labels**: `operation`
**Helper**: `recordBatchOperation(operation, size)`

```promql
# Batch request rate
rate(servalsheets_batch_requests_total[5m])
```

#### `servalsheets_batch_size` (Histogram)

Batch size distribution by operation type.

**Labels**: `operation`
**Buckets**: 1, 5, 10, 25, 50, 100, 250, 500
**Helper**: `recordBatchOperation(operation, size)`

```promql
# Average batch size
rate(servalsheets_batch_size_sum[5m]) / rate(servalsheets_batch_size_count[5m])

# P95 batch size
histogram_quantile(0.95, rate(servalsheets_batch_size_bucket[5m]))
```

#### `servalsheets_batch_efficiency_ratio` (Gauge) 🆕

Ratio of operations batched vs individual calls (0-1).

**Labels**: `operation_type`
**Helper**: `updateBatchEfficiency(operationType, ratio)`

```promql
# Current batch efficiency
servalsheets_batch_efficiency_ratio

# Low efficiency alert
servalsheets_batch_efficiency_ratio < 0.5
```

## Common Queries

### Performance Monitoring

```promql
# P99 latency by tool
servalsheets_tool_call_latency_summary{quantile="0.99"}

# Tools with high latency (>2s at P99)
servalsheets_tool_call_latency_summary{quantile="0.99"} > 2.0

# Latency trend over time
avg_over_time(servalsheets_tool_call_latency_summary{quantile="0.95"}[1h])
```

### Error Monitoring

```promql
# Overall error rate
rate(servalsheets_tool_calls_total{status="error"}[5m])

# Error rate by type
sum by (error_type) (rate(servalsheets_errors_by_type_total[5m]))

# Top 5 tools by error rate
topk(5, sum by (tool) (rate(servalsheets_errors_by_type_total[5m])))

# Error spike detection (>10 errors/min)
rate(servalsheets_errors_by_type_total[5m]) * 60 > 10
```

### Capacity Planning

```promql
# Current load
rate(servalsheets_tool_calls_total[5m])

# Queue depth trend
avg_over_time(servalsheets_request_queue_depth[1h])

# Cache size trend
avg_over_time(servalsheets_cache_size_bytes[1h])
```

### Resource Optimization

```promql
# Cache hit rate by namespace
rate(servalsheets_cache_hits_total[5m]) / (
  rate(servalsheets_cache_hits_total[5m]) +
  rate(servalsheets_cache_misses_total[5m])
)

# Batch efficiency by operation
avg(servalsheets_batch_efficiency_ratio) by (operation_type)

# Operations with low batching efficiency
servalsheets_batch_efficiency_ratio < 0.5
```

### API Quota Management

```promql
# Google API call rate
rate(servalsheets_google_api_calls_total[5m])

# Rate limit errors
rate(servalsheets_errors_by_type_total{error_type="RateLimitError"}[5m])

# API calls per tool
sum by (tool) (rate(servalsheets_tool_calls_total[5m]))
```

## Alert Rules

### Critical Alerts

```yaml
# High error rate
- alert: HighErrorRate
  expr: rate(servalsheets_tool_calls_total{status="error"}[5m]) > 0.1
  for: 5m
  annotations:
    summary: High error rate detected

# P99 latency SLA breach
- alert: HighLatencyP99
  expr: servalsheets_tool_call_latency_summary{quantile="0.99"} > 5.0
  for: 5m
  annotations:
    summary: P99 latency exceeds 5 seconds

# Circuit breaker open
- alert: CircuitBreakerOpen
  expr: servalsheets_circuit_breaker_state == 2
  for: 1m
  annotations:
    summary: Circuit breaker is open
```

### Warning Alerts

```yaml
# Low cache hit rate
- alert: LowCacheHitRate
  expr: |
    rate(servalsheets_cache_hits_total[5m]) /
    (rate(servalsheets_cache_hits_total[5m]) + rate(servalsheets_cache_misses_total[5m])) < 0.5
  for: 10m
  annotations:
    summary: Cache hit rate below 50%

# High queue depth
- alert: HighQueueDepth
  expr: servalsheets_request_queue_depth > 100
  for: 5m
  annotations:
    summary: Request queue depth exceeds 100

# Low batch efficiency
- alert: LowBatchEfficiency
  expr: servalsheets_batch_efficiency_ratio < 0.5
  for: 10m
  annotations:
    summary: Batch efficiency below 50%

# High cache eviction rate
- alert: HighCacheEvictionRate
  expr: rate(servalsheets_cache_evictions_total[5m]) > 10
  for: 5m
  annotations:
    summary: Cache eviction rate exceeds 10/s
```

## Grafana Dashboard

Example dashboard queries for visualization:

### Performance Panel

```promql
# Latency percentiles
servalsheets_tool_call_latency_summary{tool="sheets"}

# Request rate
rate(servalsheets_tool_calls_total[5m])
```

### Errors Panel

```promql
# Error rate by type
sum by (error_type) (rate(servalsheets_errors_by_type_total[5m]))

# Error rate by tool
sum by (tool) (rate(servalsheets_errors_by_type_total[5m]))
```

### Efficiency Panel

```promql
# Cache hit rate
rate(servalsheets_cache_hits_total[5m]) /
(rate(servalsheets_cache_hits_total[5m]) + rate(servalsheets_cache_misses_total[5m]))

# Batch efficiency
avg(servalsheets_batch_efficiency_ratio) by (operation_type)
```

### Capacity Panel

```promql
# Queue depth
servalsheets_request_queue_depth

# Cache size
sum(servalsheets_cache_size_bytes)

# Active sessions
servalsheets_sessions_total
```

## Integration Guide

### Express/HTTP Server

```typescript
import { metricsHandler } from './observability/metrics.js';

app.get('/metrics', metricsHandler);
```

### Tool Call Wrapper

```typescript
import { recordToolCall, recordToolCallLatency, recordError } from './observability/metrics.js';

async function handleTool(tool: string, action: string, params: unknown) {
  const start = Date.now();

  try {
    const result = await executeToolCall(tool, action, params);

    const duration = (Date.now() - start) / 1000;
    recordToolCall(tool, action, 'success', duration);
    recordToolCallLatency(tool, action, duration);

    return result;
  } catch (error) {
    const duration = (Date.now() - start) / 1000;
    recordToolCall(tool, action, 'error', duration);
    recordError(error.name, tool, action);

    throw error;
  }
}
```

### Cache Integration

```typescript
import { updateCacheMetrics, recordCacheEviction } from './observability/metrics.js';

cache.on('get', (key, value) => {
  const hit = value !== undefined;
  updateCacheMetrics('default', hit ? 1 : 0, hit ? 0 : 1, cache.size);
});

cache.on('evict', (key, reason) => {
  recordCacheEviction(reason);
});
```

### Queue Integration

```typescript
import { updateQueueMetrics, updateRequestQueueDepth } from './observability/metrics.js';

queue.on('change', () => {
  updateQueueMetrics(queue.size, queue.pending);
  updateRequestQueueDepth(queue.depth);
});
```

### Batch Operation Tracking

```typescript
import { recordBatchOperation, updateBatchEfficiency } from './observability/metrics.js';

function executeBatch(operation: string, items: unknown[]) {
  recordBatchOperation(operation, items.length);

  const totalOps = getTotalOperations();
  const batchedOps = getBatchedOperations();
  updateBatchEfficiency(operation, batchedOps / totalOps);
}
```

## New Metrics (v1.6.0) 🆕

The following metrics were added in v1.6.0 to enhance production observability:

1. **`servalsheets_errors_by_type_total`** - Detailed error tracking by type
2. **`servalsheets_tool_call_latency_summary`** - Efficient percentile calculation
3. **`servalsheets_batch_efficiency_ratio`** - Batching effectiveness monitoring
4. **`servalsheets_request_queue_depth`** - Unified queue depth metric
5. **`servalsheets_cache_evictions_total`** - Cache eviction tracking

---

**Last Updated**: 2026-01-09
**Version**: 1.3.0
