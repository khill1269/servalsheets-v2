/**
 * ServalSheets - Base Handler
 *
 * Abstract base class for tool handlers
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import type { Intent } from '../core/intent.js';
import { ServiceError } from '../core/errors.js';
import type { BatchCompiler, ExecutionResult } from '../core/batch-compiler.js';
import type { RangeResolver } from '../core/range-resolver.js';
import type {
  SafetyOptions,
  ErrorDetail,
  MutationSummary,
  RangeInput,
  ResponseMeta,
} from '../schemas/shared.js';
import {
  getRequestLogger,
  getRequestContext,
  sendProgress as sendRequestContextProgress,
} from '../utils/request-context.js';
import {
  createPermissionError,
  createRateLimitError,
  createNotFoundError,
  createAuthenticationError,
  createValidationError,
  createZodValidationError,
  parseGoogleApiError,
} from '../utils/error-factory.js';
import {
  enhanceResponse,
  estimateCost,
  type EnhancementContext,
} from '../utils/response-enhancer.js';
import { getErrorPatternLearner } from '../services/error-pattern-learner.js';
import { suggestFix } from '../services/error-fix-suggester.js';
import { compactResponse } from '../utils/response-compactor.js';
import type { SamplingServer } from '../mcp/sampling.js';
import type { ElicitationServer } from '../mcp/elicitation.js';
import type { RequestDeduplicator } from '../utils/request-deduplication.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { circuitBreakerRegistry } from '../services/circuit-breaker-registry.js';
import { getCircuitBreakerConfig, getEnv } from '../config/env.js';
import {
  buildGridRangeInput,
  parseA1Notation,
  type GridRangeInput,
} from '../utils/google-sheets-helpers.js';
import type { sheets_v4 } from 'googleapis';
import { getContextManager } from '../services/context-manager.js';
import {
  requiresConfirmation,
  generateSafetyWarnings,
  createSnapshotIfNeeded,
  formatSafetyWarnings,
  shouldReturnPreview,
  buildSnapshotInfo,
  type SafetyContext,
  type SafetyWarning,
  type SnapshotResult,
} from '../utils/safety-helpers.js';
import { createEnhancedError, enhanceError } from '../utils/enhanced-errors.js';
import { withApiSpan } from '../utils/tracing.js';
import { recordGoogleApiCall } from '../observability/metrics.js';
import {
  ScopeValidator,
  IncrementalScopeRequiredError,
  OPERATION_SCOPES,
  ScopeCategory,
} from '../security/incremental-scope.js';
import {
  getFieldMask as getFieldMaskHelper,
  applyVerbosityFilter as applyVerbosityFilterHelper,
} from './helpers/validation-helpers.js';
import {
  columnToLetter as columnToLetterHelper,
  letterToColumn as letterToColumnHelper,
} from './helpers/column-helpers.js';
import type { SpreadsheetBackend } from '@serval/core';

export type HandlerMcpServer = SamplingServer & ElicitationServer;

export interface HandlerContext {
  /** Platform-agnostic backend (optional — enables multi-backend support) */
  backend?: SpreadsheetBackend;
  batchCompiler: BatchCompiler;
  rangeResolver: RangeResolver;
  sheetResolver?: import('../services/sheet-resolver.js').SheetResolver; // For sheet name/ID resolution
  googleClient?: import('../services/google-api.js').GoogleApiClient | null; // For authentication checks
  batchingSystem?: import('../services/batching-system.js').BatchingSystem;
  snapshotService?: import('../services/snapshot.js').SnapshotService; // For undo/revert operations
  cachedSheetsApi?: import('../services/cached-sheets-api.js').CachedSheetsApi; // ETag-based caching for reads
  requestMerger?: import('../services/request-merger.js').RequestMerger; // Phase 2: Merge overlapping read requests
  parallelExecutor?: import('../services/parallel-executor.js').ParallelExecutor; // Phase 2: Parallel batch execution
  prefetchPredictor?: import('../services/prefetch-predictor.js').PrefetchPredictor; // Phase 3: Predictive prefetching
  accessPatternTracker?: import('../services/access-pattern-tracker.js').AccessPatternTracker; // Phase 3: Access pattern learning
  queryOptimizer?: import('../services/query-optimizer.js').AdaptiveQueryOptimizer; // Phase 3B: Adaptive query optimization
  prefetchingSystem?: import('../services/prefetching-system.js').PrefetchingSystem | null; // Pattern-based prefetching (80% latency reduction)
  auth?: {
    hasElevatedAccess: boolean;
    scopes: string[];
  };
  samplingServer?: SamplingServer;
  requestDeduplicator?: RequestDeduplicator;
  circuitBreaker?: CircuitBreaker;
  elicitationServer?: ElicitationServer;
  server?: HandlerMcpServer; // Narrow MCP bridge for elicitation + sampling only
  taskStore?: import('../core/task-store-adapter.js').TaskStoreAdapter; // For task-based execution (SEP-1686)
  metrics?: import('../services/metrics.js').MetricsService; // For tracking confirmation skips and performance
  metadataCache?: import('../services/metadata-cache.js').MetadataCache; // Session-level metadata cache (N+1 elimination)
  sessionContext?: import('../services/session-context.js').SessionContextManager; // For redundant read detection
  logger?: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  costTracker?: import('../services/cost-tracker.js').CostTracker; // Per-tenant API call tracking (ENABLE_COST_TRACKING)
  duckdbEngine?: import('../services/duckdb-engine.js').DuckDBEngine; // DuckDB in-process SQL analytics (Phase 1)
  scheduler?: import('../services/scheduler.js').SchedulerService; // Scheduled recurring workflows (Phase 6)
  abortSignal?: AbortSignal;
  requestId?: string;
}

// Re-export unwrapRequest from helpers for backward compatibility
export { unwrapRequest } from './helpers/request-helpers.js';

/**
 * Success result type - flat structure matching outputSchema
 * Data fields are spread directly into the result object
 */
export type HandlerResult<T extends Record<string, unknown>> = T & {
  success: true;
  action: string;
  mutation?: MutationSummary;
  dryRun?: boolean;
  _meta?: ResponseMeta;
};

/**
 * Error result type
 */
export interface HandlerError {
  success: false;
  error: ErrorDetail;
}

/**
 * Combined output type
 */
export type HandlerOutput<T extends Record<string, unknown>> = HandlerResult<T> | HandlerError;

/**
 * Base handler with common utilities
 * Now using mixin pattern for better modularity
 */
export abstract class BaseHandler<TInput, TOutput> {
  protected context: HandlerContext;
  protected toolName: string;
  protected currentSpreadsheetId?: string; // Track current request for better error messages
  protected currentVerbosity: 'minimal' | 'standard' | 'detailed' = 'standard';
  private lastProgressTime = 0; // Throttle progress events to max 1/sec

  constructor(toolName: string, context: HandlerContext) {
    this.toolName = toolName;
    this.context = context;
  }

  /**
   * Get appropriate field mask for Google API calls (Priority 8)
   * Delegates to pure helper function for better testability.
   */
  protected getFieldMask(operation: 'metadata' | 'sheets_list' | 'full'): string | undefined {
    return getFieldMaskHelper(operation);
  }

  /**
   * Check that current OAuth scopes include required permissions for an operation.
   *
   * This provides graceful degradation when using standard scopes (~85% of actions):
   * - Operations with required scopes work normally
   * - Operations missing scopes throw IncrementalScopeRequiredError with auth URL
   * - User can grant additional permissions and retry
   *
   * Only active when INCREMENTAL_CONSENT_ENABLED=true (opt-in for SaaS deployments).
   * Self-hosted deployments with full scopes (default) skip validation.
   *
   * @param operation - Operation identifier (e.g., 'sheets_collaborate.share_add')
   * @throws {IncrementalScopeRequiredError} When scopes are insufficient
   */
  protected checkOperationScopes(operation: string): void {
    // Skip validation if incremental consent is disabled or auth context missing
    if (!getEnv().INCREMENTAL_CONSENT_ENABLED || !this.context.auth) {
      return;
    }

    const validator = new ScopeValidator({
      scopes: this.context.auth.scopes,
    });

    if (!validator.hasRequiredScopes(operation)) {
      const missingScopes = validator.getMissingScopes(operation);

      // Get operation config for required scopes and category
      const opConfig = OPERATION_SCOPES[operation];
      const requiredScopes = opConfig?.required ?? missingScopes;
      const category = opConfig?.category ?? ScopeCategory.SPREADSHEET;

      throw new IncrementalScopeRequiredError({
        operation,
        requiredScopes,
        currentScopes: this.context.auth.scopes,
        authorizationUrl: '#', // URL generation happens in ScopeValidator
        category,
      });
    }
  }

  /**
   * Set verbosity level for current request (call before building response)
   * When minimal, metadata generation is skipped to save ~400-800 tokens
   */
  protected setVerbosity(verbosity: 'minimal' | 'standard' | 'detailed' = 'standard'): void {
    this.currentVerbosity = verbosity;
  }

  /**
   * Send progress notification for long-running operations (Phase 2: HTTP Progress Notifications)
   * Only works with HTTP/SSE transport - gracefully degrades for STDIO
   * Throttled to max 1 event per second to avoid overwhelming the client
   *
   * @param completed - Number of items completed
   * @param total - Total number of items
   * @param message - Optional progress message
   */
  protected async sendProgress(completed: number, total: number, _message?: string): Promise<void> {
    // Throttle: max 1 event per second
    const now = Date.now();
    if (now - this.lastProgressTime < 1000) {
      return;
    }
    this.lastProgressTime = now;

    try {
      await sendRequestContextProgress(completed, total, _message);
    } catch (error) {
      // Don't fail the operation if progress notification fails
      // Just log and continue
      const logger = this.context.logger || getRequestLogger();
      logger?.warn?.('Failed to send progress notification', {
        error: error instanceof Error ? error.message : String(error),
        tool: this.toolName,
      });
    }
  }

  /**
   * Require authentication before executing tool
   * Throws clear error with step-by-step instructions if not authenticated
   */
  protected requireAuth(): void {
    if (!this.context.googleClient) {
      const error = createEnhancedError(
        'AUTHENTICATION_REQUIRED',
        `Authentication required for ${this.toolName}. Call sheets_auth with action "status" to check authentication, or action "login" to authenticate.`,
        {
          tool: this.toolName,
          hint: 'Authentication is required before using this tool',
          resolution: 'Authenticate using sheets_auth tool',
          steps: [
            '1. Check auth status: sheets_auth action="status"',
            '2. If not authenticated: sheets_auth action="login"',
            '3. Follow the OAuth flow to complete authentication',
            '4. Retry this operation',
          ],
        }
      );
      throw error;
    }
  }

  /**
   * Execute an API call with circuit breaker protection
   * Creates/retrieves a circuit breaker for the operation type
   * Protects against cascade failures when Google API degrades
   *
   * @param operation - Operation name for circuit breaker identification (e.g., 'values.get')
   * @param fn - The API call to execute
   * @param fallback - Optional fallback function if circuit is open
   */
  protected async withCircuitBreaker<T>(
    operation: string,
    fn: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const circuitName = `${this.toolName}:${operation}`;
    const config = getCircuitBreakerConfig();

    // Get or create circuit breaker from registry
    let entry = circuitBreakerRegistry.get(circuitName);
    if (!entry) {
      const newBreaker = new CircuitBreaker({
        name: circuitName,
        failureThreshold: config.failureThreshold,
        successThreshold: config.successThreshold,
        timeout: config.timeout,
      });
      circuitBreakerRegistry.register(circuitName, newBreaker);
      entry = circuitBreakerRegistry.get(circuitName);
    }

    return entry!.breaker.execute(fn, fallback);
  }

  /**
   * Execute an instrumented Google API call with distributed tracing and metrics
   * Automatically records latency metrics and creates trace spans for observability
   *
   * @param method - API method name (e.g., 'spreadsheets.values.get')
   * @param apiCall - The API call function to execute
   * @param context - Optional context for enhanced tracing (spreadsheetId, action, range, etc.)
   * @returns Promise resolving to the API call result
   */
  protected async instrumentedApiCall<T>(
    method: string,
    apiCall: () => Promise<T>,
    context?: { spreadsheetId?: string; action?: string; range?: string; sheetName?: string }
  ): Promise<T> {
    const startTime = Date.now();

    // Build endpoint URL for tracing
    const endpoint = context?.spreadsheetId
      ? `https://sheets.googleapis.com/v4/spreadsheets/${context.spreadsheetId}`
      : 'https://sheets.googleapis.com/v4';

    return withApiSpan(
      method,
      endpoint,
      async (span) => {
        // Add context attributes to span for better tracing
        if (context?.spreadsheetId) {
          span.setAttribute('spreadsheet.id', context.spreadsheetId);
          span.setAttribute('spreadsheetId', context.spreadsheetId);
        }
        if (context?.action) {
          span.setAttribute('action', context.action);
        }
        if (context?.range) {
          span.setAttribute('range', context.range);
        }
        if (context?.sheetName) {
          span.setAttribute('sheet.name', context.sheetName);
        }

        try {
          const result = await apiCall();
          const duration = (Date.now() - startTime) / 1000;
          recordGoogleApiCall(method, 'success', duration);
          return result;
        } catch (error) {
          if (error instanceof Error) {
            span.recordException(error);
          } else {
            span.setStatus('error', String(error));
          }
          const duration = (Date.now() - startTime) / 1000;
          recordGoogleApiCall(method, 'error', duration);
          throw error;
        }
      },
      { 'api.system': 'google_sheets' }
    );
  }

  /**
   * Execute intents through the batch compiler
   */
  protected async executeIntents(
    intents: Intent[],
    safety?: SafetyOptions
  ): Promise<ExecutionResult[]> {
    const batches = await this.context.batchCompiler.compile(intents);
    return this.context.batchCompiler.executeAll(batches, safety);
  }

  /**
   * Resolve a range input to A1 notation
   */
  protected async resolveRange(spreadsheetId: string, range: RangeInput): Promise<string> {
    const resolved = await this.context.rangeResolver.resolve(spreadsheetId, range);
    return resolved.a1Notation;
  }

  /**
   * Create a success response - FLAT structure matching outputSchema
   * Data fields are spread directly into the result (not nested under 'data')
   * Automatically generates response metadata if not provided
   */
  protected success<A extends string, T extends Record<string, unknown>>(
    action: A,
    data: T,
    mutation?: MutationSummary,
    dryRun?: boolean,
    meta?: ResponseMeta
  ): T & {
    success: true;
    action: A;
    mutation?: MutationSummary;
    dryRun?: boolean;
    _meta?: ResponseMeta;
  } {
    const result: T & {
      success: true;
      action: A;
      mutation?: MutationSummary;
      dryRun?: boolean;
      _meta?: ResponseMeta;
    } = {
      success: true as const,
      action,
      ...data,
    };

    // Only include optional fields if they have values
    if (mutation !== undefined) {
      result.mutation = mutation;
    }
    if (dryRun !== undefined) {
      result.dryRun = dryRun;
    }

    // Auto-generate metadata if not provided
    // Skip metadata generation for minimal verbosity (LLM optimization - saves ~400-800 tokens)
    // Handlers can still override by passing explicit meta
    if (this.currentVerbosity !== 'minimal') {
      if (meta !== undefined) {
        result._meta = meta;
      } else {
        // Generate metadata with context from the result
        const cellsAffected = this.extractCellsAffected(data);
        result._meta = this.generateMeta(action, data, data, { cellsAffected });
      }
    }
    // Note: No _meta field added when verbosity is minimal - this is intentional

    // Apply response compaction to reduce token usage for LLM consumption
    // Respects verbosity level and COMPACT_RESPONSES environment variable
    return compactResponse(result, { verbosity: this.currentVerbosity });
  }

  /**
   * Extract cells affected count from result data
   */
  private extractCellsAffected(data: Record<string, unknown>): number | undefined {
    // Try common field names
    if (typeof data['updatedCells'] === 'number') return data['updatedCells'];
    if (typeof data['cellsAffected'] === 'number') return data['cellsAffected'];
    if (typeof data['cellsFormatted'] === 'number') return data['cellsFormatted'];

    // Try to infer from values array
    const values = data['values'];
    if (Array.isArray(values)) {
      return values.reduce((sum: number, row: unknown) => {
        return sum + (Array.isArray(row) ? row.length : 0);
      }, 0);
    }

    // OK: Explicit empty - typed as optional, cells count cannot be inferred
    return undefined;
  }

  /**
   * Generate response metadata with suggestions and cost estimates
   * Phase 1.5: Smart metadata generation based on verbosity level
   * - minimal: No metadata (handled by caller)
   * - standard: Only costEstimate (saves ~300-600 tokens)
   * - detailed: Full metadata (suggestions, costEstimate, relatedTools, nextSteps)
   */
  protected generateMeta(
    action: string,
    input: Record<string, unknown>,
    result?: Record<string, unknown>,
    options?: {
      cellsAffected?: number;
      apiCallsMade?: number;
      duration?: number;
    }
  ): ResponseMeta {
    const context: EnhancementContext = {
      tool: this.toolName,
      action,
      input,
      result,
      cellsAffected: options?.cellsAffected,
      apiCallsMade: options?.apiCallsMade || 1,
      duration: options?.duration,
    };

    // For standard verbosity, generate lightweight metadata (cost only)
    // This saves ~300-600 tokens while preserving essential cost information
    if (this.currentVerbosity === 'standard') {
      const costEstimate = estimateCost(context);
      return { costEstimate };
    }

    // For detailed verbosity, include full metadata
    return enhanceResponse(context);
  }

  /**
   * Create an error response with enhanced context
   */
  protected error(error: ErrorDetail): HandlerError {
    return {
      success: false,
      error,
    };
  }

  /**
   * Create enhanced error with suggested fixes
   */
  protected enhancedError(
    code: string,
    message: string,
    context?: Record<string, unknown>
  ): HandlerError {
    return createEnhancedError(code, message, context);
  }

  /**
   * Helper: Create "not found" error (SHEET_NOT_FOUND, CHART_NOT_FOUND, etc.)
   */
  protected notFoundError(
    resourceType: string,
    identifier: string | number,
    details?: Record<string, unknown>
  ): HandlerError {
    return this.error({
      code: ErrorCodes.SHEET_NOT_FOUND,
      message: `${resourceType} ${identifier} not found`,
      retryable: false,
      suggestedFix: 'Verify the sheet name or ID is correct',
      details,
    });
  }

  /**
   * Helper: Create "invalid" error (INVALID_RANGE, INVALID_REQUEST, etc.)
   */
  protected invalidError(
    what: string,
    why: string,
    details?: Record<string, unknown>
  ): HandlerError {
    return this.error({
      code: ErrorCodes.INVALID_REQUEST,
      message: `Invalid ${what}: ${why}`,
      retryable: false,
      suggestedFix: 'Verify the request format is correct',
      details,
    });
  }

  /**
   * Map any error to a structured HandlerError
   */
  protected mapError(err: unknown): HandlerError {
    const logger = getRequestLogger();
    if (err instanceof Error) {
      const errAny = err as unknown as Record<string, unknown>;

      const enrichDetail = (detail: ErrorDetail, action?: string): ErrorDetail => {
        if (detail.resolution || detail.resolutionSteps) {
          return detail;
        }

        const enhanced = enhanceError(detail.code, detail.message, detail.details);
        let enriched: ErrorDetail = {
          ...detail,
          resolution: detail.resolution ?? enhanced.resolution,
          resolutionSteps: detail.resolutionSteps ?? enhanced.resolutionSteps,
          retryable: detail.retryable ?? enhanced.retryable,
        };

        // Inject learned fix from error pattern learner (non-blocking)
        try {
          const patternLearner = getErrorPatternLearner();
          const patterns = patternLearner.getPatterns(detail.code, {
            tool: this.toolName,
            action,
          });
          if (patterns?.topResolution && patterns.topResolution.occurrenceCount >= 3) {
            enriched = {
              ...enriched,
              suggestedFix:
                enriched.suggestedFix ??
                `Learned fix (${Math.round(patterns.topResolution.successRate * 100)}% success): ${patterns.topResolution.fix}`,
            };
          }
        } catch {
          // Non-blocking: pattern learner failure must not affect error reporting
        }

        // Inject fixableVia from error-fix-suggester (non-blocking)
        try {
          if (!enriched.fixableVia) {
            const fix = suggestFix(detail.code, detail.message, this.toolName, action);
            if (fix) {
              enriched = {
                ...enriched,
                fixableVia: {
                  tool: fix.tool,
                  action: fix.action,
                  params: fix.params as Record<
                    string,
                    string | number | boolean | unknown[] | Record<string, unknown> | null
                  >,
                },
              };
            }
          }
        } catch {
          // Non-blocking: suggester failure must not affect error reporting
        }

        return enriched;
      };

      if (typeof errAny['toErrorDetail'] === 'function') {
        const detail = (err as unknown as { toErrorDetail: () => ErrorDetail }).toErrorDetail();
        return this.error(enrichDetail(detail));
      }

      // Check if it's already a structured error (from RangeResolver, PolicyEnforcer, etc.)
      if ('code' in err && typeof errAny['code'] === 'string') {
        const structured = err as Error & {
          code: string;
          details?: Record<string, unknown>;
          retryable?: boolean;
          retryAfterMs?: number;
          resolution?: string;
          resolutionSteps?: string[];
          category?: ErrorDetail['category'];
          severity?: ErrorDetail['severity'];
          retryStrategy?: ErrorDetail['retryStrategy'];
          suggestedTools?: string[];
          suggestedFix?: string;
          alternatives?: ErrorDetail['alternatives'];
        };
        const detail: ErrorDetail = {
          code: structured.code as ErrorDetail['code'],
          message: structured.message,
          details: structured.details,
          retryable: structured.retryable ?? false,
        };

        if (typeof structured.retryAfterMs === 'number') {
          detail.retryAfterMs = structured.retryAfterMs;
        }
        if (typeof structured.resolution === 'string') {
          detail.resolution = structured.resolution;
        }
        if (structured.resolutionSteps) {
          detail.resolutionSteps = structured.resolutionSteps;
        }
        if (structured.category) {
          detail.category = structured.category;
        }
        if (structured.severity) {
          detail.severity = structured.severity;
        }
        if (structured.retryStrategy) {
          detail.retryStrategy = structured.retryStrategy;
        }
        if (structured.suggestedTools) {
          detail.suggestedTools = structured.suggestedTools;
        }
        if (structured.suggestedFix) {
          detail.suggestedFix = structured.suggestedFix;
        }
        if (structured.alternatives) {
          detail.alternatives = structured.alternatives;
        }

        return this.error(enrichDetail(detail));
      }

      // Check if it's a Zod validation error (has `issues` array)
      if (
        'issues' in err &&
        Array.isArray(errAny['issues']) &&
        (errAny['issues'] as unknown[]).length > 0
      ) {
        const issues = errAny['issues'] as Array<{
          code: string;
          path: (string | number)[];
          message: string;
          expected?: string;
          received?: string;
          options?: unknown[];
        }>;
        const zodDetail = createZodValidationError(issues, this.toolName);
        return this.error(enrichDetail(zodDetail));
      }

      // Map Google API errors
      const mapped = this.mapGoogleApiError(err);
      if (mapped.code === 'INTERNAL_ERROR' || mapped.code === 'UNKNOWN_ERROR') {
        logger.error('Handler error', { tool: this.toolName, error: err });
      }
      return this.error(mapped);
    }

    logger.error('Handler error', { tool: this.toolName, error: err });
    return this.error({
      code: ErrorCodes.UNKNOWN_ERROR,
      message: String(err),
      retryable: false,
      suggestedFix: 'Please try again. If the issue persists, contact support',
    });
  }

  /**
   * Map Google API error to ErrorDetail with agent-actionable information
   */
  private mapGoogleApiError(error: Error): ErrorDetail {
    const message = error.message.toLowerCase();

    // Try to extract structured error info from Google API error
    const errorAny = error as unknown as Record<string, unknown>;
    if ('code' in errorAny && typeof errorAny['code'] === 'number') {
      // Use error factory for structured Google API errors
      const googleError = errorAny as {
        code: number;
        message: string;
        errors?: Array<{ domain?: string; reason?: string; message?: string }>;
      };
      const parsed = parseGoogleApiError(googleError);

      // Fix "unknown" resourceId if we have actual spreadsheet ID
      if (this.currentSpreadsheetId && parsed.details?.['resourceId'] === 'unknown') {
        parsed.details['resourceId'] = this.currentSpreadsheetId;
        // Also fix the message text
        if (parsed.message) {
          parsed.message = parsed.message.replace('unknown', this.currentSpreadsheetId);
        }
      }

      return parsed as ErrorDetail;
    }

    // ISSUE-044: Check numeric HTTP status before falling back to fragile string matching.
    // GaxiosError exposes status via error.status or error.response?.status.
    const httpStatus: number | undefined =
      typeof errorAny['status'] === 'number'
        ? (errorAny['status'] as number)
        : typeof (errorAny['response'] as Record<string, unknown> | undefined)?.['status'] ===
            'number'
          ? ((errorAny['response'] as Record<string, unknown>)['status'] as number)
          : undefined;

    if (httpStatus === 429) {
      const circuitBreakerState =
        this.context.googleClient &&
        typeof this.context.googleClient.getCircuitBreakerState === 'function'
          ? this.context.googleClient.getCircuitBreakerState()
          : undefined;
      return createRateLimitError({
        quotaType: 'requests',
        retryAfterMs: 60000,
        circuitBreakerState,
      });
    }
    if (httpStatus === 401) {
      const authMessage = error.message.toLowerCase();
      const reason =
        authMessage.includes('expired') ||
        authMessage.includes('revoked') ||
        authMessage.includes('invalid_grant')
          ? 'expired_token'
          : 'invalid_token';

      return createAuthenticationError({ reason });
    }
    if (httpStatus === 403) {
      return createPermissionError({
        operation: 'perform this operation',
        resourceType: 'spreadsheet',
        currentPermission: 'view',
        requiredPermission: 'edit',
      });
    }
    if (httpStatus === 404) {
      return createNotFoundError({
        resourceType: 'spreadsheet',
        resourceId: this.currentSpreadsheetId || 'unknown (check spreadsheet ID)',
        searchSuggestion: 'Verify the spreadsheet URL and your access permissions',
      });
    }

    // Fallback: Parse from message string (locale-sensitive, used only when no numeric code)

    // Rate limit (429)
    if (message.includes('429') || message.includes('rate limit')) {
      const circuitBreakerState =
        this.context.googleClient &&
        typeof this.context.googleClient.getCircuitBreakerState === 'function'
          ? this.context.googleClient.getCircuitBreakerState()
          : undefined;
      return createRateLimitError({
        quotaType: 'requests',
        retryAfterMs: 60000,
        circuitBreakerState,
      });
    }

    // Quota exceeded
    if (message.includes('quota exceeded') || message.includes('quota')) {
      const circuitBreakerState =
        this.context.googleClient &&
        typeof this.context.googleClient.getCircuitBreakerState === 'function'
          ? this.context.googleClient.getCircuitBreakerState()
          : undefined;
      return createRateLimitError({
        quotaType: 'requests',
        retryAfterMs: 3600000,
        circuitBreakerState,
      });
    }

    // Permission denied (403)
    if (
      message.includes('401') ||
      message.includes('invalid credentials') ||
      message.includes('autherror') ||
      message.includes('unauthenticated')
    ) {
      const reason =
        message.includes('expired') ||
        message.includes('revoked') ||
        message.includes('invalid_grant')
          ? 'expired_token'
          : 'invalid_token';
      return createAuthenticationError({ reason });
    }

    // Permission denied (403)
    if (
      message.includes('403') ||
      message.includes('permission') ||
      message.includes('forbidden')
    ) {
      return createPermissionError({
        operation: 'perform this operation',
        resourceType: 'spreadsheet',
        currentPermission: 'view',
        requiredPermission: 'edit',
      });
    }

    // Not found (404)
    if (
      message.includes('404') ||
      message.includes('not found') ||
      message.includes('requested entity was not found')
    ) {
      return createNotFoundError({
        resourceType: 'spreadsheet',
        resourceId: this.currentSpreadsheetId || 'unknown (check spreadsheet ID)',
        searchSuggestion: 'Verify the spreadsheet URL and your access permissions',
      });
    }

    // Invalid range
    if (message.includes('unable to parse range') || message.includes('invalid range')) {
      return createValidationError({
        field: 'range',
        value: 'invalid',
        expectedFormat: 'A1 notation (e.g., "Sheet1!A1:C10")',
        reason: 'Range specification could not be parsed',
      });
    }

    // Circular reference
    if (message.includes('circular')) {
      return createValidationError({
        field: 'formula',
        value: 'contains circular reference',
        reason: 'Formula creates a circular dependency',
      });
    }

    // HTTP/2 Connection Errors (transient, auto-recoverable)
    // These occur when Google servers close idle connections or during network issues
    const errorCode = (error as { code?: string }).code;
    if (
      errorCode?.startsWith('ERR_HTTP2') ||
      message.includes('http2') ||
      message.includes('goaway') ||
      message.includes('stream cancel') ||
      message.includes('stream error') ||
      message.includes('session error') ||
      message.includes('new streams cannot be created') ||
      message.includes('the pending stream has been canceled')
    ) {
      return {
        code: ErrorCodes.CONNECTION_ERROR,
        message:
          'HTTP/2 connection was reset by Google servers. This is a temporary network issue.',
        category: 'transient',
        severity: 'medium',
        retryable: true,
        retryAfterMs: 2000,
        resolution: 'The connection will automatically recover. Please retry the operation.',
        resolutionSteps: [
          '1. Wait 2-5 seconds for connection recovery',
          '2. Retry the same operation',
          '3. If error persists after 3 retries, the server may need restart',
          '4. Check network connectivity if issue continues',
        ],
        details: {
          errorCode: errorCode || 'HTTP2_ERROR',
          originalMessage: error.message,
          recoveryAction: 'automatic',
        },
      };
    }

    // DNS / Network errors (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, ECONNRESET, etc.)
    // These surface when internet is unavailable or Google API is unreachable
    if (
      errorCode === 'ENOTFOUND' ||
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNRESET' ||
      errorCode === 'EAI_AGAIN' ||
      message.includes('getaddrinfo') ||
      message.includes('network') ||
      message.includes('dns')
    ) {
      const isTimeout = errorCode === 'ETIMEDOUT' || message.includes('timeout');
      return {
        code: ErrorCodes.CONNECTION_ERROR,
        message: isTimeout
          ? 'Request to Google Sheets API timed out. The network may be slow or unavailable.'
          : 'Cannot reach Google Sheets API. Check your internet connection.',
        category: 'transient',
        severity: 'high',
        retryable: true,
        retryAfterMs: 5000,
        resolution: 'Check your internet connection and retry.',
        resolutionSteps: [
          '1. Check your internet connection (try opening a webpage)',
          '2. If on VPN, verify it allows access to googleapis.com',
          '3. Try flushing DNS cache: sudo dscacheutil -flushcache (macOS) or sudo resolvectl flush-caches (Linux)',
          '4. Wait a few seconds and retry the operation',
          '5. If persistent, check firewall/proxy settings for sheets.googleapis.com',
        ],
        details: {
          errorCode: errorCode || 'NETWORK_ERROR',
          hostname: 'sheets.googleapis.com',
          originalMessage: error.message,
          recoveryAction: 'automatic_retry',
        },
      };
    }

    // Default: internal error
    return {
      code: ErrorCodes.INTERNAL_ERROR,
      message: error.message,
      category: 'server',
      severity: 'high',
      retryable: false,
      retryStrategy: 'none',
      resolution:
        'This is an internal error. Check the error message for details or contact support.',
      resolutionSteps: [
        '1. Check the error message for specific details',
        '2. Verify your request parameters are correct',
        '3. If the error persists, report it with the full error message',
      ],
    };
  }

  /**
   * Create mutation summary from execution results
   */
  protected createMutationSummary(results: ExecutionResult[]): MutationSummary | undefined {
    // OK: Explicit empty - typed as optional, no results to summarize
    if (results.length === 0) return undefined;

    const firstResult = results[0];
    // OK: Explicit empty - typed as optional, invalid result
    if (!firstResult) return undefined;

    return {
      cellsAffected:
        firstResult.diff?.tier === 'METADATA'
          ? firstResult.diff.summary.estimatedCellsChanged
          : firstResult.diff?.tier === 'FULL'
            ? firstResult.diff.summary.cellsChanged
            : 0,
      diff: firstResult.diff,
      reversible: !!firstResult.snapshotId,
      revertSnapshotId: firstResult.snapshotId,
    };
  }

  /**
   * Convert column index (0-based) to letter (A, B, ..., Z, AA, AB, ...)
   * Delegates to helper with memoization for performance.
   */
  protected columnToLetter(index: number): string {
    return columnToLetterHelper(index);
  }

  /**
   * Convert column letter to 0-based index
   * Delegates to helper with memoization for performance.
   */
  protected letterToColumn(letter: string): number {
    return letterToColumnHelper(letter);
  }

  /**
   * Track spreadsheet ID for better error messages
   *
   * Call this at the start of handle() to enable better error reporting.
   * This allows error messages to show the actual spreadsheet ID instead of "unknown".
   */
  protected trackSpreadsheetId(spreadsheetId?: string): void {
    this.currentSpreadsheetId = spreadsheetId;
  }

  /**
   * Infer missing parameters from conversational context
   *
   * Phase 1, Task 1.4 - Parameter Inference
   *
   * Automatically fills in spreadsheetId, sheetId, and range from recent operations
   * when they're missing from the current request.
   */
  protected inferRequestParameters<T extends Record<string, unknown>>(request: T): T {
    const contextManager = getContextManager();
    return contextManager.inferParameters(request);
  }

  /**
   * Update conversational context from successful operation
   *
   * Phase 1, Task 1.4 - Parameter Inference
   *
   * Tracks spreadsheetId, sheetId, and range for future parameter inference.
   * Call this after successful operations to maintain context.
   */
  protected trackContextFromRequest(params: {
    spreadsheetId?: string;
    sheetId?: number;
    range?: string;
    sheetName?: string;
  }): void {
    const contextManager = getContextManager();
    contextManager.updateContext(params);
  }

  /**
   * Record access pattern and trigger predictive prefetch
   *
   * Integrates with the prefetching system to enable 80% latency reduction
   * on sequential operations. Non-blocking - errors don't affect main operation.
   *
   * When to call:
   * - After successful read operations (sheet data, metadata)
   * - After spreadsheet open/list operations
   * - Not needed for write operations (they invalidate cache)
   *
   * @param params - Operation parameters for pattern tracking
   */
  protected recordAccessAndPrefetch(params: {
    spreadsheetId: string;
    sheetId?: number;
    range?: string;
    action?: 'read' | 'write' | 'open';
  }): void {
    const prefetchingSystem = this.context.prefetchingSystem;
    if (!prefetchingSystem) {
      return; // Feature not enabled or not initialized
    }

    try {
      // Record access pattern for learning
      const tracker = this.context.accessPatternTracker;
      if (tracker) {
        tracker.recordAccess({
          spreadsheetId: params.spreadsheetId,
          sheetId: params.sheetId,
          range: params.range,
          action: params.action ?? 'read',
        });
      }

      // Trigger prefetch for likely next operations (non-blocking)
      void prefetchingSystem
        .prefetch({
          spreadsheetId: params.spreadsheetId,
          sheetId: params.sheetId,
          range: params.range,
        })
        .catch((err) => {
          // Log but don't propagate prefetch errors
          const logger = this.context.logger || getRequestLogger();
          logger?.warn?.('Prefetch failed', {
            error: err instanceof Error ? err.message : String(err),
            spreadsheetId: params.spreadsheetId,
          });
        });
    } catch (err) {
      // Non-blocking - log but don't affect main operation
      const logger = this.context.logger || getRequestLogger();
      logger?.warn?.('Access pattern recording failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Check if operation requires confirmation
   */
  protected shouldRequireConfirmation(context: SafetyContext): boolean {
    return requiresConfirmation(context);
  }

  /**
   * Auto-confirm destructive operation before execution (Phase 1.3)
   *
   * Automatically requests user confirmation for destructive operations via MCP Elicitation.
   * Handlers should call this BEFORE executing any delete/clear/destructive operation.
   *
   * @param operation - Operation description (e.g., "Delete sheet", "Clear data")
   * @param details - Impact details (e.g., "This will permanently remove 1000 rows")
   * @param context - Safety context with operation metadata
   * @param options - Optional configuration
   * @returns True if user confirmed or no confirmation needed, false if user cancelled
   *
   * @example
   * ```typescript
   * const canProceed = await this.confirmOperation(
   *   `Delete sheet "${sheetName}"`,
   *   `This will permanently remove the sheet and all its data (${rowCount} rows).`,
   *   {
   *     isDestructive: true,
   *     operationType: 'delete_sheet',
   *     affectedRows: rowCount,
   *     spreadsheetId: req.spreadsheetId,
   *   }
   * );
   *
   * if (!canProceed) {
   *   return this.error({
   *     code: ErrorCodes.OPERATION_CANCELLED,
   *     message: 'Operation cancelled by user',
   *     retryable: false,
   suggestedFix: 'Retry the operation',
   *   });
   * }
   * ```
   */
  protected async confirmOperation(
    operation: string,
    details: string,
    context: SafetyContext,
    options?: { skipIfElicitationUnavailable?: boolean }
  ): Promise<boolean> {
    const logger = getRequestLogger();

    // Check if confirmation is required based on safety rules
    if (!this.shouldRequireConfirmation(context)) {
      logger.debug('Operation does not require confirmation', {
        operation,
        isDestructive: context.isDestructive,
        affectedCells: context.affectedCells,
        affectedRows: context.affectedRows,
      });
      return true; // Safe to proceed
    }

    // Check if elicitation server is available
    if (!this.context.server) {
      logger.warn('Elicitation not available for destructive operation', {
        operation,
        skipIfUnavailable: options?.skipIfElicitationUnavailable,
      });

      // If skipIfElicitationUnavailable is true, proceed without confirmation
      // (backward compatibility for clients that don't support elicitation)
      if (options?.skipIfElicitationUnavailable) {
        return true;
      }

      // Otherwise, block the operation for safety
      return false;
    }

    // Import confirmDestructiveAction dynamically to avoid circular dependencies
    const { confirmDestructiveAction } = await import('../mcp/elicitation.js');

    try {
      const confirmation = await confirmDestructiveAction(this.context.server, operation, details);

      logger.info('User confirmation received', {
        operation,
        confirmed: confirmation.confirmed,
        reason: confirmation.reason,
      });

      return confirmation.confirmed;
    } catch (error) {
      logger.error('Confirmation request failed', {
        operation,
        error: error instanceof Error ? error.message : String(error),
      });

      // On error, err on the side of safety (block the operation)
      return false;
    }
  }

  /**
   * Generate safety warnings for operation
   */
  protected getSafetyWarnings(
    context: SafetyContext,
    safetyOptions?: SafetyOptions
  ): SafetyWarning[] {
    return generateSafetyWarnings(context, safetyOptions);
  }

  /**
   * Create snapshot if needed for destructive operation
   */
  protected async createSafetySnapshot(
    context: SafetyContext,
    safetyOptions?: SafetyOptions
  ): Promise<SnapshotResult | null> {
    return createSnapshotIfNeeded(this.context.snapshotService, context, safetyOptions);
  }

  /**
   * Format safety warnings for response
   */
  protected formatWarnings(warnings: SafetyWarning[]): string[] {
    return formatSafetyWarnings(warnings);
  }

  /**
   * Check if should return preview (dry-run mode)
   */
  protected isDryRun(safetyOptions?: SafetyOptions): boolean {
    return shouldReturnPreview(safetyOptions);
  }

  /**
   * Build snapshot info for response
   */
  protected snapshotInfo(snapshot: SnapshotResult | null): Record<string, unknown> | undefined {
    return buildSnapshotInfo(snapshot);
  }

  /**
   * Fetch comprehensive metadata for analysis (Phase 2 optimization)
   *
   * This helper provides a single method for all handlers to fetch comprehensive
   * spreadsheet metadata in ONE API call, instead of making multiple separate calls.
   *
   * Returns cached data if available, otherwise fetches comprehensive metadata
   * including:
   * - All sheet properties
   * - All conditional formats
   * - All protected ranges
   * - All charts
   * - All named ranges
   * - All filter views
   * - All merges
   *
   * Usage in analysis handlers:
   * ```typescript
   * const metadata = await this.fetchComprehensiveMetadata(spreadsheetId, sheetsApi);
   * const sheets = metadata.sheets ?? [];
   * const namedRanges = metadata.namedRanges ?? [];
   * ```
   */
  protected async fetchComprehensiveMetadata(
    spreadsheetId: string,
    sheetsApi: import('googleapis').sheets_v4.Sheets
  ): Promise<import('googleapis').sheets_v4.Schema$Spreadsheet> {
    const { cacheManager, createCacheKey } = await import('../utils/cache-manager.js');
    const { CACHE_TTL_SPREADSHEET } = await import('../config/constants.js');

    // Check cache first
    const cacheKey = createCacheKey('spreadsheet:comprehensive', {
      spreadsheetId,
    });
    const cached = cacheManager.get<import('googleapis').sheets_v4.Schema$Spreadsheet>(
      cacheKey,
      'spreadsheet'
    );

    if (cached) {
      return cached;
    }

    // Fetch comprehensive metadata in ONE call
    const fields = [
      'spreadsheetId',
      'properties',
      'namedRanges',
      'sheets(properties,conditionalFormats,protectedRanges,charts,filterViews,basicFilter,merges)',
    ].join(',');

    const response = await this.instrumentedApiCall(
      'spreadsheets.get',
      () =>
        sheetsApi.spreadsheets.get({
          spreadsheetId,
          includeGridData: false,
          fields,
        }),
      {
        spreadsheetId,
        action: 'fetch_comprehensive_metadata',
      }
    );

    // Cache for 5 minutes
    cacheManager.set(cacheKey, response.data, {
      ttl: CACHE_TTL_SPREADSHEET,
      namespace: 'spreadsheet',
    });

    return response.data;
  }

  /**
   * Validate spreadsheet size before using includeGridData=true without explicit ranges.
   *
   * This prevents fetching massive payloads on large spreadsheets when using
   * includeGridData without bounded ranges. Returns an error if the spreadsheet
   * exceeds safe limits for full grid data retrieval.
   *
   * Use this BEFORE making any sheetsApi.spreadsheets.get() call with:
   * - includeGridData: true AND
   * - ranges: [] (empty/undefined, meaning ALL sheets)
   *
   * Safe limits (conservative to prevent OOM and timeouts):
   * - Max 500,000 cells total across all sheets
   * - Max 50 sheets
   *
   * @param spreadsheetId - The spreadsheet to validate
   * @param sheetsApi - Sheets API instance
   * @param sheetId - Optional: only validate a specific sheet
   * @returns null if safe to proceed, or an error response if too large
   */
  protected async validateGridDataSize(
    spreadsheetId: string,
    sheetsApi: import('googleapis').sheets_v4.Sheets,
    sheetId?: number
  ): Promise<HandlerError | null> {
    const MAX_CELLS_FOR_GRID_DATA = 500_000; // 500K cells
    const MAX_SHEETS_FOR_GRID_DATA = 50;

    try {
      const metadata = await this.instrumentedApiCall(
        'spreadsheets.get',
        () =>
          sheetsApi.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
          }),
        {
          spreadsheetId,
          action: 'validate_grid_data_size',
        }
      );

      const sheets = sheetId
        ? (metadata.data.sheets ?? []).filter((s) => s.properties?.sheetId === sheetId)
        : (metadata.data.sheets ?? []);

      // Check sheet count
      if (sheets.length > MAX_SHEETS_FOR_GRID_DATA) {
        return this.error({
          code: ErrorCodes.SPREADSHEET_TOO_LARGE,
          message: `Spreadsheet has ${sheets.length} sheets (max: ${MAX_SHEETS_FOR_GRID_DATA} for this operation)`,
          retryable: false,
          suggestedFix: 'Split your spreadsheet into smaller files or remove unnecessary data',
          resolution:
            'Specify a sheetId parameter to target a specific sheet instead of all sheets.',
        });
      }

      // Calculate total cells
      const totalCells = sheets.reduce(
        (sum, s) =>
          sum +
          (s.properties?.gridProperties?.rowCount ?? 0) *
            (s.properties?.gridProperties?.columnCount ?? 0),
        0
      );

      if (totalCells > MAX_CELLS_FOR_GRID_DATA) {
        return this.error({
          code: ErrorCodes.SPREADSHEET_TOO_LARGE,
          message: `Spreadsheet has ${totalCells.toLocaleString()} cells (max: ${MAX_CELLS_FOR_GRID_DATA.toLocaleString()} for this operation)`,
          retryable: false,
          suggestedFix: 'Split your spreadsheet into smaller files or remove unnecessary data',
          resolution:
            'Specify a sheetId parameter or use a more targeted range to reduce the data volume.',
          details: {
            totalCells,
            maxCells: MAX_CELLS_FOR_GRID_DATA,
            sheetCount: sheets.length,
          },
        });
      }

      return null; // Safe to proceed
    } catch (error) {
      // If we can't validate size, proceed anyway (fail safely)
      const logger = getRequestLogger();
      logger.warn('Failed to validate grid data size, proceeding anyway', {
        spreadsheetId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get sheet ID by name with caching
   *
   * Reduces redundant API calls by caching spreadsheet metadata.
   * Multiple calls within same request will only hit API once.
   */
  protected async getSheetId(
    spreadsheetId: string,
    sheetName?: string,
    sheetsApi?: import('googleapis').sheets_v4.Sheets
  ): Promise<number> {
    const metadataCache = this.context.metadataCache ?? getRequestContext()?.metadataCache;

    // OPTIMIZATION: Use session-level metadata cache if available (N+1 elimination)
    if (metadataCache) {
      if (!sheetName) {
        // Get first sheet ID
        const metadata = await metadataCache.getOrFetch(spreadsheetId);
        return metadata.sheets[0]?.sheetId ?? 0;
      }

      // Get sheet ID by name
      const sheetId = await metadataCache.getSheetId(spreadsheetId, sheetName);
      if (sheetId === undefined) {
        // Sheet not found - provide helpful error
        const metadata = await metadataCache.getOrFetch(spreadsheetId);
        const availableSheets = metadata.sheets.map((s) => s.title).slice(0, 5);
        const RangeResolutionError = (await import('../core/range-resolver.js'))
          .RangeResolutionError;
        throw new RangeResolutionError(
          `Sheet "${sheetName}" not found. Available sheets: ${availableSheets.join(', ')}${metadata.sheets.length > 5 ? ` (+${metadata.sheets.length - 5} more)` : ''}. Use sheets_core action:"list_sheets" to see all sheets.`,
          'SHEET_NOT_FOUND',
          {
            sheetName,
            spreadsheetId,
            availableSheets,
            hint: 'Sheet names are case-sensitive. Check spelling and use exact name.',
            suggestedAction: 'sheets_core action:"list_sheets"',
          },
          false
        );
      }
      return sheetId;
    }

    // FALLBACK: Use global cache manager (legacy path)
    const { cacheManager, createCacheKey } = await import('../utils/cache-manager.js');
    const { CACHE_TTL_SPREADSHEET } = await import('../config/constants.js');

    // Check cache first
    const cacheKey = createCacheKey('spreadsheet:metadata', {
      spreadsheetId,
    });
    let metadata = cacheManager.get<import('googleapis').sheets_v4.Schema$Spreadsheet>(
      cacheKey,
      'spreadsheet'
    );

    // Fetch if not cached
    if (!metadata) {
      if (!sheetsApi) {
        throw new ServiceError(
          'sheetsApi required when metadata not cached',
          'SERVICE_NOT_INITIALIZED',
          'SheetsAPI',
          false
        );
      }
      const response = await this.instrumentedApiCall(
        'spreadsheets.get',
        () =>
          sheetsApi.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties',
          }),
        {
          spreadsheetId,
          action: 'resolve_sheet_id',
        }
      );
      metadata = response.data;

      // Cache for 5 minutes
      cacheManager.set(cacheKey, metadata, {
        ttl: CACHE_TTL_SPREADSHEET,
        namespace: 'spreadsheet',
      });
    }

    const sheets = metadata.sheets ?? [];
    if (!sheetName) {
      return sheets[0]?.properties?.sheetId ?? 0;
    }

    const match = sheets.find((s) => s.properties?.title === sheetName);
    if (!match) {
      const availableSheets = sheets
        .map((s) => s.properties?.title)
        .filter(Boolean)
        .slice(0, 5);
      const RangeResolutionError = (await import('../core/range-resolver.js')).RangeResolutionError;
      throw new RangeResolutionError(
        `Sheet "${sheetName}" not found. Available sheets: ${availableSheets.join(', ')}${sheets.length > 5 ? ` (+${sheets.length - 5} more)` : ''}. Use sheets_core action:"list_sheets" to see all sheets.`,
        'SHEET_NOT_FOUND',
        {
          sheetName,
          spreadsheetId,
          availableSheets,
          hint: 'Sheet names are case-sensitive. Check spelling and use exact name.',
          suggestedAction: 'sheets_core action:"list_sheets"',
        },
        false
      );
    }
    return match.properties?.sheetId ?? 0;
  }

  // ============================================================
  // Shared Helper Methods (extracted from handler duplicates)
  // ============================================================

  /**
   * Execute an API call with request deduplication.
   * Prevents duplicate concurrent and sequential requests within TTL.
   * Expected savings: 30-50% API call reduction.
   *
   * Extracted from: core.ts, data.ts (identical implementations)
   */
  protected async deduplicatedApiCall<T>(cacheKey: string, apiCall: () => Promise<T>): Promise<T> {
    const deduplicator = this.context.requestDeduplicator;
    if (deduplicator) {
      return deduplicator.deduplicate(cacheKey, apiCall);
    }
    return apiCall();
  }

  /**
   * Convert a RangeInput (A1 notation or named range) to a GridRange for batchUpdate requests.
   * Resolves the range, parses A1 notation, and looks up the sheet ID.
   *
   * Extracted from: advanced.ts, dimensions.ts (identical implementations)
   * Note: visualize.ts has a specialized version with comma-separated range handling.
   */
  protected async rangeToGridRange(
    spreadsheetId: string,
    range: RangeInput,
    sheetsApi: sheets_v4.Sheets
  ): Promise<GridRangeInput> {
    const a1 = await this.resolveRange(spreadsheetId, range);
    const parsed = parseA1Notation(a1);
    const sheetId = await this.getSheetId(spreadsheetId, parsed.sheetName, sheetsApi);

    return buildGridRangeInput(
      sheetId,
      parsed.startRow,
      parsed.endRow,
      parsed.startCol,
      parsed.endCol
    );
  }

  /**
   * Convert a Google Sheets Schema$GridRange (with nullable fields) to our GridRangeInput type.
   *
   * Extracted from: advanced.ts, dimensions.ts (identical implementations)
   */
  protected gridRangeToOutput(range: sheets_v4.Schema$GridRange): GridRangeInput {
    return buildGridRangeInput(
      range.sheetId ?? 0,
      range.startRowIndex ?? undefined,
      range.endRowIndex ?? undefined,
      range.startColumnIndex ?? undefined,
      range.endColumnIndex ?? undefined
    );
  }

  /**
   * Apply verbosity filtering to optimize token usage (Phase 1 LLM optimization)
   * Delegates to pure helper function for better testability.
   */
  protected applyVerbosityFilter<T extends { success: boolean; _meta?: unknown }>(
    response: T,
    verbosity: 'minimal' | 'standard' | 'detailed' = 'standard'
  ): T {
    return applyVerbosityFilterHelper(response, verbosity);
  }

  /**
   * Handle the input and return output (abstract method to be implemented by subclasses)
   */
  abstract handle(input: TInput): Promise<TOutput>;

  /**
   * Create intents from input (abstract method to be implemented by subclasses)
   */
  protected abstract createIntents(input: TInput): Intent[];
}
