import { createHash } from 'crypto';
import type { Express, Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import * as swaggerUi from 'swagger-ui-express';
import { metricsHandler } from '../observability/metrics.js';
import { ACTION_COUNT, TOOL_COUNT } from '../schemas/action-counts.js';
import { getTraceAggregator } from '../services/trace-aggregator.js';
import type { UserRateLimiter } from '../services/user-rate-limiter.js';
import { VERSION, SERVER_INFO } from '../version.js';
import { requireAdminAuth } from '../admin/index.js';
import { logger } from '../utils/logger.js';
import {
  getCacheStats,
  getConnectionStats,
  getDeduplicationStats,
  getTracingStats,
} from '../startup/lifecycle.js';
import { circuitBreakerRegistry } from '../services/circuit-breaker-registry.js';
import type { HealthService } from '../server/health.js';
import { resolveOpenApiJsonPath, resolveOpenApiYamlPath } from '../utils/runtime-paths.js';

interface HttpServerObservabilityOptions {
  enableOAuth?: boolean;
  oauthConfig?: {
    clientId: string;
    clientSecret: string;
  };
}

export function registerHttpObservabilityRoutes(params: {
  app: Express;
  healthService: HealthService;
  options: HttpServerObservabilityOptions;
  host: string;
  port: number;
  legacySseEnabled: boolean;
  getSessionCount: () => number;
  getUserRateLimiter: () => UserRateLimiter | null;
}): void {
  const {
    app,
    healthService,
    options,
    host,
    port,
    legacySseEnabled,
    getSessionCount,
    getUserRateLimiter,
  } = params;

  // Liveness probe - Is the server running?
  app.get('/health/live', async (_req: Request, res: Response) => {
    const health = await healthService.checkLiveness();
    res.status(200).json(health);
  });

  // Readiness probe - Is the server ready to handle requests?
  app.get('/health/ready', async (_req: Request, res: Response) => {
    const baseHealth = await healthService.checkReadiness();

    // Extended health response with OAuth and session info
    const health: typeof baseHealth & {
      oauth?: {
        enabled: boolean;
        configured: boolean;
      };
      sessions?: {
        hasAuthentication: boolean;
      };
    } = { ...baseHealth };

    // Add OAuth status if enabled
    if (options.enableOAuth && options.oauthConfig) {
      health.oauth = {
        enabled: true,
        configured: Boolean(
          options.oauthConfig.clientId &&
          options.oauthConfig.clientSecret &&
          !options.oauthConfig.clientSecret.includes('REPLACE_WITH')
        ),
      };
    }

    // Add active session info
    health.sessions = {
      hasAuthentication: getSessionCount() > 0,
    };

    // Return 200 for healthy/degraded, 503 for unhealthy
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  });

  // Legacy /health endpoint (redirects to /health/ready for compatibility)
  app.get('/health', async (_req: Request, res: Response) => {
    const health = await healthService.checkReadiness();
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  });

  // Trace context endpoint - View current request's trace information
  app.get('/trace', (req: Request, res: Response) => {
    const traceId = req.headers['x-trace-id'] as string | undefined;
    const spanId = req.headers['x-span-id'] as string | undefined;
    const parentSpanId = req.headers['x-parent-span-id'] as string | undefined;
    const requestId = req.headers['x-request-id'] as string | undefined;

    res.json({
      traceContext: {
        traceId,
        spanId,
        parentSpanId,
        requestId,
      },
      message: 'W3C Trace Context information for this request',
      spec: 'https://www.w3.org/TR/trace-context/',
      usage: 'Include traceparent header in requests: traceparent: 00-<traceId>-<parentId>-01',
    });
  });

  // MCP server info
  app.get('/info', (req: Request, res: Response) => {
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || `${host}:${port}`;
    const baseUrl = `${protocol}://${hostHeader}`;
    const transports = legacySseEnabled
      ? ['stdio', 'streamable-http', 'sse']
      : ['stdio', 'streamable-http'];
    const endpoints: Record<string, string> = {
      mcp: `${baseUrl}/mcp`,
      health: `${baseUrl}/health`,
      metrics: `${baseUrl}/metrics`,
      circuitBreakers: `${baseUrl}/metrics/circuit-breakers`,
      stats: `${baseUrl}/stats`,
      traces: `${baseUrl}/traces`,
      tracesRecent: `${baseUrl}/traces/recent`,
      tracesSlow: `${baseUrl}/traces/slow`,
      tracesErrors: `${baseUrl}/traces/errors`,
      tracesStats: `${baseUrl}/traces/stats`,
      apiDocs: `${baseUrl}/api-docs`,
      openapiJson: `${baseUrl}/api-docs/openapi.json`,
      openapiYaml: `${baseUrl}/api-docs/openapi.yaml`,
    };
    if (legacySseEnabled) {
      endpoints['sse'] = `${baseUrl}/sse`;
    }

    res.json({
      name: SERVER_INFO.name,
      version: VERSION,
      description: 'Production-grade Google Sheets MCP server',
      tools: TOOL_COUNT,
      actions: ACTION_COUNT,
      protocol: `MCP ${SERVER_INFO.protocolVersion}`,
      transports,
      discovery: {
        mcp_configuration: `${baseUrl}/.well-known/mcp-configuration`,
        oauth_authorization_server: `${baseUrl}/.well-known/oauth-authorization-server`,
        oauth_protected_resource: `${baseUrl}/.well-known/oauth-protected-resource`,
      },
      endpoints,
    });
  });

  // Explicit HEAD support for directory compliance testing
  // Express auto-handles HEAD for GET routes, but explicit handlers
  // ensure consistent behavior for Anthropic directory health checks
  app.head('/health', (_req: Request, res: Response) => res.status(200).end());
  app.head('/health/live', (_req: Request, res: Response) => res.status(200).end());
  app.head('/health/ready', (_req: Request, res: Response) => res.status(200).end());
  app.head('/info', (_req: Request, res: Response) => res.status(200).end());

  // OpenAPI/Swagger documentation
  const openapiJsonPath = resolveOpenApiJsonPath();
  const openapiYamlPath = resolveOpenApiYamlPath();

  // Serve OpenAPI spec (JSON)
  app.get('/api-docs/openapi.json', (_req: Request, res: Response) => {
    try {
      if (openapiJsonPath && existsSync(openapiJsonPath)) {
        const spec = JSON.parse(readFileSync(openapiJsonPath, 'utf-8'));
        res.json(spec);
      } else {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'OpenAPI spec not generated. Run: npm run gen:openapi',
          },
        });
      }
    } catch (error) {
      logger.error('Failed to serve OpenAPI spec', { error });
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load OpenAPI spec',
        },
      });
    }
  });

  // Serve OpenAPI spec (YAML)
  app.get('/api-docs/openapi.yaml', (_req: Request, res: Response) => {
    try {
      if (openapiYamlPath && existsSync(openapiYamlPath)) {
        const spec = readFileSync(openapiYamlPath, 'utf-8');
        res.set('Content-Type', 'text/yaml');
        res.send(spec);
      } else {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'OpenAPI spec not generated. Run: npm run gen:openapi',
          },
        });
      }
    } catch (error) {
      logger.error('Failed to serve OpenAPI spec', { error });
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load OpenAPI spec',
        },
      });
    }
  });

  // Swagger UI
  if (openapiJsonPath && existsSync(openapiJsonPath)) {
    try {
      const openapiSpec = JSON.parse(readFileSync(openapiJsonPath, 'utf-8'));
      app.use(
        '/api-docs',
        swaggerUi.serve,
        swaggerUi.setup(openapiSpec, {
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: 'ServalSheets API Documentation',
          customfavIcon: '/favicon.ico',
        })
      );
      logger.info('Swagger UI enabled at /api-docs');
    } catch (error) {
      logger.warn('Failed to load OpenAPI spec for Swagger UI', { error });
    }
  } else {
    // Fallback route when spec not generated - returns helpful error message
    app.get('/api-docs', (_req: Request, res: Response) => {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message:
            'API documentation not available. Generate OpenAPI spec with: npm run gen:openapi',
          hint: 'Run the generator script to create openapi.json and enable interactive documentation',
        },
      });
    });
  }

  // Prometheus metrics endpoint
  app.get('/metrics', requireAdminAuth, metricsHandler);

  // Circuit breaker metrics endpoint
  app.get('/metrics/circuit-breakers', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { circuitBreakerRegistry } = await import('../services/circuit-breaker-registry.js');
      const breakers = circuitBreakerRegistry.getAll();

      const metrics = breakers.map((entry) => {
        const stats = entry.breaker.getStats();
        return {
          name: entry.name,
          description: entry.description,
          state: stats.state,
          isOpen: stats.state === 'open',
          isHalfOpen: stats.state === 'half_open',
          isClosed: stats.state === 'closed',
          failureCount: stats.failureCount,
          successCount: stats.successCount,
          totalRequests: stats.totalRequests,
          lastFailure: stats.lastFailure,
          nextAttempt: stats.nextAttempt,
          fallbackUsageCount: stats.fallbackUsageCount,
          registeredFallbacks: stats.registeredFallbacks,
        };
      });

      res.json({
        timestamp: new Date().toISOString(),
        circuitBreakers: metrics,
        summary: {
          total: metrics.length,
          open: metrics.filter((m) => m.isOpen).length,
          halfOpen: metrics.filter((m) => m.isHalfOpen).length,
          closed: metrics.filter((m) => m.isClosed).length,
        },
      });
    } catch (error) {
      logger.error('Failed to fetch circuit breaker metrics', { error });
      res.status(500).json({ error: 'Failed to fetch circuit breaker metrics' });
    }
  });

  // Webhook delivery dashboard endpoint
  app.get('/webhooks/dashboard', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { getWebhookManager, getWebhookQueue } = await import('../services/index.js');

      // Get spreadsheet filter if provided
      const spreadsheetId = req.query['spreadsheetId'] as string | undefined;

      const manager = getWebhookManager();
      const queue = getWebhookQueue();

      // Get all webhooks (filtered by spreadsheetId if provided)
      const webhooks = await manager.list(spreadsheetId, undefined);

      // Get queue statistics
      const queueStats = await queue.getStats();

      // Calculate aggregate statistics
      const totalWebhooks = webhooks.length;
      const activeWebhooks = webhooks.filter((w) => w.active).length;
      const totalDeliveries = webhooks.reduce((sum, w) => sum + w.deliveryCount, 0);
      const totalFailures = webhooks.reduce((sum, w) => sum + w.failureCount, 0);

      // Calculate average delivery rate (deliveries per webhook)
      const avgDeliveryRate = totalWebhooks > 0 ? totalDeliveries / totalWebhooks : 0;

      // Per-webhook statistics
      const webhookStats = webhooks.map((webhook) => {
        const successCount = webhook.deliveryCount - webhook.failureCount;
        const successRate =
          webhook.deliveryCount > 0 ? (successCount / webhook.deliveryCount) * 100 : 0;

        return {
          webhookId: webhook.webhookId,
          spreadsheetId: webhook.spreadsheetId,
          active: webhook.active,
          deliveryCount: webhook.deliveryCount,
          failureCount: webhook.failureCount,
          successRate: Math.round(successRate * 100) / 100, // 2 decimal places
          avgDeliveryTimeMs: webhook.avgDeliveryTimeMs,
          p95DeliveryTimeMs: webhook.p95DeliveryTimeMs,
          p99DeliveryTimeMs: webhook.p99DeliveryTimeMs,
          lastDelivery: webhook.lastDelivery,
          lastFailure: webhook.lastFailure,
        };
      });

      res.json({
        timestamp: new Date().toISOString(),
        summary: {
          totalWebhooks,
          activeWebhooks,
          totalDeliveries,
          totalFailures,
          avgDeliveryRate: Math.round(avgDeliveryRate * 100) / 100,
        },
        queue: {
          pending: queueStats.pendingCount,
          retry: queueStats.retryCount,
          dlq: queueStats.dlqCount,
        },
        webhooks: webhookStats,
      });
    } catch (error) {
      logger.error('Failed to fetch webhook dashboard', { error });
      res.status(500).json({ error: 'Failed to fetch webhook dashboard' });
    }
  });

  // Statistics dashboard endpoint
  app.get('/stats', requireAdminAuth, async (req: Request, res: Response) => {
    const cacheStats = getCacheStats() as Record<string, unknown> | null;
    const dedupStats = getDeduplicationStats() as Record<string, unknown> | null;
    const connStats = getConnectionStats() as Record<string, unknown> | null;
    const tracingStats = getTracingStats() as Record<string, unknown> | null;
    const memUsage = process.memoryUsage();

    // Get per-user quota stats if rate limiter available
    let userQuota = null;
    const userRateLimiter = getUserRateLimiter();
    if (userRateLimiter) {
      try {
        // Extract user ID from Authorization header
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const userId = token
          ? `user:${createHash('sha256').update(token).digest('hex').substring(0, 16)}`
          : 'anonymous';

        const quotaStats = await userRateLimiter.getUsage(userId);
        userQuota = {
          enabled: true,
          minuteUsage: quotaStats.minuteUsage,
          minuteLimit: quotaStats.minuteLimit,
          minuteRemaining: quotaStats.minuteRemaining,
          hourUsage: quotaStats.hourUsage,
          hourLimit: quotaStats.hourLimit,
          hourRemaining: quotaStats.hourRemaining,
        };
      } catch (error) {
        logger.error('Failed to get per-user quota stats', { error });
        userQuota = { enabled: false, error: 'Failed to fetch quota' };
      }
    }

    res.json({
      uptime: {
        seconds: Math.floor(process.uptime()),
        formatted: formatUptime(process.uptime()),
      },
      cache: cacheStats
        ? {
            enabled: true,
            totalEntries: cacheStats['totalEntries'] as number,
            totalSizeMB: parseFloat(((cacheStats['totalSize'] as number) / 1024 / 1024).toFixed(2)),
            hits: cacheStats['hits'] as number,
            misses: cacheStats['misses'] as number,
            hitRate: parseFloat((cacheStats['hitRate'] as number).toFixed(2)),
            byNamespace: cacheStats['byNamespace'] as Record<string, unknown>,
            oldestEntry: cacheStats['oldestEntry']
              ? new Date(cacheStats['oldestEntry'] as number).toISOString()
              : null,
            newestEntry: cacheStats['newestEntry']
              ? new Date(cacheStats['newestEntry'] as number).toISOString()
              : null,
          }
        : { enabled: false },
      deduplication: dedupStats
        ? {
            enabled: true,
            totalRequests: dedupStats['totalRequests'] as number,
            deduplicatedRequests: dedupStats['deduplicatedRequests'] as number,
            savedRequests: dedupStats['savedRequests'] as number,
            deduplicationRate: parseFloat((dedupStats['deduplicationRate'] as number).toFixed(2)),
            pendingCount: dedupStats['pendingCount'] as number,
            oldestRequestAgeMs: dedupStats['oldestRequestAge'] as number,
          }
        : { enabled: false },
      connection: connStats
        ? {
            status: connStats['status'] as string,
            uptimeSeconds: connStats['uptimeSeconds'] as number,
            totalHeartbeats: connStats['totalHeartbeats'] as number,
            disconnectWarnings: connStats['disconnectWarnings'] as number,
            timeSinceLastActivityMs: connStats['timeSinceLastActivity'] as number,
            lastActivity: new Date(connStats['lastActivity'] as number).toISOString(),
          }
        : null,
      tracing: tracingStats
        ? {
            totalSpans: tracingStats['totalSpans'] as number,
            averageDurationMs: parseFloat((tracingStats['averageDuration'] as number).toFixed(2)),
            spansByKind: tracingStats['spansByKind'] as Record<string, unknown>,
            spansByStatus: tracingStats['spansByStatus'] as Record<string, unknown>,
          }
        : null,
      memory: {
        heapUsedMB: parseFloat((memUsage.heapUsed / 1024 / 1024).toFixed(2)),
        heapTotalMB: parseFloat((memUsage.heapTotal / 1024 / 1024).toFixed(2)),
        rssMB: parseFloat((memUsage.rss / 1024 / 1024).toFixed(2)),
        externalMB: parseFloat((memUsage.external / 1024 / 1024).toFixed(2)),
        arrayBuffersMB: parseFloat((memUsage.arrayBuffers / 1024 / 1024).toFixed(2)),
      },
      performance: {
        apiCallReduction:
          dedupStats && cacheStats
            ? {
                deduplicationSavings: `${(dedupStats['deduplicationRate'] as number).toFixed(1)}%`,
                cacheSavings: `${(cacheStats['hitRate'] as number).toFixed(1)}%`,
                estimatedTotalSavings: calculateTotalSavings(dedupStats, cacheStats),
              }
            : null,
      },
      sessions: {
        active: getSessionCount(),
      },
      userQuota: userQuota || { enabled: false },
      circuitBreakers: circuitBreakerRegistry.getAllStats(),
    });
  });

  // ==================== Trace Endpoints ====================

  // Search traces with filters
  app.get('/traces', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const aggregator = getTraceAggregator();

      if (!aggregator.isEnabled()) {
        res.json({
          enabled: false,
          message:
            'Trace aggregation is not enabled. Set TRACE_AGGREGATION_ENABLED=true to enable.',
        });
        return;
      }

      // Parse query filters with bounds validation
      const filters: Record<string, unknown> = {};
      if (req.query['tool']) filters['tool'] = req.query['tool'] as string;
      if (req.query['action']) filters['action'] = req.query['action'] as string;
      if (req.query['errorCode']) filters['errorCode'] = req.query['errorCode'] as string;
      if (req.query['success']) filters['success'] = req.query['success'] === 'true';
      if (req.query['minDuration']) {
        const val = Number.parseInt(req.query['minDuration'] as string, 10);
        if (!Number.isNaN(val)) filters['minDuration'] = Math.max(val, 0);
      }
      if (req.query['maxDuration']) {
        const val = Number.parseInt(req.query['maxDuration'] as string, 10);
        if (!Number.isNaN(val)) filters['maxDuration'] = Math.max(val, 0);
      }
      if (req.query['startTime']) {
        const val = Number.parseInt(req.query['startTime'] as string, 10);
        if (!Number.isNaN(val)) filters['startTime'] = Math.max(val, 0);
      }
      if (req.query['endTime']) {
        const val = Number.parseInt(req.query['endTime'] as string, 10);
        if (!Number.isNaN(val)) filters['endTime'] = Math.max(val, 0);
      }

      const rawLimit = req.query['limit'] ? Number.parseInt(req.query['limit'] as string, 10) : 100;
      const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 100 : rawLimit, 1), 1000);

      const traces = aggregator.searchTraces(
        filters as import('../services/trace-aggregator.js').TraceSearchFilters
      );

      res.json({
        count: traces.length,
        traces: traces.slice(0, limit),
        filters,
        _links: {
          self: '/traces',
          recent: '/traces/recent',
          slow: '/traces/slow',
          errors: '/traces/errors',
          stats: '/traces/stats',
        },
      });
    } catch (error) {
      logger.error('Failed to search traces', { error });
      res.status(500).json({ error: 'Failed to search traces' });
    }
  });

  // Get recent traces
  app.get('/traces/recent', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const aggregator = getTraceAggregator();

      if (!aggregator.isEnabled()) {
        res.json({
          enabled: false,
          message:
            'Trace aggregation is not enabled. Set TRACE_AGGREGATION_ENABLED=true to enable.',
        });
        return;
      }

      const limit = req.query['limit'] ? Number.parseInt(req.query['limit'] as string, 10) : 100;
      const traces = aggregator.getRecentTraces(limit);

      res.json({
        count: traces.length,
        traces,
      });
    } catch (error) {
      logger.error('Failed to get recent traces', { error });
      res.status(500).json({ error: 'Failed to get recent traces' });
    }
  });

  // Get slowest traces
  app.get('/traces/slow', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const aggregator = getTraceAggregator();

      if (!aggregator.isEnabled()) {
        res.json({
          enabled: false,
          message:
            'Trace aggregation is not enabled. Set TRACE_AGGREGATION_ENABLED=true to enable.',
        });
        return;
      }

      const limit = req.query['limit'] ? Number.parseInt(req.query['limit'] as string, 10) : 10;
      const traces = aggregator.getSlowestTraces(limit);

      res.json({
        count: traces.length,
        traces,
      });
    } catch (error) {
      logger.error('Failed to get slowest traces', { error });
      res.status(500).json({ error: 'Failed to get slowest traces' });
    }
  });

  // Get error traces
  app.get('/traces/errors', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const aggregator = getTraceAggregator();

      if (!aggregator.isEnabled()) {
        res.json({
          enabled: false,
          message:
            'Trace aggregation is not enabled. Set TRACE_AGGREGATION_ENABLED=true to enable.',
        });
        return;
      }

      const limit = req.query['limit'] ? Number.parseInt(req.query['limit'] as string, 10) : 100;
      const traces = aggregator.getErrorTraces(limit);

      res.json({
        count: traces.length,
        traces,
      });
    } catch (error) {
      logger.error('Failed to get error traces', { error });
      res.status(500).json({ error: 'Failed to get error traces' });
    }
  });

  // Get trace statistics
  app.get('/traces/stats', requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const aggregator = getTraceAggregator();

      if (!aggregator.isEnabled()) {
        res.json({
          enabled: false,
          message:
            'Trace aggregation is not enabled. Set TRACE_AGGREGATION_ENABLED=true to enable.',
        });
        return;
      }

      const stats = aggregator.getStats();
      const cacheStats = aggregator.getCacheStats();

      res.json({
        timestamp: new Date().toISOString(),
        enabled: true,
        cache: cacheStats,
        statistics: {
          total: stats.totalTraces,
          success: stats.successCount,
          errors: stats.errorCount,
          errorRate:
            stats.totalTraces > 0
              ? ((stats.errorCount / stats.totalTraces) * 100).toFixed(2) + '%'
              : '0%',
          averageDuration: `${stats.averageDuration.toFixed(2)}ms`,
          p50Duration: `${stats.p50Duration.toFixed(2)}ms`,
          p95Duration: `${stats.p95Duration.toFixed(2)}ms`,
          p99Duration: `${stats.p99Duration.toFixed(2)}ms`,
        },
        byTool: Object.entries(stats.byTool).map(([tool, toolStats]) => {
          const stats = toolStats as { count: number; averageDuration: number; errorRate: number };
          return {
            tool,
            count: stats.count,
            averageDuration: `${stats.averageDuration.toFixed(2)}ms`,
            errorRate: `${(stats.errorRate * 100).toFixed(2)}%`,
          };
        }),
        byError: stats.byError,
      });
    } catch (error) {
      logger.error('Failed to get trace stats', { error });
      res.status(500).json({ error: 'Failed to get trace stats' });
    }
  });

  // Get specific trace by request ID
  app.get('/traces/:requestId', requireAdminAuth, (req: Request, res: Response) => {
    try {
      const aggregator = getTraceAggregator();

      if (!aggregator.isEnabled()) {
        res.json({
          enabled: false,
          message:
            'Trace aggregation is not enabled. Set TRACE_AGGREGATION_ENABLED=true to enable.',
        });
        return;
      }

      const requestId = req.params['requestId'] as string;
      const trace = aggregator.getTrace(requestId);

      if (!trace) {
        res.status(404).json({
          error: 'Trace not found',
          requestId,
          hint: 'Traces are kept in memory for 5 minutes. Check /traces/recent for available traces.',
        });
        return;
      }

      res.json(trace);
    } catch (error) {
      logger.error('Failed to get trace', { error, requestId: req.params['requestId'] });
      res.status(500).json({ error: 'Failed to get trace' });
    }
  });

  // ==================== End of Trace Endpoints ====================

  // ==================== Tracing UI Routes ====================

  // Integrate tracing dashboard UI (P3-2)
  // Loaded synchronously - routes are added during server initialization
  // Protect UI routes with admin auth (same as other trace endpoints)
  app.use('/ui/tracing', requireAdminAuth);
  app.use('/traces/stream', requireAdminAuth);
  try {
    import('../http-server-tracing-ui.js')
      .then(({ addTracingUIRoutes }) => {
        addTracingUIRoutes(app);
        logger.info('Tracing UI routes loaded successfully');
      })
      .catch((error) => {
        logger.warn('Failed to load tracing UI routes', { error });
        // UI routes are optional - server still functions without them
      });
  } catch (error) {
    logger.warn('Failed to initialize tracing UI', { error });
  }

  // ==================== End of Tracing UI Routes ====================
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

function calculateTotalSavings(
  dedupStats: Record<string, unknown>,
  cacheStats: Record<string, unknown>
): string {
  // Estimate combined savings (not perfect but reasonable approximation)
  // Deduplication happens first, cache applies to non-deduplicated requests
  const dedupRate = (dedupStats['deduplicationRate'] as number) / 100;
  const cacheRate = (cacheStats['hitRate'] as number) / 100;
  const combinedSavings = (dedupRate + (1 - dedupRate) * cacheRate) * 100;
  return `~${combinedSavings.toFixed(1)}%`;
}
