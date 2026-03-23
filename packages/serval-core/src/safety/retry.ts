/**
 * Serval Core - Retry with Exponential Backoff
 *
 * Platform-agnostic retry logic with configurable status codes,
 * jitter, and timeout support.
 */

import { defaultLogger } from '../utils/logger.js';
import {
  recordRateLimitHit,
  recordRetryAttempt,
  recordHttp2Error,
} from '../observability/metrics.js';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  retryable?: (error: unknown) => boolean;
  timeoutMs?: number;
  /** Called before each retry attempt */
  onRetry?: (error: unknown, attempt: number) => void | Promise<void>;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  defaultTimeoutMs: number;
  /** HTTP status codes that should trigger retry */
  retryableStatuses: Set<number>;
  /** Error codes (e.g. ETIMEDOUT) that should trigger retry */
  retryableCodes: Set<string>;
  /** API name for metrics labeling */
  apiName: string;
}

/**
 * Default retry config — can be overridden per-platform
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 60000,
  jitterRatio: 0.2,
  defaultTimeoutMs: 60000,
  retryableStatuses: new Set([429, 500, 502, 503, 504]),
  retryableCodes: new Set([
    'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN',
    'ENOTFOUND', 'ENETUNREACH', 'ECONNABORTED',
    'ERR_HTTP2_GOAWAY_SESSION', 'ERR_HTTP2_SESSION_ERROR',
    'ERR_HTTP2_STREAM_CANCEL', 'ERR_HTTP2_STREAM_ERROR',
  ]),
  apiName: 'api',
};

/**
 * Execute an operation with retry logic
 */
export async function executeWithRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions = {},
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  const logger = defaultLogger;

  const maxRetries = options.maxRetries ?? config.maxRetries;
  const baseDelayMs = options.baseDelayMs ?? config.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? config.maxDelayMs;
  const jitterRatio = options.jitterRatio ?? config.jitterRatio;
  const timeoutMs = options.timeoutMs ?? config.defaultTimeoutMs;
  const retryable = options.retryable ?? ((error: unknown) => isRetryableError(error, config));

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await withTimeout(operation, timeoutMs);

      if (attempt > 0) {
        const status = getErrorStatus(lastError);
        const isRateLimited = status === 429;
        const retryReason = isRateLimited ? 'rate_limit' : status ? `status_${status}` : 'unknown';
        recordRetryAttempt(config.apiName, retryReason, true, 0);
      }

      return result;
    } catch (error) {
      lastError = error;

      // Track HTTP/2 errors
      const errCode = typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code : '';
      if (config.retryableCodes.has(errCode) && errCode.startsWith('ERR_HTTP2_')) {
        recordHttp2Error(errCode, 'connection');
      }

      if (attempt >= maxRetries || !retryable(error)) {
        throw error;
      }

      const status = getErrorStatus(error);
      const isRateLimited = status === 429;
      const retryAfterMs = parseRetryAfter(error);
      const backoff = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = backoff * jitterRatio * (Math.random() * 2 - 1);
      const delay = Math.max(0, retryAfterMs ?? backoff + jitter);

      if (isRateLimited) {
        recordRateLimitHit(config.apiName, 'default');
        logger.warn('Rate limit hit, backing off', {
          attempt, maxRetries, delayMs: delay, retryAfterMs,
        });
      } else {
        logger.warn('Retrying API call', {
          attempt, maxRetries, delayMs: delay, errorStatus: status,
        });
      }

      const retryReason = isRateLimited ? 'rate_limit' : status ? `status_${status}` : 'unknown';
      recordRetryAttempt(config.apiName, retryReason, false, delay / 1000);

      if (options.onRetry) {
        await options.onRetry(error, attempt);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const errAny = error as { code?: unknown; response?: { status?: number } };
  const status = errAny.response?.status;
  if (typeof status === 'number') return status;
  if (typeof errAny.code === 'number') return errAny.code;
  return undefined;
}

export function isRetryableError(error: unknown, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  if (!error || typeof error !== 'object') return false;

  const errAny = error as {
    code?: unknown; message?: unknown; name?: unknown;
    response?: { status?: number; data?: unknown };
  };

  const status = errAny.response?.status;
  if (typeof status === 'number' && config.retryableStatuses.has(status)) {
    if (status === 403) {
      const message = typeof errAny.message === 'string' ? errAny.message.toLowerCase() : '';
      return message.includes('userratelimitexceeded') || message.includes('rate limit') || message.includes('quota exceeded');
    }
    // 401 Unauthorized is not retryable — indicates invalid/expired credentials,
    // not a transient server error. Token refresh must happen at a higher layer.
    if (status === 401) return false;
    return true;
  }

  if (typeof errAny.code === 'number' && config.retryableStatuses.has(errAny.code)) return true;
  if (typeof errAny.code === 'string' && config.retryableCodes.has(errAny.code)) return true;

  if (typeof errAny.name === 'string' && errAny.name === 'AbortError') return false;

  if (typeof errAny.message === 'string') {
    const message = errAny.message.toLowerCase();
    return message.includes('rate limit') || message.includes('quota exceeded') ||
      message.includes('timeout') || message.includes('timed out') ||
      message.includes('temporarily unavailable') || message.includes('backend error') ||
      message.includes('goaway') || message.includes('socket hang up') ||
      (message.includes('connection') && message.includes('closed'));
  }

  return false;
}

function parseRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const headers = (error as { response?: { headers?: Record<string, string | string[]> } }).response?.headers;
  if (!headers) return undefined;

  const headerValue = headers['retry-after'] ?? headers['Retry-After'];
  if (!headerValue) return undefined;

  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) return numeric * 1000;

  const parsedDate = Date.parse(String(value));
  if (!Number.isNaN(parsedDate)) return Math.max(0, parsedDate - Date.now());

  return undefined;
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
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
    if (timeoutId) clearTimeout(timeoutId);
    operationPromise.catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
