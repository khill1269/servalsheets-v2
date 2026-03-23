---
title: 'Runbook: Authentication Failures'
category: general
last_updated: 2026-02-04
description: 'Alert Name: HighAuthenticationFailureRate'
version: 1.6.0
tags: [sheets, prometheus, kubernetes]
---

# Runbook: Authentication Failures

**Alert Name:** `HighAuthenticationFailureRate`
**Severity:** Critical
**Component:** Authentication
**Threshold:** > 10% authentication failure rate over 5 minutes

## Impact

- Users unable to authenticate with Google Sheets API
- All operations requiring API access will fail
- Complete service degradation if auth is completely broken
- Potential security issue if credentials compromised

## Symptoms

- High rate of 401 (Unauthorized) errors
- Error messages containing "invalid_grant", "token_expired", or "invalid_client"
- Health check showing auth status as "unhealthy"
- Logs showing authentication-related errors

## Diagnosis

### 1. Check Current Auth Status

```bash
# Check health endpoint
curl http://localhost:3000/health/ready | jq '.checks[] | select(.name == "auth")'

# Expected output when healthy:
# {
#   "name": "auth",
#   "status": "ok",
#   "message": "Authenticated",
#   "metadata": {
#     "hasAuth": true,
#     "tokenExpiry": "2026-02-02T12:00:00Z"
#   }
# }
```

### 2. Check Error Logs

```bash
# Check for auth errors
kubectl logs -n servalsheets deployment/servalsheets | grep -i "auth\|401\|unauthorized"

# Common error patterns:
# - "Token has expired"
# - "Invalid authentication credentials"
# - "The access token could not be verified"
# - "Insufficient Permission"
```

### 3. Verify Credentials Configuration

```bash
# Check if credentials secret exists
kubectl get secret google-creds -n servalsheets

# Check if secret is mounted
kubectl get deployment/servalsheets -n servalsheets \
  -o jsonpath='{.spec.template.spec.volumes}' | jq

# Check environment variables
kubectl get deployment/servalsheets -n servalsheets \
  -o jsonpath='{.spec.template.spec.containers[0].env}' | jq
```

## Common Causes and Resolution

### Cause 1: OAuth Token Expired

**Symptoms:**

- Error: "Token has expired"
- Error: "invalid_grant"
- Auth worked before, stopped recently

**Resolution:**

```bash
# Method 1: Refresh token via CLI
cd /path/to/servalsheets
npm run auth:refresh

# Method 2: Run interactive auth setup
npm run auth:setup

# Method 3: Update OAuth credentials
# 1. Go to Google Cloud Console
# 2. Go to APIs & Services > Credentials
# 3. Download new credentials.json
# 4. Update Kubernetes secret:

kubectl create secret generic google-creds \
  --from-file=credentials.json=./credentials.json \
  --dry-run=client -o yaml | kubectl apply -f - -n servalsheets

# Restart pods to pick up new credentials
kubectl rollout restart deployment/servalsheets -n servalsheets
```

### Cause 2: Invalid OAuth Configuration

**Symptoms:**

- Error: "invalid_client"
- Error: "redirect_uri_mismatch"
- Auth never worked or broken after configuration change

**Resolution:**

```bash
# Verify OAuth configuration in Google Cloud Console:
# 1. Check Client ID and Client Secret are correct
# 2. Verify redirect URIs include:
#    - http://localhost:3000/oauth/callback
#    - https://your-domain.com/oauth/callback
# 3. Ensure Google Sheets API is enabled

# Update environment variables:
kubectl set env deployment/servalsheets \
  GOOGLE_CLIENT_ID='your-client-id' \
  GOOGLE_CLIENT_SECRET='your-client-secret' \
  -n servalsheets

# Restart service
kubectl rollout restart deployment/servalsheets -n servalsheets
```

### Cause 3: Service Account Permissions

**Symptoms:**

- Error: "Insufficient Permission"
- Error: "The caller does not have permission"
- Specific operations fail (read works, write fails)

**Resolution:**

```bash
# Check service account permissions in Google Cloud Console:
# 1. Go to IAM & Admin > Service Accounts
# 2. Find your service account
# 3. Verify it has these roles:
#    - Service Account Token Creator
#    - Service Account User
#    (for delegated domain-wide access)

# For direct Sheets access, the user who authorized the OAuth
# must have appropriate permissions on the spreadsheet

# Grant access to spreadsheet:
# Share the spreadsheet with the service account email
# or the OAuth user email with appropriate permissions
```

### Cause 4: Credentials File Missing or Corrupted

**Symptoms:**

- Error: "GOOGLE_APPLICATION_CREDENTIALS not found"
- Error: "Error reading credentials"
- Service fails to start

**Resolution:**

```bash
# Verify credentials file exists in pod
kubectl exec -it deployment/servalsheets -n servalsheets -- \
  ls -la /etc/google/credentials.json

# If missing, check secret:
kubectl get secret google-creds -n servalsheets -o yaml

# Recreate secret from valid credentials file:
kubectl delete secret google-creds -n servalsheets
kubectl create secret generic google-creds \
  --from-file=credentials.json=./path/to/credentials.json \
  -n servalsheets

# Restart deployment
kubectl rollout restart deployment/servalsheets -n servalsheets
```

### Cause 5: Google API Quota Exceeded

**Symptoms:**

- Error: "Quota exceeded"
- Error: "Rate Limit Exceeded"
- Works intermittently

**Resolution:**

```bash
# Check quota usage in Google Cloud Console:
# APIs & Services > Dashboard > Google Sheets API

# Temporary mitigation:
# 1. Enable caching
kubectl set env deployment/servalsheets CACHE_ENABLED=true -n servalsheets

# 2. Reduce batch sizes
kubectl set env deployment/servalsheets MAX_BATCH_SIZE=50 -n servalsheets

# 3. Add request delays
kubectl set env deployment/servalsheets MIN_REQUEST_DELAY_MS=1000 -n servalsheets

# Long-term solution:
# Request quota increase from Google Cloud Console
```

### Cause 6: Token Validation Cache Issue

**Symptoms:**

- Auth failures after recent credential change
- Inconsistent failures (some requests work, some don't)

**Resolution:**

```bash
# Clear token validation cache
kubectl exec -it deployment/servalsheets -n servalsheets -- \
  curl -X POST http://localhost:3000/cache/clear?namespace=auth

# Or restart service to clear all caches
kubectl rollout restart deployment/servalsheets -n servalsheets
```

## Testing Authentication

### Manual OAuth Flow Test

```bash
# Start local server
npm run dev

# Open browser to
http://localhost:3000/oauth/start

# Complete OAuth flow
# Check logs for "Authentication successful"
```

### API Call Test

```bash
# Get current access token
TOKEN=$(kubectl exec -it deployment/servalsheets -n servalsheets -- \
  cat /var/run/secrets/google/token)

# Test API call
curl -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/test-id" \
  -w "\nHTTP Status: %{http_code}\n"

# Expected: HTTP Status: 200
# If 401: Token is invalid
# If 403: Permission issue
```

### Service Account Test

```bash
# Test service account authentication
node -e "
const { GoogleAuth } = require('google-auth-library');
const auth = new GoogleAuth({
  keyFile: './credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
auth.getClient().then(client => {
  client.getAccessToken().then(token => {
    console.log('Token obtained:', token.token ? 'SUCCESS' : 'FAILED');
  });
});
"
```

## Prevention

1. **Set up token refresh automation:**

   ```yaml
   # Add CronJob to refresh tokens
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: refresh-auth-token
   spec:
     schedule: '0 */6 * * *' # Every 6 hours
     jobTemplate:
       spec:
         template:
           spec:
             containers:
               - name: refresh
                 image: servalsheets:latest
                 command: ['npm', 'run', 'auth:refresh']
   ```

2. **Add token expiry monitoring:**

   ```typescript
   // Alert when token expires soon (< 1 hour)
   const tokenExpiry = getTokenExpiry();
   const hoursUntilExpiry = (tokenExpiry - Date.now()) / (1000 * 60 * 60);
   if (hoursUntilExpiry < 1) {
     metrics.recordWarning('token_expiring_soon', { hours: hoursUntilExpiry });
   }
   ```

3. **Implement credential rotation:**
   - Rotate OAuth credentials quarterly
   - Use multiple service accounts for redundancy
   - Keep backup credentials in vault

4. **Add auth health checks:**

   ```typescript
   // Periodic auth validation
   setInterval(
     async () => {
       try {
         await validateAuthToken();
         metrics.recordAuthHealth('ok');
       } catch (error) {
         metrics.recordAuthHealth('failed');
         logger.error('Auth validation failed', { error });
       }
     },
     5 * 60 * 1000
   ); // Every 5 minutes
   ```

## Emergency Credentials Rotation

If credentials are compromised:

```bash
# 1. Immediately revoke old credentials in Google Cloud Console
# Go to APIs & Services > Credentials
# Delete or disable compromised credentials

# 2. Create new OAuth credentials
# Click "Create Credentials" > "OAuth 2.0 Client ID"
# Configure authorized redirect URIs

# 3. Update service with new credentials
kubectl create secret generic google-creds-new \
  --from-file=credentials.json=./new-credentials.json \
  -n servalsheets

# 4. Update deployment to use new secret
kubectl patch deployment/servalsheets -n servalsheets \
  --type json -p '[{
    "op": "replace",
    "path": "/spec/template/spec/volumes/0/secret/secretName",
    "value": "google-creds-new"
  }]'

# 5. Rollout new pods
kubectl rollout restart deployment/servalsheets -n servalsheets

# 6. Verify auth works
curl http://localhost:3000/health/ready | jq '.checks[] | select(.name == "auth")'

# 7. Delete old secret
kubectl delete secret google-creds -n servalsheets
```

## Post-Incident

1. **Audit auth failures:**

   ```bash
   # Export auth failure metrics
   curl "http://prometheus:9090/api/v1/query_range?query=servalsheets_google_api_calls_total{status='error',method=~'.*auth.*'}&start=$START&end=$END&step=60s"
   ```

2. **Review security:**
   - Check if credentials were exposed
   - Review access logs for suspicious activity
   - Rotate credentials if compromise suspected

3. **Update documentation:**
   - Document root cause
   - Update runbook with new findings
   - Share learnings with team

4. **Improve monitoring:**
   - Add alerts for leading indicators
   - Implement proactive token refresh
   - Add auth success rate SLI

## Related Runbooks

- [High Error Rate](./high-error-rate.md)
- [Service Down](./service-down.md)
- [Google API Errors](./google-api-errors.md)
- [Quota Near Limit](./quota-near-limit.md)

## Metrics to Monitor

- `servalsheets_google_api_calls_total{status="error",method=~".*auth.*"}`
- `servalsheets_errors_by_type_total{error_type=~"AuthError|PermissionDenied"}`
- `servalsheets_tool_calls_total{status="401"}`

## Escalation

- **On-call engineer** (first 15 minutes)
- **Team lead** (if not resolved in 30 minutes)
- **Security team** (if credential compromise suspected)
- **Engineering manager** (if business impact exceeds 1 hour)

## Reference Documentation

- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Google Sheets API Auth](https://developers.google.com/sheets/api/guides/authorizing)
- [Service Account Auth](https://cloud.google.com/iam/docs/service-accounts)
- [OAuth Setup Guide](../guides/OAUTH_USER_SETUP.md)
