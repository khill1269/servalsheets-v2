---
title: Feature Flags & Environment Variables Reference
category: guide
last_updated: 2026-03-10
description: Comprehensive reference for all environment variables and feature flags that control ServalSheets behavior. All variables are defined in src/config/en
version: 1.6.0
tags: [sheets, prometheus, docker]
audience: user
difficulty: intermediate
---

# Feature Flags & Environment Variables Reference

Comprehensive reference for all environment variables and feature flags that control ServalSheets behavior. All variables are defined in `src/config/env.ts` and validated using Zod schema on startup.

**Last Updated:** February 2025
**Configuration File:** `src/config/env.ts`

---

## Environment & Runtime Configuration

| Flag        | Type   | Default       | Description                                                                                                                                                    |
| ----------- | ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`  | enum   | `development` | Runtime environment mode: `development`, `production`, or `test`. Must be set to `production` in production deployments.                                       |
| `PORT`      | number | `3000`        | Server port for HTTP/SSE server. Valid range: 1-65535.                                                                                                         |
| `HTTP_PORT` | number | `3000`        | Alternative HTTP port configuration used by lifecycle.ts.                                                                                                      |
| `HOST`      | string | `127.0.0.1`   | Server host binding. Use `127.0.0.1` for localhost only (secure, recommended for development) or `0.0.0.0` for all interfaces (production with firewall only). |
| `LOG_LEVEL` | enum   | `info`        | Logging verbosity: `error`, `warn`, `info`, or `debug`.                                                                                                        |

---

## Authentication & Authorization

| Flag                    | Type                     | Default                                | Description                                                                                                                                                                          |
| ----------------------- | ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JWT_SECRET`            | string                   | required                               | JWT signing secret for OAuth access tokens. Generate with: `openssl rand -hex 32`. **REQUIRED in production.**                                                                       |
| `STATE_SECRET`          | string                   | required                               | OAuth state HMAC secret for CSRF protection. Generate with: `openssl rand -hex 32`. **REQUIRED in production.**                                                                      |
| `OAUTH_CLIENT_SECRET`   | string                   | required                               | OAuth client secret for client authentication. **REQUIRED in production.**                                                                                                           |
| `OAUTH_ISSUER`          | string                   | `https://servalsheets.example.com`     | OAuth issuer URL (base URL of your server). Must match your deployment domain.                                                                                                       |
| `OAUTH_CLIENT_ID`       | string                   | `servalsheets`                         | OAuth client identifier.                                                                                                                                                             |
| `ALLOWED_REDIRECT_URIS` | string (comma-separated) | See defaults                           | Whitelist of allowed OAuth redirect URIs. Prevents open redirect vulnerabilities. Default includes localhost (dev), Claude AI domains (production), and callback paths.              |
| `CORS_ORIGINS`          | string (comma-separated) | `https://claude.ai,https://claude.com` | Allowed CORS origin domains. **⚠️ Never use `*` in production!** Configure for your deployment.                                                                                      |
| `ACCESS_TOKEN_TTL`      | number                   | `3600`                                 | OAuth access token lifetime in seconds. Default: 1 hour. Short-lived for security.                                                                                                   |
| `REFRESH_TOKEN_TTL`     | number                   | `2592000`                              | OAuth refresh token lifetime in seconds. Default: 30 days. Use shorter values (604800 = 7 days) for higher security in production.                                                   |
| `MANAGED_AUTH`          | boolean                  | `false`                                | Enable Google Cloud Managed Authentication mode. Set to `true` when deploying to Cloud Run, GKE, or Cloud Functions with Application Default Credentials. Disables sheets_auth tool. |

---

## Google API Integration

| Flag                   | Type   | Default  | Description                                                                                                                                                            |
| ---------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | string | optional | Google OAuth Client ID for Sheets access. Get from https://console.cloud.google.com. Format: `[project-id].apps.googleusercontent.com`.                                |
| `GOOGLE_CLIENT_SECRET` | string | optional | Google OAuth Client Secret. Keep this secret!                                                                                                                          |
| `GOOGLE_REDIRECT_URI`  | string | optional | Google OAuth redirect URI. Must match configured URI in Google Cloud Console.                                                                                          |
| `CREDENTIALS_PATH`     | string | optional | Path to stored OAuth credentials/tokens. Used for CLI token storage.                                                                                                   |
| `ENCRYPTION_KEY`       | string | required | Encryption key for token storage. Must be 64 hex characters (32 bytes). Generate with: `openssl rand -hex 32`. **REQUIRED in production for encrypted token storage.** |

---

## Connection Pooling & Network Configuration

| Flag                                    | Type    | Default  | Description                                                                                                                                        |
| --------------------------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_API_MAX_SOCKETS`                | number  | `50`     | Maximum persistent HTTP connections to Google APIs. Higher values allow more parallel requests but consume more resources.                         |
| `GOOGLE_API_KEEPALIVE_TIMEOUT`          | number  | `30000`  | Keep-alive timeout for persistent connections in milliseconds. Determines how long idle connections stay open for reuse.                           |
| `GOOGLE_API_HTTP2_ENABLED`              | boolean | `true`   | Enable HTTP/2 protocol for Google API connections. Provides 5-15% latency reduction via request multiplexing. Set to `false` to disable.           |
| `GOOGLE_API_MAX_IDLE_MS`                | number  | `300000` | Maximum idle time before proactive connection refresh in milliseconds. Google closes idle HTTP/2 connections after ~5 minutes. Default: 5 minutes. |
| `GOOGLE_API_KEEPALIVE_INTERVAL_MS`      | number  | `60000`  | Keepalive health check interval in milliseconds. Set to `0` to disable periodic health checks. Default: 1 minute.                                  |
| `GOOGLE_API_CONNECTION_RESET_THRESHOLD` | number  | `3`      | Consecutive API failures before automatic connection reset. Triggers fresh HTTP/2 negotiation after threshold.                                     |
| `ENABLE_AUTO_CONNECTION_RESET`          | boolean | `true`   | Enable automatic HTTP/2 connection reset on consecutive failures. Improves recovery from GOAWAY errors.                                            |
| `GOOGLE_API_TIMEOUT_MS`                 | number  | `30000`  | Google Sheets/Drive API request timeout in milliseconds. Default: 30 seconds. Enforces deadline for individual API calls.                          |

---

## Session & Storage Configuration

| Flag                               | Type   | Default  | Description                                                                                                                                            |
| ---------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SESSION_STORE_TYPE`               | enum   | `memory` | Session store backend: `memory` (development) or `redis` (production). ⚠️ Use `redis` in production for persistence and scalability.                   |
| `REDIS_URL`                        | string | optional | Redis connection URL. Format: `redis://[user:pass@][host]:[port]/[db]`. **REQUIRED when SESSION_STORE_TYPE=redis**. Example: `redis://localhost:6379`. |
| `STREAMABLE_HTTP_EVENT_TTL_MS`     | number | `300000` | Time-to-live for HTTP event store in milliseconds (resumability). Default: 5 minutes. Controls how long resumable events are kept.                     |
| `STREAMABLE_HTTP_EVENT_MAX_EVENTS` | number | `5000`   | Maximum number of streamable events per session. Prevents unbounded memory growth.                                                                     |
| `MAX_SESSIONS_PER_USER`            | number | `5`      | Maximum concurrent sessions per user. Prevents session exhaustion attacks.                                                                             |
| `SESSION_TTL_SECONDS`              | number | `86400`  | Session time-to-live in seconds. Default: 24 hours. Sessions older than this are automatically cleaned up.                                             |

---

## Performance & Caching

| Flag                          | Type    | Default  | Description                                                                                                                                               |
| ----------------------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CACHE_ENABLED`               | boolean | `true`   | Enable response caching. Set to `false` to disable all local caching.                                                                                     |
| `CACHE_MAX_SIZE_MB`           | number  | `100`    | Maximum cache size in megabytes. Default: 100MB. Adjust based on available memory.                                                                        |
| `CACHE_TTL_MS`                | number  | `300000` | Cache entry time-to-live in milliseconds. Default: 5 minutes (300000ms).                                                                                  |
| `CACHE_REDIS_ENABLED`         | boolean | `false`  | Enable distributed Redis L2 cache for data responses (metadata, values). Opt-in. Provides 15-25% latency improvement across replicas. Requires REDIS_URL. |
| `CACHE_REDIS_TTL_SECONDS`     | number  | `600`    | Redis cache TTL in seconds. Default: 10 minutes. Independent from local cache TTL.                                                                        |
| `DEDUP_ENABLED`               | boolean | `true`   | Enable request deduplication. Prevents duplicate identical requests within the timeout window.                                                            |
| `DEDUP_WINDOW_MS`             | number  | `5000`   | Deduplication timeout in milliseconds. Default: 5 seconds. How long to wait before considering a request timed out.                                       |
| `ENABLE_REQUEST_MERGING`      | boolean | `false`  | Enable RequestMerger optimization. Merges overlapping range reads within 50ms window. Provides 20-40% API savings. Experimental.                          |
| `ENABLE_PARALLEL_EXECUTOR`    | boolean | `false`  | Enable ParallelExecutor for large batch operations. Executes operations in parallel for 40% speed improvement. Experimental.                              |
| `PARALLEL_EXECUTOR_THRESHOLD` | number  | `100`    | Minimum number of operations to trigger parallel execution. Default: 100. Smaller batches execute sequentially.                                           |

---

## Feature Flags (Staged Rollout)

| Flag                            | Type    | Default | Description                                                                                                                                                                                                                                |
| ------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENABLE_DATAFILTER_BATCH`       | boolean | `true`  | Enable DataFilter batch operations: `batch_read`, `batch_write`, `batch_clear` with dataFilters. Production-ready feature flag.                                                                                                            |
| `ENABLE_TABLE_APPENDS`          | boolean | `true`  | Enable tableId-based appends for Tables API. Production-ready feature flag. Allows appending to tables by ID.                                                                                                                              |
| `ENABLE_PAYLOAD_VALIDATION`     | boolean | `true`  | Enable payload size validation and warnings. Recommended for production. Helps identify oversized requests.                                                                                                                                |
| `ENABLE_AGGRESSIVE_FIELD_MASKS` | boolean | `true`  | Enable aggressive field masking for Google API calls (Priority 8). Provides 40-60% payload reduction for spreadsheet metadata. Handlers use `getFieldMask()` helper to apply optimized masks.                                              |
| `ENABLE_CONDITIONAL_REQUESTS`   | boolean | `true`  | Enable ETag-based conditional requests (Priority 9). Uses If-None-Match headers to get 304 Not Modified responses when data hasn't changed. Provides 10-20% quota savings. Google API ETags are cached and reused for subsequent requests. |
| `ENABLE_LEGACY_SSE`             | boolean | `true`  | Enable legacy SSE endpoints (`/sse`, `/sse/message`) for backward compatibility. Keep enabled unless migrating away from legacy endpoints.                                                                                                 |

---

## Observability & Debugging

| Flag                              | Type    | Default | Description                                                                                                                                |
| --------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `TRACING_ENABLED`                 | boolean | `true`  | Enable OpenTelemetry distributed tracing. Enabled by default for production observability. Set to `false` to disable.                      |
| `TRACING_SAMPLE_RATE`             | number  | `0.1`   | Tracing sample rate (0.0 to 1.0). Default: 0.1 = sample 10% of requests. Adjust based on traffic volume to control observability overhead. |
| `ENABLE_BACKGROUND_ANALYSIS`      | boolean | `true`  | Enable background data quality analysis after destructive operations. Automatically monitors data health.                                  |
| `BACKGROUND_ANALYSIS_MIN_CELLS`   | number  | `10`    | Minimum cell count to trigger background analysis. Skips analysis on very small ranges.                                                    |
| `BACKGROUND_ANALYSIS_DEBOUNCE_MS` | number  | `2000`  | Debounce delay for background analysis in milliseconds. Default: 2 seconds. Coalesces rapid operations.                                    |
| `ENABLE_GRANULAR_PROGRESS`        | boolean | `false` | Enable granular progress notifications for long-running operations. Provides detailed step-by-step feedback.                               |

---

## Resilience & Error Handling

| Flag                                | Type   | Default | Description                                                                                                                                  |
| ----------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | number | `5`     | Consecutive API failures before circuit breaker opens. Default: 5 consecutive failures. Higher values in production for tolerance.           |
| `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` | number | `2`     | Successes in half-open state before circuit closes. Default: 2 successes. Lower values = faster recovery, higher values = more conservative. |
| `CIRCUIT_BREAKER_TIMEOUT_MS`        | number | `30000` | Circuit breaker timeout in milliseconds. Time to stay open before attempting half-open state. Default: 30 seconds.                           |

---

## Safety Limits & Timeouts

| Flag                           | Type   | Default | Description                                                                                                                                                   |
| ------------------------------ | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_CONCURRENT_REQUESTS`      | number | `10`    | Maximum concurrent Google API requests. Default: 10. Increase for higher throughput, decrease to reduce API quota usage.                                      |
| `REQUEST_TIMEOUT_MS`           | number | `30000` | Request timeout in milliseconds. Default: 30 seconds. Enforces deadline for all requests. Increase to 60000ms for production with complex operations.         |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | number | `10000` | Graceful shutdown timeout in milliseconds. Default: 10 seconds. Time allowed to drain requests before forced termination. Increase to 30000ms for production. |

---

## Context Optimization & Discovery

| Flag                          | Type    | Default | Description                                                                                                                                                                                         |
| ----------------------------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_KNOWLEDGE_RESOURCES` | boolean | `false` | Disable 800KB of embedded knowledge resources to reduce context usage. Set to `true` to reduce token consumption in Claude Desktop. Knowledge files still available in `dist/knowledge/` if needed. |
| `DEFER_RESOURCE_DISCOVERY`    | boolean | `false` | Defer resource registration until first access. Saves 300-500ms on cold start. Enable for production optimization but keep disabled for testing. Resources registered lazily on first tool call.    |

---

## Webhook Configuration

| Flag                         | Type         | Default  | Description                                                                                                                                                            |
| ---------------------------- | ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEBHOOK_ENDPOINT`           | string (URL) | optional | Public HTTPS endpoint for Google Drive API push notifications. Must be HTTPS for security. Required for webhook functionality. Must be accessible from Google servers. |
| `WEBHOOK_WORKER_CONCURRENCY` | number       | `2`      | Maximum concurrent webhook processing workers. Default: 2. Adjust based on expected notification volume.                                                               |
| `WEBHOOK_MAX_ATTEMPTS`       | number       | `3`      | Maximum retry attempts for failed webhook deliveries. Default: 3 attempts. Higher values ensure delivery at cost of latency.                                           |

---

## Production-Only Variables (from .env.production.example)

Additional variables documented in `.env.production.example` that are commonly configured in production deployments but not in the main schema:

| Flag                           | Type    | Default      | Description                                                                             |
| ------------------------------ | ------- | ------------ | --------------------------------------------------------------------------------------- |
| `LOG_FORMAT`                   | string  | (see schema) | Log output format: `json` for production log aggregation, `text` for development.       |
| `RATE_LIMIT_PER_MINUTE`        | number  | `100`        | Maximum requests per minute per user. Used by `createUserRateLimiterFromEnv()`.         |
| `RATE_LIMIT_PER_HOUR`          | number  | `5000`       | Maximum requests per hour per user. Used by `createUserRateLimiterFromEnv()`.           |
| `RATE_LIMIT_BURST`             | number  | `20`         | Extra requests allowed in burst (per minute). Used by `createUserRateLimiterFromEnv()`. |
| `DEFAULT_BATCH_SIZE`           | number  | (production) | Default batch operation size. Adjust based on typical request patterns.                 |
| `DEFAULT_BATCH_DELAY_MS`       | number  | (production) | Default batch collection window. Balance between batching efficiency and latency.       |
| `SCHEMA_CACHE_TTL_MS`          | number  | (production) | Schema cache time-to-live. Default: 1 hour.                                             |
| `SCHEMA_CACHE_MAX_ENTRIES`     | number  | (production) | Maximum schema cache entries. Default: 1000.                                            |
| `METADATA_CACHE_TTL_MS`        | number  | (production) | Metadata cache TTL. Default: 5 minutes.                                                 |
| `METADATA_CACHE_MAX_ENTRIES`   | number  | (production) | Maximum metadata cache entries. Default: 500.                                           |
| `HEALTH_CHECK_ENABLED`         | boolean | (production) | Enable health check endpoint.                                                           |
| `HEALTH_CHECK_INTERVAL_MS`     | number  | (production) | Health check interval. Default: 30 seconds.                                             |
| `HEALTH_CHECK_TIMEOUT_MS`      | number  | (production) | Health check timeout. Default: 5 seconds.                                               |
| `METRICS_ENABLED`              | boolean | (production) | Enable Prometheus metrics endpoint.                                                     |
| `METRICS_PORT`                 | number  | (production) | Prometheus metrics port. Default: 9090.                                                 |
| `PAYLOAD_WARNING_THRESHOLD_MB` | number  | (production) | Threshold for payload size warnings. Default: 5MB.                                      |
| `PAYLOAD_MAX_SIZE_MB`          | number  | (production) | Hard limit for payload size. Default: 50MB.                                             |
| `CSP_DIRECTIVES`               | string  | (production) | Content Security Policy directives for security headers.                                |
| `HSTS_MAX_AGE`                 | number  | (production) | HSTS max-age header. Default: 31536000 (1 year).                                        |
| `HSTS_INCLUDE_SUBDOMAINS`      | boolean | (production) | Include subdomains in HSTS policy. Default: `true`.                                     |
| `HSTS_PRELOAD`                 | boolean | (production) | Enable HSTS preload list inclusion. Default: `true`.                                    |

---

## Configuration File Locations

| File                      | Purpose                                             | Environment     |
| ------------------------- | --------------------------------------------------- | --------------- |
| `.env`                    | Active environment configuration                    | All             |
| `.env.example`            | Example configuration with all documented variables | Reference       |
| `.env.quickstart`         | Minimal quick-start configuration                   | Development     |
| `.env.production.example` | Production-optimized defaults and recommendations   | Reference       |
| `.env.docker.example`     | Docker-specific configuration                       | Docker          |
| `src/config/env.ts`       | Zod schema with validation and defaults             | Source of truth |

---

## Environment Variable Priority

(Highest to lowest):

1. System environment variables (set in shell/CI/CD)
2. `.env` file (loaded at startup)
3. Default values in `src/config/env.ts` (Zod schema)

---

## Validation & Error Handling

All environment variables are validated at startup using Zod schema in `src/config/env.ts`:

- **Early validation:** Fails fast with clear error messages if configuration is invalid
- **Type coercion:** Numeric and boolean values are automatically coerced
- **Default values:** Applied automatically if variable not set
- **Required fields:** JWT_SECRET, STATE_SECRET, OAUTH_CLIENT_SECRET required in production mode
- **Regex validation:** URLs validated against URL_REGEX pattern

If validation fails, the application will:

1. Log detailed error messages for each invalid variable
2. Output reference to `.env.example` for correct configuration
3. Exit with status code 1

---

## Configuration by Environment

### Development

Recommended settings for local development:

```bash
NODE_ENV=development
PORT=3000
HOST=127.0.0.1
LOG_LEVEL=debug
SESSION_STORE_TYPE=memory
CACHE_ENABLED=true
TRACING_ENABLED=true
DEFER_RESOURCE_DISCOVERY=false
```

### Production

Recommended settings for production deployment:

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
LOG_FORMAT=json
SESSION_STORE_TYPE=redis
CACHE_ENABLED=true
CACHE_REDIS_ENABLED=true
TRACING_ENABLED=true
TRACING_SAMPLE_RATE=0.1
REQUEST_TIMEOUT_MS=60000
GRACEFUL_SHUTDOWN_TIMEOUT_MS=30000
MAX_CONCURRENT_REQUESTS=100
DEFER_RESOURCE_DISCOVERY=true
```

### Testing

Recommended settings for test environment:

```bash
NODE_ENV=test
PORT=3001
HOST=127.0.0.1
LOG_LEVEL=warn
SESSION_STORE_TYPE=memory
CACHE_ENABLED=false
TRACING_ENABLED=false
DEFER_RESOURCE_DISCOVERY=false
```

---

## Security Best Practices

1. **Never commit secrets to version control** - Use `.gitignore` for `.env` files
2. **Rotate secrets regularly** - At least every 90 days
3. **Generate strong secrets** - Use: `openssl rand -hex 32`
4. **Use secrets manager** - AWS Secrets Manager, HashiCorp Vault, etc.
5. **Restrict CORS origins** - Never use `*` in production
6. **Whitelist redirect URIs** - Prevents open redirect vulnerabilities
7. **Use HTTPS everywhere** - Required for OAuth and webhooks
8. **Enable authentication** - Set SESSION_STORE_TYPE to redis in production
9. **Monitor logs** - Set up centralized log aggregation
10. **Validate payloads** - Keep ENABLE_PAYLOAD_VALIDATION enabled

---

## Feature Flag Rollout Strategy

ServalSheets uses feature flags for staged rollout:

- **Development:** All flags enabled by default for testing
- **Staging:** Enable/disable specific features to validate production readiness
- **Production:** Start with conservative settings, gradually enable new features

Common rollout pattern:

1. Set flag to `true` in limited production instances
2. Monitor metrics and logs for issues
3. Gradually increase percentage of traffic
4. Enable globally once stable

---

## Total Feature Flags & Variables Count

**Total Environment Variables Documented:** 99

### Breakdown by Category

- Environment & Runtime: 5
- Authentication & Authorization: 11
- Google API Integration: 5
- Connection Pooling & Network: 8
- Session & Storage: 6
- Performance & Caching: 8
- Feature Flags (Staged Rollout): 6
- Observability & Debugging: 6
- Resilience & Error Handling: 3
- Safety Limits & Timeouts: 3
- Context Optimization: 2
- Webhook Configuration: 3
- Production-Only Variables: 20

---

## Related Documentation

- Configuration: `src/config/env.ts`
- Examples: `.env.example`, `.env.production.example`
- Deployment: `docs/guides/DEPLOYMENT.md`
- Security: `docs/development/SECURITY.md`
- Getting Started: `.env.quickstart`
