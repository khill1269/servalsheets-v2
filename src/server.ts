/**
 * ServalSheets - MCP Server
 *
 * Main server class that registers all tools and resources
 * MCP Protocol: 2025-11-25
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryTaskMessageQueue } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import { type CallToolResult, type LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type {
  ToolTaskHandler,
  TaskToolExecution,
} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import { TOOL_COUNT, ACTION_COUNT } from './schemas/index.js';
import { SERVER_ICONS } from './version.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as {
  version: string;
};
const PACKAGE_VERSION = packageJson.version;

function getProcessBreadcrumbs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      externalMb: Math.round(memory.external / 1024 / 1024),
    },
    ...extra,
  };
}

function shouldAllowDegradedGoogleStartup(error: unknown): boolean {
  const transport = process.env['MCP_TRANSPORT'];
  const allowDegradedExplicitly = process.env['SERVAL_ALLOW_DEGRADED_STARTUP'] === 'true';
  const allowDegradedByTransport =
    transport === 'stdio' || process.env['NODE_ENV'] === 'test' || allowDegradedExplicitly;

  if (!allowDegradedByTransport) {
    return false;
  }

  if (isGoogleAuthError(error)) {
    return true;
  }

  const message =
    error instanceof Error
      ? `${error.name} ${error.message} ${error.stack ?? ''}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  const normalized = message.toLowerCase();

  return [
    'google',
    'oauth',
    'credential',
    'token',
    'network',
    'enotfound',
    'eai_again',
    'econn',
    'fetch failed',
    'invalid_grant',
    'unauthenticated',
    'permission denied',
    'could not load the default credentials',
  ].some((pattern) => normalized.includes(pattern));
}

import PQueue from 'p-queue';
import {
  createServerCapabilities,
  SERVER_INSTRUCTIONS,
  TOOL_ICONS,
  TOOL_EXECUTION_CONFIG,
} from './mcp/features-2025-11-25.js';
import { validateToolCatalogConfiguration } from './mcp/tool-catalog.js';
import { recordToolCall, updateQueueMetrics, quotaWarningsTotal } from './observability/metrics.js';
import { initTelemetry } from './observability/otel-setup.js';

import {
  BatchCompiler,
  RateLimiter,
  DiffEngine,
  PolicyEnforcer,
  RangeResolver,
  TaskStoreAdapter,
} from './core/index.js';

import { SnapshotService, GoogleApiClient, createGoogleApiClient } from './services/index.js';
import type { GoogleApiClientOptions } from './services/google-api.js';
// Removed: initWorkflowEngine (Claude orchestrates natively via MCP)
// Removed: initPlanningAgent, initInsightsService (replaced by MCP-native Elicitation/Sampling)
import { initTransactionManager } from './services/transaction-manager.js';
import { initConflictDetector } from './services/conflict-detector.js';
import { initImpactAnalyzer } from './services/impact-analyzer.js';
import { initValidationEngine } from './services/validation-engine.js';
import { initWebhookManager } from './services/webhook-manager.js';
import { initWebhookQueue } from './services/webhook-queue.js';
import { DuckDBEngine } from './services/duckdb-engine.js';
import { SchedulerService } from './services/scheduler.js';
import {
  createHandlers,
  type HandlerContext,
  type HandlerMcpServer,
  type Handlers,
} from './handlers/index.js';
import { getCostTracker } from './services/cost-tracker.js';
import { initializeBillingIntegration } from './services/billing-integration.js';
import { createMetadataCache } from './services/metadata-cache.js';
import { GoogleSheetsBackend } from './adapters/index.js';
import { AuthHandler } from './handlers/auth.js';
import {
  checkAuthAsync,
  buildAuthErrorResponse,
  isGoogleAuthError,
  convertGoogleAuthError,
} from './utils/auth-guard.js';
import { logger as baseLogger } from './utils/logger.js';
import {
  createRequestContext,
  createRequestAbortError,
  runWithRequestContext,
  sendProgress,
  type RelatedRequestSender,
  type TaskStatusUpdater,
} from './utils/request-context.js';
import { extractIdempotencyKeyFromHeaders } from './utils/idempotency-key-generator.js';
import { TOOL_DEFINITIONS, isToolCallAuthExempt } from './mcp/registration/tool-definitions.js';
import { createTaskAwareSamplingServer } from './mcp/sampling.js';
import { buildToolResponse } from './mcp/registration/tool-handlers.js';
import { registerToolsListCompatibilityHandler } from './mcp/registration/tools-list-compat.js';
import { recordSpreadsheetId } from './mcp/completions.js';
import { resourceNotifications, teardownResourceNotifications } from './resources/notifications.js';
import { cacheManager } from './utils/cache-manager.js';
import { requestDeduplicator } from './utils/request-deduplication.js';
import {
  createHealthMonitor,
  createHeapHealthCheck,
  createConnectionHealthCheck,
  type HealthMonitor,
} from './server/index.js';
import { cleanupAllResources } from './utils/resource-cleanup.js';
import { disposeTemporaryResourceStore } from './resources/temporary-storage.js';
import { startHeapWatchdog } from './utils/heap-watchdog.js';
import { STAGED_REGISTRATION } from './config/constants.js';
import { toolStageManager } from './mcp/registration/tool-stage-manager.js';
import { getEnv, validateEnv } from './config/env.js';
import { resolveCostTrackingTenantId } from './utils/tenant-identification.js';
import { verifyToolIntegrity } from './security/tool-hash-registry.js';
import {
  initializeBuiltinConnectors,
  connectorManager,
  type SheetWriterFn,
} from './connectors/connector-manager.js';
import {
  extractActionFromArgs,
  extractPrincipalIdFromHeaders,
} from './server/request-extraction.js';
import {
  recordToolExecutionException,
  recordToolExecutionResult,
} from './server/tool-call-metrics.js';
import {
  handlePreInitExemptToolCall,
  handleSheetsAuthToolCall,
} from './server/preinit-tool-routing.js';
import { dispatchServerToolCall } from './server/handler-dispatch.js';
import { installServerLoggingBridge } from './server/logging-bridge.js';
import { createMcpLogRateLimitState } from './server/logging-bridge-utils.js';
import {
  ensureServerCompletionsRegistered,
  ensureServerResourcesRegistered,
  registerServerPrompts,
  registerServerResources,
} from './server/resource-registration.js';
import { prepareServerBootstrap } from './server/bootstrap.js';
import { ServiceError } from './core/errors.js';
import {
  registerServerLoggingSetLevelHandler,
  registerServerTaskCancelHandler,
} from './server/control-plane-registration.js';

export interface ServalSheetsServerOptions {
  name?: string;
  version?: string;
  googleApiOptions?: GoogleApiClientOptions;
  taskStore?: TaskStoreAdapter;
}

/**
 * ServalSheets MCP Server
 */
export class ServalSheetsServer {
  private _server: McpServer;
  private googleClient: GoogleApiClient | null = null;
  private authHandler: AuthHandler | null = null;
  private options: ServalSheetsServerOptions;
  private isShutdown = false;
  private handlers: Handlers | null = null;
  private context: HandlerContext | null = null;
  private requestQueue: PQueue;
  private taskStore: TaskStoreAdapter;
  private taskAbortControllers = new Map<string, AbortController>();
  private taskWatchdogTimers = new Map<string, NodeJS.Timeout>();
  private healthMonitor: HealthMonitor;
  private connectionHealthCheck: ReturnType<typeof createConnectionHealthCheck>;
  private requestedMcpLogLevel: LoggingLevel | null = null;
  private loggingBridgeInstalled = false;
  private forwardingMcpLog = false;
  private mcpLogRateLimitState = createMcpLogRateLimitState();
  private protectedInitializeRequestIds = new Set<string | number>();
  private toolIntegrityVerified = false;

  // Cached handler map (rebuilt only when handlers change)
  private cachedHandlerMap: Record<
    string,
    (args: unknown, extra?: unknown) => Promise<unknown>
  > | null = null;

  // Resource lazy loading state
  private resourcesRegistered = false;
  private resourceRegistrationPromise: Promise<void> | null = null;
  private resourceRegistrationFailed = false;

  constructor(options: ServalSheetsServerOptions = {}) {
    this.options = options;

    // Initialize task store for MCP 2025-11-25 Tasks support
    // Use provided taskStore or create default with InMemoryTaskStore
    this.taskStore = options.taskStore ?? new TaskStoreAdapter();

    // Create McpServer with MCP 2025-11-25 capabilities
    this._server = new McpServer(
      {
        name: options.name ?? 'servalsheets',
        version: options.version ?? PACKAGE_VERSION,
        icons: SERVER_ICONS,
        description:
          'Production-grade Google Sheets MCP server with AI-powered analysis, transactions, workflows, and enterprise features',
      },
      {
        // Server capabilities (logging, tasks, etc. - tools/prompts/resources auto-registered)
        capabilities: createServerCapabilities(),
        // Instructions for LLM context
        instructions: SERVER_INSTRUCTIONS,
        // Task support (MCP 2025-11-25) for tasks/get/list/result/cancel and task-capable tools
        taskStore: this.taskStore,
        taskMessageQueue: new InMemoryTaskMessageQueue(),
      }
    );
    this.installInitializeCancellationGuard();

    // Initialize request queue with concurrency limit
    const maxConcurrent = parseInt(process.env['MAX_CONCURRENT_REQUESTS'] ?? '10', 10);
    this.requestQueue = new PQueue({
      concurrency: maxConcurrent,
    });

    baseLogger.info('Request queue initialized', { maxConcurrent });

    // Initialize health monitoring with heap and connection checks
    this.connectionHealthCheck = createConnectionHealthCheck({
      disconnectThresholdMs: Number.parseInt(
        process.env['MCP_DISCONNECT_THRESHOLD_MS'] || '120000',
        10
      ),
      warnThresholdMs: Number.parseInt(process.env['MCP_WARN_THRESHOLD_MS'] || '60000', 10),
    });

    this.healthMonitor = createHealthMonitor({
      checks: [
        createHeapHealthCheck({
          warningThreshold: 0.7,
          criticalThreshold: 0.85,
          enableSnapshots: process.env['ENABLE_HEAP_SNAPSHOTS'] === 'true',
          snapshotPath: process.env['HEAP_SNAPSHOT_PATH'] || './heap-snapshots',
        }),
        this.connectionHealthCheck,
      ],
      autoStart: false, // Manual start in initialize()
    });
  }

  /**
   * MCP §1.5 forbids clients from cancelling `initialize`.
   * The SDK's generic cancellation path would otherwise abort the in-flight init
   * request before its response is emitted if a notifications/cancelled arrives
   * in the same read cycle.
   */
  private installInitializeCancellationGuard(): void {
    const rawServer = this._server.server as unknown as {
      _onrequest?: (
        request: { id?: string | number; method?: string },
        extra?: unknown
      ) => Promise<void> | void;
      _oncancel?: (notification: { params?: { requestId?: string | number } }) => unknown;
    };

    if (typeof rawServer._onrequest !== 'function' || typeof rawServer._oncancel !== 'function') {
      return;
    }

    const originalOnRequest = rawServer._onrequest.bind(rawServer);
    const originalOnCancel = rawServer._oncancel.bind(rawServer);

    rawServer._onrequest = (request, extra) => {
      if (request.method === 'initialize' && request.id !== undefined) {
        const requestId = request.id;
        this.protectedInitializeRequestIds.add(requestId);
        const finalize = () => {
          this.protectedInitializeRequestIds.delete(requestId);
        };

        try {
          const result = originalOnRequest(request, extra) as void | Promise<void>;
          if (result && typeof result.finally === 'function') {
            return result.finally(finalize);
          }
          setImmediate(finalize);
          return result;
        } catch (error) {
          finalize();
          throw error;
        }
      }

      return originalOnRequest(request, extra);
    };

    rawServer._oncancel = (notification) => {
      const requestId = notification.params?.requestId;
      if (requestId !== undefined && this.protectedInitializeRequestIds.has(requestId)) {
        baseLogger.warn('Ignoring cancellation for initialize request', { requestId });
        return;
      }

      return originalOnCancel(notification);
    };
  }

  private async ensureToolIntegrityVerified(): Promise<void> {
    if (this.toolIntegrityVerified) {
      return;
    }

    await verifyToolIntegrity();
    this.toolIntegrityVerified = true;
  }

  /**
   * Initialize the server
   */
  async initialize(): Promise<void> {
    await this.ensureToolIntegrityVerified();

    const envConfig = getEnv();
    validateToolCatalogConfiguration();
    const costTrackingEnabled =
      envConfig.ENABLE_COST_TRACKING || envConfig.ENABLE_BILLING_INTEGRATION;

    // Always create AuthHandler (it works even without googleClient)
    this.authHandler = new AuthHandler({
      googleClient: null, // Will be set after googleClient is created
    });

    // Initialize Google API client
    if (this.options.googleApiOptions) {
      try {
        this.googleClient = await createGoogleApiClient(this.options.googleApiOptions);
      } catch (error) {
        if (!shouldAllowDegradedGoogleStartup(error)) {
          throw error;
        }

        baseLogger.warn('Google client initialization failed; continuing in auth-only mode', {
          error: error instanceof Error ? error.message : String(error),
          transport: process.env['MCP_TRANSPORT'] ?? 'unknown',
          breadcrumbs: getProcessBreadcrumbs(),
        });
        this.googleClient = null;
      }
    }

    if (this.googleClient) {
      // Update AuthHandler with the initialized googleClient
      this.authHandler = new AuthHandler({
        googleClient: this.googleClient,
      });

      // Create SnapshotService for undo/revert operations
      const snapshotService = new SnapshotService({ driveApi: this.googleClient.drive });

      // Initialize all performance optimizations (batching, caching, merging, prefetching)
      const { initializePerformanceOptimizations } = await import('./startup/performance-init.js');
      const {
        batchingSystem,
        cachedSheetsApi,
        requestMerger,
        parallelExecutor,
        prefetchPredictor,
        accessPatternTracker,
        queryOptimizer,
        prefetchingSystem,
      } = await initializePerformanceOptimizations(this.googleClient.sheets);

      // Create reusable context and handlers
      // Local ref for closure capture in getter below
      const _googleClient = this.googleClient;
      const duckdbEngine = new DuckDBEngine();
      const scheduler = new SchedulerService(envConfig.DATA_DIR, async (job) => {
        const result = await this.handleToolCall(job.action.tool, {
          request: {
            action: job.action.actionName,
            ...job.action.params,
          },
        });

        const isError = (result as { isError?: boolean }).isError === true;
        if (isError) {
          throw new ServiceError(
            `Scheduled job ${job.id} failed for ${job.action.tool}`,
            'INTERNAL_ERROR',
            'scheduler'
          );
        }
      });

      // Create platform-agnostic backend adapter (wraps GoogleApiClient)
      const backend = new GoogleSheetsBackend(_googleClient);
      await backend.initialize();

      this.context = {
        backend, // Platform-agnostic SpreadsheetBackend from @serval/core
        batchCompiler: new BatchCompiler({
          rateLimiter: new RateLimiter(),
          diffEngine: new DiffEngine({ sheetsApi: this.googleClient.sheets }),
          policyEnforcer: new PolicyEnforcer(),
          snapshotService,
          sheetsApi: this.googleClient.sheets,
          onProgress: (event) => {
            // Send MCP progress notification
            void sendProgress(event.current, event.total, event.message);
          },
        }),
        rangeResolver: new RangeResolver({ sheetsApi: this.googleClient.sheets }),
        googleClient: this.googleClient, // For authentication checks in handlers
        batchingSystem, // Time-window batching system for reducing API calls
        cachedSheetsApi, // ETag-based caching for reads (30-50% API savings)
        requestMerger, // Phase 2: Merge overlapping read requests (20-40% API savings)
        parallelExecutor, // Phase 2: Parallel batch execution (40% faster batch ops)
        prefetchPredictor, // Phase 3: Predictive prefetching (200-500ms latency reduction)
        accessPatternTracker, // Phase 3: Access pattern learning for smarter predictions
        queryOptimizer, // Phase 3B: Adaptive query optimization (-25% avg latency)
        prefetchingSystem, // Pattern-based prefetching (80% latency reduction on sequential ops)
        snapshotService, // Pass to context for HistoryHandler undo/revert (Task 1.3)
        duckdbEngine, // Advanced SQL compute engine (Phase 1)
        scheduler, // Scheduled workflows (Phase 6)
        ...(costTrackingEnabled ? { costTracker: getCostTracker() } : {}),
        auth: {
          // Use getter to always read live value from GoogleApiClient
          // This ensures re-auth with broader scopes takes effect immediately
          get hasElevatedAccess() {
            return _googleClient.hasElevatedAccess;
          },
          // Use getter to always read live scopes from GoogleApiClient
          // This ensures re-auth with broader scopes takes effect immediately
          get scopes() {
            return _googleClient.scopes;
          },
        },
        samplingServer: createTaskAwareSamplingServer(this._server.server),
        elicitationServer: this._server.server,
        server: this._server.server as HandlerMcpServer, // Narrow bridge for elicitation/sampling only
        requestDeduplicator, // Pass request deduplicator for preventing duplicate API calls
        taskStore: this.taskStore, // For task-based execution (SEP-1686)
      };

      // QUOTA-01: Subscribe to CostTracker alerts and emit Prometheus metric at 80% quota
      this.context.costTracker?.on('alert', (alert: { type: string; tenantId: string }) => {
        if (alert.type === 'limit_approaching') {
          quotaWarningsTotal.inc({ tenantId: alert.tenantId });
          baseLogger.warn('API quota approaching monthly limit', { tenantId: alert.tenantId });
        }
      });

      const handlers = createHandlers({
        context: this.context,
        sheetsApi: this.googleClient.sheets,
        driveApi: this.googleClient.drive,
        bigqueryApi: this.googleClient.bigquery ?? undefined,
      });
      this.handlers = handlers;
      this.cachedHandlerMap = null; // Invalidate cached handler map

      if (envConfig.ENABLE_PYTHON_COMPUTE) {
        void import('./services/python-engine.js')
          .then(({ preloadPyodide }) => {
            preloadPyodide();
          })
          .catch((error) => {
            baseLogger.warn('Pyodide preload skipped due to initialization error', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }

      // Removed: initWorkflowEngine (Claude orchestrates natively via MCP)
      // Removed: initPlanningAgent, initInsightsService (replaced by MCP-native Elicitation/Sampling)

      // Initialize Phase 4 advanced features
      initTransactionManager(this.googleClient); // Phase 4, Task 4.1
      initConflictDetector(this.googleClient); // Phase 4, Task 4.2
      initImpactAnalyzer(this.googleClient); // Phase 4, Task 4.3
      initValidationEngine(this.googleClient); // Phase 4, Task 4.4

      // Initialize webhook infrastructure (BUG FIX 0.8)
      // Note: Redis is optional - webhooks will fail gracefully without it
      const webhookEndpoint = process.env['WEBHOOK_ENDPOINT'] || 'https://localhost:3000/webhook';
      initWebhookQueue(null); // No Redis by default - would need to add Redis client
      initWebhookManager(null, this.googleClient, webhookEndpoint);
    }

    // Register built-in data connectors once at startup so sheets_connectors has
    // a non-empty catalog without any manual bootstrap calls.
    initializeBuiltinConnectors();

    // Wire subscription writeback: inject the Sheets values.update writer so
    // scheduled refreshes persist results to the destination spreadsheet.
    if (this.googleClient?.sheets) {
      const sheetsClient = this.googleClient.sheets;
      const sheetWriter: SheetWriterFn = async (spreadsheetId, range, values) => {
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'RAW',
          requestBody: { values },
        });
      };
      connectorManager.setSheetWriter(sheetWriter);
    } else {
      baseLogger.debug('Connector sheet writer not configured (Sheets client unavailable)');
    }

    initializeBillingIntegration({
      enabled: envConfig.ENABLE_BILLING_INTEGRATION,
      stripeSecretKey: envConfig.STRIPE_SECRET_KEY,
      webhookSecret: envConfig.STRIPE_WEBHOOK_SECRET,
      currency: envConfig.BILLING_CURRENCY,
      billingCycle: envConfig.BILLING_CYCLE,
      autoInvoicing: envConfig.BILLING_AUTO_INVOICING,
    });

    // Register all tools
    this.registerTools();

    // Register completions
    // Supported since SDK v1.26.0: resource template completions are auto-registered by the
    // SDK when ResourceTemplate instances include 'complete' callbacks (see resource-registration.ts).
    // This call ensures completion capability is advertised and logs registration status.
    this.registerCompletions();

    // Register resources (async to support non-blocking knowledge discovery)
    // Can be deferred to first access with DEFER_RESOURCE_DISCOVERY=true (saves 300-500ms)
    const { shouldDeferResourceDiscovery } = await import('./config/env.js');
    if (shouldDeferResourceDiscovery()) {
      baseLogger.info('Resource discovery deferred - resources will load on first access');
    } else {
      await this.registerResources();
      this.resourcesRegistered = true;
    }

    // Register prompts
    this.registerPrompts();

    // Register task cancellation handler (SEP-1686)
    this.registerTaskCancelHandler();

    // Register logging handler for dynamic log level control
    this.registerLogging();

    // Start cache cleanup task
    cacheManager.startCleanupTask();

    // Start reactive heap watchdog (5s interval, disables analysis at 80%, rejects at 90%)
    startHeapWatchdog();

    // Start health monitoring (heap usage, connection tracking)
    await this.healthMonitor.start();
    baseLogger.info('Health monitoring started');
  }

  /**
   * Register a set of tool definitions with the MCP server.
   * Extracted to support both initial registration and stage-based advancement.
   */
  private registerToolSet(tools: readonly (typeof TOOL_DEFINITIONS)[number][]): void {
    for (const tool of tools) {
      // Keep SDK registration on native Zod schemas. Deferred / compact JSON Schema
      // serialization is handled separately by the tools/list compatibility handler.
      const inputSchemaForRegistration = tool.inputSchema as unknown as AnySchema;
      const outputSchemaForRegistration = tool.outputSchema as unknown as AnySchema;

      // Get icons and execution config for this tool
      const toolIcons = TOOL_ICONS[tool.name];
      const toolExecution = TOOL_EXECUTION_CONFIG[tool.name];
      const supportsTasks = toolExecution?.taskSupport && toolExecution.taskSupport !== 'forbidden';

      // Task support enabled (SEP-1686)
      if (supportsTasks) {
        const taskHandler = this.createToolTaskHandler(tool.name);
        const taskSupport = toolExecution?.taskSupport === 'required' ? 'required' : 'optional';
        const taskExecution = {
          ...(toolExecution ?? {}),
          taskSupport,
        } as TaskToolExecution;

        this._server.experimental.tasks.registerToolTask<AnySchema, AnySchema>(
          tool.name,
          {
            title: tool.annotations.title,
            description: tool.description,
            inputSchema: inputSchemaForRegistration,
            outputSchema: outputSchemaForRegistration,
            annotations: tool.annotations,
            execution: taskExecution,
          },
          taskHandler
        );
        continue;
      }

      // Register tool with transformed schemas
      // Note: Using type assertion to avoid TypeScript's "excessively deep type instantiation" error
      // See registration.ts for detailed explanation
      (
        this._server.registerTool as (
          name: string,
          config: {
            title?: string;
            description?: string;
            inputSchema?: unknown;
            outputSchema?: unknown;
            annotations?: import('@modelcontextprotocol/sdk/types.js').ToolAnnotations;
            icons?: import('@modelcontextprotocol/sdk/types.js').Icon[];
            execution?: import('@modelcontextprotocol/sdk/types.js').ToolExecution;
          },
          cb: (
            args: Record<string, unknown>,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            extra: any // Use 'any' to accept full RequestHandlerExtra from SDK with all fields
          ) => Promise<CallToolResult>
        ) => void
      )(
        tool.name,
        {
          title: tool.annotations.title,
          description: tool.description,
          inputSchema: inputSchemaForRegistration,
          outputSchema: outputSchemaForRegistration,
          annotations: tool.annotations,
          // SEP-973: Tool icons for UI
          icons: toolIcons,
          // SEP-1686: Task support for long-running operations
          execution: toolExecution,
        },
        async (args: Record<string, unknown>, extra) => {
          // Extract progress token from request metadata
          const progressToken = extra._meta?.progressToken;
          // Forward complete MCP context (Task 1.1)
          return this.handleToolCall(tool.name, args, {
            ...extra, // Forward all fields: signal, requestId, sendRequest, sendNotification, etc.
            sendNotification: extra.sendNotification as (
              n: import('@modelcontextprotocol/sdk/types.js').ServerNotification
            ) => Promise<void>,
            progressToken,
            abortSignal: extra.signal, // Make signal available as abortSignal for clarity
          });
        }
      );
    }
  }

  /**
   * Register tools with stage-based loading support.
   *
   * When SERVAL_STAGED_REGISTRATION=true:
   * - Stage 1 tools are registered immediately (auth, core, session, analyze, confirm)
   * - Stage 2 tools (data, format, dimensions, etc.) are registered after spreadsheet active
   * - Stage 3 tools (remaining) are registered on demand
   * - Each stage transition emits notifications/tools/list_changed
   *
   * When disabled (default): all tools are registered at once (backwards-compatible).
   */
  private registerTools(): void {
    // Initialize stage manager with all definitions and registration callback
    toolStageManager.initialize(TOOL_DEFINITIONS, (newTools) => this.registerToolSet(newTools));

    // Register initial tools (all tools if staging disabled, Stage 1 if enabled)
    const initialTools = toolStageManager.getInitialTools();
    this.registerToolSet(initialTools);
    toolStageManager.markRegistered(initialTools.map((t) => t.name));

    if (STAGED_REGISTRATION) {
      baseLogger.info('Staged tool registration enabled', {
        stage: 1,
        initialTools: initialTools.length,
        totalAvailable: TOOL_DEFINITIONS.length,
      });
    }

    // Override tools/list to safely serialize schemas with transforms/pipes.
    registerToolsListCompatibilityHandler(this._server);

    if (getEnv().ENABLE_TOOLS_LIST_CHANGED_NOTIFICATIONS) {
      resourceNotifications.syncToolList(
        initialTools.map((tool) => tool.name),
        {
          emitOnFirstSet: false,
          reason: 'tool registration updated',
        }
      );
    }
  }

  private createToolTaskHandler(toolName: string): ToolTaskHandler<AnySchema> {
    return {
      createTask: async (args, extra) => {
        if (!extra.taskStore) {
          throw new ServiceError(
            `[${toolName}] Task store not configured`,
            'INTERNAL_ERROR',
            toolName
          );
        }

        const task = await extra.taskStore.createTask({
          ttl: extra.taskRequestedTtl ?? undefined,
        });

        // Create AbortController for this task
        const abortController = new AbortController();
        this.taskAbortControllers.set(task.taskId, abortController);

        // Watchdog timer: force-abort tasks that exceed configured max runtime
        const TASK_WATCHDOG_MS = getEnv().TASK_WATCHDOG_MS;
        const watchdogTimer = setTimeout(() => {
          if (this.taskAbortControllers.has(task.taskId)) {
            baseLogger.warn('Task watchdog: aborting hung task', {
              taskId: task.taskId,
              toolName,
              maxLifetimeMs: TASK_WATCHDOG_MS,
            });
            abortController.abort(
              `Task exceeded maximum runtime of ${(TASK_WATCHDOG_MS / 60000).toFixed(1)} minutes`
            );
            this.taskAbortControllers.delete(task.taskId);
            this.taskWatchdogTimers.delete(task.taskId);
          }
        }, TASK_WATCHDOG_MS);
        this.taskWatchdogTimers.set(task.taskId, watchdogTimer);

        // Use this.taskStore for cancellation methods (not extra.taskStore)
        void (async () => {
          try {
            // Check if already cancelled
            if (await this.taskStore.isTaskCancelled(task.taskId)) {
              const reason = await this.taskStore.getCancellationReason(task.taskId);
              await this.storeCancelledTaskResult(task.taskId, reason || 'Task was cancelled');
              return;
            }

            // Execute with abort signal — pass only fields handleToolCall accepts
            // (avoids sendRequest type mismatch from SDK's ToolTaskHandler extra)
            const result = await this.handleToolCall(toolName, args as Record<string, unknown>, {
              sendNotification: extra.sendNotification as
                | ((
                    n: import('@modelcontextprotocol/sdk/types.js').ServerNotification
                  ) => Promise<void>)
                | undefined,
              progressToken: extra._meta?.progressToken,
              abortSignal: abortController.signal,
              taskId: task.taskId,
              taskStore: extra.taskStore,
            });

            // Check cancellation again before storing result
            if (await this.taskStore.isTaskCancelled(task.taskId)) {
              const reason = await this.taskStore.getCancellationReason(task.taskId);
              await this.storeCancelledTaskResult(task.taskId, reason || 'Task was cancelled');
              return;
            }

            await extra.taskStore.storeTaskResult(task.taskId, 'completed', result);
          } catch (error) {
            // Check if error is due to cancellation
            if (error instanceof Error && error.name === 'AbortError') {
              try {
                await this.storeCancelledTaskResult(task.taskId, error.message);
              } catch (storeError) {
                baseLogger.error('Failed to store cancelled task result', { toolName, storeError });
              }
            } else {
              if (await this.taskStore.isTaskCancelled(task.taskId)) {
                try {
                  const reason = await this.taskStore.getCancellationReason(task.taskId);
                  await this.storeCancelledTaskResult(task.taskId, reason || 'Task was cancelled');
                } catch (storeError) {
                  baseLogger.error('Failed to store cancelled task result', {
                    toolName,
                    storeError,
                  });
                }
                return;
              }
              const errorResult = buildToolResponse({
                response: {
                  success: false,
                  error: {
                    code: 'INTERNAL_ERROR',
                    message: error instanceof Error ? error.message : String(error),
                    retryable: false,
                  },
                },
              });
              try {
                await extra.taskStore.storeTaskResult(task.taskId, 'failed', errorResult);
              } catch (storeError) {
                baseLogger.error('Failed to store task result', { toolName, storeError });
              }
            }
          } finally {
            // Cleanup abort controller and watchdog timer
            this.taskAbortControllers.delete(task.taskId);
            clearTimeout(this.taskWatchdogTimers.get(task.taskId));
            this.taskWatchdogTimers.delete(task.taskId);
          }
        })();

        return { task };
      },
      getTask: async (_args, extra) => {
        if (!extra.taskStore) {
          throw new ServiceError(
            `[${toolName}] Task store not configured`,
            'INTERNAL_ERROR',
            toolName
          );
        }
        return await extra.taskStore.getTask(extra.taskId);
      },
      getTaskResult: async (_args, extra) => {
        if (!extra.taskStore) {
          throw new ServiceError(
            `[${toolName}] Task store not configured`,
            'INTERNAL_ERROR',
            toolName
          );
        }
        return (await extra.taskStore.getTaskResult(extra.taskId)) as CallToolResult;
      },
    };
  }

  private async storeCancelledTaskResult(taskId: string, message: string): Promise<void> {
    const cancelResult = buildToolResponse({
      response: {
        success: false,
        error: {
          code: 'TASK_CANCELLED',
          message,
          retryable: false,
        },
      },
    });

    // C11: SDK storeTaskResult only accepts 'completed'|'failed'; use 'failed' for
    // cancelled tasks (the task store preserves cancelled status and the payload carries TASK_CANCELLED).
    await this.taskStore.storeTaskResult(taskId, 'failed', cancelResult);
  }

  /**
   * Handle a tool call - routes to appropriate handler
   */
  private async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
    extra?: {
      sendNotification?: (
        notification: import('@modelcontextprotocol/sdk/types.js').ServerNotification
      ) => Promise<void>;
      sendRequest?: RelatedRequestSender;
      taskId?: string;
      taskStore?: TaskStatusUpdater;
      progressToken?: string | number;
      elicit?: unknown; // SEP-1036: Elicitation capability for sheets_confirm
      sample?: unknown; // SEP-1577: Sampling capability for sheets_analyze
      abortSignal?: AbortSignal; // Task cancellation support
    }
  ): Promise<CallToolResult> {
    // Lazy-load resources if deferred at startup
    await this.ensureResourcesRegistered();

    const startTime = Date.now();

    // Update queue metrics
    updateQueueMetrics(this.requestQueue.size, this.requestQueue.pending);

    // Wrap in queue to enforce concurrency limits
    return this.requestQueue.add(async () => {
      if (extra?.abortSignal?.aborted) {
        throw createRequestAbortError(extra.abortSignal.reason);
      }

      // Extract idempotency key from headers (if HTTP transport)
      const headers = (extra as { headers?: Record<string, string | string[] | undefined> })
        ?.headers;
      const idempotencyKey = headers ? extractIdempotencyKeyFromHeaders(headers) : undefined;
      const costTrackingTenantId = resolveCostTrackingTenantId({ headers });
      const principalId = extractPrincipalIdFromHeaders(headers) ?? 'anonymous';
      const metadataCache = this.googleClient?.sheets
        ? createMetadataCache(this.googleClient.sheets)
        : undefined;

      const requestContext = createRequestContext({
        sendNotification: extra?.sendNotification,
        progressToken: extra?.progressToken,
        abortSignal: extra?.abortSignal,
        // W3C Trace Context support - extract from extra if provided by HTTP transport
        traceId: (extra as { traceId?: string })?.traceId,
        spanId: (extra as { spanId?: string })?.spanId,
        parentSpanId: (extra as { parentSpanId?: string })?.parentSpanId,
        // Idempotency key from X-Idempotency-Key header
        idempotencyKey,
        principalId,
        metadataCache,
        sessionContext: this.context?.sessionContext ?? undefined,
        sendRequest: extra?.sendRequest,
        taskId: extra?.taskId,
        taskStore: extra?.taskStore,
      });
      return runWithRequestContext(requestContext, async () => {
        const logger = requestContext.logger;
        recordSpreadsheetId(args);

        // Record heartbeat for connection health monitoring
        this.connectionHealthCheck.recordHeartbeat(toolName);

        // Log queue state with trace context
        logger.debug('Tool call queued', {
          toolName,
          queueSize: this.requestQueue.size,
          pendingCount: this.requestQueue.pending,
          traceId: requestContext.traceId,
          spanId: requestContext.spanId,
        });

        if (requestContext.abortSignal?.aborted) {
          throw createRequestAbortError(requestContext.abortSignal.reason);
        }

        // Check if shutting down
        if (this.isShutdown) {
          return buildToolResponse({
            response: {
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Server is shutting down',
                retryable: false,
              },
            },
          });
        }

        try {
          // Handle sheets_auth separately - it works even without full initialization
          if (toolName === 'sheets_auth') {
            const authResult = await handleSheetsAuthToolCall(this.authHandler, args);
            this.authHandler = authResult.authHandler;
            const duration = (Date.now() - startTime) / 1000;
            recordToolCall(toolName, 'auth', 'success', duration);
            return buildToolResponse(authResult.result);
          }

          // Local-only actions that are explicitly auth-exempt in tool registration metadata.
          // Extract action from request envelope first, then fallback to flat legacy args.
          const rawArgs = args as Record<string, unknown>;
          const rawAction = ((rawArgs['request'] as Record<string, unknown> | undefined)?.[
            'action'
          ] ?? rawArgs['action']) as string | undefined;
          const isExempt = isToolCallAuthExempt(toolName, rawAction);

          // For all other tools, check authentication first
          if (!isExempt) {
            const authResult = await checkAuthAsync(this.googleClient);
            if (!authResult.authenticated) {
              const errorResponse = buildAuthErrorResponse(authResult.error!);
              return buildToolResponse(errorResponse);
            }
          }

          if (!this.handlers) {
            // Pre-auth path: serve local-only tools without full handler initialization
            if (isExempt) {
              const preInitResult = await handlePreInitExemptToolCall(toolName, args);
              if (preInitResult) {
                return buildToolResponse(preInitResult);
              }
            }
            return buildToolResponse({
              response: {
                success: false,
                error: {
                  code: 'INTERNAL_ERROR',
                  message: 'Handlers not initialized. This is unexpected after auth check passed.',
                  retryable: false,
                  resolution: 'Call sheets_auth with action: "status" to verify auth state.',
                },
              },
            });
          }

          const dispatchResult = await dispatchServerToolCall({
            toolName,
            args,
            extra: extra as (Record<string, unknown> & { abortSignal?: AbortSignal }) | undefined,
            rawArgs,
            rawAction,
            handlers: this.handlers,
            authHandler: this.authHandler,
            cachedHandlerMap: this.cachedHandlerMap,
            context: this.context,
            googleClient: this.googleClient,
            requestId: requestContext.requestId,
            costTrackingTenantId,
          });
          this.cachedHandlerMap = dispatchResult.handlerMap;
          if (dispatchResult.kind === 'error') {
            return dispatchResult.response;
          }

          const duration = (Date.now() - startTime) / 1000;

          // Get action from args if available (check up to 3 levels deep)
          const action = extractActionFromArgs(args);
          recordToolExecutionResult({
            toolName,
            action,
            durationSeconds: duration,
            result: dispatchResult.result,
            principalId: requestContext.principalId ?? 'anonymous',
            warn: (message, meta) => logger.warn(message, meta),
          });

          return buildToolResponse(dispatchResult.result);
        } catch (error) {
          const duration = (Date.now() - startTime) / 1000;
          const action = extractActionFromArgs(args);

          logger.error('Tool call threw exception', { tool: toolName, error });

          if (error instanceof Error && error.name === 'AbortError') {
            return buildToolResponse({
              response: {
                success: false,
                error: {
                  code: 'OPERATION_CANCELLED',
                  message: error.message,
                  retryable: false,
                },
              },
            });
          }

          recordToolExecutionException({
            toolName,
            action,
            durationSeconds: duration,
            principalId: requestContext.principalId ?? 'anonymous',
          });

          // Check if this is a Google authentication error
          // If so, convert it to a user-friendly auth error with clear instructions
          if (isGoogleAuthError(error)) {
            logger.info('Detected Google auth error, converting to auth flow guidance', {
              tool: toolName,
            });
            return buildToolResponse(convertGoogleAuthError(error));
          }

          return buildToolResponse({
            response: {
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
              },
            },
          });
        }
      }).finally(() => {
        metadataCache?.clear();
      });
    });
  }

  /**
   * Register resources
   * Idempotent: safe to call multiple times (guards against double-registration)
   */
  private async registerResources(): Promise<void> {
    if (this.resourcesRegistered) {
      return; // Already registered — prevent SDK "already registered" errors
    }
    try {
      await registerServerResources({
        server: this._server,
        googleClient: this.googleClient,
        context: this.context,
      });
    } catch (err) {
      // Swallow duplicate-registration errors from the SDK (idempotent restart scenarios)
      if (err instanceof Error && err.message.includes('already registered')) {
        baseLogger.warn('Resource already registered — skipping duplicate registration', {
          message: err.message,
        });
        return;
      }
      throw err;
    }
  }

  /**
   * Ensure resources are registered (lazy initialization)
   *
   * This method is called before any operation that requires resources.
   * If resources were deferred at startup, they are registered on first access.
   * Thread-safe: multiple concurrent calls will only register once.
   */
  private async ensureResourcesRegistered(): Promise<void> {
    await ensureServerResourcesRegistered({
      resourcesRegistered: this.resourcesRegistered,
      resourceRegistrationPromise: this.resourceRegistrationPromise,
      resourceRegistrationFailed: this.resourceRegistrationFailed,
      registerResources: () => this.registerResources(),
      setResourcesRegistered: (value) => {
        this.resourcesRegistered = value;
      },
      setResourceRegistrationPromise: (value) => {
        this.resourceRegistrationPromise = value;
      },
      setResourceRegistrationFailed: (value) => {
        this.resourceRegistrationFailed = value;
      },
      log: baseLogger,
    });
  }

  /**
   * Register prompts
   */
  private registerPrompts(): void {
    registerServerPrompts(this._server);
  }

  /**
   * Register MCP completions capability
   *
   * Resource template completions (spreadsheetId, range) are auto-registered by the SDK
   * when ResourceTemplate instances include 'complete' callbacks in resource-registration.ts.
   * This method ensures the capability is advertised and logs its status.
   *
   * SDK v1.26.0+: setCompletionRequestHandler() is called automatically by the SDK
   * when any ResourceTemplate with completions is registered.
   */
  private registerCompletions(): void {
    ensureServerCompletionsRegistered(baseLogger);
  }

  /**
   * Register task cancellation handler
   *
   * Enables clients to cancel long-running tasks via the tasks/cancel request.
   * MCP 2025-11-25: Task-based execution support
   */
  private registerTaskCancelHandler(): void {
    registerServerTaskCancelHandler({
      taskStore: this.taskStore,
      taskAbortControllers: this.taskAbortControllers,
      taskWatchdogTimers: this.taskWatchdogTimers,
      log: baseLogger,
    });
  }

  private installLoggingBridge(): void {
    installServerLoggingBridge({
      loggingBridgeInstalled: this.loggingBridgeInstalled,
      setLoggingBridgeInstalled: (value) => {
        this.loggingBridgeInstalled = value;
      },
      getRequestedMcpLogLevel: () => this.requestedMcpLogLevel,
      getForwardingMcpLog: () => this.forwardingMcpLog,
      setForwardingMcpLog: (value) => {
        this.forwardingMcpLog = value;
      },
      getRateLimitState: () => this.mcpLogRateLimitState,
      server: this._server,
    });
  }

  /**
   * Register logging handler for dynamic log level control
   *
   * Enables clients to adjust server log verbosity via logging/setLevel request.
   */
  private registerLogging(): void {
    registerServerLoggingSetLevelHandler({
      server: this._server,
      setRequestedMcpLogLevel: (level) => {
        this.requestedMcpLogLevel = level;
      },
      installLoggingBridge: () => {
        this.installLoggingBridge();
      },
      log: baseLogger,
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.isShutdown) return;
    this.isShutdown = true;

    baseLogger.info('ServalSheets: Shutting down...');

    // Wait for queue to drain (with timeout)
    const pendingAtShutdown = this.requestQueue.size;
    baseLogger.info('Waiting for request queue to drain', {
      queueSize: pendingAtShutdown,
      pendingCount: this.requestQueue.pending,
    });

    let timedOut = false;
    await Promise.race([
      this.requestQueue.onIdle(),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, 10000)
      ), // 10s max
    ]);

    // ISSUE-056: if drain timed out, clear remaining queued (not yet started) items
    // to prevent orphaned requests from executing after shutdown completes.
    if (timedOut && this.requestQueue.size > 0) {
      const orphaned = this.requestQueue.size;
      this.requestQueue.clear();
      baseLogger.warn('Request queue drain timed out — cleared orphaned waiting requests', {
        orphaned,
        stillRunning: this.requestQueue.pending,
      });
    } else {
      baseLogger.info('Request queue drained');
    }

    // Clear range resolver cache
    if (this.context?.rangeResolver) {
      this.context.rangeResolver.clearCache();
    }

    // Stop cache cleanup task
    cacheManager.stopCleanupTask();

    // Stop health monitoring (ISSUE-055: 5s timeout prevents indefinite hang on stuck onStop hooks)
    await Promise.race([
      this.healthMonitor.stop(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Health monitor stop timed out after 5s')), 5000)
      ),
    ]).catch((err: Error) => {
      baseLogger.warn('Health monitor stop did not complete cleanly', { error: err.message });
    });
    baseLogger.info('Health monitoring stopped');

    // Phase 1: Clean up all registered resources (timers, connections, etc.)
    const cleanupResult = await cleanupAllResources();
    baseLogger.info('Resource cleanup complete', {
      total: cleanupResult.total,
      successful: cleanupResult.successful,
      failed: cleanupResult.failed,
    });

    if (cleanupResult.failed > 0) {
      baseLogger.warn('Some resources failed to clean up', {
        errors: cleanupResult.errors,
      });
    }

    // Phase 2.5: Destroy services with active timers (prevent memory leaks >24h uptime)
    try {
      // Dispose SpreadsheetBackend adapter (releases cached API refs)
      if (this.context?.backend) {
        await this.context.backend.dispose();
        baseLogger.debug('SpreadsheetBackend disposed');
      }

      // Destroy GoogleApiClient (pool monitor interval, HTTP agents)
      if (this.googleClient) {
        this.googleClient.destroy();
        baseLogger.debug('GoogleApiClient destroyed');
      }

      // Destroy RequestMerger (pending group timers)
      if (this.context?.requestMerger) {
        this.context.requestMerger.destroy();
        baseLogger.debug('RequestMerger destroyed');
      }

      if (this.context?.scheduler) {
        this.context.scheduler.dispose();
        baseLogger.debug('SchedulerService disposed');
      }

      // Destroy BatchingSystem singleton (batch window timers)
      const { getBatchingSystem } = await import('./services/batching-system.js');
      const batchingSystem = getBatchingSystem();
      if (batchingSystem) {
        batchingSystem.destroy();
        baseLogger.debug('BatchingSystem destroyed');
      }

      // Destroy PrefetchingSystem singleton (background refresh timer)
      const { getPrefetchingSystem } = await import('./services/prefetching-system.js');
      const prefetchingSystem = getPrefetchingSystem();
      if (prefetchingSystem) {
        prefetchingSystem.destroy();
        baseLogger.debug('PrefetchingSystem destroyed');
      }
    } catch (error) {
      baseLogger.warn('Error during service cleanup', { error });
    }

    // Dispose connector framework resources (subscription timers + connector state).
    await connectorManager.dispose();
    baseLogger.debug('ConnectorManager disposed');

    // Dispose task store (stops cleanup interval)
    this.taskStore.dispose();

    // Dispose temporary resource store (stops cleanup interval)
    disposeTemporaryResourceStore();

    teardownResourceNotifications(this._server);

    // Clear references
    this.googleClient = null;
    this.authHandler = null;
    this.handlers = null;
    this.context = null;
    this.cachedHandlerMap = null;

    baseLogger.info('ServalSheets: Shutdown complete');
  }

  /**
   * Get underlying MCP server instance (for testing and advanced usage)
   */
  get server(): McpServer {
    return this._server;
  }

  /**
   * Start the server with signal handling
   */
  async start(): Promise<void> {
    const startTime = performance.now();

    // Initialize OpenTelemetry (no-op if ENABLE_OTEL is not set)
    await initTelemetry();

    // Validate required environment variables before any initialization
    validateEnv();
    await this.ensureToolIntegrityVerified();

    // Initialize first (register handlers), then connect
    baseLogger.info('[Phase 1/3] Initializing handlers...');
    const initStart = performance.now();
    // Wrap initialization in try-catch to provide better error context
    try {
      await this.initialize();
      const initDuration = performance.now() - initStart;
      baseLogger.info('[Phase 1/3] ✓ Handlers initialized', {
        durationMs: initDuration.toFixed(2),
      });
    } catch (error) {
      baseLogger.error('[Phase 1/3] ✗ Initialization failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error; // Re-throw for CLI to handle with enhanced errors
    }

    baseLogger.info('[Phase 2/3] Creating STDIO transport');
    const transportStart = performance.now();
    const transport = new StdioServerTransport();
    const transportDuration = performance.now() - transportStart;
    let isConnected = false;

    // Privacy mode banner for STDIO transport
    baseLogger.info('🔒 Running in privacy mode — no data leaves your machine (STDIO transport)');

    // Add transport error handlers BEFORE connecting
    transport.onclose = () => {
      if (!this.isShutdown) {
        baseLogger.warn('MCP transport closed unexpectedly', {
          wasConnected: isConnected,
          suggestion: isConnected
            ? 'Client (Claude Desktop) may have crashed or disconnected'
            : 'Initial connection failed - check client MCP configuration',
          ...getProcessBreadcrumbs({
            resourcesRegistered: this.resourcesRegistered,
            resourceRegistrationFailed: this.resourceRegistrationFailed,
          }),
        });

        // Graceful shutdown to clean up resources
        this.shutdown().catch((err) => {
          baseLogger.error('Shutdown after transport close failed', { error: err });
        });
      }
    };

    transport.onerror = (error: Error) => {
      baseLogger.error('MCP transport error', {
        error: error.message,
        stack: error.stack,
        isConnected,
        suggestion: 'Check Claude Desktop logs and MCP server configuration',
        ...getProcessBreadcrumbs({
          resourcesRegistered: this.resourcesRegistered,
          resourceRegistrationFailed: this.resourceRegistrationFailed,
        }),
      });
    };

    // Handle process signals for graceful shutdown
    const handleShutdown = async (signal: string): Promise<void> => {
      baseLogger.warn(`ServalSheets: Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGHUP', () => handleShutdown('SIGHUP'));

    // Handle uncaught errors
    process.on('uncaughtException', async (error) => {
      baseLogger.error('ServalSheets: Uncaught exception', {
        error,
        ...getProcessBreadcrumbs({
          resourcesRegistered: this.resourcesRegistered,
          resourceRegistrationFailed: this.resourceRegistrationFailed,
        }),
      });
      await this.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      baseLogger.error('ServalSheets: Unhandled rejection', {
        reason,
        ...getProcessBreadcrumbs({
          resourcesRegistered: this.resourcesRegistered,
          resourceRegistrationFailed: this.resourceRegistrationFailed,
        }),
      });
      await this.shutdown();
      process.exit(1);
    });

    // Ensure resources are registered before connect (handles deferred-discovery restarts)
    if (!this.resourcesRegistered) {
      await this.registerResources();
      this.resourcesRegistered = true;
    }

    // Connect after initialization (handlers are registered)
    baseLogger.info('[Phase 3/3] Connecting transport');
    const connectStart = performance.now();
    // Wrap connect in try-catch to handle immediate connection failures
    try {
      await this._server.connect(transport);
      isConnected = true;
      const connectDuration = performance.now() - connectStart;
      const totalDuration = performance.now() - startTime;
      baseLogger.info(
        `[Phase 3/3] ✓ ServalSheets ready (${TOOL_COUNT} tools, ${ACTION_COUNT} actions)`,
        {
          transport: 'stdio',
          connectionId: new Date().toISOString(),
          timing: {
            initMs: (performance.now() - startTime - connectDuration - transportDuration).toFixed(
              2
            ),
            transportMs: transportDuration.toFixed(2),
            connectMs: connectDuration.toFixed(2),
            totalMs: totalDuration.toFixed(2),
          },
        }
      );
    } catch (error) {
      baseLogger.error('[Phase 3/3] ✗ Connection failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        transport: 'stdio',
        suggestion: 'Check Claude Desktop MCP configuration and server.json',
      });
      throw error; // Re-throw for CLI to handle
    }
  }

  /**
   * Get server info
   */
  getInfo(): { name: string; version: string; tools: number; actions: number } {
    return {
      name: this.options.name ?? 'servalsheets',
      version: this.options.version ?? PACKAGE_VERSION,
      tools: TOOL_COUNT,
      actions: ACTION_COUNT,
    };
  }

  /**
   * Check if server is healthy
   */
  isHealthy(): boolean {
    return !this.isShutdown && this.googleClient !== null;
  }
}

/**
 * Create and start a ServalSheets server
 *
 * Automatically selects RedisTaskStore if REDIS_URL is set, otherwise InMemoryTaskStore.
 * For production deployments with multiple instances, set REDIS_URL for shared task state.
 */
export async function createServalSheetsServer(
  options: ServalSheetsServerOptions = {}
): Promise<ServalSheetsServer> {
  await prepareServerBootstrap(options);

  const server = new ServalSheetsServer(options);
  await server.start();
  return server;
}
