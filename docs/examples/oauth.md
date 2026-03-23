---
title: OAuth Authentication Flow
category: example
last_updated: 2026-01-31
description: Complete guide to setting up and using OAuth authentication with ServalSheets.
version: 1.6.0
tags: [oauth, authentication, sheets, docker]
---

# OAuth Authentication Flow

Complete guide to setting up and using OAuth authentication with ServalSheets.

## Overview

This guide covers:

- OAuth 2.0 setup and configuration
- Authentication flow walkthrough
- Token management
- Scope selection
- Security best practices
- Troubleshooting authentication issues

## Prerequisites

- Google Cloud Platform account
- Project with Sheets API enabled
- ServalSheets v1.6.0 or later
- Basic understanding of OAuth 2.0

## OAuth Fundamentals

### What is OAuth?

OAuth 2.0 is an authorization framework that enables applications to obtain limited access to user accounts on Google Sheets without exposing passwords.

### Key Concepts

- **Client ID**: Identifies your application
- **Client Secret**: Secret key for your application
- **Scopes**: Permissions your app requests
- **Access Token**: Short-lived token for API calls
- **Refresh Token**: Long-lived token to get new access tokens
- **Redirect URI**: Where user returns after authorization

## Setting Up OAuth

### Step 1: Create Google Cloud Project

```
1. Go to console.cloud.google.com
2. Create new project or select existing
3. Name: "ServalSheets Integration"
4. Note project ID for reference
```

### Step 2: Enable Sheets API

```
1. Navigate to APIs & Services > Library
2. Search for "Google Sheets API"
3. Click Enable
4. Wait for activation (usually instant)
```

### Step 3: Create OAuth Credentials

```
1. Go to APIs & Services > Credentials
2. Click "Create Credentials" > "OAuth Client ID"
3. Application type: "Desktop app" or "Web application"
4. Name: "ServalSheets Client"
5. Add authorized redirect URI:
   - Desktop: http://localhost:3000/oauth/callback
   - Web: https://your-domain.com/oauth/callback
6. Click Create
7. Download credentials JSON file
```

### Step 4: Configure ServalSheets

**Option 1: Environment Variables**

```bash
export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_REDIRECT_URI="http://localhost:3000/oauth/callback"
```

**Option 2: Configuration File**

Create `.env` file:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
```

**Option 3: Credentials File**

Place downloaded `credentials.json` in ServalSheets config directory:

```bash
mkdir -p ~/.config/servalsheets
mv ~/Downloads/credentials.json ~/.config/servalsheets/
```

## OAuth Flow Walkthrough

### Desktop Application Flow

**Step 1: Initiate Authorization**

```
Start OAuth flow for ServalSheets
```

**What happens**:

1. ServalSheets generates authorization URL
2. Opens browser to Google consent screen
3. User sees requested permissions
4. User clicks "Allow"

**Step 2: Handle Callback**

```
Authorization code received: 4/0Adeu5BX...
Exchange code for tokens
```

**What happens**:

1. Google redirects to your redirect URI
2. Authorization code in URL parameters
3. ServalSheets exchanges code for tokens
4. Receives access token and refresh token

**Step 3: Store Tokens**

```json
{
  "access_token": "ya29.a0AfH6SMBx...",
  "refresh_token": "1//0gL4dQJ...",
  "scope": "https://www.googleapis.com/auth/spreadsheets",
  "token_type": "Bearer",
  "expiry_date": 1706620800000
}
```

**Storage locations**:

- Desktop: `~/.config/servalsheets/tokens.json`
- Docker: `/app/config/tokens.json`
- Custom: Set via `TOKEN_STORAGE_PATH`

**Step 4: Use Access Token**

```
Read spreadsheet "1abc...xyz" using stored authentication
```

**Behind the scenes**:

```http
GET /v4/spreadsheets/1abc...xyz
Authorization: Bearer ya29.a0AfH6SMBx...
```

### Web Application Flow

**Differences from desktop**:

1. Redirect URI must be HTTPS (except localhost)
2. State parameter for CSRF protection
3. Token storage in secure session/database
4. User-specific token management

**Flow diagram**:

```
User → Your App → Google Auth → User Consents
  ↓                                     ↓
Token Storage ← Your App ← Google Callback
  ↓
API Calls with Token
```

## Scope Selection

### Available Scopes

**Read-only**: `https://www.googleapis.com/auth/spreadsheets.readonly`

- Read spreadsheet data
- Read spreadsheet metadata
- List spreadsheets
- **Cannot**: Write, update, or delete

**Full access**: `https://www.googleapis.com/auth/spreadsheets`

- All read-only permissions
- Write/update data
- Create/delete spreadsheets
- Manage permissions

**Drive access**: `https://www.googleapis.com/auth/drive.file`

- Access to spreadsheets created by app
- Create new spreadsheets
- Share spreadsheets
- **Cannot**: Access user's other files

### Scope Best Practices

1. **Request minimum necessary** - Don't request full access if read-only suffices
2. **Explain why** - Show users why you need each permission
3. **Upgrade when needed** - Start with read-only, upgrade if user needs write
4. **Document requirements** - Tell users what features need which scopes

### Setting Scopes in ServalSheets

```bash
export GOOGLE_SCOPES="https://www.googleapis.com/auth/spreadsheets"
```

**Multiple scopes** (space-separated):

```bash
export GOOGLE_SCOPES="https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file"
```

## Token Management

### Access Token Lifecycle

**Lifetime**: 1 hour (3600 seconds)
**Usage**: Every API call
**Renewal**: Automatic using refresh token

### Refresh Token Lifecycle

**Lifetime**: Until revoked (or 6 months inactive for web apps)
**Usage**: To get new access tokens
**Storage**: Securely store, never expose

### Automatic Token Refresh

ServalSheets automatically refreshes expired tokens:

```
1. API call with expired access token
2. Receives 401 Unauthorized
3. Uses refresh token to get new access token
4. Retries original API call
5. Succeeds with new token
```

**Manual refresh**:

```
Refresh OAuth tokens for ServalSheets
```

### Token Revocation

**User-initiated** (in Google Account settings):

```
1. Go to myaccount.google.com/permissions
2. Find your application
3. Click "Remove Access"
```

**Programmatic revocation**:

```
Revoke OAuth tokens for ServalSheets
```

**Effect**: All tokens invalidated, user must re-authorize

## Security Best Practices

### Credential Protection

1. **Never commit credentials** to version control

   ```gitignore
   .env
   credentials.json
   tokens.json
   ```

2. **Use environment variables** for sensitive data
3. **Restrict redirect URIs** to your domains only
4. **Rotate secrets** periodically
5. **Monitor usage** in Google Cloud Console

### Token Storage

1. **Encrypt tokens at rest**
2. **Use secure storage** (not plain text files in production)
3. **Implement access controls** on token storage
4. **Clear tokens on logout**
5. **Set appropriate file permissions** (chmod 600)

### Transport Security

1. **Always use HTTPS** (except localhost development)
2. **Validate SSL certificates**
3. **Implement CSRF protection** (state parameter)
4. **Use secure cookies** for web applications
5. **Implement rate limiting**

### User Privacy

1. **Clearly explain data access** in consent screen
2. **Only access what's needed** when needed
3. **Don't store more than necessary**
4. **Implement data retention policy**
5. **Provide easy revocation**

## Troubleshooting

### Common Issues

**"Redirect URI mismatch"**

```
Error: redirect_uri_mismatch
```

**Cause**: Redirect URI doesn't match configured URI
**Solution**: Check exact match including protocol, host, port, path

**"Access denied"**

```
Error: access_denied
```

**Cause**: User clicked "Deny" or lacks permissions
**Solution**: User must grant consent; check scope requirements

**"Invalid grant"**

```
Error: invalid_grant
```

**Cause**: Refresh token expired or revoked
**Solution**: User must re-authenticate

**"Insufficient permissions"**

```
Error: insufficientPermissions
```

**Cause**: Scope doesn't cover requested operation
**Solution**: Request broader scope and re-authenticate

### Token Refresh Failures

**Symptoms**: Repeated authentication prompts

**Checks**:

1. Refresh token stored correctly?
2. Token file readable?
3. Token hasn't been revoked?
4. Client credentials match?

**Fix**: Delete tokens and re-authenticate

```bash
rm ~/.config/servalsheets/tokens.json
# Run ServalSheets - will prompt for new authentication
```

### Verification Steps

**Check credentials**:

```bash
echo $GOOGLE_CLIENT_ID
echo $GOOGLE_REDIRECT_URI
# Don't echo CLIENT_SECRET (security)
```

**Verify token**:

```bash
cat ~/.config/servalsheets/tokens.json | jq .
# Should show access_token, refresh_token, expiry_date
```

**Test authentication**:

```
List my spreadsheets using ServalSheets
```

## Advanced Configuration

### Multiple Users

**Scenario**: Support multiple Google accounts

```
1. Store tokens per user ID
   - ~/.config/servalsheets/tokens-user1.json
   - ~/.config/servalsheets/tokens-user2.json

2. Specify user when calling ServalSheets:
   export SERVAL_USER_ID=user1

3. Load appropriate token file
```

### Service Accounts

**When to use**: Server-to-server, no user interaction

**Setup**:

```
1. Create service account in GCP
2. Download JSON key file
3. Share spreadsheets with service account email
4. Use service account for authentication
```

**Limitations**: Cannot access user's personal spreadsheets

### Domain-Wide Delegation

**For G Suite/Workspace admins**: Grant service account access to all users' spreadsheets

**Setup**:

```
1. Create service account with domain-wide delegation
2. Admin grants delegation in Workspace console
3. Service account can impersonate any user
4. Subject claim specifies which user
```

### OAuth Proxy

**Scenario**: Centralized authentication server

```
1. OAuth server handles all authentication
2. Issues internal tokens to clients
3. Clients never see Google credentials
4. Server manages token refresh
```

## OAuth Flow Examples

### First-Time Setup

```
1. User: "Setup ServalSheets OAuth"
2. ServalSheets: Generates auth URL
3. Opens browser to Google consent
4. User: Clicks "Allow"
5. Google: Redirects with code
6. ServalSheets: Exchanges code for tokens
7. Stores tokens securely
8. "OAuth setup complete! You can now use ServalSheets"
```

### Subsequent Usage

```
1. User: "Read spreadsheet 1abc...xyz"
2. ServalSheets: Loads stored tokens
3. Checks access token expiry
4. If expired, refreshes with refresh token
5. Makes API call with valid access token
6. Returns data to user
```

### Re-authentication

```
1. User: "Read spreadsheet 1abc...xyz"
2. ServalSheets: Tries to load tokens
3. Error: Tokens revoked or expired
4. "Your authorization has expired. Please re-authenticate"
5. Initiates new OAuth flow
6. User re-authorizes
7. Stores new tokens
8. Retries original request
```

## Reference Files

For detailed OAuth examples, see:

- `oauth-flow-examples.json` - Complete OAuth workflows
- `error-handling-examples.json` - Authentication error handling
- `advanced-examples.json` - Advanced OAuth patterns

## Next Steps

- **Usage**: Learn [basic operations](./basic.md)
- **Security**: Review [security best practices](../../SECURITY.md)
- **Deployment**: See [deployment guide](../guides/DEPLOYMENT.md)

## Related Resources

- [Usage Guide](../guides/USAGE_GUIDE.md) - General usage patterns
- [OAuth User Setup](../guides/OAUTH_USER_SETUP.md) - End-user setup guide
- [Troubleshooting](../guides/TROUBLESHOOTING.md) - Common issues
- [Google OAuth Documentation](https://developers.google.com/identity/protocols/oauth2)
