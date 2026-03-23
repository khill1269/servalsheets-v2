/**
 * Environment Variable Validation
 *
 * Centralizes all environment variable access and validation using Zod.
 * Fails fast on startup with clear error messages if configuration is invalid.
 *
 * Anti-pattern Prevention:
 * - No scattered process.env access throughout codebase
 * - Type-safe environment variables
 * - Clear error messages for misconfiguration
 * - Validates early (fail fast)
 */

import { z } from 'zod';
import { tmpdir } from 'os';
import { resolve, sep } from 'path';
import { logger } from '../utils/logger.js';
import { URL_REGEX } from './google-limits.js';
import { ConfigError } from '../core/errors.js';

/**
 * Strict boolean parser for environment variables.
 *
 * strictBoolean() uses JavaScript's Boolean() coercion, which makes
 * Boolean("false") === true — silently keeping disabled features enabled.
 *
 * This helper correctly maps:
 *   "true"  / "1"  → true
 *   "false" / "0"  → false
 *   true / false   → pass-through (already boolean, e.g. from defaults)
 *   undefined      → undefined (handled by .default() downstream)
 */
const StrictBooleanSchema = z.union([
  z.boolean(),
  z.literal('true').transform(() => true as boolean),
  z.literal('1').transform(() => true as boolean),
  z.literal('false').transform(() => false as boolean),
  z.literal('0').transform(() => false as boolean),
]);

const strictBoolean = (): typeof StrictBooleanSchema => StrictBooleanSchema;

export const DEFAULT_DATA_DIR = '/tmp/servalsheets';
export const DEFAULT_PROFILE_STORAGE_DIR = '/tmp/servalsheets-profiles';
export const DEFAULT_CHECKPOINT_DIR = '/tmp/servalsheets-checkpoints';

/**
 * Environment variable schema with validation rules and defaults
 */
const EnvSchema = z.object({
  // Server configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  // HIGH-003 FIX: Default to 127.0.0.1 for security (0.0.0.0 exposes to entire network)
  HOST: z.string().default('127.0.0.1'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  // Per-user sliding-window limits (used by UserRateLimiter in user-rate-limiter.ts)
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5000),
  RATE_LIMIT_BURST: z.coerce.number().int().positive().default(20),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Google API Configuration (optional - can run without for testing)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z
    .string()
    .regex(URL_REGEX, 'Invalid URL format')
    .optional()
    .catch(undefined), // Gracefully fall back if env var is set to invalid URL (e.g., OOB redirect)

  // OAuth token storage paths (optional)
  // Note: Use GOOGLE_TOKEN_STORE_PATH in CLI (not TOKEN_PATH)
  CREDENTIALS_PATH: z.string().optional(),
  GOOGLE_TOKEN_STORE_PATH: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  PROFILE_STORAGE_DIR: z.string().optional(),
  CHECKPOINT_DIR: z.string().optional(),
  OAUTH_USE_CALLBACK_SERVER: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  OAUTH_AUTO_OPEN_BROWSER: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  MAX_TRANSACTION_OPS: z.coerce.number().int().positive().default(200),

  // Performance tuning
  CACHE_ENABLED: strictBoolean().default(true),
  CACHE_MAX_SIZE_MB: z.coerce.number().positive().default(100),
  CACHE_TTL_MS: z.coerce.number().positive().default(300000), // 5 minutes
  ETAG_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(1000),

  // Distributed Cache (Redis L2)
  // Enables Redis L2 cache for data responses (metadata, values)
  // Provides 15-25% latency improvement across replicas
  CACHE_REDIS_ENABLED: strictBoolean().default(false), // Opt-in for now
  CACHE_REDIS_TTL_SECONDS: z.coerce.number().int().positive().default(600), // 10 minutes

  // Background Analysis Configuration
  // Automatically monitors data quality after destructive operations
  ENABLE_BACKGROUND_ANALYSIS: strictBoolean().default(true),
  BACKGROUND_ANALYSIS_MIN_CELLS: z.coerce.number().int().positive().default(10),
  BACKGROUND_ANALYSIS_DEBOUNCE_MS: z.coerce.number().int().positive().default(2000), // 2 seconds

  // Feature flags (staged rollout)
  ENABLE_DATAFILTER_BATCH: strictBoolean().default(true),
  ENABLE_TABLE_APPENDS: strictBoolean().default(true),
  ENABLE_APPSSCRIPT_TRIGGER_COMPAT: strictBoolean().default(false),
  ENABLE_PAYLOAD_VALIDATION: strictBoolean().default(true),
  ENABLE_LEGACY_SSE: strictBoolean().default(false),
  ENABLE_TOOLS_LIST_CHANGED_NOTIFICATIONS: strictBoolean().default(true),
  ENABLE_AGGRESSIVE_FIELD_MASKS: strictBoolean().default(true), // Priority 8: 40-60% payload reduction
  ENABLE_CONDITIONAL_REQUESTS: strictBoolean().default(true), // Priority 9: ETag-based conditional reads (10-20% quota savings)
  // HTTP/2 connection health management (prevents GOAWAY errors)
  ENABLE_AUTO_CONNECTION_RESET: strictBoolean().default(true),
  GOOGLE_API_HTTP2_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'), // Enabled by default, only false if explicitly set
  GOOGLE_API_MAX_IDLE_MS: z.coerce.number().int().positive().default(300000), // 5 minutes
  GOOGLE_API_KEEPALIVE_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60000), // 1 minute, 0 = disabled
  GOOGLE_API_CONNECTION_RESET_THRESHOLD: z.coerce.number().int().positive().default(3), // Consecutive failures before reset
  GOOGLE_API_MAX_SOCKETS: z.coerce.number().int().positive().default(50), // Connection pool size
  GOOGLE_API_KEEPALIVE_TIMEOUT: z.coerce.number().int().positive().default(30000), // Keep-alive timeout (30s)

  // Performance optimization flags
  // RequestMerger: Merges overlapping range reads within 50ms window (20-40% API savings)
  // Enabled by default — production-ready with safe 50ms window and metrics tracking
  ENABLE_REQUEST_MERGING: strictBoolean().default(true),
  // Collection window for merging overlapping range reads (milliseconds)
  REQUEST_MERGER_WINDOW_MS: z.coerce.number().int().positive().default(50),
  // ParallelExecutor: Parallel execution for large batch operations (40% faster)
  // Enabled by default — 19 unit/integration tests pass, guarded by threshold (100+ ranges)
  ENABLE_PARALLEL_EXECUTOR: strictBoolean().default(true),
  PARALLEL_EXECUTOR_THRESHOLD: z.coerce.number().int().positive().default(100),
  // Number of concurrent requests in parallel executor (quota-safe default: 5)
  PARALLEL_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  // Max retries per task in parallel executor
  PARALLEL_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  // Granular progress notifications for long-running operations
  // Enabled by default — non-breaking MCP-compliant progress updates for CSV import, dedup, batch ops
  ENABLE_GRANULAR_PROGRESS: strictBoolean().default(true),

  // Deduplication
  DEDUP_ENABLED: strictBoolean().default(true),
  DEDUP_WINDOW_MS: z.coerce.number().positive().default(5000), // 5 seconds

  // Tracing & Observability (OTEL enabled by default for production observability)
  TRACING_ENABLED: strictBoolean().default(true),
  TRACING_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  OTEL_ENABLED: strictBoolean().default(true), // Internal tracing infrastructure
  OTEL_LOG_SPANS: strictBoolean().default(false), // Debug logging of spans
  ENABLE_OTEL: strictBoolean().default(false), // Enable OpenTelemetry SDK initialization

  // OTLP Export Configuration (production observability)
  OTEL_EXPORT_ENABLED: strictBoolean().default(false), // Opt-in OTLP export
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'), // OTLP collector endpoint
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(), // Additional headers (comma-separated key=value pairs)
  OTEL_SERVICE_NAME: z.string().default('servalsheets'),
  OTEL_EXPORT_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  OTEL_EXPORT_INTERVAL_MS: z.coerce.number().int().positive().default(5000), // 5 seconds
  OTEL_EXPORT_MAX_QUEUE_SIZE: z.coerce.number().int().positive().default(1000),
  OTEL_METRICS_PORT: z.coerce.number().int().positive().default(9464), // Prometheus metrics port
  OTEL_TRACES_EXPORTER: z.string().default('none').describe('Traces exporter: none, console, otlp'),

  // Dedicated Prometheus metrics server (optional)
  // When enabled, serves metrics on a separate port via src/server/metrics-server.ts
  ENABLE_METRICS_SERVER: strictBoolean().default(true),
  METRICS_PORT: z.coerce.number().int().positive().max(65535).default(9090),
  METRICS_HOST: z.string().default('127.0.0.1'),

  // Circuit Breaker (Google Sheets API defaults)
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_BREAKER_SUCCESS_THRESHOLD: z.coerce.number().int().positive().default(2),
  CIRCUIT_BREAKER_TIMEOUT_MS: z.coerce.number().positive().default(30000), // 30 seconds

  // Circuit Breaker overrides for specific APIs (optional - defaults match base config above)
  OAUTH_CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().optional(),
  OAUTH_CIRCUIT_BREAKER_SUCCESS_THRESHOLD: z.coerce.number().int().positive().optional(),
  OAUTH_CIRCUIT_BREAKER_TIMEOUT_MS: z.coerce.number().positive().optional(),
  APPSSCRIPT_CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().optional(),
  SNAPSHOT_CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().optional(),
  WEBHOOK_DELIVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().optional(),
  WEBHOOK_WORKER_CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().optional(),
  FEDERATION_CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().optional(),

  // Apps Script concurrency
  APPSSCRIPT_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(15),

  // Safety limits
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().positive().default(10),
  REQUEST_TIMEOUT_MS: z.coerce.number().positive().default(60000), // 60 seconds

  // Per-action timeout overrides for operations that need longer than MCP 30s default
  // Use these to configure timeouts for specific actions that naturally take longer
  COMPOSITE_TIMEOUT_MS: z.coerce.number().positive().default(55000), // 55s — must stay under MCP 60s transport limit
  LARGE_PAYLOAD_TIMEOUT_MS: z.coerce.number().positive().default(60000), // 1 minute for large data operations
  TASK_WATCHDOG_MS: z.coerce.number().int().positive().default(600000), // 10 minutes

  // Graceful shutdown
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: z.coerce.number().positive().default(10000), // 10 seconds

  // Stateless mode (Kubernetes readiness)
  // When true, services prefer Redis over in-memory stores for horizontal scaling
  STATELESS_MODE: strictBoolean().default(false),

  // Session Store Configuration (for OAuth)
  SESSION_STORE_TYPE: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().regex(URL_REGEX, 'Invalid URL format').optional().catch(undefined),
  ALLOW_MEMORY_SESSIONS: strictBoolean().default(false),

  // Admin Dashboard Configuration
  ADMIN_API_KEY: z.string().optional(),
  ADMIN_VIEWER_KEY: z.string().optional(),
  ADMIN_SECRET: z.string().optional(), // Deprecated fallback for legacy admin auth
  ADMIN_SESSION_TTL_MS: z.coerce.number().positive().default(86400000), // 24 hours

  // Session idle timeout (HTTP transport only)
  // Sessions inactive beyond this duration are automatically evicted
  SESSION_TIMEOUT_MS: z.coerce.number().positive().default(1800000), // 30 minutes

  // Streamable HTTP event store (resumability)
  STREAMABLE_HTTP_EVENT_TTL_MS: z.coerce.number().positive().default(300000), // 5 minutes
  STREAMABLE_HTTP_EVENT_MAX_EVENTS: z.coerce.number().int().positive().default(5000),

  // OAuth Server Configuration (for remote server)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be ≥32 chars when OAuth enabled').optional(),
  STATE_SECRET: z.string().min(32, 'STATE_SECRET must be ≥32 chars when OAuth enabled').optional(),
  OAUTH_CLIENT_SECRET: z.string().min(16, 'OAUTH_CLIENT_SECRET must be ≥16 chars').optional(),
  OAUTH_ISSUER: z.string().default('https://servalsheets.example.com'),
  OAUTH_CLIENT_ID: z.string().default('servalsheets'),
  OAUTH_RESOURCE_INDICATOR: z
    .string()
    .optional()
    .describe(
      'RFC 8707 resource indicator (aud claim). If set, JWT tokens will use this as the audience instead of client_id. Typically the server base URL or API resource identifier.'
    ),
  // Claude/Anthropic Directory required callback URLs + localhost for development
  ALLOWED_REDIRECT_URIS: z
    .string()
    .default(
      'http://localhost:3000/callback,' +
        'http://localhost:6274/oauth/callback,' +
        'http://localhost:6274/oauth/callback/debug,' +
        'https://claude.ai/api/mcp/auth_callback,' +
        'https://claude.com/api/mcp/auth_callback'
    ),
  CORS_ORIGINS: z
    .string()
    .default(
      'https://claude.ai,' +
        'https://claude.com,' +
        'https://chatgpt.com,' +
        'https://chat.openai.com,' +
        'https://copilot.microsoft.com,' +
        'https://gemini.google.com,' +
        'https://grok.x.ai,' +
        'https://app.cursor.sh,' +
        'https://codeium.com'
    ),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(3600), // 1 hour
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2592000), // 30 days
  OAUTH_MAX_TOKEN_TTL: z.coerce.number().int().positive().default(1800), // 30 minutes (security boundary)

  // Google Cloud Managed Auth Mode
  // When true: Uses Application Default Credentials, disables sheets_auth tool
  // Set to true when deploying to Cloud Run, GKE, or Cloud Functions
  MANAGED_AUTH: strictBoolean().default(false),

  // Webhook Configuration (Phase 1: Drive API Push Notifications)
  // Public HTTPS endpoint for Google Drive API to send notifications
  // Required for webhook functionality, must be accessible from Google servers
  WEBHOOK_ENDPOINT: z
    .string()
    .regex(URL_REGEX, 'Invalid URL format')
    .refine((url) => url.startsWith('https://'), 'Webhook endpoint must use HTTPS')
    .optional(),
  WEBHOOK_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // When true, DNS resolution failures block webhook registration (fail-closed security).
  // Set to false in environments with unreliable DNS to allow registration despite DNS errors.
  WEBHOOK_DNS_STRICT: strictBoolean().default(true),

  // MCP Federation Configuration (Feature 3: Server Federation)
  // Enables calling external MCP servers for composite workflows
  // Example: Weather APIs, ML servers, database connectors
  MCP_FEDERATION_ENABLED: strictBoolean().default(false),
  MCP_FEDERATION_TIMEOUT_MS: z.coerce.number().positive().default(30000), // 30 seconds
  MCP_FEDERATION_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  MCP_FEDERATION_DNS_STRICT: strictBoolean().default(true),
  // JSON array of server configs: [{"name":"weather-api","url":"http://localhost:3001"}]
  MCP_FEDERATION_SERVERS: z.string().optional(),

  // Context Optimization
  // Disables 800KB of embedded knowledge resources to reduce context usage
  // Knowledge files still available in dist/knowledge/ if needed
  DISABLE_KNOWLEDGE_RESOURCES: strictBoolean().default(false),

  // Resource Discovery Optimization
  // Defers resource registration until first access (saves 300-500ms on cold start)
  // Disabled by default for compatibility; enable explicitly for production optimization
  DEFER_RESOURCE_DISCOVERY: strictBoolean().default(false),

  // Incremental consent (SaaS deployments)
  INCREMENTAL_CONSENT_ENABLED: strictBoolean().default(false),
  SAMPLING_CONSENT_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(30000),
  // GDPR sampling consent enforcement: 'off'=permissive, 'log'=warn only, 'strict'=block
  ENABLE_SAMPLING_CONSENT: z.enum(['off', 'log', 'strict']).default('off'),

  // Enterprise feature flags
  // RBAC and Tenant Isolation require infrastructure (role config, API keys) — keep opt-in
  ENABLE_RBAC: strictBoolean().default(false),
  // Audit logging: non-critical (try/catch wrapped), adds compliance visibility
  ENABLE_AUDIT_LOGGING: strictBoolean().default(true),
  AUDIT_LOG_ENCRYPTION_KEY: z.string().optional(),
  AUDIT_HMAC_SECRET: z.string().optional(),
  AUDIT_LOG_DIR: z.string().optional(),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  TRANSACTION_WAL_DIR: z.string().default('.serval/wal'),
  TRANSACTIONS_ENABLED: strictBoolean().default(true),
  TRANSACTIONS_AUTO_SNAPSHOT: strictBoolean().default(true),
  TRANSACTIONS_AUTO_ROLLBACK: strictBoolean().default(true),
  TRANSACTIONS_MAX_OPERATIONS: z.coerce.number().int().positive().default(100),
  TRANSACTIONS_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  TRANSACTIONS_SNAPSHOT_RETENTION_MS: z.coerce.number().int().positive().default(3600000),
  TRANSACTIONS_MAX_CONCURRENT: z.coerce.number().int().positive().default(10),
  TRANSACTIONS_VERBOSE: strictBoolean().default(false),
  TRANSACTIONS_DEFAULT_ISOLATION: z
    .enum(['optimistic', 'pessimistic', 'snapshot', 'read_committed'])
    .default('optimistic'),
  TENANT_ALLOW_UNMAPPED_SPREADSHEET_ACCESS: strictBoolean().default(false),
  DISCOVERY_API_ENABLED: strictBoolean().default(true),
  DISCOVERY_CACHE_TTL: z.coerce.number().int().positive().default(86400),
  ENABLE_TENANT_ISOLATION: strictBoolean().default(false),
  // Idempotency: makes all tool calls retry-safe via key-based dedup
  ENABLE_IDEMPOTENCY: strictBoolean().default(true),
  // Cost tracking: useful for SaaS/multi-tenant, adds per-request overhead — keep opt-in
  ENABLE_COST_TRACKING: strictBoolean().default(false),
  // Billing integration (Stripe): disabled by default, runtime-initialized when enabled
  ENABLE_BILLING_INTEGRATION: strictBoolean().default(false),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BILLING_CURRENCY: z.string().default('usd'),
  BILLING_CYCLE: z.enum(['monthly', 'annual']).default('monthly'),
  BILLING_AUTO_INVOICING: strictBoolean().default(true),

  // Strict output schema validation: reject responses failing schema validation (opt-in for CI/test)
  STRICT_OUTPUT_VALIDATION: strictBoolean().default(true), // MCP-01: declared outputSchema MUST conform per spec

  // Predictive Prefetching (80% latency reduction on sequential operations)
  // Intelligently prefetches data based on access patterns (adjacent ranges, predicted next access)
  // Enabled by default - production-ready with circuit breaker and background refresh
  ENABLE_PREFETCH: strictBoolean().default(true),
  PREFETCH_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  PREFETCH_MAX_PREDICTIONS: z.coerce.number().int().positive().default(5),
  PREFETCH_CONCURRENCY: z.coerce.number().int().positive().default(2),
  PREFETCH_BACKGROUND_REFRESH: strictBoolean().default(true),
  // Access pattern tracker — learning window for predictive prefetching
  ACCESS_PATTERN_MAX_HISTORY: z.coerce.number().int().positive().default(1000),
  ACCESS_PATTERN_WINDOW_MS: z.coerce.number().int().positive().default(300000),

  // Python Compute (Pyodide WASM — Phase 2)
  // Disabled by default: first load is ~10-20 seconds (WASM download + package install).
  // Set ENABLE_PYTHON_COMPUTE=true to activate python_eval, pandas_profile,
  // sklearn_model, and matplotlib_chart actions in sheets_compute.
  ENABLE_PYTHON_COMPUTE: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .default(false)
    .describe('Enable Pyodide-based Python compute (WASM, first load ~10-20s)'),

  // Excel Online (Microsoft Graph API) — scaffold backend (P3-3)
  // Set these to enable Excel Online adapter initialization
  EXCEL_ONLINE_CLIENT_ID: z.string().optional(),
  EXCEL_ONLINE_CLIENT_SECRET: z.string().optional(),
  EXCEL_ONLINE_TENANT_ID: z.string().optional(),

  // Action Log Sheet (audit-to-spreadsheet)
  // When enabled, each mutation is appended to a designated Google Sheet for audit trail
  ENABLE_ACTION_LOG_SHEET: strictBoolean().default(false),
  ACTION_LOG_SPREADSHEET_ID: z.string().optional(),
  ACTION_LOG_SHEET_NAME: z.string().default('_audit_log'),

  // Response redaction: strips tokens/keys from HTTP response bodies (default: true)
  ENABLE_RESPONSE_REDACTION: strictBoolean().default(true),

  // Google API request timeout in milliseconds (default: 60 seconds)
  GOOGLE_API_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

  // Formula passthrough bypass (security override — use with caution)
  // When true, mutation-safety-middleware skips formula injection scanning (non-production only)
  SERVAL_ALLOW_FORMULA_PASSTHROUGH: strictBoolean().default(false),

  // Post-write verification strict mode
  // When true, mutation verification divergence throws instead of logging a warning.
  MUTATION_VERIFY_STRICT: strictBoolean().default(false),

  // Connector credential encryption key (AES-256-GCM)
  // Must be set to enable encrypted credential storage for data connectors
  CONNECTOR_ENCRYPTION_KEY: z.string().min(32).optional(),

  // Agent plan file encryption key (AES-256-GCM)
  // Must be 64 hex chars (32 bytes). If unset, plans are stored as plaintext.
  PLAN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional()
    .describe(
      'AES-256-GCM key for encrypting agent plan files (64 hex chars = 32 bytes). If unset, plans are stored as plaintext.'
    ),

  // MCP non-fatal tool errors: when 'true', tool errors are returned as content not protocol errors
  MCP_NON_FATAL_TOOL_ERRORS: z.string().optional().default('true'),
  PYODIDE_CACHE_DIR: z
    .string()
    .optional()
    .describe('Directory to cache Pyodide WASM files (improves cold start)'),

  // Connector configuration directory (persistent encrypted credential storage)
  CONNECTOR_CONFIG_DIR: z.string().optional(),

  // OAuth redirect URI for embedded desktop OAuth flow
  OAUTH_REDIRECT_URI: z.string().default('http://localhost:3000/callback'),

  // When true, server is running in HTTP mode (not STDIO desktop mode)
  MCP_HTTP_MODE: strictBoolean().default(false),

  // Health monitoring — connection health check thresholds
  MCP_DISCONNECT_THRESHOLD_MS: z.coerce.number().int().positive().default(120000), // 2 minutes
  MCP_WARN_THRESHOLD_MS: z.coerce.number().int().positive().default(60000), // 1 minute

  // Heap health check — snapshot support for memory debugging
  ENABLE_HEAP_SNAPSHOTS: strictBoolean().default(false),
  HEAP_SNAPSHOT_PATH: z.string().default('./heap-snapshots'),
  // Heap pressure thresholds for heap-watchdog.ts (0-1 fraction of total heap)
  HEAP_ELEVATED_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  HEAP_CRITICAL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  HEAP_WATCHDOG_INTERVAL_MS: z.coerce.number().int().positive().default(5000),

  // Scheduler / persistent job store directory
  DATA_DIR: z.string().default(DEFAULT_DATA_DIR),

  // MCP-07: Enforce MCP-Protocol-Version header on HTTP transport.
  // When true, reject requests missing or mismatching "MCP-Protocol-Version: 2025-11-25".
  // MCP 2025-11-25 spec §4.1 requires this header; default true for compliance.
  STRICT_MCP_PROTOCOL_VERSION: strictBoolean().default(true),

  // SERVAL function integration callback URLs
  SERVAL_CALLBACK_URL: z.string().optional(),
  SERVALSHEETS_BASE_URL: z.string().optional(),

  // BigQuery result row cap (configurable for large exports)
  MAX_BIGQUERY_RESULT_ROWS: z.coerce.number().positive().default(100000),

  // Sampling request timeout in milliseconds
  SAMPLING_TIMEOUT_MS: z.coerce.number().positive().default(30000),

  // Output schema validation (validate handler responses against declared outputSchema)
  VALIDATE_OUTPUT_SCHEMAS: strictBoolean().default(true),

  // Impact analyzer configuration
  IMPACT_ANALYSIS_ENABLED: strictBoolean().default(true),
  IMPACT_ANALYZE_FORMULAS: strictBoolean().default(true),
  IMPACT_ANALYZE_CHARTS: strictBoolean().default(true),
  IMPACT_ANALYZE_PIVOT_TABLES: strictBoolean().default(true),
  IMPACT_ANALYZE_VALIDATION: strictBoolean().default(true),
  IMPACT_ANALYZE_NAMED_RANGES: strictBoolean().default(true),
  IMPACT_ANALYZE_PROTECTED: strictBoolean().default(true),
  IMPACT_ANALYSIS_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  IMPACT_VERBOSE: strictBoolean().default(false),
  ENABLE_CHECKPOINTS: strictBoolean().default(false),

  // Cache manager (constructor defaults — distinct from CACHE_TTL_MS / CACHE_MAX_SIZE_MB above)
  CACHE_DEFAULT_TTL: z.coerce.number().positive().default(300000),
  CACHE_MAX_SIZE: z.coerce.number().positive().default(100), // MB
  CACHE_CLEANUP_INTERVAL: z.coerce.number().positive().default(300000),

  // LLM fallback configuration
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'google']).default('anthropic'),
  LLM_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z
    .string()
    .optional()
    .describe('Voyage AI API key for semantic search embeddings (sheets_analyze.semantic_search)'),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),

  // SAML SSO configuration (ISSUE-173)
  SAML_ENTRY_POINT: z.string().optional().describe('IdP SSO endpoint URL (from IdP metadata)'),
  SAML_ISSUER: z.string().optional().describe('SP Entity ID, typically your server base URL'),
  SAML_CERT: z
    .string()
    .optional()
    .describe('IdP x509 signing certificate (PEM body without headers)'),
  SAML_CALLBACK_URL: z.string().optional().describe('ACS URL — must match IdP registration'),
  SAML_PRIVATE_KEY: z
    .string()
    .optional()
    .describe('SP private key PEM for signed AuthnRequests (optional)'),
  SAML_WANT_ASSERTIONS_SIGNED: z
    .string()
    .optional()
    .describe('Require signed assertions (default: true)'),
  SAML_SIGNATURE_ALGORITHM: z.enum(['sha1', 'sha256', 'sha512']).optional().default('sha256'),
  SSO_JWT_TTL: z.coerce
    .number()
    .positive()
    .optional()
    .default(3600)
    .describe('SSO JWT TTL in seconds'),
  SSO_ALLOWED_CLOCK_SKEW: z.coerce
    .number()
    .nonnegative()
    .optional()
    .default(300)
    .describe('Allowed clock skew for SAML assertions in seconds'),

  // MCP response size limits
  MCP_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(100000),
  // Response compaction (response-compactor.ts)
  MAX_INLINE_CELLS: z.coerce.number().int().positive().default(500),
  COMPACT_RESPONSES: strictBoolean().default(true),

  // Rate limiting (Google Sheets API quota)
  RATE_LIMIT_READS_PER_MINUTE: z.coerce.number().positive().default(300),
  RATE_LIMIT_WRITES_PER_MINUTE: z.coerce.number().positive().default(60),
  // Per-spreadsheet request throttle (req/sec). Follows Google guidance to
  // limit concurrent requests per spreadsheet to avoid 503s (quota exceeded).
  PER_SPREADSHEET_RPS: z.coerce.number().positive().default(3),

  // Diff engine concurrency (parallel sheet fetches)
  DIFF_ENGINE_CONCURRENCY: z.coerce.number().positive().default(10),

  // Schema optimization mode (controls tool description verbosity)
  SCHEMA_MODE: z.enum(['full', 'minimal', 'compact']).default('full'),
  LAZY_LOAD_TOOLS: z.string().optional(),
  LAZY_LOAD_ENTERPRISE: strictBoolean().default(false),

  // OAuth scope selection
  OAUTH_SCOPE_MODE: z.string().optional(),
  DEPLOYMENT_MODE: z.enum(['self-hosted', 'saas']).catch('self-hosted').default('self-hosted'),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validated environment variables
 * Access via `env.PORT`, `env.NODE_ENV`, etc.
 */
export let env: Env;

function ensureEnv(): Env {
  if (!env) {
    env = EnvSchema.parse(process.env);
  }
  return env;
}

/**
 * Reset the env cache. FOR TEST USE ONLY.
 * Call before setting process.env vars that need to be re-parsed.
 */
export function resetEnvForTest(): void {
  env = undefined as unknown as Env;
}

/**
 * Validate and parse environment variables
 *
 * Call this early in application startup (before any other initialization)
 * to ensure all required configuration is present and valid.
 *
 * @throws {ZodError} if validation fails, with detailed error messages
 * @returns {Env} Validated environment configuration
 */
export function validateEnv(): Env {
  try {
    env = EnvSchema.parse(process.env);
    // ISSUE-194: Warn when server is exposed on a public interface without RBAC
    const isPublicHost = env.HOST !== '127.0.0.1' && env.HOST !== 'localhost' && env.HOST !== '::1';
    if (isPublicHost && !env.ENABLE_RBAC) {
      logger.warn(
        'SECURITY: Server is exposed on a public interface with RBAC disabled. ' +
          'Set ENABLE_RBAC=true or restrict HOST to 127.0.0.1 to prevent unauthorized access.',
        { host: env.HOST }
      );
    }
    if (env.ENABLE_TENANT_ISOLATION && !env.ENABLE_RBAC) {
      logger.warn(
        'SECURITY: ENABLE_TENANT_ISOLATION=true while ENABLE_RBAC=false. ' +
          'Enable RBAC to enforce per-tenant authorization boundaries in multi-tenant mode.'
      );
    }
    if (env.NODE_ENV === 'production' && env.ENABLE_TENANT_ISOLATION && !env.ENABLE_RBAC) {
      throw new ConfigError(
        'ENABLE_TENANT_ISOLATION requires ENABLE_RBAC=true in production',
        'ENABLE_RBAC'
      );
    }

    if (env.ENABLE_BILLING_INTEGRATION && !env.STRIPE_SECRET_KEY) {
      logger.warn(
        'ENABLE_BILLING_INTEGRATION=true but STRIPE_SECRET_KEY is missing. Billing startup will be skipped.'
      );
    }
    if (
      env.ENABLE_AUDIT_LOGGING &&
      env.NODE_ENV === 'production' &&
      !env.AUDIT_LOG_ENCRYPTION_KEY
    ) {
      logger.warn(
        'SECURITY: ENABLE_AUDIT_LOGGING=true in production without AUDIT_LOG_ENCRYPTION_KEY. ' +
          'Audit logs will be stored unencrypted at rest.',
        { nodeEnv: env.NODE_ENV }
      );
    }
    const transactionsEnabled = env.TRANSACTIONS_ENABLED;
    if (transactionsEnabled && env.NODE_ENV === 'production' && !env.TRANSACTION_WAL_DIR) {
      logger.warn(
        'DURABILITY: Transactions are enabled in production without TRANSACTION_WAL_DIR. ' +
          'In-flight transaction recovery after process crashes will be unavailable.'
      );
    }
    if (env.NODE_ENV === 'production' && isTemporaryDataDir(env.DATA_DIR)) {
      throw new ConfigError(
        `DATA_DIR must point to persistent storage in production. ` +
          `Current value "${env.DATA_DIR}" resolves to a temporary directory. ` +
          'Set DATA_DIR to a durable path such as /var/lib/servalsheets or a mounted volume.',
        'DATA_DIR'
      );
    }
    const profileStorageDir = env.PROFILE_STORAGE_DIR ?? DEFAULT_PROFILE_STORAGE_DIR;
    if (env.NODE_ENV === 'production' && isTemporaryDataDir(profileStorageDir)) {
      throw new ConfigError(
        `PROFILE_STORAGE_DIR must point to persistent storage in production. ` +
          `Current value "${profileStorageDir}" resolves to a temporary directory.`,
        'PROFILE_STORAGE_DIR'
      );
    }
    const checkpointDir = env.CHECKPOINT_DIR ?? DEFAULT_CHECKPOINT_DIR;
    if (
      env.NODE_ENV === 'production' &&
      env.ENABLE_CHECKPOINTS &&
      isTemporaryDataDir(checkpointDir)
    ) {
      throw new ConfigError(
        `CHECKPOINT_DIR must point to persistent storage when checkpoints are enabled in production. ` +
          `Current value "${checkpointDir}" resolves to a temporary directory.`,
        'CHECKPOINT_DIR'
      );
    }
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error('Environment validation failed', { issues: error.issues });

      // Log individual issues for clarity
      for (const issue of error.issues) {
        const path = issue.path.join('.');
        logger.error(`Configuration error: ${path}`, { message: issue.message });
      }

      logger.error(
        'Please check your environment variables or .env file. See .env.example for required configuration.'
      );
      process.exit(1);
    }

    throw error;
  }
}

export function isTemporaryDataDir(dataDir: string): boolean {
  const normalizedDir = resolve(dataDir);
  const tempRoots = new Set([resolve(tmpdir()), resolve('/tmp')]);

  for (const tempRoot of tempRoots) {
    if (normalizedDir === tempRoot || normalizedDir.startsWith(`${tempRoot}${sep}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Access validated environment variables without re-parsing.
 * Uses defaults if validateEnv() has not been called yet.
 */
export function getEnv(): Env {
  return ensureEnv();
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return ensureEnv().NODE_ENV === 'production';
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return ensureEnv().NODE_ENV === 'development';
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return ensureEnv().NODE_ENV === 'test';
}

/**
 * Check if Google API credentials are configured
 */
export function hasGoogleCredentials(): boolean {
  const current = ensureEnv();
  return !!(
    current.GOOGLE_CLIENT_ID &&
    current.GOOGLE_CLIENT_SECRET &&
    current.GOOGLE_REDIRECT_URI
  );
}

/**
 * Check if managed authentication mode is enabled
 *
 * When true:
 * - Uses Google Cloud Application Default Credentials (ADC)
 * - Disables sheets_auth tool (not needed)
 * - Skips OAuth infrastructure initialization
 *
 * Set MANAGED_AUTH=true when deploying to:
 * - Google Cloud Run
 * - Google Kubernetes Engine (GKE)
 * - Google Cloud Functions
 * - Any environment with GOOGLE_APPLICATION_CREDENTIALS set
 */
export function isManagedAuth(): boolean {
  return ensureEnv().MANAGED_AUTH;
}

/**
 * Get cache configuration
 */
export function getCacheConfig(): {
  enabled: boolean;
  maxSizeMB: number;
  ttlMs: number;
} {
  const current = ensureEnv();
  return {
    enabled: current.CACHE_ENABLED,
    maxSizeMB: current.CACHE_MAX_SIZE_MB,
    ttlMs: current.CACHE_TTL_MS,
  };
}

/**
 * Get deduplication configuration
 */
export function getDedupConfig(): { enabled: boolean; windowMs: number } {
  const current = ensureEnv();
  return {
    enabled: current.DEDUP_ENABLED,
    windowMs: current.DEDUP_WINDOW_MS,
  };
}

/**
 * Get tracing configuration
 */
export function getTracingConfig(): { enabled: boolean; sampleRate: number } {
  const current = ensureEnv();
  return {
    enabled: current.TRACING_ENABLED,
    sampleRate: current.TRACING_SAMPLE_RATE,
  };
}

/**
 * Get dedicated metrics server configuration
 */
export function getMetricsServerConfig(): {
  enabled: boolean;
  port: number;
  host: string;
} {
  const current = ensureEnv();
  return {
    enabled: current.ENABLE_METRICS_SERVER,
    port: current.METRICS_PORT,
    host: current.METRICS_HOST,
  };
}

/**
 * Get safety limits configuration
 */
export function getSafetyLimits(): {
  maxConcurrentRequests: number;
  requestTimeoutMs: number;
  gracefulShutdownTimeoutMs: number;
} {
  const current = ensureEnv();
  return {
    maxConcurrentRequests: current.MAX_CONCURRENT_REQUESTS,
    requestTimeoutMs: current.REQUEST_TIMEOUT_MS,
    gracefulShutdownTimeoutMs: current.GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  };
}

/**
 * Get session store configuration
 *
 * @throws {Error} if redis type is selected but REDIS_URL not provided
 */
export function getSessionStoreConfig(): {
  type: 'memory' | 'redis';
  redisUrl?: string;
} {
  const current = ensureEnv();
  const type = current.SESSION_STORE_TYPE;
  const redisUrl = current.REDIS_URL;

  if (type === 'redis' && !redisUrl) {
    throw new ConfigError(
      'REDIS_URL is required when SESSION_STORE_TYPE=redis. ' +
        'Please provide a Redis connection URL (e.g., redis://localhost:6379)',
      'REDIS_URL'
    );
  }

  return { type, redisUrl };
}

/**
 * Get circuit breaker configuration
 */
export function getCircuitBreakerConfig(): {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
} {
  const current = ensureEnv();
  return {
    failureThreshold: current.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    successThreshold: current.CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
    timeout: current.CIRCUIT_BREAKER_TIMEOUT_MS,
  };
}

/**
 * Get API-specific circuit breaker configuration
 * Falls back to base config values if specific overrides are not set.
 *
 * @param apiName API identifier: 'oauth', 'appsscript', 'snapshot', 'webhook_delivery', 'webhook_worker', 'federation'
 * @returns Circuit breaker config with environment-based or default values
 */
export function getApiSpecificCircuitBreakerConfig(
  apiName:
    | 'oauth'
    | 'appsscript'
    | 'snapshot'
    | 'webhook_delivery'
    | 'webhook_worker'
    | 'federation'
): {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
} {
  const current = ensureEnv();
  const baseConfig = getCircuitBreakerConfig();

  // Type-safe mapping of API names to env vars
  let failureThreshold: number | undefined;
  let successThreshold: number | undefined;
  let timeout: number | undefined;

  switch (apiName) {
    case 'oauth':
      failureThreshold = current.OAUTH_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
      successThreshold = current.OAUTH_CIRCUIT_BREAKER_SUCCESS_THRESHOLD;
      timeout = current.OAUTH_CIRCUIT_BREAKER_TIMEOUT_MS;
      break;
    case 'appsscript':
      failureThreshold = current.APPSSCRIPT_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
      successThreshold = undefined; // use default
      timeout = undefined; // use default
      break;
    case 'snapshot':
      failureThreshold = current.SNAPSHOT_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
      successThreshold = undefined;
      timeout = undefined;
      break;
    case 'webhook_delivery':
      failureThreshold = current.WEBHOOK_DELIVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
      successThreshold = undefined;
      timeout = undefined;
      break;
    case 'webhook_worker':
      failureThreshold = current.WEBHOOK_WORKER_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
      successThreshold = undefined;
      timeout = undefined;
      break;
    case 'federation':
      failureThreshold = current.FEDERATION_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
      successThreshold = undefined;
      timeout = undefined;
      break;
  }

  return {
    failureThreshold: failureThreshold ?? baseConfig.failureThreshold,
    successThreshold: successThreshold ?? baseConfig.successThreshold,
    timeout: timeout ?? baseConfig.timeout,
  };
}

/**
 * Get background analysis configuration
 */
export function getBackgroundAnalysisConfig(): {
  enabled: boolean;
  minCells: number;
  debounceMs: number;
} {
  const current = ensureEnv();
  return {
    enabled: current.ENABLE_BACKGROUND_ANALYSIS,
    minCells: current.BACKGROUND_ANALYSIS_MIN_CELLS,
    debounceMs: current.BACKGROUND_ANALYSIS_DEBOUNCE_MS,
  };
}

/**
 * Get distributed cache (Redis) configuration
 */
export function getDistributedCacheConfig(): {
  enabled: boolean;
  redisUrl?: string;
  ttlSeconds: number;
} {
  const current = ensureEnv();
  return {
    enabled: current.CACHE_REDIS_ENABLED && !!current.REDIS_URL,
    redisUrl: current.REDIS_URL,
    ttlSeconds: current.CACHE_REDIS_TTL_SECONDS,
  };
}

/**
 * Check if resource discovery should be deferred
 *
 * When true:
 * - Resource registration is skipped during server initialization
 * - Resources are registered lazily on first tool call
 * - Saves 300-500ms on cold start
 *
 * Enable for:
 * - Production deployments where startup time is critical
 * - Claude Desktop with many resources
 *
 * Keep disabled (default) for:
 * - Testing environments that call resources/list immediately
 * - Development environments
 *
 * Note: Resources will be registered before the first tool call,
 * so they may not be available for immediate resources/list requests.
 */
export function shouldDeferResourceDiscovery(): boolean {
  return ensureEnv().DEFER_RESOURCE_DISCOVERY;
}

/**
 * Get MCP federation configuration
 *
 * When enabled:
 * - ServalSheets can call tools on external MCP servers
 * - Enables composite workflows (e.g., weather data → Sheets)
 * - Requires MCP_FEDERATION_SERVERS JSON configuration
 *
 * Example MCP_FEDERATION_SERVERS:
 * ```json
 * [
 *   {
 *     "name": "weather-api",
 *     "url": "http://localhost:3001",
 *     "auth": {"type": "bearer", "token": "sk-..."}
 *   }
 * ]
 * ```
 */
export function getFederationConfig(): {
  enabled: boolean;
  timeoutMs: number;
  maxConnections: number;
  serversJson?: string;
} {
  const current = ensureEnv();
  return {
    enabled: current.MCP_FEDERATION_ENABLED,
    timeoutMs: current.MCP_FEDERATION_TIMEOUT_MS,
    maxConnections: current.MCP_FEDERATION_MAX_CONNECTIONS,
    serversJson: current.MCP_FEDERATION_SERVERS,
  };
}

/**
 * Get OpenTelemetry OTLP export configuration
 *
 * When enabled:
 * - Exports spans to OTLP collector (Jaeger, Zipkin, Honeycomb, etc.)
 * - Provides production observability and distributed tracing
 * - Batches spans for efficient export
 *
 * Example setup:
 * ```bash
 * # Local Jaeger (all-in-one)
 * docker run -d -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:latest
 * export OTEL_EXPORT_ENABLED=true
 * export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *
 * # Honeycomb
 * export OTEL_EXPORT_ENABLED=true
 * export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
 * export OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=YOUR_API_KEY"
 * ```
 */
export function getOtlpExportConfig(): {
  enabled: boolean;
  endpoint: string;
  serviceName: string;
  headers?: string;
  batchSize: number;
  exportIntervalMs: number;
  maxQueueSize: number;
} {
  const current = ensureEnv();
  return {
    enabled: current.OTEL_EXPORT_ENABLED,
    endpoint: current.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: current.OTEL_SERVICE_NAME,
    headers: current.OTEL_EXPORTER_OTLP_HEADERS,
    batchSize: current.OTEL_EXPORT_BATCH_SIZE,
    exportIntervalMs: current.OTEL_EXPORT_INTERVAL_MS,
    maxQueueSize: current.OTEL_EXPORT_MAX_QUEUE_SIZE,
  };
}

/**
 * Get predictive prefetching configuration
 *
 * When enabled:
 * - Prefetches data based on access patterns (80% latency reduction)
 * - Background refresh keeps hot data in cache
 * - Circuit breaker prevents quota exhaustion
 * - Low concurrency (2) to avoid interfering with user requests
 *
 * Performance impact:
 * - Sequential operations: 70-80% latency reduction (read → analyze → chart)
 * - First 100 rows on open: Instant response after initial load
 * - Adjacent range reads: Prefetched and cached
 *
 * Safety:
 * - Min confidence threshold (default 0.5) prevents wasteful prefetches
 * - Circuit breaker opens at 30% failure rate
 * - Non-blocking - errors don't affect main operations
 */
export function getPrefetchConfig(): {
  enabled: boolean;
  minConfidence: number;
  concurrency: number;
  backgroundRefresh: boolean;
} {
  const current = ensureEnv();
  return {
    enabled: current.ENABLE_PREFETCH,
    minConfidence: current.PREFETCH_MIN_CONFIDENCE,
    concurrency: current.PREFETCH_CONCURRENCY,
    backgroundRefresh: current.PREFETCH_BACKGROUND_REFRESH,
  };
}
