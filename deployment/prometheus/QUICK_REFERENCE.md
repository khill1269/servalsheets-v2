# ServalSheets Alerting - Quick Reference Card

## Quick Start (5 Minutes)

```bash
# 1. Configure notifications
cd deployment/prometheus
vim alertmanager.yml  # Update Slack/PagerDuty URLs

# 2. Start stack
docker-compose up -d

# 3. Verify
curl http://localhost:9090/api/v1/rules | jq '.data.groups[] | .name'

# 4. Access UIs
# Prometheus: http://localhost:9090
# Alertmanager: http://localhost:9093
# Grafana: http://localhost:3001 (admin/admin)
```

## Alert Severity Quick Reference

| Severity | Response  | Count | Examples                                           |
| -------- | --------- | ----- | -------------------------------------------------- |
| CRITICAL | Immediate | 5     | ServiceDown, HighErrorRate, CircuitBreakerOpen     |
| WARNING  | 15 min    | 10    | RequestQueueBackup, HighLatency, APIQuotaNearLimit |
| INFO     | 1 hour    | 9     | LowCacheHitRate, LowBatchEfficiency                |

## Critical Alerts (Immediate Response)

```bash
# 1. HighErrorRate - Error rate > 5%
curl 'http://localhost:9090/api/v1/query?query=(rate(servalsheets_tool_calls_total{status="error"}[5m])/rate(servalsheets_tool_calls_total[5m]))*100' | jq .

# 2. CircuitBreakerOpen - Circuit breaker opened
curl 'http://localhost:9090/api/v1/query?query=servalsheets_circuit_breaker_state' | jq .

# 3. ServiceDown - Service unreachable
curl http://localhost:3000/health/live

# 4. HighAuthenticationFailureRate - Auth failures > 10%
curl http://localhost:3000/health/ready | jq '.checks.auth'

# 5. HighMemoryUsage - Memory > 1.5GB
curl 'http://localhost:9090/api/v1/query?query=process_resident_memory_bytes/(1024*1024*1024)' | jq .
```

## Common Operations

### Check Active Alerts

```bash
# All firing alerts
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.state=="firing")'

# By severity
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.severity=="critical" and .state=="firing")'
```

### Send Test Alert

```bash
curl -X POST http://localhost:9093/api/v1/alerts -H 'Content-Type: application/json' -d '[
  {
    "labels": {"alertname": "TestAlert", "severity": "warning"},
    "annotations": {"summary": "Test alert"},
    "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }
]'
```

### Reload Configuration

```bash
# Reload Prometheus (hot reload)
curl -X POST http://localhost:9090/-/reload

# Reload Alertmanager (hot reload)
curl -X POST http://localhost:9093/-/reload

# Or restart services
docker-compose restart prometheus alertmanager
```

### Validate Configuration

```bash
# Validate alert rules
./scripts/validate-alerts.sh

# Check Prometheus can scrape ServalSheets
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | select(.job=="servalsheets")'

# Check rules are loaded
curl http://localhost:9090/api/v1/rules | jq '.data.groups[] | {name, rules: (.rules | length)}'
```

## Troubleshooting One-Liners

### Alerts Not Firing

```bash
# Check metric exists
curl 'http://localhost:9090/api/v1/query?query=servalsheets_tool_calls_total' | jq '.data.result | length'

# Check alert evaluation
curl http://localhost:9090/api/v1/rules | jq '.data.groups[].rules[] | select(.name=="HighErrorRate") | {state, health, evaluationTime}'
```

### Notifications Not Received

```bash
# Check Alertmanager has alerts
curl http://localhost:9093/api/v1/alerts | jq '.data | length'

# Check Alertmanager config
curl http://localhost:9093/api/v1/status | jq '.data.config'

# Check logs
docker-compose logs alertmanager | tail -50
```

### High Alert Noise

```bash
# Check inhibition rules are working
curl http://localhost:9093/api/v1/alerts | jq '.data[] | select(.status.inhibitedBy | length > 0)'

# Silence an alert temporarily
curl -X POST http://localhost:9093/api/v1/silences -H 'Content-Type: application/json' -d '{
  "matchers": [{"name": "alertname", "value": "HighErrorRate", "isRegex": false}],
  "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
  "endsAt": "'$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%S.000Z)'",
  "comment": "Investigating issue"
}'
```

## Key Metrics to Watch

```bash
# Error rate
curl 'http://localhost:9090/api/v1/query?query=(rate(servalsheets_tool_calls_total{status="error"}[5m])/rate(servalsheets_tool_calls_total[5m]))*100'

# P95 latency
curl 'http://localhost:9090/api/v1/query?query=servalsheets_tool_call_latency_summary{quantile="0.95"}'

# Queue depth
curl 'http://localhost:9090/api/v1/query?query=servalsheets_request_queue_depth'

# Cache hit rate
curl 'http://localhost:9090/api/v1/query?query=rate(servalsheets_cache_hits_total[5m])/(rate(servalsheets_cache_hits_total[5m])+rate(servalsheets_cache_misses_total[5m]))'

# Circuit breaker state
curl 'http://localhost:9090/api/v1/query?query=servalsheets_circuit_breaker_state'

# Memory usage
curl 'http://localhost:9090/api/v1/query?query=process_resident_memory_bytes/(1024*1024*1024)'
```

## File Locations

```
deployment/prometheus/
├── alerts.yml              # 24 alert rules (422 lines)
├── alertmanager.yml        # Notification routing (237 lines)
├── prometheus.yml          # Scrape config
├── docker-compose.yml      # Complete stack
└── README.md              # Full documentation

docs/
├── guides/MONITORING.md    # Enhanced monitoring guide
└── runbooks/
    └── high-error-rate.md  # Example runbook (441 lines)

scripts/
└── validate-alerts.sh      # Validation script
```

## Emergency Procedures

### ServiceDown Alert

```bash
# 1. Check process
docker-compose ps servalsheets

# 2. Check logs
docker-compose logs servalsheets --tail=100

# 3. Restart if needed
docker-compose restart servalsheets

# 4. Verify recovery
curl http://localhost:3000/health/live
```

### High Error Rate

```bash
# 1. Check error types
docker-compose logs servalsheets | grep ERROR | tail -50

# 2. Check Google API status
curl https://status.cloud.google.com/incidents.json

# 3. View recent errors by type
tail -1000 /var/log/servalsheets/app.log | jq -r 'select(.level=="error") | .error.code' | sort | uniq -c | sort -rn

# 4. See full runbook
cat docs/runbooks/high-error-rate.md
```

### Circuit Breaker Open

```bash
# 1. Check which circuit
curl 'http://localhost:9090/api/v1/query?query=servalsheets_circuit_breaker_state{state="open"}'

# 2. Check underlying service
curl http://localhost:3000/health/ready | jq '.checks'

# 3. Allow recovery (circuit breaker auto-recovers)
# Monitor state transition to half_open, then closed
watch -n 5 'curl -s "http://localhost:9090/api/v1/query?query=servalsheets_circuit_breaker_state" | jq .'
```

## Grafana Quick Setup

```bash
# 1. Login to Grafana
open http://localhost:3001  # admin/admin

# 2. Add Prometheus datasource
# Configuration → Data Sources → Add → Prometheus
# URL: http://prometheus:9090

# 3. Import dashboard with these panels:
# - Request Rate: rate(servalsheets_tool_calls_total[5m])
# - Error Rate: rate(servalsheets_tool_calls_total{status="error"}[5m])
# - P95 Latency: servalsheets_tool_call_latency_summary{quantile="0.95"}
# - Cache Hit Rate: rate(servalsheets_cache_hits_total[5m])/(rate(servalsheets_cache_hits_total[5m])+rate(servalsheets_cache_misses_total[5m]))
# - Queue Depth: servalsheets_request_queue_depth
# - Active Alerts: ALERTS{alertstate="firing"}
```

## Contact Info Template

Update this section with your team's contact information:

```yaml
# On-Call Rotation
Primary: [Name] - [Phone] - [Email]
Secondary: [Name] - [Phone] - [Email]

# Escalation
Level 1: On-call engineer (0-15 min)
Level 2: Team lead (15-30 min)
Level 3: Senior engineer (30+ min)

# Notification Channels
Critical: PagerDuty → #servalsheets-alerts-critical
Warning: #servalsheets-alerts
Info: #servalsheets-monitoring

# External Contacts
Google Cloud Support: [Support Portal]
Infrastructure Team: [Contact]
```

## Useful Links

- **Prometheus UI**: http://localhost:9090
- **Alertmanager UI**: http://localhost:9093
- **Grafana**: http://localhost:3001
- **ServalSheets Health**: http://localhost:3000/health/ready
- **ServalSheets Metrics**: http://localhost:9090/metrics (if exposed)
- **Google API Status**: https://status.cloud.google.com/
- **Full Documentation**: docs/guides/MONITORING.md
- **Runbooks**: docs/runbooks/

## Metrics Reference

| Metric                                 | Type    | Purpose                          |
| -------------------------------------- | ------- | -------------------------------- |
| servalsheets_tool_calls_total          | Counter | Total operations (success/error) |
| servalsheets_tool_call_latency_summary | Summary | Latency percentiles              |
| servalsheets_google_api_calls_total    | Counter | Google API calls                 |
| servalsheets_circuit_breaker_state     | Gauge   | Circuit breaker state (0/1/2)    |
| servalsheets_cache_hits_total          | Counter | Cache hits                       |
| servalsheets_cache_misses_total        | Counter | Cache misses                     |
| servalsheets_request_queue_depth       | Gauge   | Queue depth                      |
| servalsheets_batch_efficiency_ratio    | Gauge   | Batch efficiency (0-1)           |
| servalsheets_errors_by_type_total      | Counter | Errors by type                   |

## Alert Thresholds Summary

| Alert              | Threshold     | Duration |
| ------------------ | ------------- | -------- |
| HighErrorRate      | > 5%          | 2m       |
| HighLatencyP99     | > 5s          | 5m       |
| HighLatencyP95     | > 3s          | 10m      |
| RequestQueueBackup | > 50 requests | 5m       |
| APIQuotaNearLimit  | > 55/min      | 2m       |
| LowCacheHitRate    | < 50%         | 10m      |
| HighMemoryUsage    | > 1.5GB       | 5m       |
| CircuitBreakerOpen | state >= 2    | 1m       |

---

**Last Updated**: 2026-01-09
**Version**: 1.0.0
**Maintainer**: DevOps Team
