---
title: JWT Secret Rotation
category: runbook
last_updated: 2026-01-31
description: ServalSheets supports JWT secret rotation for zero-downtime secret updates. This allows you to rotate JWT signing secrets without invalidating existing sessions.
version: 1.6.0
tags: [docker, kubernetes]
estimated_time: 15-30 minutes
---

# JWT Secret Rotation

## Overview

ServalSheets supports JWT secret rotation for zero-downtime secret updates. This allows you to rotate JWT signing secrets without invalidating existing sessions or requiring users to re-authenticate.

## How It Works

1. **Multiple Active Secrets**: The server can use multiple JWT secrets simultaneously
2. **Primary Secret for Signing**: New tokens are always signed with the **first** secret in the list
3. **All Secrets for Validation**: Token validation tries all active secrets in order
4. **Graceful Phase-Out**: Old secrets can be removed after all tokens expire naturally

## Rotation Procedure

### Step 1: Generate New Secret

Generate a strong random secret:

```bash
openssl rand -hex 32
```

Output example: `a1b2c3d4e5f6789...` (64 hex characters)

### Step 2: Add New Secret (Primary Position)

Add the new secret **first** in the comma-separated list:

```bash
# Before rotation
JWT_SECRET=OLD_SECRET_HERE

# After adding new secret (new secret is first)
JWT_SECRET=NEW_SECRET_HERE,OLD_SECRET_HERE
```

⚠️ **IMPORTANT**: The first secret in the list is used for signing new tokens!

### Step 3: Restart Server

Restart all server instances with the updated configuration:

```bash
# Docker
docker-compose restart servalsheets

# PM2
pm2 restart servalsheets

# Kubernetes
kubectl rollout restart deployment/servalsheets
```

**What happens now:**

- ✅ New tokens are signed with `NEW_SECRET_HERE`
- ✅ Old tokens signed with `OLD_SECRET_HERE` still validate
- ✅ Zero downtime, no user impact

### Step 4: Wait for Token Expiration

Wait for all tokens signed with the old secret to expire naturally:

- **Access Token TTL**: Default 1 hour (`ACCESS_TOKEN_TTL=3600`)
- **Refresh Token TTL**: Default 30 days (`REFRESH_TOKEN_TTL=2592000`)

**Recommended wait time**: `REFRESH_TOKEN_TTL + 24 hours` (safety buffer)

For default configuration: **31 days**

### Step 5: Remove Old Secret

After the wait period, remove the old secret from the configuration:

```bash
# Remove old secret (keep only new secret)
JWT_SECRET=NEW_SECRET_HERE
```

### Step 6: Final Restart

Restart the server one final time:

```bash
# Apply the simplified configuration
docker-compose restart servalsheets
```

**Done!** Secret rotation complete with zero downtime.

---

## Automated Rotation

For automated secret rotation (CI/CD, secret managers):

### AWS Secrets Manager Example

```bash
#!/bin/bash
# Automated JWT secret rotation script

# 1. Fetch current secret
CURRENT_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id servalsheets/jwt-secret \
  --query 'SecretString' --output text)

# 2. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 3. Create dual-secret configuration
DUAL_SECRET="${NEW_SECRET},${CURRENT_SECRET}"

# 4. Update secret manager with dual configuration
aws secretsmanager update-secret \
  --secret-id servalsheets/jwt-secret \
  --secret-string "$DUAL_SECRET"

# 5. Trigger rolling restart
kubectl rollout restart deployment/servalsheets

# 6. Schedule cleanup job for 31 days later
# (Remove old secret after token expiration)
aws events put-rule \
  --name "servalsheets-jwt-cleanup-$(date +%s)" \
  --schedule-expression "rate(31 days)"
```

### Kubernetes Secret Rotation

```yaml
# servalsheets-secret-rotation.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: servalsheets-jwt-rotation
spec:
  # Run every 90 days (recommended rotation schedule)
  schedule: '0 2 1 */3 *'
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: rotate-jwt
              image: servalsheets/secret-rotator:latest
              env:
                - name: SECRET_NAME
                  value: servalsheets-jwt-secret
                - name: DEPLOYMENT_NAME
                  value: servalsheets
          restartPolicy: OnFailure
```

---

## Emergency Rotation

If a secret is **compromised**, perform immediate rotation:

### ⚠️ URGENT: Compromised Secret Response

```bash
# 1. Generate new secret immediately
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update with ONLY the new secret (no dual-secret phase)
JWT_SECRET=$NEW_SECRET

# 3. Restart all instances immediately
docker-compose restart servalsheets

# 4. Notify users
# All existing sessions will be invalidated
# Users must re-authenticate
```

**Impact:**

- ❌ All existing JWT tokens immediately invalid
- ❌ All users must re-authenticate
- ✅ Compromised secret no longer accepted
- ✅ Security restored

---

## Verification

### Check Active Secret Count

The server logs the number of active JWT secrets on startup:

```bash
# Look for this log entry
grep "JWT secrets loaded" /var/log/servalsheets.log
```

Example output:

```
JWT secrets loaded: 2 (primary + 1 for rotation)
```

### Test Token Validation

Generate a test token and verify it validates:

```bash
# Get access token
TOKEN=$(curl -s -X POST http://localhost:3000/oauth/token \
  -d 'grant_type=client_credentials' \
  -d 'client_id=servalsheets' \
  -d 'client_secret=YOUR_SECRET' \
  | jq -r '.access_token')

# Verify token is accepted
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/health
```

---

## Best Practices

### 1. Regular Rotation Schedule

**Recommended**: Rotate secrets every **90 days**

- Security best practice
- Limits exposure window if secret compromised
- Prevents secret staleness

### 2. Strong Secret Generation

**Always use cryptographically secure random generation:**

```bash
# ✅ GOOD - Cryptographically secure
openssl rand -hex 32

# ❌ BAD - Weak, predictable
echo "my-secret-key"
```

### 3. Secret Storage

**Never:**

- ❌ Commit secrets to version control
- ❌ Store secrets in plaintext files
- ❌ Share secrets via email or chat
- ❌ Log or print secrets

**Instead:**

- ✅ Use environment variables
- ✅ Use secret management systems (Vault, AWS Secrets Manager, Azure Key Vault)
- ✅ Restrict access to secrets (principle of least privilege)
- ✅ Audit secret access

### 4. Test in Staging First

**Always test rotation procedure in staging before production:**

1. Perform rotation in staging environment
2. Verify services restart successfully
3. Test authentication with new tokens
4. Confirm old tokens still validate (dual-secret phase)
5. Wait appropriate TTL period
6. Verify old secret removal works
7. Document any issues encountered

### 5. Coordinate with Deployment Windows

**Best times to rotate:**

- ✅ During maintenance windows
- ✅ Low-traffic periods (e.g., weekends, off-peak hours)
- ✅ After recent deployments have stabilized
- ❌ Never during high-traffic events or critical business periods

### 6. Monitor After Rotation

**Watch for:**

- Authentication error rates
- Token validation failures
- Server restart success
- User session issues

**Set alerts for:**

- Spike in 401 Unauthorized responses
- JWT validation errors in logs
- Increased re-authentication requests

---

## Troubleshooting

### Problem: "Invalid signature" errors after rotation

**Cause**: Old secret removed too soon (before tokens expired)

**Solution**:

1. Re-add old secret to JWT_SECRET list
2. Restart server
3. Wait full TTL period before removing again

### Problem: New tokens not working

**Cause**: New secret not in primary position (first in list)

**Solution**:

```bash
# Wrong order (old secret is first)
JWT_SECRET=OLD_SECRET,NEW_SECRET  # ❌

# Correct order (new secret is first)
JWT_SECRET=NEW_SECRET,OLD_SECRET  # ✅
```

### Problem: Server won't start after adding new secret

**Cause**: Invalid secret format or typo

**Solution**:

1. Verify secret is 64 hex characters (32 bytes)
2. Check for typos or special characters
3. Ensure proper comma separation (no spaces)
4. Generate fresh secret: `openssl rand -hex 32`

### Problem: Can't remember which secret is active

**Solution**: Check server logs on startup for active secret count

---

## Advanced: Multi-Region Rotation

For globally distributed deployments:

1. **Stagger restarts** across regions to maintain availability
2. **Monitor each region** independently during rotation
3. **Rollback plan** ready if issues occur in any region
4. **Use centralized secret storage** (AWS Secrets Manager replication)

### Example: AWS Multi-Region

```bash
# Region 1: us-east-1
aws secretsmanager update-secret \
  --region us-east-1 \
  --secret-id servalsheets/jwt-secret \
  --secret-string "$DUAL_SECRET"

# Replicate to Region 2: eu-west-1
aws secretsmanager replicate-secret-to-regions \
  --secret-id servalsheets/jwt-secret \
  --add-replica-regions Region=eu-west-1

# Rolling restart across regions
kubectl --context=us-east-1 rollout restart deployment/servalsheets
kubectl --context=eu-west-1 rollout restart deployment/servalsheets
```

---

## References

- [OAuth 2.1 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [NIST Secret Management Guidelines](https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final)

---

## Summary Checklist

Before starting rotation:

- [ ] New secret generated securely (`openssl rand -hex 32`)
- [ ] Staging environment tested
- [ ] Deployment window scheduled
- [ ] Monitoring alerts configured
- [ ] Rollback plan documented
- [ ] Team notified of rotation schedule

During rotation:

- [ ] New secret added in primary position
- [ ] All instances restarted successfully
- [ ] Authentication working with new tokens
- [ ] Old tokens still validating
- [ ] No errors in logs

After TTL expiration:

- [ ] Full TTL period + safety buffer elapsed
- [ ] Old secret removed from configuration
- [ ] Final restart completed
- [ ] Monitoring shows normal operation
- [ ] Rotation documented in runbook
