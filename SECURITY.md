# Security Best Practices

This guide covers security best practices for deploying and operating ServalSheets in production.

## Table of Contents

- [Embedded OAuth Credentials](#embedded-oauth-credentials)
- [Token Storage](#token-storage)
- [Authentication Methods](#authentication-methods)
- [Service Account Security](#service-account-security)
- [OAuth Security](#oauth-security)
- [Production Deployment](#production-deployment)
- [Incident Response](#incident-response)

---

## Embedded OAuth Credentials

ServalSheets ships with embedded Google OAuth client credentials in `src/config/embedded-oauth.ts` to enable zero-configuration authentication for CLI and Claude Desktop users.

### Why This Is Safe

- **Desktop/CLI OAuth apps** use the "installed application" flow (RFC 8252) with PKCE. Google's [OAuth documentation](https://developers.google.com/identity/protocols/oauth2/native-app) explicitly states that client secrets for installed apps are not treated as confidential, because the binary is distributed to end users.
- The embedded credentials **cannot access any user data** without the user explicitly completing the OAuth consent flow in their browser.
- All data access is scoped to the permissions the user grants during consent.

### When to Use Your Own Credentials

For production or enterprise deployments, you should register your own OAuth application in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and configure:

```bash
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
```

This provides: isolated rate limits, custom consent screen branding, and independent credential rotation.

### Rotation Policy

The embedded credentials are rotated with each major version release. If you believe the credentials have been compromised for abuse (not data access — that requires user consent), please report it via the [security contact](#incident-response).

---

## Token Storage

### Encrypted Token Store

ServalSheets supports encrypted token storage using AES-256-GCM encryption.

#### Generate Encryption Key

```bash
# Generate a secure 32-byte key (64 hex characters)
openssl rand -hex 32

# Example output:
# 8f3b2c1a9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
```

#### Configure Token Store

```bash
export GOOGLE_TOKEN_STORE_PATH=~/.config/servalsheets/tokens.enc
export ENCRYPTION_KEY=8f3b2c1a9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
```

#### Key Rotation Procedure

**Recommended**: Rotate encryption keys annually or when compromised.

```bash
# 1. Generate new key
NEW_KEY=$(openssl rand -hex 32)

# 2. Replace the active token-store key
export ENCRYPTION_KEY=$NEW_KEY

# 3. Delete the old encrypted token store
rm ~/.config/servalsheets/tokens.enc

# 4. Re-authenticate so tokens are re-encrypted with the new key
```

#### File Permissions

Ensure token store has restricted permissions:

```bash
# Set owner-only read/write
chmod 600 ~/.config/servalsheets/tokens.enc

# Verify
ls -la ~/.config/servalsheets/tokens.enc
# Should show: -rw------- (600)
```

---

## Authentication Methods

### Service Account vs OAuth

| Factor                 | Service Account       | OAuth                  |
| ---------------------- | --------------------- | ---------------------- |
| **Use Case**           | Server automation     | User-specific access   |
| **Setup Complexity**   | Medium                | High                   |
| **Credential Storage** | JSON file             | Encrypted token store  |
| **Sharing Required**   | Yes                   | No (user's own sheets) |
| **Rotation**           | Annual                | Per-session            |
| **Audit Trail**        | Service account email | User email             |
| **Best For**           | Production servers    | Desktop apps           |

### When to Use Each

**Use Service Account when:**

- ✅ Automating spreadsheet operations
- ✅ Server-to-server communication
- ✅ No user interaction required
- ✅ Same operations for all users
- ✅ Long-running processes

**Use OAuth when:**

- ✅ User-specific access needed
- ✅ Desktop/mobile applications
- ✅ Per-user permissions required
- ✅ Interactive user consent needed
- ✅ Multi-tenant scenarios

---

## Service Account Security

### Creating Secure Service Accounts

1. **Use Descriptive Names**

   ```
   servalsheets-prod@project-id.iam.gserviceaccount.com
   servalsheets-staging@project-id.iam.gserviceaccount.com
   ```

2. **Separate Service Accounts per Environment**
   - Production: `servalsheets-prod`
   - Staging: `servalsheets-staging`
   - Development: `servalsheets-dev`

3. **Principle of Least Privilege**
   - Don't grant project-wide roles
   - Share only necessary spreadsheets
   - Use Viewer role when read-only access sufficient

### Key Management

#### Generate Keys Securely

```bash
# In Google Cloud Console:
# 1. IAM & Admin → Service Accounts
# 2. Select service account
# 3. Keys → Add Key → Create new key
# 4. Choose JSON format
# 5. Key downloads automatically

# Verify key format
cat service-account-key.json | jq .
```

#### Store Keys Securely

```bash
# Create secure directory
mkdir -p ~/.config/google
chmod 700 ~/.config/google

# Move key
mv ~/Downloads/servalsheets-*.json ~/.config/google/servalsheets-prod.json

# Set restrictive permissions
chmod 600 ~/.config/google/servalsheets-prod.json

# Verify
ls -la ~/.config/google/
```

#### Rotate Keys Annually

```bash
# 1. Generate new key in Google Cloud Console
# 2. Download new key
# 3. Update environment variable
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/google/servalsheets-prod-new.json

# 4. Test with new key
servalsheets --help

# 5. If successful, delete old key
# In Google Cloud Console: Keys → Delete old key

# 6. Rename new key
mv ~/.config/google/servalsheets-prod-new.json ~/.config/google/servalsheets-prod.json
```

### Access Control

#### Spreadsheet Sharing

**Best Practice**: Share spreadsheets explicitly, not via "Anyone with link"

```bash
# Share with service account
# In Google Sheets:
# 1. Click Share
# 2. Add: servalsheets-prod@project-id.iam.gserviceaccount.com
# 3. Role: Editor (or Viewer if read-only)
# 4. Uncheck "Notify people"
```

#### Audit Access

```bash
# List all spreadsheets service account can access
# Use sheets_core tool with action: "list"
# Or Google Drive API: files.list with query: 'me in owners'
```

---

## OAuth Security

### OAuth 2.1 with PKCE

ServalSheets implements OAuth 2.1 with PKCE (Proof Key for Code Exchange) for enhanced security.

#### Setup OAuth Client

1. **Google Cloud Console**
   - APIs & Services → Credentials
   - Create OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/oauth/callback`

2. **Configure ServalSheets**

   ```bash
   export GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
   export GOOGLE_CLIENT_SECRET=GOCSPX-xxx
   export GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
   ```

#### Token Security

**Access Tokens:**

- Short-lived (1 hour)
- Never log or expose
- Encrypt in token store

**Refresh Tokens:**

- Long-lived (until revoked)
- Encrypt in token store
- Rotate on suspicious activity

#### Revoke Compromised Tokens

```bash
# If tokens compromised:

# 1. Revoke in Google Account
# Visit: https://myaccount.google.com/permissions
# Find "ServalSheets" → Remove Access

# 2. Delete local token store
rm ~/.config/servalsheets/tokens.enc

# 3. Re-authenticate
# Restart ServalSheets
```

---

## Production Deployment

### Pre-Deployment Checklist

#### Infrastructure

- [ ] **Use HTTPS only** (TLS 1.3 preferred)
- [ ] **Enable rate limiting** (default: 100 req/min per IP)
- [ ] **Configure CORS** (restrict to your domains)
- [ ] **Set up monitoring** (health checks, alerts)
- [ ] **Enable audit logging** (JSON structured logs)
- [ ] **Use encrypted token store** (AES-256-GCM)
- [ ] **Restrict network access** (firewall rules)

#### Authentication

- [ ] **Rotate service account keys** (if > 1 year old)
- [ ] **Use separate keys per environment** (prod/staging/dev)
- [ ] **Set restrictive file permissions** (600 for keys)
- [ ] **Store keys outside code repository** (never commit!)
- [ ] **Use secrets management** (Vault, AWS Secrets Manager, etc.)

#### Configuration

- [ ] **Set NODE_ENV=production**
- [ ] **Configure logging level** (info or warn in prod)
- [ ] **Set resource limits** (memory, CPU)
- [ ] **Enable auto-restart** (PM2, systemd, K8s)
- [ ] **Configure timeout values** (30s API, 120s request)

#### Monitoring

- [ ] **Set up health checks** (/health endpoint)
- [ ] **Configure alerts** (errors, rate limits, quota)
- [ ] **Enable metrics collection** (Prometheus, CloudWatch)
- [ ] **Set up log aggregation** (ELK, Splunk, CloudWatch Logs)
- [ ] **Test failover procedures**

### Environment Variables

#### Required

```bash
# Authentication (choose one)
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# OR
export GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=GOCSPX-xxx
```

#### Recommended

```bash
# Production mode
export NODE_ENV=production

# Logging
export LOG_LEVEL=info              # info, warn, error
export LOG_FORMAT=json             # json or text

# Rate limiting (adjust based on quota)
export SERVALSHEETS_READS_PER_MINUTE=300
export SERVALSHEETS_WRITES_PER_MINUTE=60

# Token store (recommended)
export GOOGLE_TOKEN_STORE_PATH=/secure/path/tokens.enc
export ENCRYPTION_KEY=$(cat /secure/path/token-store-key.txt)

# Timeouts
export GOOGLE_API_TIMEOUT_MS=30000
export REQUEST_TIMEOUT_MS=120000

# HTTP server (if using)
export PORT=3000
export CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### Secrets Management

#### Using Vault

```bash
# Store service account key in Vault
vault kv put secret/servalsheets/prod \
  service_account_key=@service-account.json \
  token_store_key=$(openssl rand -hex 32)

# Retrieve in startup script
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa-key.json
vault kv get -field=service_account_key secret/servalsheets/prod > $GOOGLE_APPLICATION_CREDENTIALS
chmod 600 $GOOGLE_APPLICATION_CREDENTIALS

export ENCRYPTION_KEY=$(vault kv get -field=token_store_key secret/servalsheets/prod)
```

#### Using AWS Secrets Manager

```bash
# Store secrets
aws secretsmanager create-secret \
  --name servalsheets/prod/service-account \
  --secret-string file://service-account.json

# Retrieve in startup script
aws secretsmanager get-secret-value \
  --secret-id servalsheets/prod/service-account \
  --query SecretString \
  --output text > /tmp/sa-key.json

export GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa-key.json
chmod 600 $GOOGLE_APPLICATION_CREDENTIALS
```

### Network Security

#### Firewall Rules

```bash
# Allow only necessary traffic
# Inbound: HTTPS (443) only
# Outbound: Google API (443) only

# Example: iptables
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 443 -d sheets.googleapis.com -j ACCEPT
iptables -A OUTPUT -p tcp --dport 443 -d www.googleapis.com -j ACCEPT
```

#### HTTPS/TLS Configuration

```javascript
// src/http-server.ts (production example)
const httpsOptions = {
  key: fs.readFileSync('/path/to/privkey.pem'),
  cert: fs.readFileSync('/path/to/fullchain.pem'),
  minVersion: 'TLSv1.3',
  ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
};

https.createServer(httpsOptions, app).listen(443);
```

---

## Incident Response

### Security Incident Response Plan

#### 1. Identify Incident

**Indicators of Compromise:**

- Unexpected API calls
- Rate limit exhaustion
- Unauthorized spreadsheet access
- Token store tampering
- Unusual error patterns

#### 2. Contain

**Immediate Actions:**

```bash
# Stop service
systemctl stop servalsheets

# Revoke service account keys
# Google Cloud Console → IAM → Service Accounts → Keys → Delete

# Revoke OAuth tokens
# https://myaccount.google.com/permissions

# Rotate encryption keys
NEW_KEY=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$NEW_KEY

# Delete token store
rm ~/.config/servalsheets/tokens.enc
```

#### 3. Investigate

**Collect Evidence:**

```bash
# Export logs
journalctl -u servalsheets > incident-logs-$(date +%Y%m%d-%H%M%S).txt

# Check API usage
# Google Cloud Console → APIs & Services → Dashboard
# Review quota usage and API calls

# Review audit logs
# Google Cloud Console → Logging → Logs Explorer
# Filter: resource.type="service_account"

# Check file access
ls -la ~/.config/servalsheets/
stat ~/.config/servalsheets/tokens.enc
```

#### 4. Remediate

**Steps:**

1. Generate new service account
2. Generate new encryption keys
3. Update all secrets in secrets manager
4. Re-deploy with new credentials
5. Audit all spreadsheet permissions
6. Remove old service account access

#### 5. Document

**Incident Report Template:**

```markdown
# Security Incident Report

Date: YYYY-MM-DD
Severity: [Critical/High/Medium/Low]

## Summary

[Brief description]

## Timeline

- HH:MM - Incident detected
- HH:MM - Service stopped
- HH:MM - Keys revoked
- HH:MM - Service restored

## Impact

- Affected systems: [list]
- Data accessed: [yes/no/unknown]
- Downtime: [duration]

## Root Cause

[Detailed analysis]

## Remediation

- [Action taken]
- [Action taken]

## Prevention

- [Measure implemented]
- [Measure implemented]
```

### Contact Information

**Google Workspace Security:**

- Report abuse: https://support.google.com/code/contact/abuse

**Vulnerability Disclosure:**

- Report security issues: security@anthropic.com

---

## Security Updates

### Stay Informed

- **MCP Security Advisories**: https://modelcontextprotocol.io/security
- **Google API Security**: https://developers.google.com/sheets/api/guides/security
- **Node.js Security**: https://nodejs.org/en/security/

### Update Schedule

- **Critical**: Within 24 hours
- **High**: Within 1 week
- **Medium**: Next maintenance window
- **Low**: Next minor version

### Verify Updates

```bash
# Check for npm security issues
npm audit

# Fix automatically
npm audit fix

# Check dependencies
npm outdated

# Update ServalSheets
npm update servalsheets
```

---

## Compliance

### Data Protection

ServalSheets processes Google Sheets data on behalf of users:

- **GDPR**: Users control data, service account is data processor
- **CCPA**: No sale of data, users have access/deletion rights
- **HIPAA**: Not HIPAA compliant (Google Sheets isn't HIPAA compliant)
- **SOC 2**: Google Sheets is SOC 2 certified

### Data Retention

ServalSheets implements automatic data retention policies to comply with GDPR Article 5 (storage limitation) and security best practices.

#### Session Data

- **Default Retention:** 1 hour (configurable via TTL at creation time)
- **Maximum Age:** Sessions older than their TTL are automatically purged
- **Automatic Cleanup:** Every 60 seconds (in-memory store)
- **Storage:** In-memory (lost on restart) or Redis (persistent)
- **GDPR Compliance:** Automatic expiration ensures minimal data retention

**Configuration:**

```bash
# Session store cleanup interval (milliseconds)
# Default: 60000 (1 minute)
export SESSION_CLEANUP_INTERVAL_MS=60000

# Default session TTL (milliseconds)
# Default: 3600000 (1 hour)
export SESSION_DEFAULT_TTL_MS=3600000
```

#### OAuth Tokens

- **Access Tokens:** Expire per Google's token lifetime (typically 1 hour)
- **Refresh Tokens:** Stored encrypted until explicitly revoked
- **Token Encryption:** AES-256-GCM with unique IV per token
- **Cleanup:** Tokens are marked expired but retained for audit purposes
- **Manual Revocation:** `sheets_auth` action with `revoke: true`

**Best Practices:**

- Rotate tokens when user access changes
- Revoke tokens immediately upon user offboarding
- Regularly audit token usage via logging

#### Logs

- **Retention Period:** 90 days (recommended)
- **Log Rotation:** Daily or by size (100MB recommended)
- **Audit Logs:** Retain longer for compliance (1-7 years depending on regulations)
- **Automatic Cleanup:** Use logrotate or cloud logging retention policies

**Configuration:**

```bash
# Log retention (days) - handled by log management system
export LOG_RETENTION_DAYS=90

# For structured logging to file
export LOG_FILE_PATH=/var/log/servalsheets/app.log
export LOG_MAX_SIZE=100m
export LOG_MAX_AGE=90d
```

#### Sensitive Data in Memory

- **OAuth State Parameters:** 5-minute TTL (HMAC-validated)
- **PKCE Verifiers:** 10-minute TTL (OAuth flow completion)
- **API Response Cache:** 5-minute TTL (default, configurable)
- **Connection Pool:** Cleared on server restart

#### Service Account Keys

- **Retention:** Until rotated (recommend 90-day rotation)
- **Storage:** Filesystem with restricted permissions (600)
- **Backup:** Store in secure vault (HashiCorp Vault, Google Secret Manager)
- **Rotation:** Automated via `scripts/rotate-service-account.sh`

#### GDPR Right to Erasure

To delete all data for a specific user:

1. **Revoke OAuth tokens:**

   ```javascript
   await sheets_auth({ action: 'revoke' });
   ```

2. **Clear session data:**

   ```javascript
   // Sessions expire automatically within 1 hour
   // For immediate removal, restart the server
   ```

3. **Remove from Google Sheets:**

   ```javascript
   // Use sheets_collaborate to remove user permissions
   await sheets_collaborate({
     action: 'remove_permission',
     spreadsheetId: 'your-sheet-id',
     email: 'user@example.com',
   });
   ```

4. **Audit log retention:**
   - Audit logs may be retained longer for compliance
   - Pseudonymize user identifiers in long-term logs

#### Compliance Summary

| Data Type            | Retention     | Auto-Cleanup  | GDPR Compliant          |
| -------------------- | ------------- | ------------- | ----------------------- |
| Sessions             | 1 hour        | ✅ Yes (1min) | ✅ Yes                  |
| OAuth Access Tokens  | 1 hour        | ✅ Yes        | ✅ Yes                  |
| OAuth Refresh Tokens | Until revoked | ⚠️ Manual     | ⚠️ Requires user action |
| Logs (operational)   | 90 days       | ⚠️ External   | ✅ Yes (with logrotate) |
| Logs (audit)         | 1-7 years     | ⚠️ External   | ✅ Yes (compliance req) |
| Service Account Keys | Until rotated | ❌ Manual     | ✅ Yes (with rotation)  |

### Audit Logging

Enable structured JSON logging for compliance:

```bash
export LOG_FORMAT=json
export LOG_LEVEL=info
export AUDIT_LOG_PATH=/var/log/servalsheets/audit.log
```

---

## Security Architecture

### Defense-in-Depth Layers

ServalSheets employs multiple security layers to protect against common attack vectors:

**SAML/SSO Security:**
- SSO tokens delivered via httpOnly cookies (never in URL query parameters)
- RelayState validated against configurable origin allowlist (`SAML_ALLOWED_REDIRECT_ORIGINS`)
- Assertion signature verification enforced by default (`wantAssertionsSigned=true`)
- Warning logged when signature verification is disabled

**SQL Injection Prevention (BigQuery):**
- 12-pattern blocklist validates all user-supplied SQL (DROP, DELETE, INSERT, UPDATE, MERGE, etc.)
- Comment and string literal stripping before pattern matching to prevent evasion
- Allowlist-based identifier validation for project/dataset/table names
- Only SELECT queries permitted through Connected Sheets interface

**Code Execution Sandbox (Python/Pyodide):**
- Allowlist-based import restriction (math, statistics, json, pandas, numpy, scipy only)
- Pre-execution AST validation blocks sandbox escape patterns (importlib, ctypes, eval, __subclasses__)
- Each execution runs in isolated Worker thread with fresh Pyodide runtime
- Hard wall-clock timeout via `worker.terminate()` (default 60s)
- `exec()` and `open()` removed from builtins

**Prompt Injection Defense:**
- User-controlled data (sheet names, cell values, queries) sanitized before embedding in LLM prompts
- XML data boundaries (`<user_data>`) with explicit instructions to treat as data, not instructions
- Length truncation prevents context exhaustion attacks

**WAL Durability:**
- `fsync()` after every WAL append and compact operation
- Stale `.tmp` files cleaned on startup (from interrupted compact operations)

**OAuth/Admin Security:**
- Google tokens stored server-side in session store, never in JWT payloads
- Admin consent endpoints (`/oauth/consent/*`) require Bearer token authentication
- PKCE enforced for all OAuth flows

**CI/CD Supply Chain:**
- All GitHub Actions pinned to immutable commit SHAs (176 references across 27 workflow files)
- Dependabot configured for automated security updates

---

## Known Security Advisories

### CVE-2025-XXXX: Hono JWT Middleware Vulnerability (Non-Impact)

**Status:** Does not affect ServalSheets
**Severity:** High (in affected systems) / None (in ServalSheets)
**Advisory IDs:** GHSA-3vhc-576x-3qv4, GHSA-f67f-6cw9-8mq4
**Affected Package:** `hono@<=4.11.3`
**Fix Version:** `hono@>=4.11.4` (not yet released as of 2026-01-16)

#### Description

The hono package (used by @modelcontextprotocol/sdk) has a JWT middleware vulnerability that could allow algorithm confusion attacks when JWK keys lack an "alg" parameter.

#### Why ServalSheets Is Not Affected

1. **ServalSheets does not use hono directly**
   - No imports or usage of hono in ServalSheets code
   - Zero references to hono in `src/` directory

2. **ServalSheets does not use hono's JWT middleware**
   - JWT authentication uses `jsonwebtoken` package directly
   - OAuth implementation in [src/oauth-provider.ts](src/oauth-provider.ts) is independent
   - No code path reaches hono's vulnerable JWT middleware

3. **Hono is only a transitive dependency**
   - Dependency chain: @modelcontextprotocol/sdk → @hono/node-server → hono
   - MCP SDK may use hono for its internal transport layer
   - This usage doesn't expose JWT middleware to ServalSheets operations

4. **ServalSheets uses Express for HTTP/SSE transport**
   - HTTP server: [src/http-server.ts](src/http-server.ts) uses Express
   - OAuth endpoints: Express middleware with custom JWT validation
   - No hono server instances in ServalSheets code

#### Verification

```bash
# Verify ServalSheets doesn't use hono directly
grep -r "hono" src/ --include="*.ts"  # Returns: no matches
grep -r "@hono" src/ --include="*.ts"  # Returns: no matches

# Check dependency tree
npm ls hono
# Shows: @modelcontextprotocol/sdk → @hono/node-server → hono
```

#### Status & Resolution

- **Current Risk:** **None** - ServalSheets is not vulnerable
- **Action Required:** None for ServalSheets users
- **Monitoring:** Will update @modelcontextprotocol/sdk when hono@4.11.4+ is released
- **Timeline:** No urgency; purely transitive dependency cleanup

#### When to Revisit

- Monitor for hono@4.11.4 release (expected Q1 2026)
- Update @modelcontextprotocol/sdk when new version available
- No security patches needed for ServalSheets itself

---

## Questions?

For security questions or to report vulnerabilities:

- Email: security@anthropic.com
- Issues: https://github.com/khill1269/servalsheets/security

**Do not disclose security vulnerabilities in public issues.**
