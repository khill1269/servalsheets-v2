---
title: HTTP Transport Authentication
category: general
last_updated: 2026-01-31
description: 'ServalSheets HTTP transport supports two authentication modes:'
version: 1.6.0
tags: [security, sheets]
---

# HTTP Transport Authentication

## Security Model

ServalSheets HTTP transport supports two authentication modes:

### Mode 1: Direct Token Passthrough (Default)

When OAuth is disabled (`enableOAuth: false`), the HTTP server accepts Bearer tokens in the Authorization header. These tokens are passed directly to Google APIs.

```
Authorization: Bearer <google-oauth-access-token>
```

**Security constraints:**

1. **Localhost binding (default)**: Server binds to `127.0.0.1` by default
2. **HTTPS enforcement**: Production mode requires HTTPS connections
3. **CORS restrictions**: Only Claude domains allowed by default

### Mode 2: Full OAuth 2.1 Provider

When OAuth is enabled (`enableOAuth: true`), the server acts as an OAuth 2.1 authorization server:

```typescript
createHttpServer({
  port: 3000,
  enableOAuth: true,
  oauthConfig: {
    issuer: 'https://your-domain.com',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    jwtSecret: 'your-jwt-secret',
    stateSecret: 'your-state-secret',
    allowedRedirectUris: ['https://claude.ai/oauth/callback'],
    googleClientId: 'google-client-id',
    googleClientSecret: 'google-client-secret',
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
  },
});
```

## Security Analysis: Token Passthrough

MCP specification states that tokens should be issued FOR the MCP server, not passed through. The current direct passthrough implementation is acceptable because:

1. **Scoped Access**: Tokens are used only for Google Sheets API access
2. **Stateless Authorization**: No session state is tied to token identity
3. **Independent Authorization**: Each request is independently authorized with Google
4. **No Token Storage**: Server does not persist or cache tokens

## Recommendations for Deployment

### Local Development (Default)

- Token passthrough mode is safe
- Server binds to localhost only
- No additional configuration needed

### Production Deployment

1. **Enable OAuth mode** for public deployments:

   ```bash
   ENABLE_OAUTH=true
   ```

2. **Bind to external interface** only with OAuth:

   ```bash
   HOST=0.0.0.0  # Only set with OAuth enabled
   ```

3. **Always use HTTPS**:

   ```bash
   NODE_ENV=production  # Enforces HTTPS
   ```

4. **Configure allowed CORS origins**:

   ```bash
   CORS_ORIGINS=https://claude.ai,https://your-domain.com
   ```

## Session Security

HTTP sessions include security binding to prevent session hijacking:

- Token hash verification
- User-agent binding
- IP address tracking (warning on change, not blocking)

## Streamable HTTP Sessions

Streamable HTTP sessions use the `Mcp-Session-Id` header for continuity:

- The server **generates** the session ID during `initialize`.
- Clients must **omit** `Mcp-Session-Id` on the initial `initialize` request.
- Use the returned `Mcp-Session-Id` header for subsequent requests (POST/GET/DELETE).

### Resumability Storage

Resumability is backed by the Streamable HTTP event store:

- **Default**: in-memory (per instance)
- **With `REDIS_URL`**: Redis-backed event store for cross-instance resumability

## Rate Limiting

Two levels of rate limiting protect the service:

1. **Global rate limiting**: Express middleware (100 req/min default)
2. **Per-user rate limiting**: Optional Redis-backed limiter

## Protocol Version Security

The server validates MCP protocol versions on MCP endpoints:

- Returns HTTP 400 for unsupported protocol versions
- Non-MCP endpoints (health, metrics) are not version-checked
