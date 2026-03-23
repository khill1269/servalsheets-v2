---
title: Backup and Restore Procedures
category: runbook
last_updated: 2026-01-31
description: ServalSheets backup and restore procedures for production deployments. This guide covers data persistence, session state, and configuration backups.
version: 1.6.0
tags: [prometheus, docker, kubernetes]
estimated_time: 15-30 minutes
---

# Backup and Restore Procedures

## Overview

ServalSheets backup and restore procedures for production deployments. This guide covers data persistence, session state, and configuration backups.

---

## What to Backup

### 1. **Configuration Files**

- `.env` - Environment variables (secrets!)
- `credentials.json` - Google OAuth credentials
- Service account keys (if applicable)

### 2. **Session Data** (if using Redis)

- Redis database dump
- OAuth session state
- Task state

### 3. **Encrypted Token Store** (if using file-based storage)

- Location: Configured via `GOOGLE_TOKEN_STORE_PATH`
- Contains: Encrypted Google OAuth tokens
- **Critical**: Also backup `ENCRYPTION_KEY` (from `.env`)

### 4. **Logs** (optional, for audit/forensics)

- Application logs
- Access logs
- Error logs

---

## Backup Procedures

### Configuration Backup

#### Manual Backup

```bash
#!/bin/bash
# backup-config.sh

BACKUP_DIR="/backup/servalsheets/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup environment files (SECURITY: Encrypt these!)
cp .env "$BACKUP_DIR/env.backup"
cp credentials.json "$BACKUP_DIR/credentials.backup" 2>/dev/null || true

# Backup service account key if exists
cp service-account.json "$BACKUP_DIR/service-account.backup" 2>/dev/null || true

# Encrypt the backup directory
tar czf - "$BACKUP_DIR" | gpg --encrypt --recipient admin@example.com > "$BACKUP_DIR.tar.gz.gpg"

# Remove unencrypted backup
rm -rf "$BACKUP_DIR"

echo "Configuration backup created: $BACKUP_DIR.tar.gz.gpg"
```

#### Automated Backup (Cron)

```bash
# /etc/cron.d/servalsheets-backup
# Backup configuration daily at 2 AM
0 2 * * * servalsheets /opt/servalsheets/scripts/backup-config.sh >> /var/log/servalsheets-backup.log 2>&1
```

---

### Redis Backup (Session/Task State)

#### Using Redis RDB Snapshots

```bash
#!/bin/bash
# backup-redis.sh

BACKUP_DIR="/backup/servalsheets/redis"
mkdir -p "$BACKUP_DIR"

# Trigger Redis save
redis-cli SAVE

# Copy RDB file
cp /var/lib/redis/dump.rdb "$BACKUP_DIR/dump-$(date +%Y%m%d_%H%M%S).rdb"

# Compress old backups
find "$BACKUP_DIR" -name "dump-*.rdb" -mtime +1 -exec gzip {} \;

# Remove backups older than 30 days
find "$BACKUP_DIR" -name "dump-*.rdb.gz" -mtime +30 -delete

echo "Redis backup completed"
```

#### Using Redis AOF (Append-Only File)

If using AOF persistence:

```bash
# Redis config (redis.conf)
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec

# Backup AOF file
cp /var/lib/redis/appendonly.aof /backup/servalsheets/redis/appendonly-$(date +%Y%m%d_%H%M%S).aof
```

#### Redis Cloud/Managed Service

If using Redis Cloud, AWS ElastiCache, or Azure Cache:

- Configure automatic snapshots in cloud console
- Recommended: Daily snapshots with 7-day retention
- Test restore procedures quarterly

---

### Token Store Backup

#### File-Based Token Store

```bash
#!/bin/bash
# backup-token-store.sh

TOKEN_STORE_PATH="${GOOGLE_TOKEN_STORE_PATH:-./google-token-store}"
BACKUP_DIR="/backup/servalsheets/tokens"

mkdir -p "$BACKUP_DIR"

# Backup encrypted token file
cp "$TOKEN_STORE_PATH" "$BACKUP_DIR/token-store-$(date +%Y%m%d_%H%M%S).enc"

# CRITICAL: Also backup the encryption key from .env
# This should be in your secure configuration backup

# Keep last 30 backups
ls -t "$BACKUP_DIR"/token-store-*.enc | tail -n +31 | xargs rm -f

echo "Token store backup completed"
```

**IMPORTANT**: The token store is encrypted with `ENCRYPTION_KEY`. Without this key, backups are useless!

---

### Kubernetes Backup

#### Using Velero

```yaml
# velero-backup-schedule.yaml
apiVersion: velero.io/v1
kind: Schedule
metadata:
  name: servalsheets-daily
  namespace: velero
spec:
  schedule: '0 2 * * *'
  template:
    includedNamespaces:
      - servalsheets
    includedResources:
      - '*'
    storageLocation: default
    volumeSnapshotLocations:
      - default
    ttl: 720h # 30 days
```

```bash
# Create backup manually
velero backup create servalsheets-manual --include-namespaces servalsheets

# Verify backup
velero backup describe servalsheets-manual
```

---

### Docker Volume Backup

```bash
#!/bin/bash
# backup-docker-volumes.sh

BACKUP_DIR="/backup/servalsheets/volumes"
mkdir -p "$BACKUP_DIR"

# Backup Redis data volume
docker run --rm \
  --volumes-from servalsheets-redis \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf /backup/redis-$(date +%Y%m%d_%H%M%S).tar.gz /data

# Backup token store volume (if using volume)
docker run --rm \
  --volumes-from servalsheets-app \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf /backup/tokens-$(date +%Y%m%d_%H%M%S).tar.gz /app/token-store

echo "Docker volumes backed up"
```

---

## Restore Procedures

### Pre-Restore Checklist

- [ ] Verify backup integrity (checksums, test decrypt)
- [ ] Identify correct backup version to restore
- [ ] Notify users of maintenance window
- [ ] Stop or scale down running instances
- [ ] Document current state (for rollback)

---

### Configuration Restore

```bash
#!/bin/bash
# restore-config.sh

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup-file.tar.gz.gpg>"
  exit 1
fi

# Decrypt and extract
gpg --decrypt "$BACKUP_FILE" | tar xzf - -C /tmp

# Restore files
cp /tmp/backup-*/env.backup .env
cp /tmp/backup-*/credentials.backup credentials.json
cp /tmp/backup-*/service-account.backup service-account.json 2>/dev/null || true

# Clean up
rm -rf /tmp/backup-*

echo "Configuration restored. Verify secrets before starting server."
```

**Post-Restore Steps:**

1. Verify `.env` contains correct values
2. Test credentials with: `npm run auth`
3. Restart server

---

### Redis Restore

#### From RDB Snapshot

```bash
#!/bin/bash
# restore-redis.sh

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <dump-YYYYMMDD_HHMMSS.rdb>"
  exit 1
fi

# Stop Redis
systemctl stop redis
# or: docker-compose stop redis

# Backup current data (safety)
cp /var/lib/redis/dump.rdb /var/lib/redis/dump.rdb.pre-restore

# Restore from backup
cp "$BACKUP_FILE" /var/lib/redis/dump.rdb
chown redis:redis /var/lib/redis/dump.rdb

# Start Redis
systemctl start redis
# or: docker-compose start redis

# Verify
redis-cli PING

echo "Redis restored from $BACKUP_FILE"
```

#### From AOF File

```bash
# Stop Redis
systemctl stop redis

# Restore AOF file
cp /backup/servalsheets/redis/appendonly-YYYYMMDD.aof /var/lib/redis/appendonly.aof
chown redis:redis /var/lib/redis/appendonly.aof

# Start Redis (will replay AOF)
systemctl start redis

# Verify
redis-cli DBSIZE
```

---

### Token Store Restore

```bash
#!/bin/bash
# restore-token-store.sh

BACKUP_FILE="$1"
TOKEN_STORE_PATH="${GOOGLE_TOKEN_STORE_PATH:-./google-token-store}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <token-store-YYYYMMDD.enc>"
  exit 1
fi

# Backup current token store
cp "$TOKEN_STORE_PATH" "$TOKEN_STORE_PATH.pre-restore" 2>/dev/null || true

# Restore from backup
cp "$BACKUP_FILE" "$TOKEN_STORE_PATH"

echo "Token store restored. Verify ENCRYPTION_KEY in .env matches!"
```

**CRITICAL**: The `ENCRYPTION_KEY` in `.env` must match the key used when the backup was created!

---

### Kubernetes Restore

#### Using Velero

```bash
# List available backups
velero backup get

# Restore from backup
velero restore create --from-backup servalsheets-daily-20260104020000

# Monitor restore
velero restore describe servalsheets-daily-20260104020000

# Verify pods are running
kubectl get pods -n servalsheets
```

---

### Docker Volume Restore

```bash
#!/bin/bash
# restore-docker-volumes.sh

REDIS_BACKUP="$1"
TOKEN_BACKUP="$2"

# Stop containers
docker-compose down

# Restore Redis volume
docker run --rm \
  --volumes-from servalsheets-redis \
  -v "$(dirname $REDIS_BACKUP)":/backup \
  alpine sh -c "cd / && tar xzf /backup/$(basename $REDIS_BACKUP)"

# Restore token store volume
docker run --rm \
  --volumes-from servalsheets-app \
  -v "$(dirname $TOKEN_BACKUP)":/backup \
  alpine sh -c "cd / && tar xzf /backup/$(basename $TOKEN_BACKUP)"

# Start containers
docker-compose up -d

echo "Docker volumes restored"
```

---

## Disaster Recovery

### RTO (Recovery Time Objective)

**Target**: 1 hour from backup to full recovery

### RPO (Recovery Point Objective)

**Target**: 24 hours (daily backups)

For critical deployments, reduce RPO with:

- Redis AOF with `appendfsync everysec`
- Hourly configuration backups
- Continuous replication to standby region

---

### Full System Restore (Step-by-Step)

1. **Provision New Infrastructure** (if needed)

   ```bash
   terraform apply -var="environment=production"
   # or provision manually
   ```

2. **Restore Configuration**

   ```bash
   ./restore-config.sh /backup/latest.tar.gz.gpg
   ```

3. **Restore Redis**

   ```bash
   ./restore-redis.sh /backup/redis/dump-latest.rdb
   ```

4. **Restore Token Store**

   ```bash
   ./restore-token-store.sh /backup/tokens/token-store-latest.enc
   ```

5. **Start Services**

   ```bash
   docker-compose up -d
   # or: kubectl apply -f k8s/
   # or: systemctl start servalsheets
   ```

6. **Verify**

   ```bash
   curl http://localhost:3000/health
   # Should return: {"status": "healthy"}
   ```

7. **Test OAuth Flow**

   ```bash
   # Test authentication
   curl http://localhost:3000/.well-known/oauth-authorization-server
   ```

8. **Monitor for Issues**

   ```bash
   # Watch logs
   docker-compose logs -f
   # or: kubectl logs -f deployment/servalsheets
   ```

---

## Backup Verification

### Regular Testing

**Schedule**: Quarterly (every 3 months)

```bash
#!/bin/bash
# test-restore.sh
# Run in test environment to verify backups

set -e

echo "Starting backup verification..."

# 1. Deploy clean test environment
terraform apply -var="environment=test"

# 2. Restore from latest backup
./restore-config.sh /backup/latest.tar.gz.gpg
./restore-redis.sh /backup/redis/dump-latest.rdb
./restore-token-store.sh /backup/tokens/token-store-latest.enc

# 3. Start services
docker-compose up -d

# 4. Wait for startup
sleep 30

# 5. Run health checks
curl -f http://localhost:3000/health || { echo "Health check failed"; exit 1; }

# 6. Test OAuth flow
curl -f http://localhost:3000/.well-known/oauth-authorization-server || { echo "OAuth check failed"; exit 1; }

# 7. Test Redis connectivity
redis-cli PING || { echo "Redis check failed"; exit 1; }

echo "✅ Backup verification successful"

# Cleanup test environment
docker-compose down
terraform destroy -var="environment=test" -auto-approve
```

---

## Retention Policy

### Recommended Retention

| Backup Type     | Frequency | Retention |
| --------------- | --------- | --------- |
| Configuration   | Daily     | 30 days   |
| Redis Snapshots | Daily     | 7 days    |
| Token Store     | Daily     | 30 days   |
| Full System     | Weekly    | 90 days   |
| Pre-Deployment  | On deploy | 1 year    |

### Automated Cleanup

```bash
#!/bin/bash
# cleanup-old-backups.sh

BACKUP_BASE="/backup/servalsheets"

# Remove config backups older than 30 days
find "$BACKUP_BASE"/*.tar.gz.gpg -mtime +30 -delete

# Remove Redis backups older than 7 days
find "$BACKUP_BASE"/redis/*.rdb.gz -mtime +7 -delete

# Remove token store backups older than 30 days
find "$BACKUP_BASE"/tokens/*.enc -mtime +30 -delete

echo "Old backups cleaned up"
```

---

## Security Best Practices

### Encryption

**Always encrypt backups containing:**

- `.env` files (contain secrets!)
- `credentials.json`
- Token store files

**Recommended**: Use GPG with strong passphrase or key-based encryption

```bash
# Encrypt with GPG
tar czf - /path/to/backup | gpg --encrypt --recipient admin@example.com > backup.tar.gz.gpg

# Decrypt
gpg --decrypt backup.tar.gz.gpg | tar xzf -
```

### Access Control

- Store backups in secure location (encrypted S3, vault, etc.)
- Limit access to backup files (principle of least privilege)
- Use separate encryption keys for different environments (dev, staging, prod)
- Rotate backup encryption keys annually

### Audit Trail

- Log all backup and restore operations
- Record who performed backup/restore and when
- Monitor backup success/failure with alerts

---

## Monitoring & Alerts

### Backup Health Checks

```yaml
# prometheus-rules.yaml
groups:
  - name: backup_alerts
    rules:
      - alert: BackupFailed
        expr: time() - servalsheets_last_backup_timestamp > 86400
        for: 1h
        labels:
          severity: critical
        annotations:
          summary: 'ServalSheets backup failed or is stale'
          description: 'No successful backup in the last 24 hours'

      - alert: BackupSizeTooSmall
        expr: servalsheets_backup_size_bytes < 1000000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Backup size suspiciously small'
```

---

## Troubleshooting

### Backup Issues

**Problem**: Redis backup fails with "Can't save in background: fork: Cannot allocate memory"

**Solution**:

```bash
# Temporarily increase vm.overcommit_memory
sysctl vm.overcommit_memory=1

# Or disable Redis background save and use AOF
redis-cli CONFIG SET save ""
```

**Problem**: Token store restore results in "Invalid encryption key"

**Solution**:

- Verify `ENCRYPTION_KEY` in `.env` matches the key used when backup was created
- Check for whitespace or hidden characters in key
- Regenerate tokens if key is permanently lost

### Restore Issues

**Problem**: After restore, sessions are lost

**Solution**:

- This is expected if Redis backup is older than session TTL (default 24h)
- Users will need to re-authenticate
- To minimize impact, schedule restores during low-traffic periods

**Problem**: OAuth flow fails after configuration restore

**Solution**:

- Verify `credentials.json` is correct
- Check redirect URIs in Google Console match configuration
- Test with: `npm run auth`

---

## Summary Checklist

### Daily (Automated)

- [ ] Configuration backup
- [ ] Redis snapshot
- [ ] Token store backup

### Weekly (Automated)

- [ ] Full system backup
- [ ] Backup verification in test environment

### Monthly (Manual)

- [ ] Review backup retention policy
- [ ] Check backup storage capacity
- [ ] Verify backup encryption keys are secure

### Quarterly (Manual)

- [ ] Full disaster recovery test
- [ ] Update backup procedures documentation
- [ ] Review and update RTO/RPO targets

---

## References

- [Redis Persistence Documentation](https://redis.io/topics/persistence)
- [Velero Backup Guide](https://velero.io/docs/)
- [Kubernetes Backup Best Practices](https://kubernetes.io/docs/concepts/cluster-administration/backup/)
- [GPG Encryption Guide](https://gnupg.org/documentation/)
