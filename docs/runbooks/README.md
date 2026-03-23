---
title: ServalSheets Operational Runbooks
category: general
last_updated: 2026-02-04
description: Comprehensive troubleshooting and incident response guides for ServalSheets operations.
version: 1.6.0
tags: [sheets, prometheus, grafana, docker, kubernetes]
---

# ServalSheets Operational Runbooks

Comprehensive troubleshooting and incident response guides for ServalSheets operations.

## Critical Alerts (Immediate Response Required)

### 🔴 [High Error Rate](./high-error-rate.md)

- **Threshold:** > 5% error rate
- **Impact:** Users experiencing failed operations
- **First Actions:** Check logs, verify Google API status, review recent deployments

### 🔴 [Circuit Breaker Open](./circuit-breaker.md)

- **Threshold:** Circuit breaker state >= 2 (OPEN)
- **Impact:** Service degraded, requests being rejected
- **First Actions:** Identify circuit, check downstream service health

### 🔴 [Service Down](./service-down.md)

- **Threshold:** Service unreachable for 1 minute
- **Impact:** Complete outage, all requests failing
- **First Actions:** Check pod status, review events, verify resources

### 🔴 [Authentication Failures](./auth-failures.md)

- **Threshold:** > 10% auth failure rate
- **Impact:** Users unable to authenticate with Google Sheets API
- **First Actions:** Check token expiry, verify credentials, test OAuth flow

### 🔴 [Memory Exhaustion](./memory-exhaustion.md)

- **Threshold:** > 1.5GB memory usage
- **Impact:** Risk of OOM crash
- **First Actions:** Check for memory leaks, review large operations, clear cache

## Warning Alerts (Performance Degradation)

### 🟡 Request Queue Backup

- **Threshold:** Queue depth > 50
- **Runbook:** `queue-backup.md`

### 🟡 High Latency (P95/P99)

- **Threshold:** P95 > 3s, P99 > 5s
- **Runbook:** `high-latency.md`

### 🟡 API Quota Near Limit

- **Threshold:** > 55 API calls/minute
- **Runbook:** `quota-near-limit.md`

### 🟡 Google API Errors

- **Threshold:** > 2% error rate
- **Runbook:** `google-api-errors.md`

### 🟡 Slow Google API Calls

- **Threshold:** P95 > 3s
- **Runbook:** `slow-google-api.md`

## Info Alerts (Operational Awareness)

### ℹ️ Low Cache Hit Rate

- **Threshold:** < 50% hit rate
- **Runbook:** `low-cache-hit-rate.md`

### ℹ️ Cache Evictions

- **Threshold:** > 10 evictions/s
- **Runbook:** `cache-evictions.md`

### ℹ️ Batch Efficiency

- **Threshold:** < 60% efficiency
- **Runbook:** `batch-efficiency.md`

### ℹ️ Transaction Failures

- **Threshold:** > 1% failure rate
- **Runbook:** `transaction-failures.md`

### ℹ️ Error Patterns

- **Threshold:** Specific error spike
- **Runbook:** `error-patterns.md`

## Anomaly Detection Alerts

### ⚠️ Traffic Drop

- **Threshold:** Request rate < 20% of baseline
- **Runbook:** `traffic-drop.md`

### ⚠️ Traffic Spike

- **Threshold:** Request rate > 3x baseline
- **Runbook:** `traffic-spike.md`

### ⚠️ Cache Degradation

- **Threshold:** Hit rate drops > 20% from baseline
- **Runbook:** `cache-degradation.md`

## SLO-Based Alerts

### 📊 [Availability SLO](./slo-availability.md)

- **Target:** 99.9% uptime
- **Error Budget:** 43.2 minutes/month

### 📊 [Latency SLO](./slo-latency.md)

- **Targets:**
  - P95 Read: < 500ms
  - P95 Write: < 2000ms
  - P99: < 5000ms

### 📊 [Error Rate SLO](./slo-errors.md)

- **Targets:**
  - 4xx: < 0.1%
  - 5xx: < 0.01%

### 📊 [Google API SLO](./slo-google-api.md)

- **Target:** 99.5% success rate

### 📊 [Cache SLO](./slo-cache.md)

- **Target:** 80% hit rate

### 📊 [Error Budget](./error-budget.md)

- **Alert Conditions:**
  - Burn rate > 10x
  - Remaining budget < 10%

## Quick Reference

### Common Commands

```bash
# Check service status
kubectl get pods -n servalsheets

# View logs
kubectl logs -n servalsheets deployment/servalsheets --tail=100

# Check health
curl http://localhost:3000/health/ready | jq

# View metrics
curl http://localhost:3000/metrics | grep servalsheets_

# Restart service
kubectl rollout restart deployment/servalsheets -n servalsheets

# Rollback deployment
kubectl rollout undo deployment/servalsheets -n servalsheets
```

### Metrics Dashboards

- **Overview:** [Grafana Dashboard](http://grafana:3000/d/servalsheets-overview)
- **SLI/SLO:** [Grafana Dashboard](http://grafana:3000/d/servalsheets-slo)
- **Errors:** [Grafana Dashboard](http://grafana:3000/d/servalsheets-errors)
- **Performance:** [Grafana Dashboard](http://grafana:3000/d/servalsheets-performance)

### Health Check Endpoints

- **Liveness:** `GET /health/live` - Process running
- **Readiness:** `GET /health/ready` - Service ready to accept traffic
- **Metrics:** `GET /metrics` - Prometheus metrics
- **Circuit Breakers:** `GET /metrics/circuit-breakers` - CB status
- **Traces:** `GET /traces` - OpenTelemetry traces

### Log Locations

- **Kubernetes:** `kubectl logs -n servalsheets deployment/servalsheets`
- **Docker:** `docker logs servalsheets`
- **Local:** `logs/servalsheets.log`
- **Aggregated:** Loki (if configured): `http://loki:3100`

## Incident Response Process

### 1. Acknowledge (< 5 minutes)

- Acknowledge alert in PagerDuty
- Join incident Slack channel
- Post initial status update

### 2. Assess (< 10 minutes)

- Determine severity and impact
- Identify affected users/operations
- Check relevant runbook

### 3. Mitigate (< 30 minutes)

- Follow runbook procedures
- Implement temporary fixes if needed
- Escalate if unresolved in 30 minutes

### 4. Resolve

- Verify fix resolves issue
- Monitor for recurrence
- Update incident status

### 5. Post-Mortem (within 48 hours)

- Document root cause
- Timeline of events
- Action items for prevention
- Update runbooks

## Escalation Path

```
Level 1: On-Call Engineer (0-15 min)
  ↓ (if not resolved)
Level 2: Team Lead (15-30 min)
  ↓ (if business impact)
Level 3: Engineering Manager (30-60 min)
  ↓ (if SLO breach)
Level 4: CTO (> 60 min or critical impact)
```

## Communication Channels

- **Incidents:** `#servalsheets-incidents` (Slack)
- **Alerts:** `#servalsheets-alerts` (Slack)
- **Status Page:** https://status.servalsheets.io
- **PagerDuty:** ServalSheets service

## Related Documentation

- [Monitoring Setup](../guides/MONITORING.md)
- [Alert Configuration](../../deployment/prometheus/alerts.yml)
- [Grafana Dashboards](../../deployment/grafana/dashboards/)
- [Troubleshooting Guide](../guides/TROUBLESHOOTING.md)
- [Deployment Guide](../guides/DEPLOYMENT.md)

## Contributing to Runbooks

### When to Update

- After resolving an incident
- When discovering new troubleshooting steps
- When alert thresholds change
- When adding new monitoring

### Runbook Template

```markdown
# Runbook: [Alert Name]

**Alert Name:** `AlertName`
**Severity:** Critical/Warning/Info
**Component:** [component]
**Threshold:** [threshold condition]

## Impact

[User-facing impact description]

## Symptoms

[Observable symptoms]

## Diagnosis

[How to diagnose the issue]

## Resolution Steps

[Step-by-step resolution]

## Prevention

[How to prevent in future]

## Post-Incident

[Post-incident actions]

## Related Runbooks

[Links to related runbooks]

## Metrics to Monitor

[Relevant Prometheus metrics]

## Escalation

[When and how to escalate]
```

## Runbook Coverage

| Alert Rule                    | Runbook Status | Last Updated |
| ----------------------------- | -------------- | ------------ |
| HighErrorRate                 | ✅ Complete    | 2026-02-02   |
| CircuitBreakerOpen            | ✅ Complete    | 2026-02-02   |
| ServiceDown                   | ✅ Complete    | 2026-02-02   |
| HighAuthenticationFailureRate | ✅ Complete    | 2026-02-02   |
| HighMemoryUsage               | ✅ Complete    | 2026-02-04   |
| RequestQueueBackup            | ✅ Complete    | 2026-02-24   |
| HighLatencyP99                | ✅ Complete    | 2026-02-04   |
| APIQuotaNearLimit             | ✅ Complete    | 2026-02-04   |
| GoogleAPIErrorRate            | ✅ Complete    | 2026-02-04   |
| SlowGoogleAPICalls            | ✅ Complete    | 2026-02-04   |
| LowCacheHitRate               | ✅ Complete    | 2026-02-04   |
| ...                           | ...            | ...          |

**Legend:**

- ✅ Complete and tested
- 🔄 In progress or planned
- ❌ Not started
