import type { Express } from 'express';
import {
  BatchCompiler,
  DiffEngine,
  PolicyEnforcer,
  RangeResolver,
  RateLimiter,
  AuthenticationError,
} from '../core/index.js';
import { addAdminRoutes, type AdminSessionManager } from '../admin/index.js';
import { addGraphQLEndpoint } from '../graphql/index.js';
import type { HandlerContext } from '../handlers/index.js';
import { createGoogleApiClient } from '../services/google-api.js';
import { initConflictDetector } from '../services/conflict-detector.js';
import { initImpactAnalyzer } from '../services/impact-analyzer.js';
import { SnapshotService } from '../services/snapshot.js';
import { initTransactionManager } from '../services/transaction-manager.js';
import { initValidationEngine } from '../services/validation-engine.js';
import { requestDeduplicator } from '../utils/request-deduplication.js';
import { logger } from '../utils/logger.js';

export function registerHttpGraphQlAndAdmin(params: {
  app: Express;
  sessions: Map<string, unknown>;
}): void {
  const { app, sessions } = params;

  // GraphQL handler context factory
  const getHandlerContextForGraphQL = async (authToken?: string): Promise<HandlerContext> => {
    if (!authToken) {
      throw new AuthenticationError('Authentication required for GraphQL endpoint');
    }

    // Create Google API client
    const googleClient = await createGoogleApiClient({
      accessToken: authToken,
      refreshToken: undefined, // GraphQL uses bearer tokens, no refresh token
    });

    // Initialize Phase 4 advanced features
    initTransactionManager(googleClient);
    initConflictDetector(googleClient);
    initImpactAnalyzer(googleClient);
    initValidationEngine(googleClient);

    // Create SnapshotService for undo/revert operations
    const snapshotService = new SnapshotService({ driveApi: googleClient.drive });

    // Initialize all performance optimizations
    const { initializePerformanceOptimizations } = await import('../startup/performance-init.js');
    const {
      batchingSystem,
      cachedSheetsApi,
      requestMerger,
      parallelExecutor,
      prefetchPredictor,
      accessPatternTracker,
      queryOptimizer,
    } = await initializePerformanceOptimizations(googleClient.sheets);

    return {
      batchCompiler: new BatchCompiler({
        rateLimiter: new RateLimiter(),
        diffEngine: new DiffEngine({ sheetsApi: googleClient.sheets }),
        policyEnforcer: new PolicyEnforcer(),
        snapshotService,
        sheetsApi: googleClient.sheets,
        onProgress: async (event) => {
          logger.debug('GraphQL operation progress', {
            phase: event.phase,
            progress: `${event.current}/${event.total}`,
            message: event.message,
            spreadsheetId: event.spreadsheetId,
          });
        },
      }),
      rangeResolver: new RangeResolver({ sheetsApi: googleClient.sheets }),
      googleClient,
      batchingSystem,
      cachedSheetsApi,
      requestMerger,
      parallelExecutor,
      prefetchPredictor,
      accessPatternTracker,
      queryOptimizer,
      snapshotService,
      auth: {
        get hasElevatedAccess() {
          return googleClient?.hasElevatedAccess ?? false;
        },
        get scopes() {
          return googleClient?.scopes ?? [];
        },
      },
      // MCP-specific features not needed for GraphQL endpoint
      samplingServer: undefined,
      server: undefined,
      requestDeduplicator,
    };
  };

  // Initialize GraphQL endpoint (P3-1)
  addGraphQLEndpoint(app, getHandlerContextForGraphQL)
    .then(() => {
      logger.info('GraphQL endpoint initialized at /graphql');
    })
    .catch((error) => {
      logger.error('Failed to initialize GraphQL endpoint', { error });
    });

  // Session manager for admin dashboard
  const sessionManager: AdminSessionManager = {
    getAllSessions: () => {
      return Array.from(sessions.entries()).map(([id]) => ({
        id,
        clientName: 'MCP Client',
        clientVersion: '1.0.0',
        createdAt: Date.now(), // Approximate - sessions don't track creation time
      }));
    },
    getSessionCount: () => sessions.size,
    getTotalRequests: () => {
      // Approximate - use deduplication stats as proxy
      const stats = requestDeduplicator.getStats();
      return stats.totalRequests;
    },
  };

  // Initialize Admin Dashboard (P3-7)
  addAdminRoutes(app, sessionManager);
}
