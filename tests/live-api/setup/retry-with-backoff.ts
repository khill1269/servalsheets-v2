/**
 * Enhanced Retry with Exponential Backoff
 *
 * Provides robust retry logic for live API tests with:
 * - Exponential backoff with jitter
 * - Rate limit detection and handling
 * - Quota-aware delays
 * - Detailed logging for debugging
 */

import { TEST_CONFIG } from './config.js';
import { getMetricsCollector } from './metrics-collector.js';

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Base delay in milliseconds */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds */
  maxDelayMs?: number;
  /** Jitter factor (0-1) to randomize delays */
  jitterFactor?: number;
  /** Whether to retry on rate limit errors */
  retryOnRateLimit?: boolean;
  /** Custom delay for rate limit errors */
  rateLimitDelayMs?: number;
  /** Operation name for logging */
  operationName?: string;
  /** Whether to log retries */
  verbose?: boolean;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
  retryReasons: string[];
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: TEST_CONFIG.retry.maxRetries,
  baseDelayMs: TEST_CONFIG.retry.baseDelayMs,
  maxDelayMs: TEST_CONFIG.retry.maxDelayMs,
  jitterFactor: TEST_CONFIG.retry.jitterFactor,
  retryOnRateLimit: true,
  rateLimitDelayMs: 60000,
  operationName: 'operation',
  verbose: process.env.VERBOSE_TESTS === 'true',
};

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as { code?: number; status?: number; message?: string };
  const code = err.code || err.status;
  const message = err.message?.toLowerCase() || '';

  // Rate limit errors (429)
  if (code === 429) return true;

  // Server errors (5xx)
  if (code && code >= 500 && code < 600) return true;

  // Network errors
  if (
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('timeout')
  ) {
    return true;
  }

  // Quota errors
  if (message.includes('quota') || message.includes('rate limit')) {
    return true;
  }

  // Temporary unavailable
  if (message.includes('unavailable') || message.includes('service')) {
    return true;
  }

  return false;
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as { code?: number; status?: number; message?: string };
  const code = err.code || err.status;
  const message = err.message?.toLowerCase() || '';

  return code === 429 || message.includes('rate limit') || message.includes('quota exceeded');
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number
): number {
  // Exponential backoff: base * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter: random value between (1-jitter) and (1+jitter) of the delay
  const jitter = 1 + (Math.random() * 2 - 1) * jitterFactor;
  const finalDelay = Math.round(cappedDelay * jitter);

  return Math.max(finalDelay, 0);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with retry and exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const retryReasons: string[] = [];
  let totalDelayMs = 0;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const result = await operation();

      // Record success metrics
      getMetricsCollector().recordApiCall('read', opts.operationName, 0, true);

      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalDelayMs,
        retryReasons,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const isRateLimit = isRateLimitError(error);
      const isRetryable = isRetryableError(error);

      if (attempt === opts.maxRetries || (!isRetryable && !isRateLimit)) {
        // No more retries
        getMetricsCollector().recordApiCall('read', opts.operationName, 0, false);

        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalDelayMs,
          retryReasons,
        };
      }

      // Calculate delay
      let delayMs: number;
      let reason: string;

      if (isRateLimit && opts.retryOnRateLimit) {
        // Use longer delay for rate limits
        delayMs = opts.rateLimitDelayMs;
        reason = `Rate limit (waiting ${delayMs}ms)`;
      } else {
        // Use exponential backoff
        delayMs = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs, opts.jitterFactor);
        reason = `${lastError.message} (attempt ${attempt + 1}, waiting ${delayMs}ms)`;
      }

      retryReasons.push(reason);
      totalDelayMs += delayMs;

      if (opts.verbose) {
        console.log(`[Retry] ${opts.operationName}: ${reason}`);
      }

      // Wait before retry
      await sleep(delayMs);
    }
  }

  // Should not reach here, but handle it
  return {
    success: false,
    error: lastError,
    attempts: opts.maxRetries + 1,
    totalDelayMs,
    retryReasons,
  };
}

/**
 * Retry wrapper that throws on failure
 */
export async function retryOrThrow<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const result = await retryWithBackoff(operation, options);

  if (!result.success) {
    const error = result.error || new Error('Unknown error');
    error.message = `${options.operationName || 'Operation'} failed after ${result.attempts} attempts: ${error.message}`;
    throw error;
  }

  return result.result as T;
}

/**
 * Batch operations with individual retry
 */
export async function batchWithRetry<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  options: RetryOptions & { concurrency?: number } = {}
): Promise<Map<T, RetryResult<R>>> {
  const results = new Map<T, RetryResult<R>>();
  const concurrency = options.concurrency || 1;

  // Process items in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const result = await retryWithBackoff(() => operation(item), options);
        return { item, result };
      })
    );

    for (const { item, result } of batchResults) {
      results.set(item, result);
    }

    // Add small delay between batches to avoid rate limits
    if (i + concurrency < items.length) {
      await sleep(100);
    }
  }

  return results;
}

/**
 * Circuit breaker for repeated failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60000
  ) {}

  /**
   * Check if circuit allows operation
   */
  canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      // Check if reset time has passed
      if (Date.now() - this.lastFailureTime >= this.resetTimeMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }

    // half-open: allow one request
    return true;
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  /**
   * Execute with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error('Circuit breaker is open - too many failures');
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Get current state
   */
  getState(): { state: string; failures: number; threshold: number } {
    return {
      state: this.state,
      failures: this.failures,
      threshold: this.threshold,
    };
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.lastFailureTime = 0;
  }
}

// Default circuit breaker for live API tests
export const liveApiCircuitBreaker = new CircuitBreaker(5, 60000);
