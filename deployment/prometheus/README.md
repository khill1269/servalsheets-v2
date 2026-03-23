# ServalSheets Prometheus Monitoring

Production-ready Prometheus alert rules and monitoring setup for ServalSheets.

## Overview

This directory contains:

- **alerts.yml** - 24 comprehensive alert rules across 4 severity levels
- **alertmanager.yml** - Alert routing and notification configuration
- **prometheus.yml** - Metrics collection configuration
- **docker-compose.yml** - Complete monitoring stack (Prometheus, Alertmanager, Grafana)

## Quick Start

### 1. Configure Notification Channels

Before deploying, update notification endpoints in `alertmanager.yml`:

```yaml
# Replace these placeholders:
<YOUR_SLACK_WEBHOOK_URL>        # Get from Slack app settings
<YOUR_PAGERDUTY_INTEGRATION_KEY> # Get from PagerDuty service integration
```

### 2. Start Monitoring Stack

```bash
# Start Prometheus, Alertmanager, and Grafana
cd deployment/prometheus
docker-compose up -d

# Verify services are running
docker-compose ps
```

### 3. Access UIs

- **Prometheus**: http://localhost:9090
- **Alertmanager**: http://localhost:9093
- **Grafana**: http://localhost:3001 (admin/admin)

### 4. Verify Alert Rules Loaded

```bash
# Check alert rules
curl http://localhost:9090/api/v1/rules | jq '.data.groups[] | select(.name | startswith("servalsheets"))'

# Check active alerts
curl http://localhost:9090/api/v1/alerts
```

## Alert Rules

### Critical Alerts (5 rules)

Immediate response required, user-facing impact.

| Alert                             | Trigger                           | Impact                               |
| --------------------------------- | --------------------------------- | ------------------------------------ |
| **HighErrorRate**                 | Error rate > 5% for 2m            | Users experiencing failed operations |
| **CircuitBreakerOpen**            | Circuit breaker state >= 2 for 1m | Requests being rejected              |
| **ServiceDown**                   | Service unreachable for 1m        | Complete outage                      |
| **HighAuthenticationFailureRate** | Auth failures > 10% for 2m        | Users unable to authenticate         |
| **HighMemoryUsage**               | Memory > 1.5GB for 5m             | Service may crash                    |

### Warning Alerts (8 rules)

Performance degradation, risk of impact.

| Alert                      | Trigger                          | Impact               |
| -------------------------- | -------------------------------- | -------------------- |
| **RequestQueueBackup**     | Queue depth > 50 for 5m          | Increased latency    |
| **HighLatencyP99**         | P99 latency > 5s for 5m          | 1% of requests slow  |
| **HighLatencyP95**         | P95 latency > 3s for 10m         | 5% of requests slow  |
| **APIQuotaNearLimit**      | API rate > 55/min for 2m         | Risk of throttling   |
| **CircuitBreakerHalfOpen** | Circuit breaker state = 1 for 5m | Recovery in progress |
| **HighQueuePending**       | Pending > 30 for 3m              | Backlog building     |
| **GoogleAPIErrorRate**     | Google API errors > 2% for 5m    | Upstream issues      |
| **SlowGoogleAPICalls**     | Google API P95 > 3s for 10m      | Upstream latency     |

### Info Alerts (8 rules)

Operational awareness, optimization opportunities.

| Alert                      | Trigger                               | Impact                      |
| -------------------------- | ------------------------------------- | --------------------------- |
| **LowCacheHitRate**        | Hit rate < 50% for 10m                | More API calls              |
| **HighCacheEvictionRate**  | Evictions > 10/s for 10m              | Reduced cache effectiveness |
| **LowBatchEfficiency**     | Batch efficiency < 0.6 for 10m        | Suboptimal batching         |
| **SmallBatchSizes**        | Median batch size < 5 for 15m         | Not utilizing batching      |
| **TransactionFailureRate** | Transaction failures > 1% for 10m     | Data integrity concern      |
| **HighSessionCount**       | Sessions > 100 for 30m                | Memory usage concern        |
| **LargeCacheSize**         | Cache > 100MB for 15m                 | High memory consumption     |
| **SpecificErrorTypeSpike** | Permission/Quota errors > 1/s for 10m | Specific error pattern      |

### Anomaly Alerts (3 rules)

Rate of change detection.

| Alert                       | Trigger                       | Impact                 |
| --------------------------- | ----------------------------- | ---------------------- |
| **SuddenDropInRequests**    | Rate < 20% of baseline for 5m | Possible client issues |
| **SuddenSpikeInRequests**   | Rate > 3x baseline for 5m     | Potential abuse        |
| **CacheHitRateDegradation** | Hit rate drops 20% for 10m    | Performance regression |

## Testing Alerts

### Validate Alert Configuration

```bash
# Run validation script
./scripts/validate-alerts.sh

# Expected output:
# ✓ YAML syntax valid
# ✓ Found 4 alert groups
# ✓ Found 24 alert rules
```

### Send Test Alert

```bash
# Send test alert to Alertmanager
curl -X POST http://localhost:9093/api/v1/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning",
      "component": "test"
    },
    "annotations": {
      "summary": "Test alert",
      "description": "This is a test",
      "impact": "No impact - testing",
      "action": "No action required"
    },
    "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "endsAt": "'$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%S.000Z)'"
  }]'

# Check Slack/PagerDuty for notification
```

### Test Specific Alert Scenarios

See `docs/guides/MONITORING.md` for detailed test scenarios:

- High error rate testing
- Queue backup testing
- Circuit breaker testing
- Cache hit rate testing

## Configuration

### Prometheus Configuration

Edit `prometheus.yml` to configure:

- Scrape targets (where to collect metrics)
- Scrape intervals
- Alertmanager endpoints
- Storage retention

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 30s

scrape_configs:
  - job_name: 'servalsheets'
    static_configs:
      - targets: ['servalsheets:9090']
```

### Alert Rules Configuration

Edit `alerts.yml` to:

- Add new alert rules
- Modify thresholds
- Change evaluation intervals
- Update annotations

```yaml
- alert: HighErrorRate
  expr: |
    (rate(servalsheets_tool_calls_total{status="error"}[5m]) /
     rate(servalsheets_tool_calls_total[5m])) > 0.05
  for: 2m
  labels:
    severity: critical
```

### Alertmanager Configuration

Edit `alertmanager.yml` to:

- Configure notification channels (Slack, PagerDuty, email)
- Set up routing rules
- Define inhibition rules
- Adjust repeat intervals

```yaml
receivers:
  - name: 'slack-critical'
    slack_configs:
      - channel: '#servalsheets-alerts-critical'
        api_url: '<YOUR_WEBHOOK_URL>'
```

## Hot Reload

Reload configurations without restarting:

```bash
# Reload Prometheus configuration
curl -X POST http://localhost:9090/-/reload

# Reload Alertmanager configuration
curl -X POST http://localhost:9093/-/reload
```

## Integrations

### Slack Setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable Incoming Webhooks
3. Create webhooks for channels:
   - `#servalsheets-alerts-critical`
   - `#servalsheets-alerts`
   - `#servalsheets-monitoring`
4. Update webhook URLs in `alertmanager.yml`

### PagerDuty Setup

1. Create a PagerDuty service for ServalSheets
2. Add Prometheus integration
3. Copy integration key
4. Update integration key in `alertmanager.yml`
5. Configure escalation policies

### Grafana Setup

1. Access Grafana at http://localhost:3001
2. Login with admin/admin (change password!)
3. Add Prometheus data source:
   - URL: http://prometheus:9090
   - Access: Server (default)
4. Import ServalSheets dashboard (see below)

## Grafana Dashboard

### Import Dashboard

Create a dashboard with these panels:

1. **Request Rate** - `rate(servalsheets_tool_calls_total[5m])`
2. **Error Rate** - `rate(servalsheets_tool_calls_total{status="error"}[5m])`
3. **P95 Latency** - `histogram_quantile(0.95, servalsheets_tool_call_duration_seconds_bucket)`
4. **Cache Hit Rate** - `rate(servalsheets_cache_hits_total[5m]) / (rate(servalsheets_cache_hits_total[5m]) + rate(servalsheets_cache_misses_total[5m]))`
5. **Queue Depth** - `servalsheets_request_queue_depth`
6. **Circuit Breaker State** - `servalsheets_circuit_breaker_state`
7. **Memory Usage** - `process_resident_memory_bytes / (1024*1024*1024)`
8. **Active Alerts** - `ALERTS{alertstate="firing"}`

### Grafana Provisioning

Create `deployment/prometheus/grafana/provisioning/datasources/prometheus.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
```

## Troubleshooting

### Alerts Not Firing

```bash
# Check Prometheus can scrape ServalSheets metrics
curl http://localhost:9090/api/v1/targets

# Check alert rules are loaded
curl http://localhost:9090/api/v1/rules

# Check metric data exists
curl 'http://localhost:9090/api/v1/query?query=servalsheets_tool_calls_total'

# Check alert evaluation
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.state=="pending" or .state=="firing")'
```

### Notifications Not Received

```bash
# Check Alertmanager is receiving alerts
curl http://localhost:9093/api/v1/alerts

# Check Alertmanager status
curl http://localhost:9093/api/v1/status

# Check Alertmanager logs
docker-compose logs alertmanager

# Test notification channel directly
curl -X POST http://localhost:9093/api/v1/alerts -H 'Content-Type: application/json' -d '[...]'
```

### High Memory Usage

```bash
# Check Prometheus storage size
du -sh /var/lib/docker/volumes/servalsheets-prometheus-data

# Reduce retention if needed (edit prometheus.yml)
storage:
  tsdb:
    retention.time: 7d      # Reduce from 15d
    retention.size: 5GB     # Reduce from 10GB
```

## Production Deployment

### Security Considerations

1. **Change default passwords**

   ```yaml
   # In docker-compose.yml, update Grafana password
   GF_SECURITY_ADMIN_PASSWORD=<strong-password>
   ```

2. **Enable authentication**

   ```yaml
   # In prometheus.yml
   basic_auth:
     username: admin
     password: <strong-password>
   ```

3. **Use TLS**

   ```yaml
   # In alertmanager.yml
   tls_config:
     cert_file: /etc/ssl/cert.pem
     key_file: /etc/ssl/key.pem
   ```

4. **Restrict access**
   - Use firewall rules to restrict access to ports
   - Use reverse proxy with authentication
   - Use VPN for access

### Scaling

For high-volume deployments:

1. **Use remote storage**

   ```yaml
   # In prometheus.yml
   remote_write:
     - url: 'http://cortex:9009/api/prom/push'
   ```

2. **Enable Prometheus federation**

   ```yaml
   # Scrape from multiple Prometheus instances
   - job_name: 'federate'
     honor_labels: true
     metrics_path: '/federate'
     params:
       'match[]':
         - '{job="servalsheets"}'
     static_configs:
       - targets:
           - 'prometheus-1:9090'
           - 'prometheus-2:9090'
   ```

3. **Use Alertmanager clustering**
   ```bash
   # Start multiple Alertmanager instances with clustering
   --cluster.peer=alertmanager-1:9094
   --cluster.peer=alertmanager-2:9094
   ```

## Maintenance

### Backup Configuration

```bash
# Backup all configuration files
tar -czf prometheus-backup-$(date +%Y%m%d).tar.gz \
  alerts.yml \
  alertmanager.yml \
  prometheus.yml \
  docker-compose.yml
```

### Update Alert Rules

```bash
# 1. Edit alerts.yml
vim alerts.yml

# 2. Validate changes
../../scripts/validate-alerts.sh

# 3. Hot reload Prometheus
curl -X POST http://localhost:9090/-/reload

# 4. Verify rules loaded
curl http://localhost:9090/api/v1/rules | jq '.data.groups[] | select(.name | startswith("servalsheets"))'
```

### Monitor Prometheus Health

```bash
# Check Prometheus health
curl http://localhost:9090/-/healthy

# Check Prometheus readiness
curl http://localhost:9090/-/ready

# Check TSDB status
curl http://localhost:9090/api/v1/status/tsdb

# Check rule manager status
curl http://localhost:9090/api/v1/status/runtimeinfo
```

## Resources

- **Alert Rules**: `alerts.yml` - 24 production-ready alert rules
- **Validation Script**: `../../scripts/validate-alerts.sh` - Validate alert configuration
- **Documentation**: `../../docs/guides/MONITORING.md` - Complete monitoring guide
- **Runbooks**: `../../docs/runbooks/` - Alert response procedures (to be created)

## Support

For issues or questions:

1. Check logs: `docker-compose logs prometheus alertmanager`
2. Review documentation: `docs/guides/MONITORING.md`
3. Validate configuration: `scripts/validate-alerts.sh`
4. Test alerts manually (see Testing section)

## Next Steps

1. Configure notification channels in `alertmanager.yml`
2. Start monitoring stack: `docker-compose up -d`
3. Create Grafana dashboards for visualization
4. Set up runbooks for each alert type
5. Test alert scenarios to verify notifications
6. Integrate with incident management workflow
