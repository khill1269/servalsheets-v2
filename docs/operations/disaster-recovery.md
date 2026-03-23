---
title: Disaster Recovery Runbook
category: runbook
last_updated: 2026-01-31
description: 'RTO (Recovery Time Objective): 1 hour'
version: 1.6.0
tags: [docker]
estimated_time: 15-30 minutes
---

# Disaster Recovery Runbook

## Quick Reference

**RTO (Recovery Time Objective)**: 1 hour
**RPO (Recovery Point Objective)**: 24 hours
**Criticality**: Production service - requires 99.9% uptime

---

## Incident Response

### 1. Assess Situation

**Incident Severity Levels:**

| Level             | Definition                          | Response Time | Escalation                 |
| ----------------- | ----------------------------------- | ------------- | -------------------------- |
| **P0 - Critical** | Complete service outage             | Immediate     | On-call engineer + Manager |
| **P1 - High**     | Partial outage affecting >50% users | <15 minutes   | On-call engineer           |
| **P2 - Medium**   | Degraded performance                | <1 hour       | Standard on-call           |
| **P3 - Low**      | Minor issues                        | <4 hours      | Standard support           |

### 2. Incident Commander

**Responsibilities:**

- Declare incident and severity level
- Coordinate recovery efforts
- Communicate with stakeholders
- Document timeline and actions

---

## Common Disaster Scenarios

### Scenario 1: Complete Server Failure

**Symptoms:**

- Health endpoint not responding
- All requests timing out
- No logs being generated

**Recovery Steps:**

```bash
# 1. Check server status
systemctl status servalsheets
# or: docker-compose ps
# or: kubectl get pods -n servalsheets

# 2. Check logs for errors
journalctl -u servalsheets -n 100
# or: docker-compose logs --tail=100
# or: kubectl logs deployment/servalsheets --tail=100

# 3. Attempt restart
systemctl restart servalsheets
# or: docker-compose restart
# or: kubectl rollout restart deployment/servalsheets

# 4. If restart fails, restore from backup
cd /opt/servalsheets
./docs/operations/restore-from-backup.sh latest

# 5. Verify recovery
curl http://localhost:3000/health
```

**Estimated Recovery Time:** 15-30 minutes

---

### Scenario 2: Redis Failure (Session Loss)

**Symptoms:**

- "Session not found" errors
- Users forced to re-authenticate
- Task state lost

**Recovery Steps:**

```bash
# 1. Check Redis status
redis-cli PING
# Expected: PONG

# 2. If Redis is down, restart
systemctl restart redis
# or: docker-compose restart redis

# 3. If Redis data corrupted, restore from backup
./docs/operations/backup-restore.sh restore-redis /backup/redis/latest.rdb

# 4. If Redis unrecoverable, accept session loss
# Users will need to re-authenticate
# Document incident for post-mortem

# 5. Verify Redis working
redis-cli INFO stats
```

**Impact:** Users must re-authenticate (30-60 seconds per user)
**Estimated Recovery Time:** 10-15 minutes

---

### Scenario 3: OAuth Service Disruption

**Symptoms:**

- Authentication failures
- "Invalid credentials" errors
- Google API returning errors

**Recovery Steps:**

```bash
# 1. Check Google API status
curl https://www.googleapis.com/oauth2/v2/tokeninfo

# 2. Verify credentials.json is intact
cat credentials.json | jq .

# 3. Check OAuth configuration
curl http://localhost:3000/.well-known/oauth-authorization-server

# 4. Test authentication flow
npm run auth

# 5. If credentials corrupted, restore from backup
./docs/operations/backup-restore.sh restore-config

# 6. Restart server to reload credentials
systemctl restart servalsheets
```

**Estimated Recovery Time:** 10-20 minutes

---

### Scenario 4: Database/Storage Corruption

**Symptoms:**

- "Cannot read property" errors
- Redis returning corrupted data
- Token store decryption failures

**Recovery Steps:**

```bash
# 1. Stop all write operations
systemctl stop servalsheets

# 2. Assess corruption extent
redis-cli --rdb /tmp/dump.rdb
# Check exit code: 0 = OK, 1 = corrupted

# 3. Restore from last known good backup
./docs/operations/backup-restore.sh restore-all YYYYMMDD_HHMMSS

# 4. Verify data integrity
redis-cli DBSIZE
cat $GOOGLE_TOKEN_STORE_PATH | wc -c

# 5. Start server in read-only mode for verification
NODE_ENV=production READ_ONLY=true npm start

# 6. If verified, switch to normal mode
systemctl start servalsheets
```

**Estimated Recovery Time:** 30-60 minutes
**Data Loss:** Up to RPO (24 hours with daily backups)

---

### Scenario 5: Complete Datacenter/Region Loss

**Symptoms:**

- All services unreachable
- Network partition
- Complete infrastructure failure

**Recovery Steps:**

```bash
# 1. Activate disaster recovery region
terraform apply -var="region=us-west-2"

# 2. Restore configuration from offsite backup
aws s3 cp s3://servalsheets-dr-backups/latest.tar.gz.gpg /tmp/
gpg --decrypt /tmp/latest.tar.gz.gpg | tar xzf - -C /opt/servalsheets

# 3. Restore Redis from backup
aws s3 cp s3://servalsheets-dr-backups/redis/latest.rdb /tmp/
./docs/operations/backup-restore.sh restore-redis /tmp/latest.rdb

# 4. Update DNS to point to DR region
aws route53 change-resource-record-sets --hosted-zone-id Z123 --change-batch file://dr-dns.json

# 5. Start services
kubectl apply -f k8s/production/

# 6. Monitor recovery
watch kubectl get pods -n servalsheets
```

**Estimated Recovery Time:** 1-4 hours
**Requires:** Offsite backups, multi-region setup, DNS failover

---

## Escalation Paths

### On-Call Contacts

```
Primary On-Call: +1-XXX-XXX-XXXX (PagerDuty)
Secondary On-Call: +1-XXX-XXX-XXXX
Engineering Manager: +1-XXX-XXX-XXXX
VP Engineering: +1-XXX-XXX-XXXX (P0 only)
```

### External Dependencies

| Service      | Support Contact          | SLA             |
| ------------ | ------------------------ | --------------- |
| Google Cloud | Google Cloud Support     | 1 hour response |
| Redis Cloud  | support@redis.com        | 30 min response |
| AWS          | AWS Support (Enterprise) | 15 min response |
| Cloudflare   | support@cloudflare.com   | 1 hour response |

---

## Communication Plan

### Internal Communication

**Slack Channel:** `#servalsheets-incidents`

**Status Update Frequency:**

- P0: Every 15 minutes
- P1: Every 30 minutes
- P2: Every hour

### External Communication

**Status Page:** `status.servalsheets.example.com`

**Customer Notification:**

```
Subject: [INCIDENT] ServalSheets Service Disruption

We are currently experiencing issues with ServalSheets.
Our team is actively working on resolution.

Status: Investigating
Started: [TIME]
Impact: [DESCRIPTION]
ETA: [ESTIMATE]

Updates will be provided every 30 minutes.
```

---

## Post-Incident Review

### Within 24 Hours

1. **Write Incident Report**
   - Timeline of events
   - Root cause analysis
   - Impact assessment
   - Actions taken

2. **Post-Mortem Meeting**
   - Attendees: All involved engineers + manager
   - Duration: 1 hour
   - Document lessons learned

3. **Action Items**
   - Preventive measures
   - Process improvements
   - Documentation updates
   - Monitoring enhancements

### Template

```markdown
# Incident Report: [DATE] - [TITLE]

## Summary

- **Duration:** [START] to [END] ([DURATION])
- **Impact:** [NUMBER] users affected
- **Severity:** P[0-3]
- **RCA:** [ROOT CAUSE]

## Timeline

- [TIME]: Incident detected
- [TIME]: On-call engineer paged
- [TIME]: Root cause identified
- [TIME]: Fix deployed
- [TIME]: Service restored
- [TIME]: Incident resolved

## Root Cause

[Detailed technical explanation]

## Resolution

[What was done to fix it]

## Lessons Learned

### What Went Well

- [Item 1]
- [Item 2]

### What Could Be Improved

- [Item 1]
- [Item 2]

## Action Items

- [ ] [ACTION] - Owner: [NAME] - Due: [DATE]
- [ ] [ACTION] - Owner: [NAME] - Due: [DATE]
```

---

## Disaster Recovery Testing

### Quarterly DR Drill

**Schedule:** First Saturday of Q1, Q2, Q3, Q4 at 2 AM

**Procedure:**

1. Announce planned DR test to team
2. Simulate primary region failure
3. Execute failover to DR region
4. Verify all services operational
5. Run smoke tests
6. Failback to primary region
7. Document results and issues
8. Update DR procedures as needed

**Success Criteria:**

- Failover completed within RTO (1 hour)
- All critical services operational
- No data loss beyond RPO (24 hours)
- Failback completed successfully

---

## DR Checklist

### Before Disaster

- [ ] Backups running daily (automated)
- [ ] Backup verification completed (monthly)
- [ ] DR region infrastructure provisioned
- [ ] DNS failover configured
- [ ] Runbooks up to date
- [ ] Contact list current
- [ ] Monitoring/alerting functional
- [ ] Team trained on DR procedures

### During Disaster

- [ ] Incident declared and logged
- [ ] Stakeholders notified
- [ ] Recovery procedures initiated
- [ ] Timeline documented
- [ ] Regular status updates provided
- [ ] External dependencies contacted (if needed)

### After Disaster

- [ ] Service restored and verified
- [ ] Incident closed
- [ ] Post-mortem scheduled
- [ ] Incident report written
- [ ] Action items tracked
- [ ] Procedures updated
- [ ] Team debriefed

---

## Quick Commands Reference

```bash
# Health check
curl http://localhost:3000/health

# Check logs (last 100 lines)
docker-compose logs --tail=100

# Restart service
docker-compose restart

# Full restore from backup
./backup-restore.sh restore-all latest

# Check Redis
redis-cli PING

# Check OAuth
curl http://localhost:3000/.well-known/oauth-authorization-server

# Monitor in real-time
watch -n 5 'curl -s http://localhost:3000/health | jq .'
```

---

## Summary

**Key Takeaways:**

1. Assess severity and declare incident immediately
2. Follow established procedures - don't improvise under pressure
3. Communicate frequently and transparently
4. Document everything for post-mortem
5. Test DR procedures regularly

**Remember:** It's better to over-communicate than under-communicate during an incident.
