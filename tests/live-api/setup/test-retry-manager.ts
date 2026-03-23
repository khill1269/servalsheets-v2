/**
 * ServalSheets - Test Retry Manager
 *
 * Test-specific retry logic with extended tolerances for live API testing.
 * Wraps production retry patterns with test-appropriate defaults.
 *
 * Key differences from production (src/utils/retry.ts):
 * - Longer base delays (2000ms vs 500ms)
 * - Extended max delay (120s vs 60s)
 * - Higher jitter ratio (0.3 vs 0.2)
 * - Additional retryable conditions for service account quirks
 * - Metrics collection per retry attempt
 */

import { TEST_CONFIG } from './config.js';

/**
 * Options for test retry operations
 */
export interface TestRetryOptions {
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Base delay between retries in ms */
  baseDelayMs?: number;
  /** Maximum delay cap in ms */
  maxDelayMs?: number;
  /** Jitter ratio (0-1) for delay randomization */
  jitterRatio?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
  /** Custom function to determine if error is retryable */
  retryable?: (error: unknown) => boolean;
  /** Operation name for metrics tracking */
  operationName?: string;
  /** Enable metrics recording */
  recordMetrics?: boolean;
}

/**
 * Metrics collected per retry attempt
 */
export interface RetryAttemptMetric {
  attempt: number;
  timestamp: number;
  delayMs: number;
  errorCode?: string;
  errorMessage?: string;
  success: boolean;
}

/**
 * Aggregated metrics for a retry operation
 */
export interface RetryMetrics {
  operationName: string;
  startTime: number;
  endTime: number;
  totalDurationMs: number;
  attempts: RetryAttemptMetric[];
  finalSuccess: boolean;
  totalRetries: number;
  totalDelayMs: number;
}

/**
 * Statuses that are retryable in test environment
 */
const RETRYABLE_STATUS = new Set([
  401, // Token expired (with specific message check)
  403, // Forbidden - sometimes transient with service accounts
  429, // Rate limited
  500, // Internal server error
  502, // Bad gateway
  503, // Service unavailable
  504, // Gateway timeout
]);

/**
 * Error codes that are retryable
 */
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'ECONNABORTED',
  // HTTP/2 connection errors
  'ERR_HTTP2_GOAWAY_SESSION',
  'ERR_HTTP2_SESSION_ERROR',
  'ERR_HTTP2_STREAM_CANCEL',
  'ERR_HTTP2_STREAM_ERROR',
]);

/**
 * Singleton metrics storage
 */
let _metricsHistory: RetryMetrics[] = [];
const MAX_METRICS_HISTORY = 1000;

/**
 * Check if an error is retryable for test environment
 * More permissive than production to handle service account quirks
 */
export function isTestRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errAny = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    response?: { status?: number; headers?: Record<string, string | string[]> };
    status?: number;
  };

  // Check HTTP status from response
  const status = errAny.response?.status ?? errAny.status;
  if (typeof status === 'number' && RETRYABLE_STATUS.has(status)) {
    // Special handling for 401 and 403
    if (status === 401 || status === 403) {
      const message = typeof errAny.message === 'string' ? errAny.message.toLowerCase() : '';
      // Retry on token/credential issues which might be transient
      return (
        message.includes('token expired') ||
        message.includes('invalid credentials') ||
        message.includes('forbidden') ||
        message.includes('access denied') ||
        message.includes('permission denied')
      );
    }
    return true;
  }

  // Check error code
  if (typeof errAny.code === 'number' && RETRYABLE_STATUS.has(errAny.code)) {
    return true;
  }

  if (typeof errAny.code === 'string' && RETRYABLE_CODES.has(errAny.code)) {
    return true;
  }

  // Check error name
  if (typeof errAny.name === 'string') {
    if (errAny.name === 'AbortError' || errAny.name === 'TimeoutError') {
      return true;
    }
  }

  // Check error message for retryable patterns
  if (typeof errAny.message === 'string') {
    const message = errAny.message.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('quota exceeded') ||
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('temporarily unavailable') ||
      message.includes('backend error') ||
      message.includes('goaway') ||
      message.includes('new streams cannot be created') ||
      message.includes('session error') ||
      (message.includes('stream') && message.includes('closed')) ||
      message.includes('socket hang up') ||
      (message.includes('connection') && message.includes('closed')) ||
      message.includes('service unavailable') ||
      message.includes('try again')
    );
  }

  return false;
}

/**
 * Extract error information for metrics
 */
function extractErrorInfo(error: unknown): { code?: string; message?: string } {
  if (!error || typeof error !== 'object') {
    return {};
  }

  const errAny = error as {
    code?: unknown;
    message?: unknown;
    response?: { status?: number };
  };

  let code: string | undefined;
  if (typeof errAny.code === 'string') {
    code = errAny.code;
  } else if (typeof errAny.code === 'number') {
    code = String(errAny.code);
  } else if (errAny.response?.status) {
    code = `HTTP_${errAny.response.status}`;
  }

  const message = typeof errAny.message === 'string' ? errAny.message.substring(0, 200) : undefined;

  return { code, message };
}

/**
 * Parse Retry-After header from error response
 */
function parseRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const headers = (error as { response?: { headers?: Record<string, string | string[]> } }).response
    ?.headers;
  if (!headers) {
    return undefined;
  }

  const headerValue = headers['retry-after'] ?? headers['Retry-After'];
  if (!headerValue) {
    return undefined;
  }

  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric * 1000;
  }

  const parsedDate = Date.parse(String(value));
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }

  return undefined;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute operation with timeout
 */
async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error(`Test request timed out after ${timeoutMs}ms`);
  timeoutError.name = 'TimeoutError';

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  const operationPromise = Promise.resolve(operation(controller.signal));

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    // Suppress unhandled rejection if operation fails after timeout
    operationPromise.catch(() => undefined);
  }
}

/**
 * Calculate backoff delay with jitter
 */
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number
): number {
  const backoff = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = backoff * jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, backoff + jitter);
}

/**
 * Execute an operation with test-appropriate retry logic
 *
 * Uses extended delays and more permissive retry conditions
 * suitable for live API testing.
 */
export async function executeWithTestRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: TestRetryOptions = {}
): Promise<T> {
  const config = TEST_CONFIG.retry;

  const maxRetries = options.maxRetries ?? config.maxRetries;
  const baseDelayMs = options.baseDelayMs ?? config.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? config.maxDelayMs;
  const jitterRatio = options.jitterRatio ?? config.jitterRatio;
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const retryable = options.retryable ?? isTestRetryableError;
  const recordMetrics = options.recordMetrics ?? config.recordMetrics;
  const operationName = options.operationName ?? 'unknown';

  const metrics: RetryMetrics = {
    operationName,
    startTime: Date.now(),
    endTime: 0,
    totalDurationMs: 0,
    attempts: [],
    finalSuccess: false,
    totalRetries: 0,
    totalDelayMs: 0,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptMetric: RetryAttemptMetric = {
      attempt,
      timestamp: Date.now(),
      delayMs: 0,
      success: false,
    };

    try {
      const result = await withTimeout(operation, timeoutMs);

      attemptMetric.success = true;
      metrics.attempts.push(attemptMetric);
      metrics.finalSuccess = true;
      metrics.endTime = Date.now();
      metrics.totalDurationMs = metrics.endTime - metrics.startTime;

      if (recordMetrics) {
        recordRetryMetrics(metrics);
      }

      return result;
    } catch (error) {
      lastError = error;
      const errorInfo = extractErrorInfo(error);
      attemptMetric.errorCode = errorInfo.code;
      attemptMetric.errorMessage = errorInfo.message;

      if (attempt >= maxRetries || !retryable(error)) {
        metrics.attempts.push(attemptMetric);
        metrics.endTime = Date.now();
        metrics.totalDurationMs = metrics.endTime - metrics.startTime;

        if (recordMetrics) {
          recordRetryMetrics(metrics);
        }

        throw error;
      }

      // Calculate delay
      const retryAfterMs = parseRetryAfter(error);
      const calculatedDelay = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio);
      const delay = retryAfterMs ?? calculatedDelay;

      attemptMetric.delayMs = delay;
      metrics.attempts.push(attemptMetric);
      metrics.totalRetries++;
      metrics.totalDelayMs += delay;

      await sleep(delay);
    }
  }

  metrics.endTime = Date.now();
  metrics.totalDurationMs = metrics.endTime - metrics.startTime;

  if (recordMetrics) {
    recordRetryMetrics(metrics);
  }

  throw lastError;
}

/**
 * Record retry metrics to history
 */
function recordRetryMetrics(metrics: RetryMetrics): void {
  _metricsHistory.push(metrics);

  // Trim history if too large
  if (_metricsHistory.length > MAX_METRICS_HISTORY) {
    _metricsHistory = _metricsHistory.slice(-MAX_METRICS_HISTORY);
  }
}

/**
 * Get all recorded retry metrics
 */
export function getRetryMetricsHistory(): RetryMetrics[] {
  return [..._metricsHistory];
}

/**
 * Get aggregated retry statistics
 */
export function getRetryStats(): {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  totalRetries: number;
  avgRetriesPerOperation: number;
  avgDurationMs: number;
  operationsByName: Record<string, number>;
} {
  const totalOperations = _metricsHistory.length;
  const successfulOperations = _metricsHistory.filter((m) => m.finalSuccess).length;
  const failedOperations = totalOperations - successfulOperations;
  const totalRetries = _metricsHistory.reduce((sum, m) => sum + m.totalRetries, 0);
  const avgRetriesPerOperation = totalOperations > 0 ? totalRetries / totalOperations : 0;
  const avgDurationMs =
    totalOperations > 0
      ? _metricsHistory.reduce((sum, m) => sum + m.totalDurationMs, 0) / totalOperations
      : 0;

  const operationsByName: Record<string, number> = {};
  for (const m of _metricsHistory) {
    operationsByName[m.operationName] = (operationsByName[m.operationName] ?? 0) + 1;
  }

  return {
    totalOperations,
    successfulOperations,
    failedOperations,
    totalRetries,
    avgRetriesPerOperation,
    avgDurationMs,
    operationsByName,
  };
}

/**
 * Clear retry metrics history
 */
export function clearRetryMetrics(): void {
  _metricsHistory = [];
}

/**
 * Retry manager class for object-oriented usage
 */
export class TestRetryManager {
  private defaultOptions: TestRetryOptions;

  constructor(options: TestRetryOptions = {}) {
    this.defaultOptions = options;
  }

  /**
   * Execute operation with retry
   */
  async execute<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: TestRetryOptions = {}
  ): Promise<T> {
    return executeWithTestRetry(operation, { ...this.defaultOptions, ...options });
  }

  /**
   * Get statistics for retries executed through this manager
   */
  getStats(): ReturnType<typeof getRetryStats> {
    return getRetryStats();
  }

  /**
   * Get metrics history
   */
  getHistory(): RetryMetrics[] {
    return getRetryMetricsHistory();
  }

  /**
   * Clear metrics
   */
  clearMetrics(): void {
    clearRetryMetrics();
  }
}

/**
 * Default singleton instance
 */
let _defaultManager: TestRetryManager | null = null;

/**
 * Get default retry manager singleton
 */
export function getTestRetryManager(): TestRetryManager {
  if (!_defaultManager) {
    _defaultManager = new TestRetryManager();
  }
  return _defaultManager;
}

/**
 * Reset the default manager (for testing)
 */
export function resetTestRetryManager(): void {
  _defaultManager = null;
  clearRetryMetrics();
}
