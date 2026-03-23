---
title: Version Migration Guide
category: runbook
last_updated: 2026-01-31
description: Procedures for migrating between ServalSheets versions, including breaking changes, data migrations, and rollback strategies.
version: 1.6.0
tags: [docker, kubernetes]
estimated_time: 15-30 minutes
---

# Version Migration Guide

## Overview

Procedures for migrating between ServalSheets versions, including breaking changes, data migrations, and rollback strategies.

---

## Version Compatibility Matrix

| From Version  | To Version    | Difficulty | Downtime Required | Data Migration |
| ------------- | ------------- | ---------- | ----------------- | -------------- |
| 1.0.x → 1.1.x | ✅ Compatible | Easy       | No                | No             |
| 1.1.x → 2.0.x | ⚠️ Breaking   | Medium     | Yes (5-10 min)    | Yes            |
| 0.x → 1.x     | ❌ Major      | Hard       | Yes (30-60 min)   | Yes            |

---

## Pre-Migration Checklist

- [ ] Read release notes for target version
- [ ] Backup all data (see `backup-restore.md`)
- [ ] Test migration in staging environment
- [ ] Schedule maintenance window
- [ ] Notify users of planned downtime
- [ ] Verify rollback plan
- [ ] Have team on standby

---

## Migration: 1.0.x → 1.1.x

### What Changed

- Added MCP Protocol 2025-11-25 support
- Added Redis task store support
- Enhanced error messages
- New environment variables (optional)

### Breaking Changes

**None** - Fully backward compatible

### Migration Steps

```bash
# 1. Backup current installation
./docs/operations/backup-restore.sh backup-all

# 2. Pull new version
git fetch origin
git checkout v1.6.0

# 3. Install dependencies
npm ci

# 4. Rebuild
npm run build

# 5. Restart (zero downtime with rolling restart)
docker-compose up -d --no-deps --build servalsheets
# or: kubectl rollout restart deployment/servalsheets

# 6. Verify
curl http://localhost:3000/health
# Should show: "version": "1.1.1"
```

**Estimated Time**: 10-15 minutes
**Downtime**: 0 minutes (rolling restart)

### New Optional Features

To enable Redis task store:

```bash
# Add to .env
REDIS_URL=redis://localhost:6379

# Restart
docker-compose restart servalsheets
```

---

## Migration: 1.1.x → 2.0.x (Future)

### What Will Change (Example)

- Schema version bump
- Database structure changes
- API endpoint changes
- Configuration format changes

### Breaking Changes

- ⚠️ Task store format change (requires migration)
- ⚠️ Session store format change
- ⚠️ Environment variable renames

### Migration Steps

```bash
# 1. Full backup
./docs/operations/backup-restore.sh backup-all

# 2. Stop services
docker-compose down

# 3. Run migration script
npm run migrate:1.1-to-2.0

# 4. Update environment variables
cp .env .env.backup
./scripts/upgrade-env.sh .env.backup > .env

# 5. Pull new version
git checkout v2.0.0
npm ci
npm run build

# 6. Start services
docker-compose up -d

# 7. Verify migration
npm run verify:migration

# 8. Monitor for issues
docker-compose logs -f
```

**Estimated Time**: 30-60 minutes
**Downtime**: Yes (30 minutes expected)

---

## Data Migration Scripts

### Redis Data Migration

If Redis schema changes between versions:

```bash
#!/bin/bash
# migrate-redis-schema.sh

echo "Starting Redis data migration..."

# 1. Export all keys
redis-cli --scan --pattern "servalsheets:*" > /tmp/keys.txt

# 2. For each key, read and transform
while read key; do
  # Get value
  value=$(redis-cli GET "$key")

  # Transform (example: add version field)
  new_value=$(echo "$value" | jq '. + {version: "2.0"}')

  # Write back
  redis-cli SET "$key" "$new_value"
done < /tmp/keys.txt

echo "Redis migration complete"
```

### Session Data Migration

```typescript
// scripts/migrate-sessions.ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

async function migrateSessions() {
  const keys = await redis.keys('servalsheets:session:*');

  for (const key of keys) {
    const session = JSON.parse(await redis.get(key));

    // Transform session to new format
    const migratedSession = {
      ...session,
      version: '2.0',
      // Add new required fields
      createdAt: session.createdAt || new Date().toISOString(),
      // Remove deprecated fields
      // ...
    };

    await redis.set(key, JSON.stringify(migratedSession));
  }

  console.log(`Migrated ${keys.length} sessions`);
}

migrateSessions();
```

Run with:

```bash
npx tsx scripts/migrate-sessions.ts
```

---

## Rollback Procedures

### Quick Rollback (< 1 hour since upgrade)

```bash
# 1. Stop new version
docker-compose down

# 2. Restore previous version
git checkout v1.6.0
npm ci
npm run build

# 3. Restore backups (if data changed)
./docs/operations/backup-restore.sh restore-all YYYYMMDD_HHMMSS

# 4. Start services
docker-compose up -d

# 5. Verify
curl http://localhost:3000/health
```

### Full Rollback (> 1 hour, data migrated)

```bash
# 1. Stop services
docker-compose down

# 2. Restore complete backup from before migration
./docs/operations/backup-restore.sh restore-all pre-migration

# 3. Checkout previous version
git checkout v1.6.0
npm ci
npm run build

# 4. Run reverse migration script (if available)
npm run migrate:2.0-to-1.1

# 5. Start services
docker-compose up -d

# 6. Verify
curl http://localhost:3000/health
```

---

## Environment Variable Changes

### Deprecated Variables (Track across versions)

| Version | Deprecated        | Replacement           | Migration |
| ------- | ----------------- | --------------------- | --------- |
| 2.0.0   | `OAUTH_TTL`       | `ACCESS_TOKEN_TTL`    | Rename    |
| 2.0.0   | `SESSION_TIMEOUT` | `SESSION_TTL_SECONDS` | Rename    |

### Environment Migration Script

```bash
#!/bin/bash
# scripts/upgrade-env.sh

INPUT_FILE="$1"
OUTPUT_FILE="${2:-.env}"

# Read old .env
source "$INPUT_FILE"

# Transform variables
cat > "$OUTPUT_FILE" << EOF
# Migrated from version 1.6.x to 2.0.x

# Renamed variables
ACCESS_TOKEN_TTL=${OAUTH_TTL:-3600}
SESSION_TTL_SECONDS=${SESSION_TIMEOUT:-86400}

# Unchanged variables
REDIS_URL=$REDIS_URL
JWT_SECRET=$JWT_SECRET
# ... (copy rest)
EOF

echo "Environment variables migrated to $OUTPUT_FILE"
```

---

## Configuration File Migrations

### From JSON to YAML (Example)

If config format changes:

```bash
#!/bin/bash
# migrate-config-format.sh

# Convert old config.json to new config.yaml
yq eval -P config.json > config.yaml

# Verify
yq eval config.yaml
```

---

## Database Schema Migrations

### Schema Version Tracking

```typescript
// Track schema version in Redis
await redis.set('servalsheets:schema_version', '2.0.0');

// Check on startup
const schemaVersion = await redis.get('servalsheets:schema_version');
if (schemaVersion !== EXPECTED_VERSION) {
  throw new Error(`Schema version mismatch. Expected ${EXPECTED_VERSION}, found ${schemaVersion}`);
}
```

### Migration Scripts

```typescript
// migrations/001_add_version_field.ts
export async function up(redis: Redis) {
  const keys = await redis.keys('servalsheets:*');
  for (const key of keys) {
    const data = JSON.parse(await redis.get(key));
    data.version = '2.0';
    await redis.set(key, JSON.stringify(data));
  }
}

export async function down(redis: Redis) {
  const keys = await redis.keys('servalsheets:*');
  for (const key of keys) {
    const data = JSON.parse(await redis.get(key));
    delete data.version;
    await redis.set(key, JSON.stringify(data));
  }
}
```

---

## Kubernetes Migration

### Rolling Update Strategy

```yaml
# k8s/deployment.yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1 # Max 1 extra pod during update
      maxUnavailable: 0 # Keep all pods running during update
```

```bash
# Apply new version
kubectl set image deployment/servalsheets \
  servalsheets=servalsheets:2.0.0

# Monitor rollout
kubectl rollout status deployment/servalsheets

# If issues, rollback immediately
kubectl rollout undo deployment/servalsheets
```

### Blue-Green Deployment

```bash
# 1. Deploy new version (green) alongside current (blue)
kubectl apply -f k8s/deployment-green.yaml

# 2. Test green deployment
kubectl port-forward deployment/servalsheets-green 9000:3000
curl http://localhost:9000/health

# 3. Switch traffic to green
kubectl patch service servalsheets -p '
{
  "spec": {
    "selector": {
      "version": "green"
    }
  }
}'

# 4. Monitor for issues
kubectl logs -f deployment/servalsheets-green

# 5. If successful, scale down blue
kubectl scale deployment servalsheets-blue --replicas=0

# 6. If issues, switch back to blue
kubectl patch service servalsheets -p '
{
  "spec": {
    "selector": {
      "version": "blue"
    }
  }
}'
```

---

## Zero-Downtime Migration

### Strategy

1. **Backward-compatible changes first**
   - Deploy code that supports BOTH old and new formats
   - Run data migration in background
   - Switch to new format once migration complete

2. **Feature flags**

   ```typescript
   const USE_NEW_FORMAT = process.env.USE_NEW_FORMAT === 'true';

   if (USE_NEW_FORMAT) {
     // Use new implementation
   } else {
     // Use old implementation
   }
   ```

3. **Gradual rollout**
   - Deploy to canary instances first (5%)
   - Monitor error rates
   - Gradually increase to 100%

---

## Post-Migration Validation

### Automated Tests

```bash
# Run integration tests against new version
npm run test:integration

# Run smoke tests
npm run test:smoke

# Load test to verify performance
k6 run tests/load/post-migration-test.js
```

### Manual Verification

```bash
# 1. Health check
curl http://localhost:3000/health
# Expected: {"status": "healthy", "version": "2.0.0"}

# 2. OAuth flow
curl http://localhost:3000/.well-known/oauth-authorization-server
# Should return complete OAuth metadata

# 3. Create test spreadsheet
# Use Claude Desktop to test basic operations

# 4. Check Redis connectivity
redis-cli -u $REDIS_URL PING

# 5. Verify task system
curl -X POST http://localhost:3000/api/tasks/test

# 6. Check logs for errors
tail -f /var/log/servalsheets.log | grep ERROR
```

---

## Migration Troubleshooting

### Common Issues

**Problem**: Service won't start after upgrade

**Solution**:

```bash
# Check logs for specific error
docker-compose logs servalsheets | tail -100

# Common causes:
# - Missing new environment variables
# - Redis schema incompatibility
# - NPM package version conflicts

# Fix:
# 1. Add missing env vars from .env.example
# 2. Run migration script
# 3. Clear node_modules and reinstall
```

**Problem**: "Schema version mismatch" error

**Solution**:

```bash
# Check current schema version
redis-cli GET servalsheets:schema_version

# Run migration script
npm run migrate:schema

# Or force set version (DANGER - only if certain)
redis-cli SET servalsheets:schema_version "2.0.0"
```

**Problem**: Users getting "Session expired" errors

**Solution**:

- Expected behavior if session format changed
- Users need to re-authenticate
- Communicate this in release notes

---

## Version-Specific Migration Guides

### v1.6.0 → v1.6.0

**Date**: 2026-01-04
**Difficulty**: Easy
**Downtime**: None

Changes:

- Added MCP 2025-11-25 support
- New optional environment variables
- Performance improvements

No migration required - fully backward compatible.

### v1.6.0 → v1.6.0 (Patch)

**Date**: 2026-01-04
**Difficulty**: Trivial
**Downtime**: None

Changes:

- Security fixes
- Bug fixes
- Documentation updates

Simply update and restart - no configuration changes needed.

---

## Migration Checklist

### Pre-Migration

- [ ] Backup all data
- [ ] Test in staging
- [ ] Read release notes
- [ ] Schedule maintenance window
- [ ] Notify users

### During Migration

- [ ] Stop services (if downtime required)
- [ ] Run migration scripts
- [ ] Update environment variables
- [ ] Deploy new version
- [ ] Start services

### Post-Migration

- [ ] Run validation tests
- [ ] Check logs for errors
- [ ] Verify functionality
- [ ] Monitor performance
- [ ] Mark migration complete

### Emergency Rollback Ready

- [ ] Backup of previous version
- [ ] Rollback script tested
- [ ] Team on standby
- [ ] Communication plan ready

---

## Future-Proofing

### Design for Migration

1. **Version all data structures**

   ```typescript
   interface Session {
     version: string; // Always include version
     data: any;
   }
   ```

2. **Support multiple versions temporarily**

   ```typescript
   if (session.version === '1.0') {
     return migrateFromV1(session);
   } else if (session.version === '2.0') {
     return session;
   }
   ```

3. **Document breaking changes clearly**
   - In CHANGELOG.md
   - In release notes
   - In migration guide

4. **Provide migration scripts**
   - Automated where possible
   - Clear manual steps where needed
   - Rollback scripts

---

## Summary

✅ **Always backup before migrating**
✅ **Test migrations in staging first**
✅ **Have rollback plan ready**
✅ **Monitor closely post-migration**
✅ **Document version-specific changes**

For questions, see `TROUBLESHOOTING.md` or file an issue.
