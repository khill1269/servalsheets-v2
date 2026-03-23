---
title: Monitoring and Observability Guide
category: guide
last_updated: 2026-02-03
description: This guide covers monitoring, logging, and observability strategies for ServalSheets in production, including automatic background quality analysis.
version: 1.6.0
tags: [monitoring, observability, sheets, prometheus, grafana, docker, kubernetes, quality-analysis]
audience: user
difficulty: intermediate
---

# Monitoring and Observability Guide

This guide covers monitoring, logging, and observability strategies for ServalSheets in production.

## Table of Contents

- [Overview](#overview)
- [Structured Logging](#structured-logging)
- [Metrics Collection](#metrics-collection)
- [Health Checks](#health-checks)
- [APM Integration](#apm-integration)
- [Alerting](#alerting)
- [Dashboards](#dashboards)
- [Troubleshooting](#troubleshooting)

---

## Overview

ServalSheets provides comprehensive observability through:

- **Structured JSON logging** - Machine-parseable logs
- **Performance metrics** - Operation timing and quota usage
- **Health checks** - Service readiness and liveness
- **Error tracking** - Detailed error context
- **Quota monitoring** - Google API quota usage

### Observability Goals

| Goal                   | Target        | Method             |
| ---------------------- | ------------- | ------------------ |
| Log all operations     | 100%          | Structured logging |
| Track quota usage      | Real-time     | Metrics            |
| Detect errors          | < 1 min       | Alerting           |
| Performance visibility | Per-operation | Tracing            |
| Service health         | 99.9% uptime  | Health checks      |

---

## Structured Logging

ServalSheets uses **structured JSON logging** for machine-parseable logs.

### Log Levels

```typescript
// From src/logging/logger.ts
export enum LogLevel {
  DEBUG = 'debug', // Detailed debugging info
  INFO = 'info', // General information
  WARN = 'warn', // Warning messages
  ERROR = 'error', // Error messages
}
```

### Configuration

```bash
# Set log level
export LOG_LEVEL=info           # debug, info, warn, error

# Set log format
export LOG_FORMAT=json          # json or text

# Set log destination (optional)
export LOG_FILE=/var/log/servalsheets/app.log
```

### Log Format

#### JSON Format (Production)

```json
{
  "timestamp": "2025-01-03T10:15:30.123Z",
  "level": "info",
  "message": "Operation completed",
  "operation": "sheets_core:read",
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "range": "Sheet1!A1:D10",
  "duration": 156,
  "quotaType": "read",
  "cellCount": 40,
  "success": true
}
```

#### Text Format (Development)

```
2025-01-03T10:15:30.123Z [INFO] Operation completed
  operation: sheets_core:read
  spreadsheetId: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
  range: Sheet1!A1:D10
  duration: 156ms
  quotaType: read
  cellCount: 40
```

### Log Schema

```typescript
// From src/logging/schemas.ts
export interface OperationLog {
  timestamp: string; // ISO 8601
  level: LogLevel; // debug, info, warn, error
  message: string; // Human-readable message
  operation: string; // Tool:action (e.g., sheets_core:read)
  spreadsheetId?: string; // Spreadsheet ID
  range?: string; // Cell range
  duration: number; // Milliseconds
  quotaType: 'read' | 'write'; // Quota bucket
  cellCount?: number; // Cells affected
  success: boolean; // Operation succeeded
  error?: ErrorDetails; // Error details if failed
}

export interface ErrorDetails {
  code: string; // Error code
  message: string; // Error message
  stack?: string; // Stack trace (debug only)
  retries?: number; // Retry attempts
}
```

### Logging Examples

#### Successful Operation

```json
{
  "timestamp": "2025-01-03T10:15:30.123Z",
  "level": "info",
  "message": "Read operation completed",
  "operation": "sheets_core:read",
  "spreadsheetId": "xxx",
  "range": "Sheet1!A1:D10",
  "duration": 156,
  "quotaType": "read",
  "cellCount": 40,
  "success": true
}
```

#### Failed Operation

```json
{
  "timestamp": "2025-01-03T10:15:35.456Z",
  "level": "error",
  "message": "Write operation failed",
  "operation": "sheets_core:write",
  "spreadsheetId": "xxx",
  "range": "Sheet1!A1:A10",
  "duration": 245,
  "quotaType": "write",
  "cellCount": 10,
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "The caller does not have permission",
    "retries": 3
  }
}
```

#### Quota Exhaustion

```json
{
  "timestamp": "2025-01-03T10:16:00.789Z",
  "level": "warn",
  "message": "Rate limit approaching",
  "quotaType": "write",
  "quotaUsed": 58,
  "quotaLimit": 60,
  "quotaRemaining": 2,
  "utilizationPct": 96.7
}
```

### Log Aggregation

#### CloudWatch Logs

```bash
# Install CloudWatch agent
sudo yum install amazon-cloudwatch-agent

# Configure log stream
cat > /opt/aws/amazon-cloudwatch-agent/etc/config.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/servalsheets/*.log",
            "log_group_name": "/servalsheets/production",
            "log_stream_name": "{instance_id}",
            "timestamp_format": "%Y-%m-%dT%H:%M:%S.%fZ"
          }
        ]
      }
    }
  }
}
EOF

# Start agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json \
  -s
```

#### ELK Stack

```yaml
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/servalsheets/*.log
    json.keys_under_root: true
    json.add_error_key: true

output.elasticsearch:
  hosts: ['elasticsearch:9200']
  index: 'servalsheets-%{+yyyy.MM.dd}'
```

#### Splunk

```bash
# inputs.conf
[monitor:///var/log/servalsheets/*.log]
disabled = false
sourcetype = _json
index = servalsheets
```

---

## Background Quality Analysis

ServalSheets automatically monitors data quality after destructive operations using fire-and-forget background analysis.

### How It Works

Background quality analysis:

- **Triggers automatically** after write operations affecting ≥10 cells (configurable)
- **Runs in background** (non-blocking, fire-and-forget pattern)
- **Debounces operations** with 2-second window to batch multiple writes
- **Adds alerts** to session context if quality drops >20%

### Configuration

```bash
# Enable/disable background analysis (default: enabled)
ENABLE_BACKGROUND_ANALYSIS=true

# Minimum cells changed to trigger analysis (default: 10)
BACKGROUND_ANALYSIS_MIN_CELLS=10

# Debounce window in milliseconds (default: 2000 = 2 seconds)
BACKGROUND_ANALYSIS_DEBOUNCE_MS=2000
```

### Operations Monitored

Background analysis automatically triggers after:

1. **Write Operations** - `sheets_data:write`, `sheets_data:update`
2. **Append Operations** - `sheets_data:append` (both table and range)
3. **Clear Operations** - `sheets_data:clear` (destructive)
4. **Dimension Deletions** - `sheets_dimensions:delete` (rows/columns)

### Alert Format

When quality degradation is detected, alerts are added to the session context:

```json
{
  "severity": "high",
  "message": "Data quality dropped from 85% to 65% after write to A1:B100",
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "actionable": {
    "tool": "sheets_fix",
    "action": "fix_all",
    "params": {
      "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
      "range": "A1:B100",
      "preview": true
    }
  }
}
```

### Logging

Background analysis logs are structured for easy monitoring:

```json
{
  "timestamp": "2026-02-03T10:15:30.123Z",
  "level": "info",
  "message": "Starting background quality analysis",
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "range": "A1:B100"
}
```

```json
{
  "timestamp": "2026-02-03T10:15:32.456Z",
  "level": "warn",
  "message": "Quality drop alert triggered",
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "qualityChange": -20,
  "range": "A1:B100"
}
```

### Disabling Background Analysis

To disable background analysis (not recommended for production):

```bash
# Disable background analysis
export ENABLE_BACKGROUND_ANALYSIS=false

# Restart server
npm run start
```

### Performance Impact

Background analysis is designed to be non-blocking:

- **Latency**: 0ms (fire-and-forget, no wait)
- **Memory**: Minimal (runs in existing event loop)
- **Debouncing**: Batches multiple rapid writes into single analysis

### Integration with sheets_analyze

Background analysis provides lightweight monitoring. For comprehensive analysis, use the `sheets_analyze` tool:

```typescript
// Background: Lightweight automatic monitoring (always on)
// - Quick quality score calculation
// - Triggered by writes >10 cells
// - Adds alerts to session context

// Explicit: Comprehensive analysis (on-demand)
await sheets_analyze.comprehensive({
  spreadsheetId: '...',
  action: 'comprehensive',
});
// - Full quality analysis
// - Detailed insights
// - Trend detection
// - Anomaly detection
// - Correlation analysis
```

---

## Metrics Collection

ServalSheets exposes metrics for monitoring performance and quota usage.

### Metric Types

```typescript
// From src/metrics/types.ts
export interface Metrics {
  counters: {
    operations_total: number; // Total operations
    operations_success: number; // Successful operations
    operations_error: number; // Failed operations
    quota_reads_used: number; // Read quota used
    quota_writes_used: number; // Write quota used
  };
  gauges: {
    quota_reads_available: number; // Read tokens available
    quota_writes_available: number; // Write tokens available
    cache_size: number; // Cache entries
    memory_usage_mb: number; // Memory usage
  };
  histograms: {
    operation_duration_ms: number[]; // Operation durations
    cell_count_per_operation: number[]; // Cells affected
  };
}
```

### Prometheus Integration

```typescript
// From src/metrics/prometheus.ts
import { Counter, Gauge, Histogram, register } from 'prom-client';

// Counters
export const operationsTotal = new Counter({
  name: 'servalsheets_operations_total',
  help: 'Total number of operations',
  labelNames: ['operation', 'status'],
});

export const quotaUsed = new Counter({
  name: 'servalsheets_quota_used_total',
  help: 'Total quota used',
  labelNames: ['quota_type'],
});

// Gauges
export const quotaAvailable = new Gauge({
  name: 'servalsheets_quota_available',
  help: 'Available quota tokens',
  labelNames: ['quota_type'],
});

export const cacheSize = new Gauge({
  name: 'servalsheets_cache_size',
  help: 'Number of cache entries',
  labelNames: ['cache_type'],
});

// Histograms
export const operationDuration = new Histogram({
  name: 'servalsheets_operation_duration_ms',
  help: 'Operation duration in milliseconds',
  labelNames: ['operation'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const cellCount = new Histogram({
  name: 'servalsheets_cell_count',
  help: 'Number of cells affected by operation',
  labelNames: ['operation'],
  buckets: [1, 10, 100, 1000, 10000, 100000],
});
```

### Metrics Endpoint

```typescript
// Expose /metrics endpoint
import express from 'express';
import { register } from 'prom-client';

const app = express();

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(9090);
```

### Prometheus Configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'servalsheets'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:9090']
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: 'servalsheets_.*'
        action: keep
```

### CloudWatch Metrics

```typescript
// From src/metrics/cloudwatch.ts
import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatch({ region: 'us-east-1' });

export async function publishMetrics(metrics: Metrics): Promise<void> {
  await cloudwatch.putMetricData({
    Namespace: 'ServalSheets',
    MetricData: [
      {
        MetricName: 'OperationsTotal',
        Value: metrics.counters.operations_total,
        Unit: 'Count',
        Timestamp: new Date(),
      },
      {
        MetricName: 'QuotaReadsAvailable',
        Value: metrics.gauges.quota_reads_available,
        Unit: 'Count',
        Timestamp: new Date(),
      },
      {
        MetricName: 'OperationDuration',
        Value:
          metrics.histograms.operation_duration_ms[
            metrics.histograms.operation_duration_ms.length - 1
          ],
        Unit: 'Milliseconds',
        Timestamp: new Date(),
      },
    ],
  });
}
```

### Key Metrics to Monitor

| Metric                   | Type      | Alert Threshold |
| ------------------------ | --------- | --------------- |
| `operations_total`       | Counter   | -               |
| `operations_error`       | Counter   | > 5% of total   |
| `quota_reads_available`  | Gauge     | < 10%           |
| `quota_writes_available` | Gauge     | < 10%           |
| `operation_duration_ms`  | Histogram | p95 > 5000ms    |
| `cache_size`             | Gauge     | > 80% of max    |
| `memory_usage_mb`        | Gauge     | > 80% of limit  |

---

## Health Checks

ServalSheets provides health check endpoints for service monitoring.

### Health Check Types

#### 1. Liveness Probe

Checks if service is running.

```typescript
// From src/health/liveness.ts
export async function checkLiveness(): Promise<boolean> {
  // Simple check: is process alive?
  return true;
}

// Endpoint
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

#### 2. Readiness Probe

Checks if service can handle requests.

```typescript
// From src/health/readiness.ts
export async function checkReadiness(): Promise<HealthStatus> {
  const checks = {
    auth: await checkAuthentication(),
    api: await checkGoogleAPI(),
    cache: await checkCache(),
    rateLimit: await checkRateLimits(),
  };

  const healthy = Object.values(checks).every((check) => check.healthy);

  return {
    healthy,
    checks,
  };
}

// Endpoint
app.get('/health/ready', async (req, res) => {
  const status = await checkReadiness();
  res.status(status.healthy ? 200 : 503).json(status);
});
```

#### 3. Startup Probe

Checks if service has started successfully.

```typescript
// From src/health/startup.ts
export async function checkStartup(): Promise<HealthStatus> {
  const checks = {
    config: await checkConfiguration(),
    credentials: await checkCredentials(),
    initialization: await checkInitialization(),
  };

  const ready = Object.values(checks).every((check) => check.healthy);

  return {
    ready,
    checks,
  };
}

// Endpoint
app.get('/health/startup', async (req, res) => {
  const status = await checkStartup();
  res.status(status.ready ? 200 : 503).json(status);
});
```

### Health Check Responses

#### Healthy

```json
{
  "status": "healthy",
  "timestamp": "2025-01-03T10:15:30.123Z",
  "checks": {
    "auth": {
      "healthy": true,
      "message": "Authentication configured"
    },
    "api": {
      "healthy": true,
      "message": "Google API reachable",
      "latency": 45
    },
    "cache": {
      "healthy": true,
      "message": "Cache operational",
      "size": 42,
      "maxSize": 100
    },
    "rateLimit": {
      "healthy": true,
      "message": "Rate limits healthy",
      "reads": { "available": 280, "capacity": 300 },
      "writes": { "available": 55, "capacity": 60 }
    }
  }
}
```

#### Unhealthy

```json
{
  "status": "unhealthy",
  "timestamp": "2025-01-03T10:16:00.456Z",
  "checks": {
    "auth": {
      "healthy": true,
      "message": "Authentication configured"
    },
    "api": {
      "healthy": false,
      "message": "Google API unreachable",
      "error": "Connection timeout after 5000ms"
    },
    "cache": {
      "healthy": true,
      "message": "Cache operational"
    },
    "rateLimit": {
      "healthy": false,
      "message": "Write quota exhausted",
      "reads": { "available": 280, "capacity": 300 },
      "writes": { "available": 0, "capacity": 60 }
    }
  }
}
```

### Kubernetes Integration

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: servalsheets
spec:
  template:
    spec:
      containers:
        - name: servalsheets
          image: servalsheets:latest
          ports:
            - containerPort: 3000
            - containerPort: 9090 # Metrics
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
          startupProbe:
            httpGet:
              path: /health/startup
              port: 3000
            initialDelaySeconds: 0
            periodSeconds: 5
            failureThreshold: 30
```

---

## APM Integration

ServalSheets integrates with Application Performance Monitoring tools.

### OpenTelemetry

```typescript
// From src/telemetry/otel.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

### Custom Spans

```typescript
// From src/telemetry/tracing.ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('servalsheets');

export async function traceOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// Usage
const result = await traceOperation('sheets_core:read', async () => {
  return await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:D10' });
});
```

### Datadog APM

```typescript
// From src/telemetry/datadog.ts
import tracer from 'dd-trace';

tracer.init({
  service: 'servalsheets',
  env: process.env.NODE_ENV || 'production',
  version: '1.0.0',
  logInjection: true,
});

// Automatic instrumentation of HTTP, Google APIs, etc.
```

### New Relic

```typescript
// From src/telemetry/newrelic.ts
import newrelic from 'newrelic';

// Custom transaction
newrelic.startWebTransaction('sheets_core:read', async () => {
  const result = await read({ action: 'read', spreadsheetId: 'xxx', range: 'A1:D10' });

  // Record custom attributes
  newrelic.addCustomAttributes({
    spreadsheetId: 'xxx',
    range: 'A1:D10',
    cellCount: 40,
  });

  return result;
});
```

---

## Alerting

ServalSheets provides comprehensive Prometheus alert rules for production incident prevention. The complete alert rules are defined in `deployment/prometheus/alerts.yml`.

### Alert Severity Levels

| Severity     | Response Time | Description                             | Examples                                            |
| ------------ | ------------- | --------------------------------------- | --------------------------------------------------- |
| **critical** | Immediate     | User-facing impact, service degradation | Service down, high error rate, circuit breaker open |
| **warning**  | 15 minutes    | Performance degradation, risk of impact | Queue backup, high latency, quota near limit        |
| **info**     | 1 hour        | Optimization opportunities, trends      | Low cache hit rate, small batch sizes               |

### Alert Rule Categories

ServalSheets alerts are organized into four categories:

1. **Critical Alerts** (`servalsheets_critical`) - Immediate response required
2. **Warning Alerts** (`servalsheets_warnings`) - Degraded performance
3. **Info Alerts** (`servalsheets_info`) - Operational awareness
4. **Anomaly Alerts** (`servalsheets_anomalies`) - Rate of change detection

### Critical Alert Rules

#### 1. High Error Rate

**Trigger**: Error rate > 5% for 2 minutes

```yaml
- alert: HighErrorRate
  expr: |
    (
      rate(servalsheets_tool_calls_total{status="error"}[5m]) /
      rate(servalsheets_tool_calls_total[5m])
    ) > 0.05
  for: 2m
  labels:
    severity: critical
```

**Impact**: Users experiencing failed operations

**Response Actions**:

1. Check logs for error patterns
2. Review recent deployments
3. Check Google API status
4. Verify authentication is working

#### 2. Circuit Breaker Open

**Trigger**: Circuit breaker state >= 2 for 1 minute

```yaml
- alert: CircuitBreakerOpen
  expr: servalsheets_circuit_breaker_state{circuit=~".+"} >= 2
  for: 1m
  labels:
    severity: critical
```

**Impact**: Requests to affected service are being rejected

**Response Actions**:

1. Check downstream service health
2. Review error logs
3. Verify network connectivity
4. Check authentication status

#### 3. Service Down

**Trigger**: Service unreachable for 1 minute

```yaml
- alert: ServiceDown
  expr: up{job="servalsheets"} == 0
  for: 1m
  labels:
    severity: critical
```

**Impact**: Complete service outage, all requests failing

**Response Actions**:

1. Check process status
2. Review system logs
3. Check resources (CPU, memory, disk)
4. Verify network connectivity
5. Restart service if needed

#### 4. High Authentication Failure Rate

**Trigger**: Auth failure rate > 10% for 2 minutes

```yaml
- alert: HighAuthenticationFailureRate
  expr: |
    (
      rate(servalsheets_google_api_calls_total{status="error",method=~".*auth.*"}[5m]) /
      rate(servalsheets_google_api_calls_total{method=~".*auth.*"}[5m])
    ) > 0.1
  for: 2m
  labels:
    severity: critical
```

**Impact**: Users unable to authenticate with Google Sheets API

**Response Actions**:

1. Verify OAuth credentials are valid
2. Check token expiration
3. Verify Google API console configuration
4. Check for API quota issues
5. Review service account permissions

#### 5. High Memory Usage

**Trigger**: Memory usage > 1.5GB for 5 minutes

```yaml
- alert: HighMemoryUsage
  expr: |
    (
      process_resident_memory_bytes{job="servalsheets"} /
      (1024 * 1024 * 1024)
    ) > 1.5
  for: 5m
  labels:
    severity: critical
```

**Impact**: Service may crash or become unresponsive

**Response Actions**:

1. Check for memory leaks
2. Review large operations in progress
3. Clear cache if needed
4. Consider scaling up memory
5. Review batch sizes

### Warning Alert Rules

#### 1. Request Queue Backup

**Trigger**: Queue depth > 50 for 5 minutes

```yaml
- alert: RequestQueueBackup
  expr: servalsheets_request_queue_depth > 50
  for: 5m
  labels:
    severity: warning
```

**Impact**: Increased latency for user requests

**Response Actions**:

1. Check for slow operations
2. Review rate limiting configuration
3. Consider horizontal scaling
4. Check for Google API throttling

#### 2. High P99 Latency

**Trigger**: P99 latency > 5 seconds for 5 minutes

```yaml
- alert: HighLatencyP99
  expr: servalsheets_tool_call_latency_summary{quantile="0.99"} > 5
  for: 5m
  labels:
    severity: warning
```

**Impact**: 1% of requests experiencing significant delays

**Response Actions**:

1. Check Google API performance
2. Review cache hit rate
3. Check for large operations
4. Review batch sizes
5. Consider optimizing diff strategy

#### 3. API Quota Near Limit

**Trigger**: API call rate > 55/minute for 2 minutes

```yaml
- alert: APIQuotaNearLimit
  expr: rate(servalsheets_google_api_calls_total[1m]) > 55
  for: 2m
  labels:
    severity: warning
```

**Impact**: Risk of API throttling and request failures

**Response Actions**:

1. Enable or tune caching
2. Review batch efficiency
3. Check for unnecessary API calls
4. Consider rate limiting client requests
5. Request quota increase from Google

### Info Alert Rules

#### 1. Low Cache Hit Rate

**Trigger**: Cache hit rate < 50% for 10 minutes

```yaml
- alert: LowCacheHitRate
  expr: |
    (
      rate(servalsheets_cache_hits_total[5m]) /
      (rate(servalsheets_cache_hits_total[5m]) + rate(servalsheets_cache_misses_total[5m]))
    ) < 0.5
  for: 10m
  labels:
    severity: info
```

**Impact**: Increased API calls and latency

**Response Actions**:

1. Review cache TTL configuration
2. Check cache size limits
3. Review access patterns
4. Consider increasing cache size

#### 2. Low Batch Efficiency

**Trigger**: Batch efficiency ratio < 0.6 for 10 minutes

```yaml
- alert: LowBatchEfficiency
  expr: servalsheets_batch_efficiency_ratio < 0.6
  for: 10m
  labels:
    severity: info
```

**Impact**: More API calls than necessary

**Response Actions**:

1. Review batching strategy
2. Check operation patterns
3. Consider adjusting batch thresholds
4. Review client usage patterns

### Anomaly Alert Rules

#### 1. Sudden Drop in Requests

**Trigger**: Request rate < 20% of baseline for 5 minutes

```yaml
- alert: SuddenDropInRequests
  expr: |
    (
      rate(servalsheets_tool_calls_total[5m]) /
      rate(servalsheets_tool_calls_total[1h] offset 1h)
    ) < 0.2
  for: 5m
  labels:
    severity: warning
```

**Impact**: Possible client issues or service degradation

**Response Actions**:

1. Check client connectivity
2. Review error rates
3. Check for network issues
4. Verify service health

#### 2. Sudden Spike in Requests

**Trigger**: Request rate > 3x baseline for 5 minutes

```yaml
- alert: SuddenSpikeInRequests
  expr: |
    (
      rate(servalsheets_tool_calls_total[5m]) /
      rate(servalsheets_tool_calls_total[1h] offset 1h)
    ) > 3
  for: 5m
  labels:
    severity: warning
```

**Impact**: Potential quota exhaustion or abuse

**Response Actions**:

1. Check for legitimate traffic spike
2. Review client behavior
3. Check for potential abuse
4. Consider rate limiting

### Alert Configuration

#### Loading Alert Rules

```bash
# Validate alert rules syntax
promtool check rules deployment/prometheus/alerts.yml

# Load rules into Prometheus
# Update prometheus.yml:
rule_files:
  - "alerts.yml"

# Reload Prometheus configuration
curl -X POST http://localhost:9090/-/reload
```

#### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 30s

# Alert manager configuration
alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager:9093

# Rule files
rule_files:
  - 'alerts.yml'

# Scrape configurations
scrape_configs:
  - job_name: 'servalsheets'
    scrape_interval: 15s
    static_configs:
      - targets: ['servalsheets:9090']
```

### Alertmanager Configuration

Alertmanager routes and manages alert notifications from Prometheus.

#### Basic Alertmanager Setup

```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m

# Route tree
route:
  group_by: ['alertname', 'severity']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'default'

  routes:
    # Critical alerts go to PagerDuty
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      continue: true

    # Critical alerts also go to Slack
    - match:
        severity: critical
      receiver: 'slack-critical'

    # Warning alerts go to Slack
    - match:
        severity: warning
      receiver: 'slack-warnings'

    # Info alerts go to Slack with lower priority
    - match:
        severity: info
      receiver: 'slack-info'

# Receivers
receivers:
  - name: 'default'
    # Default catch-all

  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '<YOUR_PAGERDUTY_INTEGRATION_KEY>'
        description: '{{ .CommonAnnotations.summary }}'
        details:
          alert: '{{ .GroupLabels.alertname }}'
          severity: '{{ .GroupLabels.severity }}'
          description: '{{ .CommonAnnotations.description }}'
          impact: '{{ .CommonAnnotations.impact }}'
          action: '{{ .CommonAnnotations.action }}'

  - name: 'slack-critical'
    slack_configs:
      - api_url: '<YOUR_SLACK_WEBHOOK_URL>'
        channel: '#servalsheets-alerts-critical'
        title: ':rotating_light: CRITICAL: {{ .GroupLabels.alertname }}'
        text: |
          *Summary:* {{ .CommonAnnotations.summary }}
          *Description:* {{ .CommonAnnotations.description }}
          *Impact:* {{ .CommonAnnotations.impact }}
          *Required Action:* {{ .CommonAnnotations.action }}
        color: danger

  - name: 'slack-warnings'
    slack_configs:
      - api_url: '<YOUR_SLACK_WEBHOOK_URL>'
        channel: '#servalsheets-alerts'
        title: ':warning: Warning: {{ .GroupLabels.alertname }}'
        text: |
          *Summary:* {{ .CommonAnnotations.summary }}
          *Description:* {{ .CommonAnnotations.description }}
          *Impact:* {{ .CommonAnnotations.impact }}
        color: warning

  - name: 'slack-info'
    slack_configs:
      - api_url: '<YOUR_SLACK_WEBHOOK_URL>'
        channel: '#servalsheets-monitoring'
        title: ':information_source: Info: {{ .GroupLabels.alertname }}'
        text: |
          *Summary:* {{ .CommonAnnotations.summary }}
          *Description:* {{ .CommonAnnotations.description }}
        color: good

# Inhibition rules - suppress less severe alerts when more severe are firing
inhibit_rules:
  # Suppress warning alerts if critical alerts are firing
  - source_match:
      severity: critical
    target_match:
      severity: warning
    equal: ['component', 'alertname']

  # Suppress info alerts if warning or critical alerts are firing
  - source_match:
      severity: warning
    target_match:
      severity: info
    equal: ['component', 'alertname']
```

#### Starting Alertmanager

```bash
# Docker Compose
version: '3'
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./alerts.yml:/etc/prometheus/alerts.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--web.enable-lifecycle'

  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
```

### PagerDuty Integration

#### Setup PagerDuty Service

1. Create a PagerDuty service for ServalSheets
2. Add Prometheus integration to get integration key
3. Configure Alertmanager with the integration key
4. Set up escalation policies

#### PagerDuty Event Routing

```yaml
# alertmanager.yml - Advanced PagerDuty configuration
receivers:
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '<YOUR_INTEGRATION_KEY>'
        description: '{{ .CommonAnnotations.summary }}'
        severity: '{{ .GroupLabels.severity }}'
        client: 'ServalSheets Monitoring'
        client_url: 'http://prometheus:9090/alerts'
        details:
          alert: '{{ .GroupLabels.alertname }}'
          component: '{{ .GroupLabels.component }}'
          severity: '{{ .GroupLabels.severity }}'
          description: '{{ .CommonAnnotations.description }}'
          impact: '{{ .CommonAnnotations.impact }}'
          action: '{{ .CommonAnnotations.action }}'
          runbook: '{{ .CommonAnnotations.runbook }}'
          firing_alerts: '{{ .Alerts.Firing | len }}'
          resolved_alerts: '{{ .Alerts.Resolved | len }}'
```

#### Custom PagerDuty Integration (Alternative)

```typescript
// From src/alerts/pagerduty.ts
import { Event } from '@pagerduty/pdjs';

export async function triggerAlert(
  severity: 'critical' | 'error' | 'warning',
  message: string,
  details: Record<string, any>
): Promise<void> {
  const event = new Event({
    routing_key: process.env.PAGERDUTY_ROUTING_KEY,
    event_action: 'trigger',
    payload: {
      summary: message,
      severity,
      source: 'servalsheets',
      component: details.component || 'unknown',
      custom_details: details,
    },
    links: [
      {
        href: details.runbook,
        text: 'Runbook',
      },
    ],
  });

  await event.send();
}

// Resolve an incident
export async function resolveAlert(dedupKey: string): Promise<void> {
  const event = new Event({
    routing_key: process.env.PAGERDUTY_ROUTING_KEY,
    event_action: 'resolve',
    dedup_key: dedupKey,
  });

  await event.send();
}
```

### Slack Integration

#### Slack Webhook Setup

1. Create a Slack app at api.slack.com/apps
2. Enable Incoming Webhooks
3. Add webhook URLs to Alertmanager configuration
4. Create channels: #servalsheets-alerts-critical, #servalsheets-alerts, #servalsheets-monitoring

#### Advanced Slack Notifications

```yaml
# alertmanager.yml - Rich Slack formatting
receivers:
  - name: 'slack-critical'
    slack_configs:
      - api_url: '<YOUR_SLACK_WEBHOOK_URL>'
        channel: '#servalsheets-alerts-critical'
        username: 'ServalSheets Alerting'
        icon_emoji: ':rotating_light:'
        title: 'CRITICAL ALERT: {{ .GroupLabels.alertname }}'
        title_link: 'http://prometheus:9090/alerts'
        text: |
          {{ range .Alerts }}
          *Alert:* {{ .Labels.alertname }}
          *Component:* {{ .Labels.component }}
          *Summary:* {{ .Annotations.summary }}
          *Description:* {{ .Annotations.description }}
          *Impact:* {{ .Annotations.impact }}
          *Required Actions:*
          {{ .Annotations.action }}
          *Runbook:* {{ .Annotations.runbook }}
          *Started:* {{ .StartsAt }}
          {{ end }}
        color: danger
        send_resolved: true
```

#### Custom Slack Integration (Alternative)

```typescript
// From src/alerts/slack.ts
import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function sendAlert(
  channel: string,
  alertName: string,
  severity: 'info' | 'warning' | 'critical',
  annotations: {
    summary: string;
    description: string;
    impact?: string;
    action?: string;
    runbook?: string;
  }
): Promise<void> {
  const color = {
    info: '#36a64f',
    warning: '#ff9900',
    critical: '#ff0000',
  }[severity];

  const emoji = {
    info: ':information_source:',
    warning: ':warning:',
    critical: ':rotating_light:',
  }[severity];

  const fields = [
    {
      title: 'Summary',
      value: annotations.summary,
      short: false,
    },
    {
      title: 'Description',
      value: annotations.description,
      short: false,
    },
  ];

  if (annotations.impact) {
    fields.push({
      title: 'Impact',
      value: annotations.impact,
      short: false,
    });
  }

  if (annotations.action) {
    fields.push({
      title: 'Required Action',
      value: annotations.action,
      short: false,
    });
  }

  await slack.chat.postMessage({
    channel,
    text: `${emoji} ${severity.toUpperCase()}: ${alertName}`,
    attachments: [
      {
        color,
        title: `${alertName} Alert`,
        fields,
        footer: 'ServalSheets Monitoring',
        footer_icon: 'https://servalsheets.io/icon.png',
        ts: Math.floor(Date.now() / 1000).toString(),
        actions: annotations.runbook
          ? [
              {
                type: 'button',
                text: 'View Runbook',
                url: annotations.runbook,
              },
            ]
          : undefined,
      },
    ],
  });
}
```

### Testing Alert Rules

#### Test Alert Firing

You can test alerts by manually triggering conditions or using Alertmanager's test API.

##### 1. Manual Condition Testing

```bash
# Test high error rate by generating errors
# (Requires test script that can generate controlled errors)
./scripts/test-generate-errors.sh --rate 10 --duration 300

# Test queue backup by sending many requests
./scripts/test-load-spike.sh --qps 100 --duration 300

# Test cache by clearing it
curl -X POST http://localhost:9090/cache/clear

# Monitor alerts firing
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.state=="firing")'
```

##### 2. Alertmanager Test Mode

```bash
# Send test alert to Alertmanager
curl -X POST http://localhost:9093/api/v1/alerts -H 'Content-Type: application/json' -d '[
  {
    "labels": {
      "alertname": "TestHighErrorRate",
      "severity": "critical",
      "component": "api"
    },
    "annotations": {
      "summary": "Test alert for high error rate",
      "description": "This is a test alert to verify notification channels",
      "impact": "Testing notification system",
      "action": "No action required - this is a test"
    },
    "startsAt": "'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'",
    "endsAt": "'"$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%S.000Z)"'"
  }
]'
```

##### 3. Prometheus Recording Rules for Testing

```yaml
# test-alerts.yml
groups:
  - name: test_alerts
    interval: 30s
    rules:
      # Recording rule to simulate high error rate
      - record: test:servalsheets_error_rate:5m
        expr: |
          rate(servalsheets_tool_calls_total{status="error"}[5m]) /
          rate(servalsheets_tool_calls_total[5m])

      # Test alert that fires when recording rule is active
      - alert: TestHighErrorRate
        expr: test:servalsheets_error_rate:5m > 0.05
        for: 1m
        labels:
          severity: critical
          test: 'true'
        annotations:
          summary: 'Test alert - high error rate'
```

#### Validate Alert Configuration

```bash
# 1. Validate alert rules syntax
promtool check rules deployment/prometheus/alerts.yml

# Expected output:
# Checking deployment/prometheus/alerts.yml
#   SUCCESS: 24 rules found

# 2. Test PromQL expressions
promtool query instant http://localhost:9090 \
  'rate(servalsheets_tool_calls_total{status="error"}[5m]) / rate(servalsheets_tool_calls_total[5m])'

# 3. Check alert rules loaded in Prometheus
curl http://localhost:9090/api/v1/rules | jq '.data.groups[] | select(.name | startswith("servalsheets"))'

# 4. Check current firing alerts
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.state=="firing")'

# 5. Check Alertmanager status
curl http://localhost:9093/api/v1/status | jq .

# 6. Verify Alertmanager configuration
amtool check-config deployment/prometheus/alertmanager.yml
```

#### Alert Testing Scenarios

##### Scenario 1: High Error Rate Alert

```bash
# Generate high error rate (requires test harness)
# 1. Start monitoring alerts
watch -n 5 'curl -s http://localhost:9090/api/v1/alerts | jq ".data.alerts[] | select(.labels.alertname==\"HighErrorRate\")"'

# 2. Generate errors
for i in {1..100}; do
  curl -X POST http://localhost:3000/api/test/error &
done

# 3. Wait for alert to fire (2 minutes + evaluation interval)
# 4. Verify notification received in Slack/PagerDuty
# 5. Stop error generation and verify alert resolves
```

##### Scenario 2: Queue Backup Alert

```bash
# 1. Monitor queue depth
watch -n 2 'curl -s http://localhost:9090/api/v1/query?query=servalsheets_request_queue_depth | jq ".data.result[0].value[1]"'

# 2. Generate load to fill queue
ab -n 10000 -c 100 http://localhost:3000/api/test/slow

# 3. Verify alert fires when queue > 50 for 5 minutes
# 4. Check notification channels
# 5. Allow queue to drain and verify resolution
```

##### Scenario 3: Circuit Breaker Alert

```bash
# 1. Monitor circuit breaker state
watch -n 2 'curl -s http://localhost:9090/api/v1/query?query=servalsheets_circuit_breaker_state | jq .'

# 2. Cause downstream failures to open circuit breaker
# (Requires ability to make Google API fail)
./scripts/test-circuit-breaker.sh --fail-rate 100 --duration 60

# 3. Verify alert fires when state >= 2
# 4. Check critical notification
# 5. Allow circuit to recover and verify half-open alert
```

##### Scenario 4: Low Cache Hit Rate Alert

```bash
# 1. Monitor cache hit rate
watch -n 5 'curl -s "http://localhost:9090/api/v1/query?query=(rate(servalsheets_cache_hits_total[5m])/(rate(servalsheets_cache_hits_total[5m])+rate(servalsheets_cache_misses_total[5m])))" | jq ".data.result[0].value[1]"'

# 2. Clear cache to reduce hit rate
curl -X POST http://localhost:9090/cache/clear

# 3. Generate traffic with varied requests (low cache hits)
./scripts/test-varied-requests.sh --requests 1000 --unique 900

# 4. Verify alert fires when hit rate < 50% for 10 minutes
# 5. Allow cache to warm up and verify resolution
```

### Alert Runbooks

Each alert should have a corresponding runbook. Create runbooks at `docs/runbooks/<alert-name>.md`.

#### Runbook Template

````markdown
# [Alert Name] Runbook

## Alert Details

- **Severity**: [critical|warning|info]
- **Component**: [api|cache|queue|etc]
- **Trigger**: [Condition that causes alert to fire]

## Symptoms

- [User-visible symptoms]
- [System symptoms]

## Impact

- **User Impact**: [How users are affected]
- **Business Impact**: [Business implications]

## Investigation Steps

1. **Check Alert Details**
   ```bash
   # View alert in Prometheus
   curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.alertname=="AlertName")'
   ```
````

1. **Review Logs**

   ```bash
   # Check recent error logs
   tail -100 /var/log/servalsheets/app.log | jq 'select(.level=="error")'
   ```

2. **Check Metrics**

   ```bash
   # Query relevant metrics
   curl 'http://localhost:9090/api/v1/query?query=metric_name'
   ```

## Resolution Steps

### Immediate Actions

1. [First action to take]
2. [Second action to take]

### Root Cause Investigation

1. [Investigation step 1]
2. [Investigation step 2]

### Long-term Fixes

1. [Preventive measure 1]
2. [Preventive measure 2]

## Related Alerts

- [Related alert 1]
- [Related alert 2]

## Escalation

- **Level 1**: On-call engineer
- **Level 2**: Team lead
- **Level 3**: Senior engineer / Architect

## References

- [Link to relevant documentation]
- [Link to similar incidents]

````

---

## Dashboards

### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "ServalSheets Monitoring",
    "panels": [
      {
        "title": "Operations Rate",
        "targets": [
          {
            "expr": "rate(servalsheets_operations_total[5m])"
          }
        ]
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "rate(servalsheets_operations_total{status=\"error\"}[5m])"
          }
        ]
      },
      {
        "title": "Quota Usage",
        "targets": [
          {
            "expr": "servalsheets_quota_available{quota_type=\"read\"}"
          },
          {
            "expr": "servalsheets_quota_available{quota_type=\"write\"}"
          }
        ]
      },
      {
        "title": "Operation Duration (P95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, servalsheets_operation_duration_ms)"
          }
        ]
      },
      {
        "title": "Cache Hit Rate",
        "targets": [
          {
            "expr": "rate(servalsheets_cache_hits[5m]) / rate(servalsheets_cache_requests[5m])"
          }
        ]
      }
    ]
  }
}
````

### CloudWatch Dashboard

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["ServalSheets", "OperationsTotal", { "stat": "Sum" }],
          [".", "OperationsError", { "stat": "Sum" }]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "Operations"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["ServalSheets", "QuotaReadsAvailable"],
          [".", "QuotaWritesAvailable"]
        ],
        "period": 60,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Quota Availability"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [["ServalSheets", "OperationDuration", { "stat": "p95" }]],
        "period": 300,
        "stat": "p95",
        "region": "us-east-1",
        "title": "Operation Duration (P95)"
      }
    }
  ]
}
```

---

## Troubleshooting

### Common Issues

#### High Latency

**Symptoms**: Operations taking > 5 seconds

**Debugging**:

```bash
# Check slow operations
cat logs.json | jq 'select(.duration > 5000)'

# Check for quota exhaustion
cat logs.json | jq 'select(.error.code == "RATE_LIMIT_EXCEEDED")'

# Check cache hit rate
cat logs.json | jq 'select(.cache_hit == false)' | wc -l
```

**Solutions**:

- Enable caching with longer TTLs
- Use METADATA diff instead of FULL
- Batch operations
- Reduce effect scope

#### Quota Errors

**Symptoms**: 429 Rate Limit Exceeded errors

**Debugging**:

```bash
# Check quota usage
cat logs.json | jq 'select(.quotaType == "write") | .operation'

# Check quota available
curl http://localhost:3000/health/ready | jq '.checks.rateLimit'
```

**Solutions**:

- Reduce rate limits: `SERVALSHEETS_WRITES_PER_MINUTE=40`
- Enable caching to reduce API calls
- Batch operations
- Request quota increase from Google

#### Memory Issues

**Symptoms**: High memory usage, OOM errors

**Debugging**:

```bash
# Check memory usage
ps aux | grep servalsheets

# Check for large operations
cat logs.json | jq 'select(.cellCount > 100000)'
```

**Solutions**:

- Use streaming for large datasets
- Use METADATA diff
- Clear cache: `curl -X POST http://localhost:3000/cache/clear`
- Reduce cache size: `SERVALSHEETS_CACHE_DATA_SIZE=500`

### Debug Mode

Enable debug logging for troubleshooting:

```bash
# Enable debug logs
export LOG_LEVEL=debug
export LOG_FORMAT=json

# Restart service
systemctl restart servalsheets

# Watch logs
tail -f /var/log/servalsheets/app.log | jq .
```

---

## Summary

ServalSheets provides comprehensive observability:

| Feature            | Method                | Use Case                   |
| ------------------ | --------------------- | -------------------------- |
| Structured logging | JSON logs             | Debugging, auditing        |
| Metrics            | Prometheus/CloudWatch | Performance, quota         |
| Health checks      | HTTP endpoints        | Kubernetes, load balancers |
| APM                | OpenTelemetry/Datadog | Distributed tracing        |
| Alerting           | Prometheus/PagerDuty  | Incident response          |
| Dashboards         | Grafana/CloudWatch    | Visualization              |

**Key Takeaway**: Enable structured logging, expose metrics, and set up alerts for critical issues like quota exhaustion and high error rates.

For deployment examples, see `DEPLOYMENT.md`.
For common issues, see `TROUBLESHOOTING.md`.
