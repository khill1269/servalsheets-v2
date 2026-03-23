/**
 * ServalSheets - Configuration Constants
 *
 * Centralized configuration values and magic numbers
 */

import path from 'path';

// ============================================================================
// Cache TTLs (in milliseconds)
// ============================================================================
//
// CACHE TTL ALIGNMENT STRATEGY:
// All cache TTLs are aligned to 5 minutes (300000ms) to:
// 1. Reduce cache misses by keeping data in cache longer
// 2. Minimize cache thrashing from different subsystems expiring at different times
// 3. Improve cache coherency across spreadsheet metadata, values, and analysis
// 4. Reduce API calls to Google Sheets by maximizing cache reuse
//
// Rationale: Spreadsheet data is relatively stable, and 5-minute staleness is
// acceptable for most use cases. Users working on the same spreadsheet will
// benefit from shared cache entries that remain valid longer.
//
// Related: RESULT_CACHE_TTL in request-deduplication.ts also set to 300000ms
//          CACHE_DEFAULT_TTL in cache-manager.ts also set to 300000ms
// ============================================================================

/** Cache TTL for spreadsheet metadata (5 minutes) - baseline for all cache TTLs */
export const CACHE_TTL_SPREADSHEET = 300000;

/** Cache TTL for cell values (5 minutes) - aligned with spreadsheet metadata TTL for consistency */
export const CACHE_TTL_VALUES = 300000;

/** Cache TTL for analysis results (5 minutes) - aligned with spreadsheet metadata TTL for consistency */
export const CACHE_TTL_ANALYSIS = 300000;

/** Cache cleanup interval (5 minutes) - aligned with cache TTLs to avoid premature eviction */
export const CACHE_CLEANUP_INTERVAL = 300000;

// ============================================================================
// Session and Security Limits
// ============================================================================

/** Maximum concurrent sessions per user */
export const MAX_SESSIONS_PER_USER = parseInt(process.env['MAX_SESSIONS_PER_USER'] ?? '5', 10);

/** Maximum total active sessions */
export const MAX_TOTAL_SESSIONS = parseInt(process.env['MAX_TOTAL_SESSIONS'] ?? '100', 10);

/** OAuth authorization code TTL (10 minutes, in seconds) */
export const OAUTH_AUTH_CODE_TTL = 600;

/** OAuth access token TTL (1 hour, in seconds) */
export const OAUTH_ACCESS_TOKEN_TTL = 3600;

/** OAuth refresh token TTL (30 days, in seconds) */
export const OAUTH_REFRESH_TOKEN_TTL = 2592000;

/** OAuth state token TTL (5 minutes, in seconds) */
export const OAUTH_STATE_TTL = 300;

// ============================================================================
// Rate Limiting
// ============================================================================

/** Rate limit window (1 minute, in milliseconds) */
export const RATE_LIMIT_WINDOW_MS = 60000;

/** Max requests per rate limit window */
export const RATE_LIMIT_MAX = 100;

/**
 * Google Sheets API rate limit: 60 read/write requests per minute per user per project.
 * NOTE: This constant is informational only — no rate limiter currently enforces it.
 * Quota enforcement relies on Google's 429 responses handled by retry logic in google-api.ts.
 */
export const GOOGLE_API_RATE_LIMIT = 60;

// ============================================================================
// Request Processing
// ============================================================================

/** Maximum concurrent requests */
export const MAX_CONCURRENT_REQUESTS = parseInt(process.env['MAX_CONCURRENT_REQUESTS'] ?? '10', 10);

/** Graceful shutdown timeout (10 seconds, in milliseconds) */
export const SHUTDOWN_TIMEOUT = 10000;

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Codebase-imposed batch limit for batchUpdate operations.
 *
 * Note: Google does not document an explicit per-call request count limit for
 * spreadsheets.batchUpdate. This is a codebase-imposed limit to keep payloads
 * under the ~2 MB recommended size and avoid timeout issues.
 *
 * @see https://developers.google.com/workspace/sheets/api/limits
 */
export const GOOGLE_SHEETS_MAX_BATCH_REQUESTS = 100;

/** Codebase-imposed batch size limit for batchUpdate operations */
export const MAX_BATCH_SIZE = 100;

/** Chunk size for large operations */
export const CHUNK_SIZE = 100;

// ============================================================================
// Retry Configuration
// ============================================================================

/** Base delay for exponential backoff (1 second, in milliseconds) */
export const RETRY_BASE_DELAY = 1000;

/** Maximum retry attempts */
export const MAX_RETRY_ATTEMPTS = 3;

/** Maximum backoff delay (32 seconds, in milliseconds) */
export const MAX_BACKOFF_DELAY = 32000;

// ============================================================================
// Circuit Breaker
// ============================================================================

/** Circuit breaker failure threshold */
export const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Circuit breaker timeout (60 seconds, in milliseconds) */
export const CIRCUIT_BREAKER_TIMEOUT = 60000;

// ============================================================================
// Monitoring and Health
// ============================================================================

/** Health check heartbeat interval (30 seconds, in milliseconds) */
export const HEARTBEAT_INTERVAL = 30000;

/** Connection health check timeout (5 minutes, in milliseconds) */
export const CONNECTION_TIMEOUT = 300000;

// ============================================================================
// HTTP Server Defaults
// ============================================================================

/** Default HTTP server port */
export const DEFAULT_HTTP_PORT = 3000;

/** Default HTTP server host */
export const DEFAULT_HTTP_HOST = '127.0.0.1';

/** Maximum HTTP request body size */
export const MAX_REQUEST_BODY_SIZE = '10mb';

/** Compression threshold (1KB) */
export const COMPRESSION_THRESHOLD = 1024;

// ============================================================================
// Response Size Limits (MCP 2025-11-25 Best Practices)
// ============================================================================

/**
 * Maximum response size before using resource URIs (1MB)
 *
 * Rationale: Large responses (>1MB) should be stored as MCP resources
 * and returned as URIs instead of inline data to avoid:
 * - JavaScript string length limits (~536MB)
 * - JSON serialization performance issues
 * - Client memory pressure
 * - Network transfer overhead
 *
 * When comprehensive analysis exceeds this limit, results are stored
 * in analyze://results/{id} and a URI is returned instead.
 */
export const MAX_RESPONSE_SIZE_BYTES = 1024 * 1024; // 1MB

/**
 * Maximum response size for inline data (5MB)
 *
 * Hard limit - responses larger than this will fail serialization.
 * Used as a safety check before attempting JSON.stringify().
 */
export const MAX_INLINE_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Maximum rows before requiring pagination or resource URIs
 */
export const MAX_ROWS_INLINE = 10000;

/**
 * Maximum sheets before requiring pagination
 */
export const MAX_SHEETS_INLINE = 20;

/**
 * Default page size for paginated responses
 */
export const DEFAULT_PAGE_SIZE = 5;

/**
 * Maximum page size for paginated responses
 */
export const MAX_PAGE_SIZE = 50;

/**
 * Deferred schema loading mode
 *
 * When enabled, tools are registered with minimal "passthrough" schemas
 * instead of full schemas. Full schemas are exposed via MCP resources
 * (schema://tools/{toolName}) for on-demand loading.
 *
 * Benefits:
 * - Reduces initial tools/list payload from ~231KB to ~5KB
 * - All 25 tools available immediately
 * - Claude fetches full schema only when needed via resources
 * - Optimal for Claude Desktop and other token-conscious clients
 *
 * Trade-offs:
 * - Claude must read schema resource before calling complex tools
 * - Server instructions guide this behavior
 *
 * Auto-detection:
 * - STDIO transport (default): auto-enabled (Claude Desktop optimization)
 * - HTTP transport (--http flag OR http-server.ts entry point): disabled by default
 * - Override: SERVAL_DEFER_SCHEMAS=true|false always takes precedence
 *
 * NOTE: The --http argv check alone is insufficient when http-server.ts is the
 * entry point (e.g., `node dist/http-server.js`) because cli.ts never propagates
 * the --http flag to process.argv. We also check process.argv[1] for 'http-server'.
 */
function resolveDeferSchemas(): boolean {
  const envVal = process.env['SERVAL_DEFER_SCHEMAS'];
  // Explicit env var takes precedence
  if (envVal === 'true') return true;
  if (envVal === 'false') return false;
  // Auto-detect: --http flag OR http-server.ts entry point
  const entry = path.basename(process.argv[1] ?? '');
  const isHttp =
    process.argv.includes('--http') || entry === 'http-server.js' || entry === 'http-server.ts';
  return !isHttp;
}
export const DEFER_SCHEMAS = resolveDeferSchemas();

/**
 * Deferred description loading mode
 *
 * When enabled, tools are registered with minimal ~100 char descriptions
 * instead of full ~1000+ char descriptions. Full documentation available via:
 * - schema://tools/{toolName} - Full schemas with examples
 * - resource://skill/servalsheets - Comprehensive SKILL.md guide
 *
 * Benefits:
 * - Reduces tool description payload from ~31KB to ~3KB (~90% reduction)
 * - ~7,700 tokens saved per conversation
 * - All 25 tools available with essential routing info
 * - Full docs available on-demand via resources
 *
 * Trade-offs:
 * - Less detailed routing hints in tool descriptions
 * - Claude should read SKILL.md resource for complex operations
 *
 * Set via SERVAL_DEFER_DESCRIPTIONS=true environment variable.
 *
 * Recommended Claude Desktop configuration:
 *   "SERVAL_DEFER_DESCRIPTIONS": "true"
 */
function resolveDeferDescriptions(): boolean {
  const envVal = process.env['SERVAL_DEFER_DESCRIPTIONS'];
  // Explicit env var takes precedence
  if (envVal === 'true') return true;
  if (envVal === 'false') return false;
  // Auto-detect: enable for STDIO (Claude Desktop optimization), disable for HTTP
  const isHttp = process.argv.includes('--http');
  return !isHttp;
}
export const DEFER_DESCRIPTIONS = resolveDeferDescriptions();

/**
 * Strip inline descriptions from JSON schemas
 *
 * When enabled, removes the "description" field from JSON Schema properties.
 * This saves ~14,000 tokens by removing inline `.describe()` content from schemas
 * while keeping the top-level tool descriptions intact.
 *
 * Benefits:
 * - Saves ~14,000 tokens (~7% of 200K context)
 * - Schemas still fully functional (validation works without descriptions)
 * - Tool descriptions still provide action routing info
 *
 * Trade-offs:
 * - No inline parameter documentation in schemas
 * - Claude relies on tool descriptions and examples for parameter guidance
 *
 * Best combined with SERVAL_SCHEMA_REFS=true for maximum savings (~60% + 14K tokens).
 *
 * Set via SERVAL_STRIP_SCHEMA_DESCRIPTIONS=true environment variable.
 */
export const STRIP_SCHEMA_DESCRIPTIONS = process.env['SERVAL_STRIP_SCHEMA_DESCRIPTIONS'] === 'true';

// ============================================================================
// Stage-Based Tool Registration
// ============================================================================

/**
 * Tool registration stages
 *
 * When enabled, tools are registered in stages to reduce initial payload:
 * - Stage 1 (bootstrap): Auth, core, session, analyze — always registered immediately
 * - Stage 2 (active): Data, format, dimensions — registered after a spreadsheet is active
 * - Stage 3 (full): All remaining tools — registered on demand or after first tool call
 *
 * Benefits:
 * - Stage 1 payload is ~40% of full payload (~4 tools vs 24)
 * - LLM gets essential tools instantly, remaining tools arrive via tools/list_changed
 * - Backwards-compatible: disabled by default (all tools registered at once)
 *
 * Set via SERVAL_STAGED_REGISTRATION=true environment variable.
 */
export const STAGED_REGISTRATION = process.env['SERVAL_STAGED_REGISTRATION'] === 'true';

export type ToolStage = 1 | 2 | 3;

/** Stage 1: Bootstrap tools — always available, no auth required for discovery */
export const STAGE_1_TOOLS = [
  'sheets_auth',
  'sheets_core',
  'sheets_session',
  'sheets_analyze',
  'sheets_confirm',
] as const;

/** Stage 2: Active spreadsheet tools — registered after session.set_active or first spreadsheetId */
export const STAGE_2_TOOLS = [
  'sheets_data',
  'sheets_format',
  'sheets_dimensions',
  'sheets_history',
  'sheets_quality',
  'sheets_fix',
] as const;

/** Stage 3: Full tools — all remaining tools, registered on demand */
export const STAGE_3_TOOLS = [
  'sheets_visualize',
  'sheets_collaborate',
  'sheets_advanced',
  'sheets_transaction',
  'sheets_composite',
  'sheets_templates',
  'sheets_bigquery',
  'sheets_appsscript',
  'sheets_webhook',
  'sheets_dependencies',
  'sheets_federation',
  'sheets_compute',
  'sheets_agent',
] as const;

/**
 * Get the stage a tool belongs to.
 * Returns 1, 2, or 3.
 */
export function getToolStage(toolName: string): ToolStage {
  if ((STAGE_1_TOOLS as readonly string[]).includes(toolName)) return 1;
  if ((STAGE_2_TOOLS as readonly string[]).includes(toolName)) return 2;
  return 3;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert seconds to milliseconds
 */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

/**
 * Convert minutes to milliseconds
 */
export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

/**
 * Convert hours to milliseconds
 */
export function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

/**
 * Convert days to milliseconds
 */
export function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}
