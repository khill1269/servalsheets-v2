# ServalSheets Observability Stack

Complete observability, monitoring, and logging infrastructure for ServalSheets.

## Overview

This directory contains a production-ready observability stack featuring:

- **Prometheus** - Metrics collection and storage
- **Grafana** - Visualization and dashboards
- **Alertmanager** - Alert routing and notifications
- **Loki** - Log aggregation and search
- **Tempo** - Distributed tracing (OpenTelemetry compatible)
- **Promtail** - Log shipper
- **Node Exporter** - Host metrics
- **cAdvisor** - Container metrics
- **ServalSheets** - MCP server with full observability instrumentation

## Prerequisites

Before starting the observability stack:

1. **Docker and Docker Compose** installed and running
2. **Google OAuth credentials** (for ServalSheets service)
3. **Slack webhook** (optional, for critical alerts)
4. **PagerDuty integration key** (optional, for on-call alerts)

## Configuration

### 1. Create Environment File

Copy the example environment file and configure it:

```bash
cd deployment/observability
cp .env.example .env
```

### 2. Edit Configuration

Edit `.env` with your credentials:

```bash
# Required: Google OAuth (for ServalSheets authentication)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_CREDENTIALS_PATH=./credentials.json

# Optional: Alert notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
PAGERDUTY_SERVICE_KEY=your_pagerduty_integration_key_here

# Optional: Version and logging
VERSION=1.6.0
LOG_LEVEL=info
```

**Important:** Never commit the `.env` file to version control. It's already in `.gitignore`.

## Quick Start

### 1. Launch the Full Stack

**Option A: Using Docker Compose (Recommended)**

```bash
# From deployment/observability directory
cd deployment/observability
docker-compose up -d
```

This will start all 9 services:

- Prometheus, Grafana, Alertmanager
- Loki, Promtail, Tempo
- Node Exporter, cAdvisor
- **ServalSheets (with full instrumentation)**

**Option B: Using Launch Script**

```bash
# From project root
./scripts/launch-observability.sh
```

This script will:

- Start all observability services via Docker Compose
- Wait for services to become healthy
- Display access URLs and credentials
- Provide next steps for configuration

### 2. Check Service Health

```bash
# Check all services are running
docker-compose ps

# Should show 9 services as "Up (healthy)"
```

### 3. Verify Everything Works

```bash
./scripts/verify-monitoring.sh
```

This comprehensive verification script checks:

- All services are healthy
- Metrics are being collected
- Logs are being aggregated
- Traces are being received
- Dashboards are available

## Access Points

| Service                  | URL                           | Credentials                |
| ------------------------ | ----------------------------- | -------------------------- |
| **ServalSheets**         | http://localhost:3000         | OAuth (configured in .env) |
| **ServalSheets Metrics** | http://localhost:3000/metrics | None                       |
| **Grafana**              | http://localhost:3001         | admin / admin              |
| **Prometheus**           | http://localhost:9090         | None                       |
| **Alertmanager**         | http://localhost:9093         | None                       |
| **Loki**                 | http://localhost:3100         | None                       |
| **Tempo**                | http://localhost:3200         | None                       |
| **Node Exporter**        | http://localhost:9100         | None                       |
| **cAdvisor**             | http://localhost:8080         | None                       |

## Grafana Dashboards

Four pre-configured dashboards are automatically provisioned:

### 1. Overview Dashboard

**URL:** http://localhost:3001/d/servalsheets-overview

Key metrics:

- Request rate (req/s)
- Error rate (%)
- P95/P99 latency
- Cache hit rate
- Active requests
- Circuit breaker status
- Memory usage
- Top tools by request count
- Error distribution by type
- Google API metrics

### 2. SLI/SLO Dashboard

**URL:** http://localhost:3001/d/servalsheets-slo

Tracks service level objectives:

- Availability SLO (99.9%)
- Error budget remaining
- Error budget burn rate
- P95 Read Latency SLO (<500ms)
- P95 Write Latency SLO (<2000ms)
- Error Rate SLOs (4xx <0.1%, 5xx <0.01%)
- Google API Success Rate SLO (99.5%)
- Cache Hit Rate SLO (80%)

### 3. Errors Dashboard

**URL:** http://localhost:3001/d/servalsheets-errors

Detailed error tracking:

- Error rate over time
- Top 10 errors by type
- Errors by tool
- Authentication errors
- Rate limit errors
- Retry attempts and success rate
- Circuit breaker state
- Error details table

### 4. Performance Dashboard

**URL:** http://localhost:3001/d/servalsheets-performance

Performance analysis:

- Request latency heatmap
- Latency percentiles (P50, P95, P99)
- Latency by tool
- Google API latency
- Batch operation efficiency
- Cache performance
- Request queue depth
- Throughput
- Memory usage
- Top 10 slowest operations

## Alerting

### Alert Rules

50+ production-ready alert rules are configured in [deployment/prometheus/alerts.yml](../prometheus/alerts.yml):

**Critical Alerts:**

- High error rate (>5%)
- Circuit breaker open
- Service down
- Authentication failures (>10%)
- Memory exhaustion (>1.5GB)

**Warning Alerts:**

- Request queue backup (>50)
- High latency (P95>3s, P99>5s)
- API quota near limit
- Google API errors (>2%)
- Slow Google API calls

**Info Alerts:**

- Low cache hit rate (<50%)
- Cache evictions
- Batch efficiency issues
- Transaction failures
- Session count growth

**SLO-Based Alerts:**

- Availability SLO breach
- Latency SLO breach
- Error rate SLO breach
- Error budget burn rate
- Error budget low

### Runbooks

Comprehensive troubleshooting guides for each alert:

**Location:** [docs/runbooks/](../../docs/runbooks/)

**Critical runbooks:**

- [High Error Rate](../../docs/runbooks/high-error-rate.md)
- [Circuit Breaker](../../docs/runbooks/circuit-breaker.md)
- [Service Down](../../docs/runbooks/service-down.md)
- [Auth Failures](../../docs/runbooks/auth-failures.md)

**Full index:** [docs/runbooks/README.md](../../docs/runbooks/README.md)

### Alert Routing

Alertmanager configuration: [deployment/prometheus/alertmanager.yml](../prometheus/alertmanager.yml)

**Notification channels:**

- **PagerDuty** - Critical alerts (24/7 on-call)
- **Slack #critical** - Critical alerts
- **Slack #warnings** - Warning alerts
- **Slack #info** - Info alerts

**Grouping:**

- By alert name, severity, and component
- 5-minute group interval
- 10-minute repeat interval

## Metrics

### Application Metrics

ServalSheets exposes 30+ Prometheus metrics at `http://localhost:3000/metrics`:

**Performance Metrics:**

- `servalsheets_tool_call_duration_seconds` - Tool call latency histogram
- `servalsheets_tool_call_latency_summary` - Latency percentiles
- `servalsheets_google_api_duration_seconds` - Google API latency

**Operational Metrics:**

- `servalsheets_tool_calls_total` - Counter by tool, action, status
- `servalsheets_google_api_calls_total` - Counter by method, status
- `servalsheets_cache_hits_total` / `servalsheets_cache_misses_total`
- `servalsheets_queue_size` / `servalsheets_queue_pending`

**Reliability Metrics:**

- `servalsheets_errors_by_type_total` - Counter by error_type, tool, action
- `servalsheets_rate_limit_hits_total` - Counter by api, endpoint
- `servalsheets_retry_attempts_total` - Counter by api, reason, success
- `servalsheets_circuit_breaker_state` - Gauge (0=closed, 1=half_open, 2=open)

**Full reference:** [src/observability/metrics.ts](../../src/observability/metrics.ts)

### System Metrics

**Node Exporter** (port 9100):

- CPU usage
- Memory usage
- Disk I/O
- Network I/O
- File system usage

**cAdvisor** (port 8080):

- Container CPU usage
- Container memory usage
- Container network I/O
- Container disk I/O

## Logging

### Log Aggregation with Loki

All logs are automatically collected and aggregated in Loki.

**Query logs in Grafana:**

1. Open Grafana: http://localhost:3001
2. Navigate to Explore
3. Select "Loki" datasource
4. Use LogQL queries

**Example queries:**

```logql
# All ServalSheets logs
{compose_service="servalsheets"}

# Error logs only
{compose_service="servalsheets"} |= "ERROR"

# Logs for specific request
{compose_service="servalsheets"} |= "requestId: abc123"

# Logs with specific error type
{compose_service="servalsheets"} | json | error_type="PermissionDenied"

# Count errors per minute
sum by (level) (count_over_time({compose_service="servalsheets"}[1m]))
```

### Log Retention

- **Loki retention:** 30 days (720 hours)
- **Compaction:** Enabled with 2-hour delete delay
- **Storage:** Local filesystem (configurable for remote)

### Structured Logging

ServalSheets uses structured JSON logging with automatic context injection:

```json
{
  "level": "INFO",
  "message": "Tool call completed",
  "timestamp": "2026-02-02T12:00:00.000Z",
  "service": "servalsheets",
  "version": "1.6.0",
  "requestId": "req-abc123",
  "traceId": "32-char-trace-id",
  "spanId": "16-char-span-id",
  "tool": "sheets_read",
  "action": "read",
  "duration": 245,
  "status": "success"
}
```

## Distributed Tracing

### OpenTelemetry with Tempo

ServalSheets has built-in OpenTelemetry support for distributed tracing.

**Enable tracing:**

```bash
export OTEL_ENABLED=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=servalsheets
```

**View traces in Grafana:**

1. Open Grafana: http://localhost:3001
2. Navigate to Explore
3. Select "Tempo" datasource
4. Search by trace ID, service name, or duration

**Trace context propagation:**

- Automatic trace ID generation
- Parent-child span relationships
- Cross-service correlation (if microservices)
- W3C Trace Context format

**Trace retention:** 30 days

## Configuration Files

### Docker Compose

**File:** [docker-compose.yml](./docker-compose.yml)

Defines all services, networks, and volumes.

**Start all services:**

```bash
docker-compose -f deployment/observability/docker-compose.yml up -d
```

**Stop all services:**

```bash
docker-compose -f deployment/observability/docker-compose.yml down
```

**View logs:**

```bash
docker-compose -f deployment/observability/docker-compose.yml logs -f
```

### Prometheus Configuration

**File:** [../prometheus/prometheus.yml](../prometheus/prometheus.yml)

- Scrape interval: 15 seconds
- Alert evaluation: 30 seconds
- Retention: 30 days
- Alert rules: [../prometheus/alerts.yml](../prometheus/alerts.yml)

### Loki Configuration

**File:** [loki-config.yml](./loki-config.yml)

- Storage: Local filesystem
- Retention: 30 days
- Ingestion rate: 16 MB/s
- Max query series: 10,000

### Tempo Configuration

**File:** [tempo-config.yml](./tempo-config.yml)

- OTLP gRPC: Port 4317
- OTLP HTTP: Port 4318
- Zipkin: Port 9411
- Jaeger: Port 14268
- Retention: 30 days

### Promtail Configuration

**File:** [promtail-config.yml](./promtail-config.yml)

- Scrapes Docker container logs
- JSON log parsing
- Label extraction
- Filters for ServalSheets containers

## Maintenance

### Backup and Restore

**Backup Prometheus data:**

```bash
docker run --rm -v servalsheets-prometheus-data:/data -v $(pwd):/backup alpine tar czf /backup/prometheus-backup.tar.gz /data
```

**Restore Prometheus data:**

```bash
docker run --rm -v servalsheets-prometheus-data:/data -v $(pwd):/backup alpine tar xzf /backup/prometheus-backup.tar.gz -C /
```

**Same process for Grafana, Loki, Tempo volumes.**

### Scaling

**Increase resource limits:**

Edit `docker-compose.yml`:

```yaml
services:
  prometheus:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
```

**Horizontal scaling:**

For production, consider:

- **Prometheus:** Use Thanos or Cortex for multi-instance
- **Grafana:** Use external database (PostgreSQL) and load balancer
- **Loki:** Deploy in distributed mode
- **Tempo:** Deploy in distributed mode

### Cleanup

**Remove all volumes (CAUTION - deletes all data):**

```bash
docker-compose -f deployment/observability/docker-compose.yml down -v
```

**Remove old data:**

```bash
# Prometheus
docker exec servalsheets-prometheus promtool tsdb clean-tombstones /prometheus

# Loki compactor runs automatically
```

## Troubleshooting

### Services won't start

**Check logs:**

```bash
docker-compose -f deployment/observability/docker-compose.yml logs
```

**Check resource usage:**

```bash
docker stats
```

**Verify ports are available:**

```bash
lsof -i :9090  # Prometheus
lsof -i :3001  # Grafana
lsof -i :9093  # Alertmanager
lsof -i :3100  # Loki
lsof -i :3200  # Tempo
```

### Prometheus not scraping ServalSheets

**Add ServalSheets target to prometheus.yml:**

```yaml
scrape_configs:
  - job_name: 'servalsheets'
    scrape_interval: 15s
    static_configs:
      - targets: ['host.docker.internal:3000']
        labels:
          app: 'servalsheets'
          env: 'production'
```

**Reload Prometheus config:**

```bash
curl -X POST http://localhost:9090/-/reload
```

### Grafana dashboards not appearing

**Import manually:**

1. Open Grafana: http://localhost:3001
2. Click + → Import
3. Upload JSON files from `deployment/grafana/dashboards/`

### Loki not receiving logs

**Check Promtail status:**

```bash
docker logs servalsheets-promtail
```

**Verify Docker socket access:**

```bash
docker exec servalsheets-promtail ls -la /var/run/docker.sock
```

### Tempo not receiving traces

**Verify OTEL endpoint:**

```bash
curl http://localhost:4318/v1/traces
```

**Check ServalSheets logs:**

```bash
# Should see "OpenTelemetry tracing enabled"
docker logs servalsheets | grep -i otel
```

## Production Considerations

### Security

**Enable authentication:**

- Grafana: Change default password immediately
- Prometheus: Add HTTP basic auth (reverse proxy)
- Alertmanager: Configure authentication

**Use secrets management:**

```bash
# Use environment variables, not hardcoded passwords
export GF_SECURITY_ADMIN_PASSWORD=$(cat /run/secrets/grafana_password)
```

**Network security:**

- Use internal networks
- Expose only necessary ports
- Use TLS for external access

### High Availability

**Deploy redundant instances:**

- Multiple Prometheus instances with federation
- Load-balanced Grafana instances
- Distributed Loki deployment
- Distributed Tempo deployment

**Use persistent storage:**

- Mount cloud volumes for Prometheus data
- Use S3-compatible storage for Loki
- Use object storage for Tempo blocks

### Remote Storage

**Prometheus remote write:**

```yaml
remote_write:
  - url: 'https://your-cortex-instance/api/v1/push'
```

**Loki S3 storage:**

```yaml
storage_config:
  aws:
    s3: s3://region/bucket-name
```

## Further Reading

- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
- [Grafana Documentation](https://grafana.com/docs/)
- [Loki LogQL](https://grafana.com/docs/loki/latest/logql/)
- [Tempo Documentation](https://grafana.com/docs/tempo/latest/)
- [OpenTelemetry](https://opentelemetry.io/docs/)

## Support

For issues or questions:

- Check [docs/runbooks/](../../docs/runbooks/)
- Review [docs/guides/MONITORING.md](../../docs/guides/MONITORING.md)
- Review [docs/guides/TROUBLESHOOTING.md](../../docs/guides/TROUBLESHOOTING.md)
