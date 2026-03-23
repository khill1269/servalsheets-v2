/**
 * ServalSheets - HTTP Transport Server
 *
 * Streamable HTTP transport for Claude Connectors Directory
 * Supports both SSE and HTTP streaming
 * MCP Protocol: 2025-11-25
 */

import express, { Request, Response, NextFunction } from 'express';
import { randomUUID, randomBytes, createHash } from 'crypto';
import type { Server as NodeHttpServer } from 'node:http';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { InMemoryTaskMessageQueue } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema, type LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { OAuthProvider } from './oauth-provider.js';
import { createSamlProviderFromEnv } from './security/saml-provider.js';
import { validateEnv, env, getEnv } from './config/env.js';
import { createGoogleApiClient, GoogleApiClient } from './services/google-api.js';
import { initTransactionManager } from './services/transaction-manager.js';
import { initConflictDetector } from './services/conflict-detector.js';
import { initImpactAnalyzer } from './services/impact-analyzer.js';
import { initValidationEngine } from './services/validation-engine.js';
import { ACTION_COUNT, TOOL_COUNT } from './schemas/action-counts.js';
import { SERVER_INFO, SERVER_ICONS } from './version.js';
import { logger } from './utils/logger.js';
import { sendProgress } from './utils/request-context.js';
import { HealthService } from './server/health.js';
import { startMetricsServer, stopMetricsServer } from './server/metrics-server.js';
import { UserRateLimiter, createUserRateLimiterFromEnv } from './services/user-rate-limiter.js';
import { MetricsExporter } from './services/metrics-exporter.js';
import { getMetricsService } from './services/metrics.js';
import {
  BatchCompiler,
  RateLimiter,
  DiffEngine,
  PolicyEnforcer,
  RangeResolver,
  TaskStoreAdapter,
} from './core/index.js';
import { SnapshotService } from './services/snapshot.js';
import { createHandlers, type HandlerContext, type HandlerMcpServer } from './handlers/index.js';
import { handleLoggingSetLevel } from './handlers/logging.js';
import {
  registerKnowledgeResources,
  registerHistoryResources,
  registerCacheResources,
  registerTransactionResources,
  registerConflictResources,
  registerImpactResources,
  registerValidationResources,
  registerMetricsResources,
  registerConfirmResources,
  registerAnalyzeResources,
  registerReferenceResources,
  registerSchemaResources,
  registerCostDashboardResources,
  registerGuideResources,
  registerDecisionResources,
  registerExamplesResources,
  registerPatternResources,
  registerSheetResources,
  registerDiscoveryResources,
  registerConnectionHealthResource,
  registerRestartHealthResource,
  registerMasterIndexResource,
  registerKnowledgeIndexResource,
  registerKnowledgeSearchResource,
  initializeResourceNotifications,
  resourceNotifications,
  teardownResourceNotifications,
} from './resources/index.js';
import { getCostTracker } from './services/cost-tracker.js';
import { initializeBillingIntegration } from './services/billing-integration.js';
import { cacheManager } from './utils/cache-manager.js';
import { registerServalSheetsPrompts } from './mcp/registration/prompt-registration.js';
import { registerServalSheetsResources } from './mcp/registration/resource-registration.js';
import { registerServalSheetsTools } from './mcp/registration/tool-handlers.js';
import { TOOL_DEFINITIONS } from './mcp/registration/tool-definitions.js';
import { createServerCapabilities, SERVER_INSTRUCTIONS } from './mcp/features-2025-11-25.js';
import { createTaskAwareSamplingServer } from './mcp/sampling.js';
import { validateToolCatalogConfiguration } from './mcp/tool-catalog.js';
import {
  startBackgroundTasks,
  registerSignalHandlers,
  onShutdown,
  logEnvironmentConfig,
} from './startup/lifecycle.js';
import { requestDeduplicator } from './utils/request-deduplication.js';
import { initTelemetry } from './observability/otel-setup.js';
import { registerWellKnownHandlers } from './server/well-known.js';
import { initializeRbacManager } from './services/rbac-manager.js';
import { getOrCreateSessionContextAsync } from './services/session-context.js';
import { verifyToolIntegrity } from './security/tool-hash-registry.js';
import {
  buildMcpLoggingMessage,
  consumeMcpLogRateLimit,
  createMcpLogRateLimitState,
  extractMcpLogEntry,
  type McpLogRateLimitState,
  shouldForwardMcpLog,
} from './server/logging-bridge-utils.js';
import { registerHttpFoundationMiddleware } from './http-server/middleware.js';
import { registerHttpGraphQlAndAdmin } from './http-server/graphql-admin.js';
import { registerHttpObservabilityRoutes } from './http-server/routes-observability.js';
import {
  registerHttpTransportRoutes,
  type HttpTransportSession,
} from './http-server/routes-transport.js';
import { registerHttpWebhookRoutes } from './http-server/routes-webhooks.js';
import { registerApiRoutes } from './http-server/routes-api.js';
import { ConfigError } from './core/errors.js';

export interface HttpServerOptions {
  port?: number;
  host?: string;
  corsOrigins?: string[];
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  trustProxy?: boolean;

  // OAuth mode (optional)
  enableOAuth?: boolean;
  oauthConfig?: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    jwtSecret: string;
    stateSecret: string;
    allowedRedirectUris: string[];
    googleClientId: string;
    googleClientSecret: string;
    accessTokenTtl: number;
    refreshTokenTtl: number;
  };
}

const DEFAULT_PORT = 3000;
// HIGH-003 FIX: Default to localhost for security (0.0.0.0 exposes to entire network)
// Override with HOST=0.0.0.0 in production if external access needed
const DEFAULT_HOST = '127.0.0.1';

let httpLoggingBridgeInstalled = false;
interface HttpLoggingSubscriber {
  requestedMcpLogLevel: LoggingLevel;
  forwardingMcpLog: boolean;
  rateLimitState: McpLogRateLimitState;
  server: McpServer;
}

const httpLoggingSubscribers = new Map<string, HttpLoggingSubscriber>();

function installHttpLoggingBridge(): void {
  if (httpLoggingBridgeInstalled) {
    return;
  }

  httpLoggingBridgeInstalled = true;
  const originalLog = logger.log.bind(logger);

  logger.log = ((levelOrEntry: unknown, message?: unknown, ...meta: unknown[]) => {
    const result = (originalLog as (...args: unknown[]) => unknown)(levelOrEntry, message, ...meta);

    if (httpLoggingSubscribers.size === 0) {
      return result;
    }

    const extracted = extractMcpLogEntry(levelOrEntry, message, meta);
    if (!extracted) {
      return result;
    }

    for (const subscriber of httpLoggingSubscribers.values()) {
      if (subscriber.forwardingMcpLog) {
        continue;
      }

      if (!shouldForwardMcpLog(extracted.level, subscriber.requestedMcpLogLevel)) {
        continue;
      }

      if (!consumeMcpLogRateLimit(subscriber.rateLimitState)) {
        continue;
      }

      subscriber.forwardingMcpLog = true;
      void subscriber.server.server
        .sendLoggingMessage(buildMcpLoggingMessage(extracted.level, extracted.text, extracted.data))
        .catch(() => {
          // Best-effort bridge: avoid recursive logging on notification failure.
        })
        .finally(() => {
          subscriber.forwardingMcpLog = false;
        });
    }

    return result;
  }) as typeof logger.log;
}

// Monkey-patches removed: All schemas now use flattened z.object() pattern
// which works natively with MCP SDK v1.25.x - no patches required!

async function createMcpServerInstance(
  googleToken?: string,
  googleRefreshToken?: string,
  sessionId?: string
): Promise<{ mcpServer: McpServer; taskStore: TaskStoreAdapter; disposeRuntime: () => void }> {
  const envConfig = getEnv();
  validateToolCatalogConfiguration();
  const costTrackingEnabled =
    envConfig.ENABLE_COST_TRACKING || envConfig.ENABLE_BILLING_INTEGRATION;

  // Create task store for SEP-1686 support - uses createTaskStore() for Redis support
  const { createTaskStore } = await import('./core/task-store-factory.js');
  const taskStore = await createTaskStore();

  const mcpServer = new McpServer(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      icons: SERVER_ICONS,
    },
    {
      capabilities: createServerCapabilities(),
      instructions: SERVER_INSTRUCTIONS,
      taskStore,
      taskMessageQueue: new InMemoryTaskMessageQueue(),
    }
  );

  let handlers = null;
  let googleClient: GoogleApiClient | null = null;
  let context: HandlerContext | null = null;

  if (googleToken) {
    googleClient = await createGoogleApiClient({
      accessToken: googleToken,
      refreshToken: googleRefreshToken,
    });

    // Initialize Phase 4 advanced features (required for sheets_transaction, etc.)
    initTransactionManager(googleClient);
    initConflictDetector(googleClient);
    initImpactAnalyzer(googleClient);
    initValidationEngine(googleClient);

    // Create SnapshotService for undo/revert operations
    const snapshotService = new SnapshotService({ driveApi: googleClient.drive });

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
    } = await initializePerformanceOptimizations(googleClient.sheets);

    context = {
      batchCompiler: new BatchCompiler({
        rateLimiter: new RateLimiter(),
        diffEngine: new DiffEngine({ sheetsApi: googleClient.sheets }),
        policyEnforcer: new PolicyEnforcer(),
        snapshotService,
        sheetsApi: googleClient.sheets,
        onProgress: (event) => {
          // Send MCP progress notification over HTTP transport
          void sendProgress(event.current, event.total, event.message);
        },
      }),
      rangeResolver: new RangeResolver({ sheetsApi: googleClient.sheets }),
      googleClient, // For authentication checks in handlers
      batchingSystem, // Time-window batching system for reducing API calls
      cachedSheetsApi, // ETag-based caching for reads (30-50% API savings)
      requestMerger, // Phase 2: Merge overlapping read requests (20-40% API savings)
      parallelExecutor, // Phase 2: Parallel batch execution (40% faster batch ops)
      prefetchPredictor, // Phase 3: Predictive prefetching (200-500ms latency reduction)
      accessPatternTracker, // Phase 3: Access pattern learning for smarter predictions
      queryOptimizer, // Phase 3B: Adaptive query optimization (-25% avg latency)
      snapshotService, // Pass to context for HistoryHandler undo/revert (Task 1.3)
      ...(costTrackingEnabled ? { costTracker: getCostTracker() } : {}),
      auth: {
        // Use getters to always read live values from GoogleApiClient
        // This ensures re-auth with broader scopes takes effect immediately
        get hasElevatedAccess() {
          return googleClient?.hasElevatedAccess ?? false;
        },
        get scopes() {
          return googleClient?.scopes ?? [];
        },
      },
      samplingServer: createTaskAwareSamplingServer(mcpServer.server),
      elicitationServer: mcpServer.server,
      server: mcpServer.server as HandlerMcpServer, // Narrow bridge for elicitation/sampling only
      requestDeduplicator, // Pass request deduplicator for preventing duplicate API calls
      ...(sessionId ? { sessionContext: await getOrCreateSessionContextAsync(sessionId) } : {}),
      taskStore, // ISSUE-225: Pass taskStore so Task IDs are emitted via HTTP transport (SEP-1686)
    };

    handlers = createHandlers({
      context,
      sheetsApi: googleClient.sheets,
      driveApi: googleClient.drive,
    });
  }

  initializeBillingIntegration({
    enabled: envConfig.ENABLE_BILLING_INTEGRATION,
    stripeSecretKey: envConfig.STRIPE_SECRET_KEY,
    webhookSecret: envConfig.STRIPE_WEBHOOK_SECRET,
    currency: envConfig.BILLING_CURRENCY,
    billingCycle: envConfig.BILLING_CYCLE,
    autoInvoicing: envConfig.BILLING_AUTO_INVOICING,
  });

  const toolRegistration = await registerServalSheetsTools(mcpServer, handlers, { googleClient });
  registerServalSheetsResources(mcpServer, googleClient);
  registerServalSheetsPrompts(mcpServer);
  await registerKnowledgeResources(mcpServer);

  // Register operation history resources
  registerHistoryResources(mcpServer);

  // Register cache statistics resources
  registerCacheResources(mcpServer);

  // Register Phase 4 resources (only if Google client was initialized)
  if (googleClient) {
    registerTransactionResources(mcpServer);
    registerConflictResources(mcpServer);
    registerImpactResources(mcpServer);
    registerValidationResources(mcpServer);
    registerMetricsResources(mcpServer);
  }

  // Register MCP-native resources (Elicitation & Sampling)
  registerConfirmResources(mcpServer);
  registerAnalyzeResources(mcpServer);

  // Register static reference resources
  registerReferenceResources(mcpServer);

  // Register schema resources for deferred loading (SERVAL_DEFER_SCHEMAS=true)
  registerSchemaResources(mcpServer);

  // Register cost dashboard resources (billing integration)
  registerCostDashboardResources(mcpServer);

  // Register discovery resources (requires Google client)
  if (googleClient) {
    registerDiscoveryResources(mcpServer);
  }

  // Register dynamic sheet discovery (requires Google client + context)
  if (googleClient && context) {
    registerSheetResources(mcpServer, context);
  }

  // Register guide, decision, examples, and pattern resources
  registerGuideResources(mcpServer);
  registerDecisionResources(mcpServer);
  registerExamplesResources(mcpServer);
  registerPatternResources(mcpServer);

  // Register health resources
  registerConnectionHealthResource(mcpServer);
  registerRestartHealthResource(mcpServer);

  // Register index and knowledge search resources
  registerMasterIndexResource(mcpServer);
  registerKnowledgeIndexResource(mcpServer);
  registerKnowledgeSearchResource(mcpServer);

  // Initialize resource change notifications
  initializeResourceNotifications(mcpServer);
  if (envConfig.ENABLE_TOOLS_LIST_CHANGED_NOTIFICATIONS) {
    resourceNotifications.syncToolList(
      TOOL_DEFINITIONS.map((tool) => tool.name),
      {
        emitOnFirstSet: false,
        reason: 'http transport resources initialized',
      }
    );
  }

  // Register logging handler
  const loggingSubscriberId = sessionId ?? `http:${randomUUID()}`;
  mcpServer.server.setRequestHandler(
    SetLevelRequestSchema,
    async (request: z.infer<typeof SetLevelRequestSchema>) => {
      const level = request.params.level;
      const existingSubscriber = httpLoggingSubscribers.get(loggingSubscriberId);
      httpLoggingSubscribers.set(loggingSubscriberId, {
        requestedMcpLogLevel: level,
        forwardingMcpLog: existingSubscriber?.forwardingMcpLog ?? false,
        rateLimitState: existingSubscriber?.rateLimitState ?? createMcpLogRateLimitState(),
        server: mcpServer,
      });
      installHttpLoggingBridge();
      const response = await handleLoggingSetLevel({ level });
      logger.info('Log level changed via logging/setLevel', {
        previousLevel: response.previousLevel,
        newLevel: response.newLevel,
      });
      // OK: Explicit empty - MCP logging/setLevel returns empty object per protocol
      return {};
    }
  );
  logger.info('HTTP Server: Logging handler registered (logging/setLevel)');

  return {
    mcpServer,
    taskStore,
    disposeRuntime: () => {
      teardownResourceNotifications(mcpServer);
      httpLoggingSubscribers.delete(loggingSubscriberId);
      toolRegistration.dispose();
    },
  };
}

/**
 * Create HTTP server with MCP transport
 */
export function createHttpServer(options: HttpServerOptions = {}): {
  app: unknown;
  start: () => Promise<void>;
  stop: () => Promise<void> | undefined;
  sessions: unknown;
} {
  const envConfig = getEnv();
  let toolIntegrityVerified = false;

  const ensureToolIntegrityVerified = async (): Promise<void> => {
    if (toolIntegrityVerified) {
      return;
    }

    await verifyToolIntegrity();
    toolIntegrityVerified = true;
  };

  const configuredCorsOrigins = envConfig.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const corsOrigins =
    options.corsOrigins ??
    (configuredCorsOrigins.length > 0
      ? configuredCorsOrigins
      : [
          'https://claude.ai',
          'https://claude.com',
          'https://platform.openai.com',
          'https://copilot.microsoft.com',
          'https://grok.x.ai',
          'https://gemini.google.com',
          // MCP Inspector (official debugging tool) and local development clients
          'http://localhost:6274',
          'http://localhost:3000',
          'http://localhost:8080',
          'http://127.0.0.1:6274',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:8080',
        ]);
  const rateLimitWindowMs = options.rateLimitWindowMs ?? envConfig.RATE_LIMIT_WINDOW_MS;
  const rateLimitMax = options.rateLimitMax ?? envConfig.RATE_LIMIT_MAX;
  const trustProxy = options.trustProxy ?? false;
  const legacySseEnabled = envConfig.ENABLE_LEGACY_SSE;
  if (legacySseEnabled) {
    logger.warn(
      'Legacy SSE transport (/sse endpoint) is deprecated per MCP 2025-11-25. ' +
        'Migrate clients to the Streamable HTTP transport at /mcp. ' +
        'Set ENABLE_LEGACY_SSE=false to suppress this warning.'
    );
  }
  const eventStoreRedisUrl = envConfig.REDIS_URL;
  const eventStoreTtlMs = envConfig.STREAMABLE_HTTP_EVENT_TTL_MS;
  const eventStoreMaxEvents = envConfig.STREAMABLE_HTTP_EVENT_MAX_EVENTS;

  const app = express();

  // Health service for liveness/readiness probes
  // Note: GoogleClient is session-specific, so health checks will report on active sessions
  const healthService = new HealthService(null);

  registerHttpFoundationMiddleware({
    app,
    corsOrigins,
    trustProxy,
    rateLimitWindowMs,
    rateLimitMax,
  });

  // OAuth provider (optional)
  let oauth: OAuthProvider | null = null;
  if (options.enableOAuth && options.oauthConfig) {
    oauth = new OAuthProvider(options.oauthConfig);
    app.use(oauth.createRouter());
    logger.info('HTTP Server: OAuth mode enabled', {
      issuer: options.oauthConfig.issuer,
      clientId: options.oauthConfig.clientId,
    });
  }

  // SAML SSO provider (optional — enabled when SAML_ENTRY_POINT + SAML_CERT + JWT_SECRET set)
  const samlProvider = createSamlProviderFromEnv();
  if (samlProvider) {
    app.use(samlProvider.createRouter());
    logger.info(
      'HTTP Server: SAML SSO enabled (routes: /sso/login, /sso/callback, /sso/metadata, /sso/logout)'
    );
  }

  // Per-user rate limiting with Redis (optional)
  let userRateLimiter: UserRateLimiter | null = null;
  const redisUrl = process.env['REDIS_URL'];

  const rateLimiterReady = redisUrl
    ? (async () => {
        try {
          const { createClient } = await import('redis');
          const redis = createClient({ url: redisUrl });

          redis.on('error', (err) => {
            logger.error('Redis connection error', { error: err });
          });

          await redis.connect();

          userRateLimiter = createUserRateLimiterFromEnv(redis);
          logger.info('Per-user rate limiter initialized with Redis', {
            redisUrl: redisUrl.replace(/:[^:]*@/, ':***@'), // Mask credentials
          });

          // SCALE-01: Wire Redis-backed session store when SESSION_STORE_TYPE=redis
          if (process.env['SESSION_STORE_TYPE'] === 'redis') {
            const { initSessionRedis } = await import('./services/session-context.js');
            initSessionRedis(redis);
            logger.info('Session store initialized with Redis backend (HTTP mode)');
          }
        } catch (error) {
          logger.error('Failed to initialize Redis for rate limiting', { error });
          logger.warn('Continuing without per-user rate limiting');
        }
      })()
    : Promise.resolve();

  if (!redisUrl) {
    logger.debug('REDIS_URL not set, per-user rate limiting disabled');
  }

  // Initialize RBAC manager when RBAC middleware is enabled so built-in roles are loaded
  // before the first permission check.
  const initializeRbac = async (): Promise<void> => {
    if (!envConfig.ENABLE_RBAC) {
      return;
    }
    try {
      await initializeRbacManager();
      logger.info('RBAC manager initialized');
    } catch (error) {
      logger.error('Failed to initialize RBAC manager', { error });
      throw error;
    }
  };

  // Per-user rate limiting middleware (if Redis available)
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    // Skip rate limiting for health checks
    if (req.path.startsWith('/health')) {
      return next();
    }

    if (!userRateLimiter) {
      return next(); // No Redis, skip per-user limiting
    }

    try {
      // Extract user ID from Authorization header
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      // Use token hash as user ID; for unauthenticated requests use per-IP key
      // to prevent one client exhausting the shared anonymous quota
      const anonymousKey = req.ip
        ? `anon:${Buffer.from(req.ip).toString('base64').slice(0, 16)}`
        : 'anon:unknown';
      const userId = token
        ? `user:${createHash('sha256').update(token).digest('hex').substring(0, 16)}`
        : anonymousKey;

      const limitCheck = await userRateLimiter.checkLimit(userId);

      if (!limitCheck.allowed) {
        const retryAfterSecs = Math.ceil((limitCheck.resetAt.getTime() - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfterSecs.toString());
        res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Per-user rate limit exceeded',
          retryAfter: limitCheck.resetAt.toISOString(),
          remaining: 0,
          minuteUsage: limitCheck.minuteUsage,
          hourUsage: limitCheck.hourUsage,
        });
        return;
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-User-Remaining', limitCheck.remaining.toString());
      res.setHeader('X-RateLimit-User-Reset', limitCheck.resetAt.toISOString());

      next();
    } catch (error) {
      logger.error('Per-user rate limit check failed', { error });
      res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Rate limiter temporarily unavailable' },
      });
      return;
    }
  });

  // QuotaManager (src/services/quota-manager.ts) handles per-tenant business quota gates
  // (reads/writes/admin per month, configurable per tier). Differs from UserRateLimiter
  // (HTTP throughput). Wire after userRateLimiter when multi-tenant is enabled.

  // Request ID middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  // Enterprise middleware (all feature-flagged, default OFF)
  // Uses lazy loading: middleware modules are imported on first request to avoid
  // blocking startup, while maintaining correct middleware ordering.

  // Tenant Isolation (must be before RBAC - tenant context needed for RBAC decisions)
  if (envConfig.ENABLE_TENANT_ISOLATION) {
    let tenantMw: Promise<typeof import('./middleware/tenant-isolation.js')> | null = null;
    let tenantIsolationHandler:
      | ((req: Request, res: Response, next: NextFunction) => Promise<void> | void)
      | null = null;
    let spreadsheetAccessHandler:
      | ((req: Request, res: Response, next: NextFunction) => Promise<void> | void)
      | null = null;

    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!tenantMw) {
        tenantMw = import('./middleware/tenant-isolation.js');
        logger.info('HTTP Server: Tenant isolation middleware enabled');
      }
      void tenantMw
        .then((mod) => {
          tenantIsolationHandler ??= mod.tenantIsolationMiddleware();
          spreadsheetAccessHandler ??= mod.validateSpreadsheetAccess();

          tenantIsolationHandler(req, res, (error?: unknown) => {
            if (error) {
              next(error);
              return;
            }
            spreadsheetAccessHandler!(req, res, next);
          });
        })
        .catch(next);
    });
  }

  // RBAC (Role-Based Access Control)
  if (envConfig.ENABLE_RBAC) {
    let rbacMw: Promise<typeof import('./middleware/rbac-middleware.js')> | null = null;
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!rbacMw) {
        rbacMw = import('./middleware/rbac-middleware.js');
        logger.info('HTTP Server: RBAC middleware enabled');
      }
      void rbacMw
        .then((mod) => {
          mod.rbacMiddleware()(req, res, next);
        })
        .catch(next);
    });
  }

  // W3C Trace Context middleware (distributed tracing)
  // Spec: https://www.w3.org/TR/trace-context/
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incomingTraceparent = req.header('traceparent');

    let traceId: string;
    let parentId: string;

    if (incomingTraceparent) {
      // Parse: version-traceId-parentId-flags (e.g., "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")
      // Validate hex format strictly to prevent log injection (ISSUE-057)
      const parts = incomingTraceparent.split('-');
      const isValidTraceId = /^[0-9a-f]{32}$/.test(parts[1] ?? '');
      const isValidParentId = /^[0-9a-f]{16}$/.test(parts[2] ?? '');
      if (parts.length === 4 && parts[0] === '00' && isValidTraceId && isValidParentId) {
        traceId = parts[1]!; // 32 hex chars (validated)
        parentId = parts[2]!; // 16 hex chars (validated)
      } else {
        // Invalid format, generate new trace
        traceId = randomBytes(16).toString('hex');
        parentId = randomBytes(8).toString('hex');
        logger.warn('Invalid traceparent header, generating new trace', {
          traceparent: incomingTraceparent.slice(0, 100), // truncate to prevent log flooding
        });
      }
    } else {
      // No incoming trace, generate new one
      traceId = randomBytes(16).toString('hex');
      parentId = randomBytes(8).toString('hex');
    }

    // Generate span ID for this service
    const spanId = randomBytes(8).toString('hex');

    // Set traceparent for downstream services
    // Format: version-traceId-spanId-flags
    // flags: 01 = sampled (always trace for now)
    const traceparent = `00-${traceId}-${spanId}-01`;
    res.setHeader('traceparent', traceparent);

    // Store in request for logging (store on headers for easy access)
    req.headers['x-trace-id'] = traceId;
    req.headers['x-span-id'] = spanId;
    req.headers['x-parent-span-id'] = parentId;

    next();
  });

  // Well-known discovery endpoints (RFC 8615)
  // These must be registered before rate limiting exemption or after with explicit allow
  registerWellKnownHandlers(app, {
    corsOrigins,
    rateLimitMax,
    legacySseEnabled,
    authenticationRequired: options.enableOAuth ?? false,
  });

  registerHttpObservabilityRoutes({
    app,
    healthService,
    options,
    host,
    port,
    legacySseEnabled,
    getSessionCount: () => sessions.size,
    getUserRateLimiter: () => userRateLimiter,
  });

  // Store active sessions with security binding
  const sessions = new Map<string, HttpTransportSession>();

  const { sessionCleanupInterval, cleanupSessions } = registerHttpTransportRoutes({
    app,
    enableOAuth: options.enableOAuth ?? false,
    oauth,
    legacySseEnabled,
    host,
    port,
    eventStoreRedisUrl,
    eventStoreTtlMs,
    eventStoreMaxEvents,
    sessionTimeoutMs: envConfig.SESSION_TIMEOUT_MS,
    sessions,
    createMcpServerInstance,
  });

  registerHttpWebhookRoutes(app);

  // =SERVAL() formula evaluation API
  registerApiRoutes(app, {
    samplingServer: null, // Wired at session creation; HTTP route uses standalone sampling
  });
  logger.info('HTTP Server: =SERVAL() API enabled (POST /api/formula-eval)');

  // Error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error('HTTP server error', {
      error: err,
      request: {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
      stack: err.stack,
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: process.env['NODE_ENV'] === 'production' ? undefined : err.message,
      },
    });
  });

  let httpServer: ReturnType<typeof app.listen> | null = null;
  let dedicatedMetricsServer: NodeHttpServer | null = null;

  // Register shutdown callback to close HTTP server
  onShutdown(async () => {
    if (httpServer) {
      logger.info('Closing HTTP server...');
      return new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => {
          if (err) {
            logger.error('Error closing HTTP server', { error: err });
            reject(err);
          } else {
            logger.info('HTTP server closed');
            resolve();
          }
        });
      });
    }
  });

  // Register shutdown callback to close dedicated metrics server
  onShutdown(async () => {
    if (!dedicatedMetricsServer) {
      return;
    }
    logger.info('Closing dedicated metrics server...');
    try {
      await stopMetricsServer(dedicatedMetricsServer);
      dedicatedMetricsServer = null;
    } catch (error) {
      logger.error('Error closing dedicated metrics server', { error });
      throw error;
    }
  });

  // Clear session cleanup interval on shutdown
  onShutdown(async () => {
    clearInterval(sessionCleanupInterval);
  });

  // Register shutdown callback to close all sessions
  onShutdown(async () => {
    logger.info(`Closing ${sessions.size} active sessions...`);
    cleanupSessions();
    logger.info('All sessions closed');
  });

  registerHttpGraphQlAndAdmin({
    app,
    sessions: sessions as Map<string, unknown>,
  });

  return {
    app,
    start: async () => {
      await initTelemetry();
      await ensureToolIntegrityVerified();
      await Promise.all([rateLimiterReady, initializeRbac()]);
      await new Promise<void>((resolve, reject) => {
        httpServer = app.listen(port, host);

        httpServer.once('error', (error) => {
          logger.error('HTTP server failed to bind', { error, host, port });
          reject(error);
        });

        httpServer.once('listening', () => {
          logger.info(`ServalSheets HTTP server listening on ${host}:${port}`);
          if (legacySseEnabled) {
            logger.info(`SSE endpoint: http://${host}:${port}/sse`);
          } else {
            logger.info('Legacy SSE endpoints disabled (use /mcp)');
          }
          logger.info(`HTTP endpoint: http://${host}:${port}/mcp`);
          logger.info(`Health check: http://${host}:${port}/health`);
          logger.info(`Metrics: ${TOOL_COUNT} tools, ${ACTION_COUNT} actions`);
          resolve();
        });
      });

      if (envConfig.ENABLE_METRICS_SERVER) {
        if (envConfig.METRICS_PORT === port && envConfig.METRICS_HOST === host) {
          throw new ConfigError(
            'METRICS_PORT/METRICS_HOST cannot match main HTTP server bind address. ' +
              'Use a dedicated metrics port.',
            'METRICS_PORT'
          );
        }

        const exporter = new MetricsExporter(getMetricsService(), cacheManager);
        dedicatedMetricsServer = await startMetricsServer({
          port: envConfig.METRICS_PORT,
          host: envConfig.METRICS_HOST,
          exporter,
        });

        logger.info('Dedicated metrics server enabled', {
          host: envConfig.METRICS_HOST,
          port: envConfig.METRICS_PORT,
        });
      }
    },
    stop: async () => {
      clearInterval(sessionCleanupInterval);
      cleanupSessions();

      if (dedicatedMetricsServer) {
        await stopMetricsServer(dedicatedMetricsServer);
        dedicatedMetricsServer = null;
      }
      if (httpServer) {
        return new Promise<void>((resolve, reject) => {
          httpServer!.close((err) => {
            if (err) {
              reject(err);
            } else {
              httpServer = null;
              resolve();
            }
          });
        });
      }
    },
    sessions,
  };
}

/**
 * Start HTTP server - convenience function for CLI
 */
export async function startHttpServer(options: HttpServerOptions = {}): Promise<void> {
  const port = options.port ?? parseInt(process.env['PORT'] ?? '3000', 10);
  const server = createHttpServer({ ...options, port });
  await server.start();
}

/**
 * Start remote server with OAuth - convenience function for CLI
 * This is a compatibility wrapper that enables OAuth mode
 */
export async function startRemoteServer(options: { port?: number } = {}): Promise<void> {
  // Validate environment variables
  validateEnv();

  if (
    !env.JWT_SECRET ||
    !env.STATE_SECRET ||
    !env.OAUTH_CLIENT_SECRET ||
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET
  ) {
    throw new ConfigError(
      'JWT_SECRET, STATE_SECRET, OAUTH_CLIENT_SECRET, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET must be set when using OAuth mode',
      'JWT_SECRET'
    );
  }

  // Load OAuth config from environment
  const oauthConfig = {
    issuer: env.OAUTH_ISSUER,
    clientId: env.OAUTH_CLIENT_ID,
    clientSecret: env.OAUTH_CLIENT_SECRET!,
    jwtSecret: env.JWT_SECRET!,
    stateSecret: env.STATE_SECRET!,
    allowedRedirectUris: env.ALLOWED_REDIRECT_URIS.split(','),
    googleClientId: env.GOOGLE_CLIENT_ID!,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET!,
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtl: env.REFRESH_TOKEN_TTL,
    resourceIndicator: env.OAUTH_RESOURCE_INDICATOR, // RFC 8707 audience claim
  };

  const server = createHttpServer({
    port: options.port ?? env.PORT,
    host: env.HOST,
    enableOAuth: true,
    oauthConfig,
    corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  });

  await server.start();
}

const isDirectEntry = (() => {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

// CLI entry point
if (isDirectEntry) {
  (async () => {
    try {
      // Log environment configuration
      logEnvironmentConfig();

      // Start background tasks and validate configuration
      await startBackgroundTasks();

      // Register signal handlers for graceful shutdown
      registerSignalHandlers();

      // Start HTTP server
      const port = parseInt(process.env['PORT'] ?? '3000', 10);
      const server = createHttpServer({ port });
      await server.start();

      logger.info('ServalSheets HTTP server started successfully');
    } catch (error) {
      logger.error('Failed to start HTTP server', { error });
      process.exit(1);
    }
  })();
}
