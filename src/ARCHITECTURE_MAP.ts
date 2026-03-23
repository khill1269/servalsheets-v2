/**
 * ServalSheets — Architecture Map
 *
 * Machine-readable directory registry for codebase navigation.
 * Updated: 2026-03-23
 *
 * Purpose: Enable automated tooling, code generation, and dependency analysis.
 * Usage: Import ARCHITECTURE_MAP to discover modules, their purposes, and dependencies.
 */

export interface DirectoryEntry {
  /** Relative path from project root (e.g., 'src/handlers') */
  path: string;
  /** Brief purpose statement */
  purpose: string;
  /** Key files in this directory (up to 4) */
  keyFiles: string[];
  /** Direct dependency paths (relative to src/) */
  dependsOn: string[];
  /** Approximate line count (for reference) */
  lineCount: number;
  /** Whether this directory exports a public API */
  isPublic: boolean;
  /** Key exports/classes defined here */
  exports?: string[];
  /** Subdirectories with their purposes */
  subdirs?: Record<string, string>;
}

export const ARCHITECTURE_MAP: DirectoryEntry[] = [
  // ============================================================================
  // CORE INFRASTRUCTURE (Foundation layer)
  // ============================================================================

  {
    path: 'src/core',
    purpose: 'Core types, interfaces, error definitions, and domain abstractions',
    keyFiles: [
      'errors.ts',           // ErrorCode enum, typed error classes
      'intent.ts',           // Intent batching system
      'batch-compiler.ts',   // Converts intents to Google API batchUpdate calls
      'diff-engine.ts',      // 3-tier diff computation (METADATA/SAMPLE/FULL)
    ],
    dependsOn: ['schemas', 'types'],
    lineCount: 7424,
    isPublic: true,
    exports: ['ErrorCode', 'SheetNotFoundError', 'Intent', 'BatchCompiler', 'DiffEngine'],
  },

  {
    path: 'src/types',
    purpose: 'TypeScript type definitions and interfaces (non-Zod)',
    keyFiles: [
      'conflict.ts',         // Conflict detection interfaces
      'history.ts',          // HistoryEntry, SnapshotMetadata
      'impact.ts',           // ImpactAnalysis result types
      'keytar.d.ts',         // Node keytar type stubs
    ],
    dependsOn: ['core', 'schemas'],
    lineCount: 1907,
    isPublic: true,
  },

  {
    path: 'src/constants',
    purpose: 'Global constants (field masks, protocol version, icons)',
    keyFiles: [
      'protocol.ts',         // MCP protocol version (2025-11-25)
      'field-masks.ts',      // Google Sheets API field mask templates
      'server-icon.ts',      // SVG icon data
    ],
    dependsOn: [],
    lineCount: 248,
    isPublic: true,
  },

  {
    path: 'src/config',
    purpose: 'Configuration management (env vars, feature flags, defaults)',
    keyFiles: [
      'env.ts',              // Environment variable validation + defaults
      'constants.ts',        // Configuration constants (timeouts, limits)
      'federation-config.ts',// Federation server discovery
      'embedded-oauth.ts',   // OAuth flow configuration
    ],
    dependsOn: [],
    lineCount: 3133,
    isPublic: true,
    exports: ['getEnv', 'validateEnv', 'FederationConfig'],
  },

  // ============================================================================
  // VALIDATION & SCHEMAS (Input/output contract layer)
  // ============================================================================

  {
    path: 'src/schemas',
    purpose: 'Zod schemas for all 25 tools × 404 actions (discriminated unions)',
    keyFiles: [
      'index.ts',            // Re-exports + metadata (tool/action counts)
      'action-counts.ts',    // TOOL_COUNT=25, ACTION_COUNT=404 (source of truth)
      'action-metadata.ts',  // Action descriptions + categories
      'shared.ts',           // Common schema patterns (A1NotationSchema, etc.)
    ],
    dependsOn: ['core', 'types'],
    lineCount: 26051,
    isPublic: true,
    subdirs: {
      'advanced.ts': '31 actions for named ranges, protected ranges, banding, tables',
      'agent.ts': '8 actions for plan compilation, execution, rollback',
      'analyze.ts': '23 actions for comprehensive analysis, scouting, suggestions',
      'appsscript.ts': '19 actions for Apps Script API integration',
      'auth.ts': '5 actions for OAuth, SSO, token management',
      'bigquery.ts': '17 actions for BigQuery integration',
      'collaborate.ts': '41 actions for sharing, comments, versions',
      'composite.ts': '21 actions for multi-step operations',
      'compute.ts': '16 actions for statistics, regression, forecasting',
      'confirm.ts': '5 actions for elicitation wizards',
      'connectors.ts': '10 actions for external data connectors',
      'core.ts': '21 actions for spreadsheet lifecycle',
      'data.ts': '25 actions for cell reads/writes/queries',
      'dependencies.ts': '10 actions for impact analysis + scenario modeling',
      'dimensions.ts': '30 actions for rows/columns/freezing/sorting',
      'federation.ts': '4 actions for remote MCP calls',
      'fix.ts': '6 actions for data cleaning',
      'format.ts': '25 actions for cell styling',
      'history.ts': '10 actions for undo/redo/revisions',
      'quality.ts': '4 actions for validation and conflict detection',
      'session.ts': '31 actions for context management',
      'templates.ts': '8 actions for reusable templates',
      'transaction.ts': '6 actions for atomic operations',
      'visualize.ts': '18 actions for charts and pivots',
      'webhook.ts': '10 actions for change notifications',
    },
  },

  // ============================================================================
  // REQUEST HANDLING (Tool dispatch layer)
  // ============================================================================

  {
    path: 'src/handlers',
    purpose: '25 tool handlers (13 BaseHandler subclasses + 12 standalone)',
    keyFiles: [
      'base.ts',             // BaseHandler abstract class (1640 lines)
      'core.ts',             // SheetsCoreHandler (775 lines)
      'data.ts',             // SheetsDataHandler (366 lines)
      'analyze.ts',          // AnalyzeHandler (1197 lines)',
    ],
    dependsOn: ['schemas', 'services', 'core', 'utils', 'mcp'],
    lineCount: 26024,
    isPublic: true,
    subdirs: {
      'advanced-actions/': 'Action handlers for named ranges, banding, tables',
      'analyze-actions/': 'Action handlers for comprehensive, scout, suggestions',
      'appsscript-actions/': 'Action handlers for Apps Script API calls',
      'bigquery-actions/': 'Action handlers for BigQuery integration',
      'collaborate-actions/': 'Action handlers for sharing, comments, versions',
      'composite-actions/': 'Action handlers for multi-step operations',
      'compute-actions/': 'Action handlers for statistical analysis',
      'core-actions/': 'Action handlers for spreadsheet CRUD',
      'data-actions/': 'Action handlers for cell reads/writes',
      'dimensions-actions/': 'Action handlers for rows/columns/freezing',
      'format-actions/': 'Action handlers for cell styling',
      'helpers/': 'Shared handler utilities (error mapping, verbosity filters)',
      'visualize-actions/': 'Action handlers for charts and pivots',
    },
  },

  // ============================================================================
  // BUSINESS LOGIC (Service layer)
  // ============================================================================

  {
    path: 'src/services',
    purpose: 'Business logic services (Google API, caching, batch operations, analysis)',
    keyFiles: [
      'google-api.ts',             // GoogleApiClient (retry, circuit breaker, HTTP/2)
      'cached-sheets-api.ts',      // ETag-based caching (5-min TTL)
      'batching-system.ts',        // Adaptive batch window (20-200ms)
      'parallel-executor.ts',      // Concurrent range fetching (20 workers)
    ],
    dependsOn: ['core', 'config', 'utils', 'schemas', 'observability'],
    lineCount: 50291,
    isPublic: true,
    subdirs: {
      'agent/': 'Agent engine services (plan compilation, execution, rollback)',
      'metrics/': 'Performance metrics collection',
    },
    exports: [
      'GoogleApiClient',
      'CachedSheetsApi',
      'BatchCompiler',
      'ParallelExecutor',
      'CompositeOperationsService',
      'CleaningEngine',
      'HistoryService',
      'SessionContextManager',
    ],
  },

  // ============================================================================
  // ANALYSIS ENGINE (Advanced computation)
  // ============================================================================

  {
    path: 'src/analysis',
    purpose: 'Data analysis, formula parsing, structure understanding (43 feature categories)',
    keyFiles: [
      'comprehensive.ts',         // Full 40-feature analysis (67K lines)
      'confidence-scorer.ts',     // Analysis quality scoring
      'flow-orchestrator.ts',     // Multi-step analysis pipelines
      'tiered-retrieval.ts',      // 4-level smart data loading',
    ],
    dependsOn: ['services', 'core', 'types', 'utils'],
    lineCount: 13893,
    isPublic: false,
  },

  // ============================================================================
  // MCP PROTOCOL (Protocol compliance layer)
  // ============================================================================

  {
    path: 'src/mcp',
    purpose: 'MCP protocol features (sampling, elicitation, resources, prompts)',
    keyFiles: [
      'sampling.ts',         // MCP Sampling (SEP-1577): AI analysis consent
      'elicitation.ts',      // MCP Elicitation (SEP-1036): wizards + forms
      'completions.ts',      // Autocomplete hints (spreadsheetId, range, connectorId)
      'features-2025-11-25.ts', // Server instructions + icons for 25 tools',
    ],
    dependsOn: ['core', 'schemas', 'services'],
    lineCount: 5635,
    isPublic: true,
    subdirs: {
      'registration/': 'Tool, resource, and prompt registration with MCP server',
    },
  },

  // ============================================================================
  // MIDDLEWARE & SECURITY
  // ============================================================================

  {
    path: 'src/middleware',
    purpose: 'Request preprocessing (audit, rate limiting, mutation safety, idempotency)',
    keyFiles: [
      'audit-middleware.ts',      // Mutation logging + change tracking
      'mutation-safety-middleware.ts', // Write-lock + snapshot before mutations
      'rate-limit-middleware.ts',  // Per-user + per-action throttling
      'idempotency-middleware.ts', // Idempotency keys for retry safety',
    ],
    dependsOn: ['core', 'config', 'services'],
    lineCount: 2405,
    isPublic: false,
  },

  {
    path: 'src/security',
    purpose: 'Security enforcement (SAML, incremental scopes, tool integrity)',
    keyFiles: [
      'tool-hash-registry.ts',     // Transport-dependent tool verification
      'incremental-scope.ts',      // OAuth scope management
      'resource-indicators.ts',    // Resource classification (public/confidential)
      'saml-provider.ts',          // SAML 2.0 service provider',
    ],
    dependsOn: ['core', 'config', 'auth'],
    lineCount: 3742,
    isPublic: false,
  },

  // ============================================================================
  // AUTHENTICATION & AUTHORIZATION
  // ============================================================================

  {
    path: 'src/auth',
    purpose: 'Authentication backends (SAML, OAuth)',
    keyFiles: [
      'saml-provider.ts',    // SAML 2.0 SSO with JWT token issuance
    ],
    dependsOn: ['config', 'core'],
    lineCount: 522,
    isPublic: true,
  },

  // ============================================================================
  // HTTP & SERVER INFRASTRUCTURE
  // ============================================================================

  {
    path: 'src/server',
    purpose: 'MCP server entry points (STDIO + HTTP)',
    keyFiles: [
      'bootstrap.ts',             // Server initialization
      'handler-dispatch.ts',      // Tool call routing
      'connection-health-check.ts', // Keepalive probe',
      'health-monitor.ts',        // Service health status',
    ],
    dependsOn: ['handlers', 'mcp', 'middleware', 'config'],
    lineCount: 3136,
    isPublic: false,
  },

  {
    path: 'src/http-server',
    purpose: 'HTTP/Express server (SSE, GraphQL admin, API routes)',
    keyFiles: [
      'routes-api.ts',           // API routes (health, metrics, readiness)
      'graphql-admin.ts',        // Admin GraphQL endpoint
      'routes-observability.ts', // Metrics export (Prometheus, OTLP)
      'middleware.ts',           // Express middleware (CORS, logging, compression)',
    ],
    dependsOn: ['server', 'observability', 'graphql'],
    lineCount: 2763,
    isPublic: false,
  },

  {
    path: 'src/server-runtime',
    purpose: 'Server lifecycle management (bootstrap, control plane, handler dispatch)',
    keyFiles: [
      'bootstrap.ts',           // Server startup sequence
      'handler-dispatch.ts',    // Tool call routing logic
      'control-plane-registration.ts', // Registration with management plane',
    ],
    dependsOn: ['handlers', 'config'],
    lineCount: 747,
    isPublic: false,
  },

  {
    path: 'src/server-utils',
    purpose: 'Server utilities (logging bridge, request extraction)',
    keyFiles: [
      'logging-bridge-utils.ts',  // Structured logging helpers
      'request-extraction.ts',    // Tool call parameter parsing',
    ],
    dependsOn: ['core', 'utils'],
    lineCount: 256,
    isPublic: false,
  },

  // ============================================================================
  // RUNTIME & LIFECYCLE
  // ============================================================================

  {
    path: 'src/startup',
    purpose: 'Server startup sequence and initialization checks',
    keyFiles: [
      'lifecycle.ts',             // Server lifecycle hooks
      'preflight-validation.ts',  // Pre-flight checks (schema, credentials)
      'performance-init.ts',      // Performance optimization setup',
    ],
    dependsOn: ['config', 'services', 'schemas'],
    lineCount: 1613,
    isPublic: false,
  },

  // ============================================================================
  // STORAGE & STATE MANAGEMENT
  // ============================================================================

  {
    path: 'src/storage',
    purpose: 'Persistent state (session store, task store)',
    keyFiles: [
      'session-store.ts',    // Session persistence (Redis/in-memory)
      'session-manager.ts',  // Session lifecycle management',
    ],
    dependsOn: ['config', 'core'],
    lineCount: 787,
    isPublic: false,
  },

  // ============================================================================
  // OBSERVABILITY & METRICS
  // ============================================================================

  {
    path: 'src/observability',
    purpose: 'Metrics, tracing, and SLI/SLO monitoring',
    keyFiles: [
      'metrics.ts',          // Prometheus metrics collection
      'otel-setup.ts',       // OpenTelemetry initialization
      'sli-slo.ts',          // SLI/SLO definitions',
    ],
    dependsOn: ['config', 'core'],
    lineCount: 1945,
    isPublic: true,
  },

  // ============================================================================
  // EXTERNAL INTEGRATIONS
  // ============================================================================

  {
    path: 'src/connectors',
    purpose: 'External data connectors (Finnhub, FRED, Alpha Vantage, Polygon, FMP)',
    keyFiles: [
      'connector-manager.ts',  // Connector registry + lifecycle
      'alpha-vantage.ts',      // Stock/forex data
      'finnhub.ts',            // Financial data
      'fred.ts',               // Economic indicators',
    ],
    dependsOn: ['config', 'core', 'services'],
    lineCount: 6876,
    isPublic: true,
  },

  {
    path: 'src/adapters',
    purpose: 'Backend adapters (Google Sheets, Excel, Notion, Airtable)',
    keyFiles: [
      'google-sheets-backend.ts', // Primary Google Sheets integration
      'excel-online-backend.ts',  // Microsoft Excel Online adapter
      'notion-backend.ts',        // Notion database adapter
      'airtable-backend.ts',      // Airtable base adapter',
    ],
    dependsOn: ['services', 'core', 'types'],
    lineCount: 3034,
    isPublic: true,
  },

  // ============================================================================
  // RESOURCES & KNOWLEDGE
  // ============================================================================

  {
    path: 'src/resources',
    purpose: 'MCP resources (read-only data accessible to client)',
    keyFiles: [
      'analyze.ts',                   // Analysis result resources
      'confirm.ts',                   // Confirmation prompt resources
      'charts.ts',                    // Chart definition resources
      'composite-operation-dispatcher.ts', // Operation dispatch helpers',
    ],
    dependsOn: ['schemas', 'services'],
    lineCount: 11499,
    isPublic: true,
  },

  {
    path: 'src/knowledge',
    purpose: 'Knowledge base (API docs, workflow guides, best practices)',
    keyFiles: [
      'DELIVERABLES.md',      // Feature deliverables
      'api/',                 // API reference documentation
      'common-workflows.json', // Common workflow patterns',
    ],
    dependsOn: [],
    lineCount: 0,
    isPublic: true,
  },

  // ============================================================================
  // CLI & ADMIN TOOLS
  // ============================================================================

  {
    path: 'src/cli',
    purpose: 'Command-line interface (auth setup, replay)',
    keyFiles: [
      'index.ts',        // CLI entry point
      'auth-setup.ts',   // OAuth flow setup
      'replay.ts',       // Request replay for debugging',
    ],
    dependsOn: ['auth', 'config', 'services'],
    lineCount: 1468,
    isPublic: true,
  },

  {
    path: 'src/admin',
    purpose: 'Admin dashboard (metrics, logs, config)',
    keyFiles: [
      'routes.ts',       // Admin route handlers
      'dashboard.html',  // Dashboard UI
      'dashboard.js',    // Dashboard logic',
    ],
    dependsOn: ['http-server', 'observability'],
    lineCount: 227,
    isPublic: false,
  },

  // ============================================================================
  // GRAPHQL API
  // ============================================================================

  {
    path: 'src/graphql',
    purpose: 'GraphQL schema and resolvers (admin introspection)',
    keyFiles: [
      'schema.ts',    // GraphQL schema definition
      'resolvers.ts', // Resolver implementations',
    ],
    dependsOn: ['schemas', 'services'],
    lineCount: 982,
    isPublic: false,
  },

  // ============================================================================
  // UTILITIES & HELPERS
  // ============================================================================

  {
    path: 'src/utils',
    purpose: 'Shared utilities (retry, circuit breaker, caching, auth)',
    keyFiles: [
      'retry.ts',                    // Exponential backoff + jitter
      'circuit-breaker.ts',          // Failure threshold + auto-recovery
      'auth-guard.ts',               // Request authentication + authorization
      'api-key-server.ts',           // OAuth credentials HTTP server',
    ],
    dependsOn: ['core', 'config'],
    lineCount: 16646,
    isPublic: true,
  },

  // ============================================================================
  // WORKERS & ASYNC PROCESSING
  // ============================================================================

  {
    path: 'src/workers',
    purpose: 'Worker threads (formula parsing, analysis, DuckDB queries)',
    keyFiles: [
      'worker-runner.ts',          // Worker lifecycle management
      'formula-parser-worker.ts',  // Formula AST parsing in worker thread
      'analysis-worker.ts',        // Expensive analysis tasks',
    ],
    dependsOn: ['config', 'core', 'utils'],
    lineCount: 817,
    isPublic: false,
  },

  // ============================================================================
  // CODE GENERATION & VERSIONING
  // ============================================================================

  {
    path: 'src/generated',
    purpose: 'Auto-generated metadata (DO NOT EDIT)',
    keyFiles: [
      'action-counts.ts',     // ACTION_COUNT=404, TOOL_COUNT=25 (source of truth)
      'annotations.ts',       // Tool categories and annotations
      'completions.ts',       // Autocomplete data
      'manifest.json',        // MCP manifest',
    ],
    dependsOn: [],
    lineCount: 12030,
    isPublic: true,
  },

  {
    path: 'src/versioning',
    purpose: 'Schema versioning and migration utilities',
    keyFiles: [
      'migration-utils.ts',   // Schema migration helpers
      'schema-manager.ts',    // Version management
      'v1-compat.ts',         // Backward compatibility layer',
    ],
    dependsOn: ['schemas', 'core'],
    lineCount: 439,
    isPublic: false,
  },

  // ============================================================================
  // DEPENDENCY INJECTION & COMPOSITION
  // ============================================================================

  {
    path: 'src/di',
    purpose: 'Dependency injection container (service composition)',
    keyFiles: [
      'container.ts',    // DI container for service wiring',
    ],
    dependsOn: ['services', 'config'],
    lineCount: 287,
    isPublic: false,
  },

  // ============================================================================
  // USER INTERFACE (Client-facing)
  // ============================================================================

  {
    path: 'src/ui',
    purpose: 'User interface components (tracing dashboard, etc.)',
    keyFiles: [
      'tracing-dashboard/', // Request tracing visualization',
    ],
    dependsOn: [],
    lineCount: 0,
    isPublic: true,
  },

  // ============================================================================
  // TEMPLATES
  // ============================================================================

  {
    path: 'src/templates',
    purpose: 'Code templates (Apps Script generator)',
    keyFiles: [
      'serval-function.gs',  // Apps Script template',
    ],
    dependsOn: [],
    lineCount: 0,
    isPublic: false,
  },
];

// ============================================================================
// DEPENDENCY ANALYSIS HELPERS
// ============================================================================

/**
 * Get all transitive dependencies for a directory
 */
export function getTransitiveDependencies(
  startPath: string,
  map: DirectoryEntry[] = ARCHITECTURE_MAP
): Set<string> {
  const visited = new Set<string>();
  const queue = [startPath];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;

    visited.add(current);
    const entry = map.find((e) => e.path === `src/${current}`);
    if (entry) {
      entry.dependsOn.forEach((dep) => {
        if (!visited.has(dep)) {
          queue.push(dep);
        }
      });
    }
  }

  visited.delete(startPath);
  return visited;
}

/**
 * Check if directory A depends on directory B
 */
export function hasDependency(
  fromPath: string,
  toPath: string,
  map: DirectoryEntry[] = ARCHITECTURE_MAP
): boolean {
  const transitive = getTransitiveDependencies(fromPath, map);
  return transitive.has(toPath);
}

/**
 * Get entry by path
 */
export function findDirectory(
  path: string,
  map: DirectoryEntry[] = ARCHITECTURE_MAP
): DirectoryEntry | undefined {
  return map.find((e) => e.path === path || e.path === `src/${path}`);
}

/**
 * Get all public API directories
 */
export function getPublicDirectories(
  map: DirectoryEntry[] = ARCHITECTURE_MAP
): DirectoryEntry[] {
  return map.filter((e) => e.isPublic);
}

/**
 * Get all directories that depend on a given path
 */
export function getReverseDependencies(
  targetPath: string,
  map: DirectoryEntry[] = ARCHITECTURE_MAP
): DirectoryEntry[] {
  const normalizedTarget = targetPath.startsWith('src/') ? targetPath.slice(4) : targetPath;
  return map.filter((e) => e.dependsOn.some((d) => d === normalizedTarget));
}
