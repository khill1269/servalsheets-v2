/**
 * ServalSheets - Request Context (Protocol Layer)
 *
 * Async-local storage for per-request metadata (requestId, logger, deadlines, progress notifications).
 *
 * ## Context Hierarchy
 *
 * ServalSheets uses a 3-layer context system:
 *
 * ```
 * 1. RequestContext (Protocol Layer) ← YOU ARE HERE
 *    ↓ contains
 * 2. SessionContext (Business Layer)
 *    ↓ contains
 * 3. ContextManager (Inference Layer)
 * ```
 *
 * ## RequestContext - Protocol Layer
 *
 * **Purpose**: MCP protocol-specific request tracking
 * **Lifetime**: Single tool call (1-30 seconds)
 * **Scope**: Thread-local via AsyncLocalStorage
 *
 * **Contains**:
 * - Request ID (UUID for tracing)
 * - Logger instance (with request context)
 * - Timeout/deadline tracking
 * - MCP progress notification channel
 * - W3C distributed tracing IDs
 *
 * **When to use**:
 * - Accessing current request ID for logging
 * - Sending MCP progress notifications
 * - Enforcing request timeouts
 * - Distributed tracing across services
 *
 * **Related**:
 * - {@link SessionContext} (src/services/session-context.ts) - Business domain context
 * - {@link ContextManager} (src/services/context-manager.ts) - Parameter inference
 *
 * @see docs/architecture/CONTEXT_LAYERS.md for full hierarchy
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { Logger } from 'winston';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { baseLogger } from './base-logger.js';

export interface RelatedMcpRequest {
  method: string;
  params?: Record<string, unknown>;
}

export interface RelatedRequestOptions {
  signal?: AbortSignal;
}

export type TaskRequestStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export interface TaskStatusUpdater {
  updateTaskStatus: (
    taskId: string,
    status: TaskRequestStatus,
    statusMessage?: string
  ) => Promise<unknown>;
}

export type RelatedRequestSender = (
  request: RelatedMcpRequest,
  resultSchema: unknown,
  options?: RelatedRequestOptions
) => Promise<unknown>;

interface RequestScopedSpreadsheetMetadata {
  sheets: Array<{
    sheetId: number;
    title: string;
  }>;
}

/**
 * Keep request-context decoupled from service implementations.
 * Concrete metadata/session services are injected, but the protocol layer
 * only depends on the small surface it actually carries between requests.
 */
export interface RequestScopedMetadataCache {
  getOrFetch(spreadsheetId: string): Promise<RequestScopedSpreadsheetMetadata>;
  getSheetId(spreadsheetId: string, sheetName: string): Promise<number | undefined>;
  clear(): void;
}

export interface RequestScopedSessionContext {
  trackRequest(): void;
}

export interface RequestLlmProvenance {
  aiMode: 'sampling' | 'fallback';
  aiProvider?: string;
  aiModelUsed?: string;
}

export interface RequestContext {
  requestId: string;
  logger: Logger;
  timeoutMs: number;
  deadline: number;
  abortSignal?: AbortSignal;
  /**
   * Stable caller identity when available (session/user/client).
   * Used for per-principal caching and correction metrics.
   */
  principalId?: string;
  /**
   * MCP progress notification function
   * Available when client requests progress updates via _meta.progressToken
   */
  sendNotification?: (notification: ServerNotification) => Promise<void>;
  /**
   * MCP nested request sender bound to the current request/task context.
   * When available, this preserves related-request and related-task metadata.
   */
  sendRequest?: RelatedRequestSender;
  /**
   * Active MCP task identifier when execution is happening in a background task.
   */
  taskId?: string;
  /**
   * Task status updater used to mark input_required while nested task requests are pending.
   */
  taskStore?: TaskStatusUpdater;
  /**
   * MCP progress token from request _meta
   * Used to associate progress notifications with the original request
   */
  progressToken?: string | number;
  /**
   * W3C Trace Context fields for distributed tracing
   * @see https://www.w3.org/TR/trace-context/
   */
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  /**
   * Idempotency key for preventing duplicate operation execution
   * Can be client-provided or auto-generated for non-idempotent operations
   */
  idempotencyKey?: string;
  metadataCache?: RequestScopedMetadataCache;
  sessionContext?: RequestScopedSessionContext;
  /**
   * Last emitted progress value — used to enforce monotonic progress notifications.
   * Progress that does not exceed this value is silently dropped per MCP spec.
   */
  lastProgress?: number;
  /**
   * Number of Google API calls made during this request.
   * Incremented by wrapGoogleApi on each API call (success or failure).
   * Exposed in _meta.apiCallsMade for LLM cost awareness.
   */
  apiCallsMade: number;
  /**
   * Epoch ms when this request context was created.
   * Used to compute _meta.executionTimeMs at response build time.
   */
  requestStartTime: number;
  /**
   * Last AI provenance recorded during this request.
   * Used to surface whether a response came from MCP sampling or fallback.
   */
  llmProvenance?: RequestLlmProvenance;
  /**
   * Verbosity level extracted from tool input args.
   * Used by the response pipeline to apply global verbosity filtering
   * for handlers that don't apply it themselves.
   */
  verbosity?: 'minimal' | 'standard' | 'detailed';
}

const storage = new AsyncLocalStorage<RequestContext>();

function parseTimeoutMs(rawValue: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

const DEFAULT_TIMEOUT_MS = parseTimeoutMs(
  process.env['REQUEST_TIMEOUT_MS'] ?? process.env['GOOGLE_API_TIMEOUT_MS'],
  30000
);

export function createRequestContext(options?: {
  requestId?: string;
  logger?: Logger;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  principalId?: string;
  sendNotification?: (notification: ServerNotification) => Promise<void>;
  sendRequest?: RelatedRequestSender;
  taskId?: string;
  taskStore?: TaskStatusUpdater;
  progressToken?: string | number;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  idempotencyKey?: string;
  metadataCache?: RequestScopedMetadataCache;
  sessionContext?: RequestScopedSessionContext;
}): RequestContext {
  const requestId = options?.requestId ?? randomUUID();
  const timeoutMs =
    typeof options?.timeoutMs === 'number' &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  // Include trace context in logger metadata
  const loggerMeta: Record<string, string> = { requestId };
  if (options?.traceId) {
    loggerMeta['traceId'] = options.traceId;
  }
  if (options?.spanId) {
    loggerMeta['spanId'] = options.spanId;
  }
  if (options?.parentSpanId) {
    loggerMeta['parentSpanId'] = options.parentSpanId;
  }

  const logger = (options?.logger ?? baseLogger).child(loggerMeta);

  const now = Date.now();
  return {
    requestId,
    logger,
    timeoutMs,
    deadline: now + timeoutMs,
    abortSignal: options?.abortSignal,
    principalId: options?.principalId,
    sendNotification: options?.sendNotification,
    sendRequest: options?.sendRequest,
    taskId: options?.taskId,
    taskStore: options?.taskStore,
    progressToken: options?.progressToken,
    traceId: options?.traceId,
    spanId: options?.spanId,
    parentSpanId: options?.parentSpanId,
    idempotencyKey: options?.idempotencyKey,
    metadataCache: options?.metadataCache,
    sessionContext: options?.sessionContext,
    apiCallsMade: 0,
    requestStartTime: now,
  };
}

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function recordRequestVerbosity(verbosity: 'minimal' | 'standard' | 'detailed'): void {
  const context = storage.getStore();
  if (!context) {
    return;
  }
  context.verbosity = verbosity;
}

export function getRequestVerbosity(): 'minimal' | 'standard' | 'detailed' | undefined {
  return storage.getStore()?.verbosity;
}

export function recordRequestLlmProvenance(provenance: RequestLlmProvenance): void {
  const context = storage.getStore();
  if (!context) {
    return;
  }
  context.llmProvenance = provenance;
}

export function getRequestLlmProvenance(): RequestLlmProvenance | undefined {
  return storage.getStore()?.llmProvenance;
}

export function getRequestAbortSignal(): AbortSignal | undefined {
  return storage.getStore()?.abortSignal;
}

export function createRequestAbortError(
  reason?: unknown,
  fallbackMessage = 'Operation cancelled by client'
): Error & { code: 'OPERATION_CANCELLED' } {
  const message =
    typeof reason === 'string' && reason.trim()
      ? reason
      : reason instanceof Error && reason.message
        ? reason.message
        : fallbackMessage;
  const error = new Error(message) as Error & { code: 'OPERATION_CANCELLED'; cause?: unknown };
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  if (reason !== undefined) {
    error.cause = reason;
  }
  return error;
}

export function throwIfRequestAborted(fallbackMessage = 'Operation cancelled by client'): void {
  const abortSignal = getRequestAbortSignal();
  if (abortSignal?.aborted) {
    throw createRequestAbortError(abortSignal.reason, fallbackMessage);
  }
}

export function getRequestLogger(): Logger {
  return storage.getStore()?.logger ?? baseLogger;
}

/**
 * Send MCP progress notification if available in request context
 * Used by BatchCompiler and other long-running operations
 *
 * @param progress Current progress (0-based)
 * @param total Total steps
 * @param message Progress message
 */
export async function sendProgress(
  progress: number,
  total?: number,
  message?: string
): Promise<void> {
  const context = storage.getStore();
  if (!context?.sendNotification || !context?.progressToken) {
    // Progress notifications not requested by client or not in request context
    return;
  }

  // Enforce monotonically increasing progress per MCP spec
  if (context.lastProgress !== undefined && progress <= context.lastProgress) {
    context.logger.warn('Dropping non-monotonic progress notification', {
      last: context.lastProgress,
      current: progress,
    });
    return;
  }
  context.lastProgress = progress;

  try {
    await context.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken: context.progressToken,
        progress,
        total,
        message,
      },
    });
  } catch (error) {
    // Don't fail the operation if progress notification fails
    context.logger.warn('Failed to send progress notification', {
      error,
      progress,
      total,
      message,
    });
  }
}
