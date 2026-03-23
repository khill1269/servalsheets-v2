/**
 * ServalSheets - Retry Utilities
 *
 * Google Sheets-specific retry wrapper over @serval/core's platform-agnostic retry.
 * Adds: environment variable config, request context deadlines, enhanced HTTP/2
 * and 401/403 error detection for Google APIs.
 */

import {
  executeWithRetry as coreExecuteWithRetry,
  isRetryableError as coreIsRetryableError,
  type RetryOptions,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from '@serval/core';
import { getRequestContext, getRequestLogger } from './request-context.js';
import { recordHttp2Error, googleApiRetryAfterWaitMs } from '../observability/metrics.js';

// Re-export types so callers don't need to change imports
export type { RetryOptions, RetryConfig };

/**
 * Google Sheets-specific retry config — reads from environment variables,
 * falls back to serval-core defaults.
 */
const GOOGLE_SHEETS_RETRY_CONFIG: RetryConfig = {
  ...DEFAULT_RETRY_CONFIG,
  maxRetries: parseInt(
    process.env['GOOGLE_API_MAX_RETRIES'] ?? String(DEFAULT_RETRY_CONFIG.maxRetries),
    10
  ),
  baseDelayMs: parseInt(
    process.env['GOOGLE_API_RETRY_BASE_DELAY_MS'] ?? String(DEFAULT_RETRY_CONFIG.baseDelayMs),
    10
  ),
  maxDelayMs: parseInt(
    process.env['GOOGLE_API_RETRY_MAX_DELAY_MS'] ?? String(DEFAULT_RETRY_CONFIG.maxDelayMs),
    10
  ),
  jitterRatio: parseFloat(
    process.env['GOOGLE_API_RETRY_JITTER'] ?? String(DEFAULT_RETRY_CONFIG.jitterRatio)
  ),
  defaultTimeoutMs: parseInt(
    process.env['GOOGLE_API_TIMEOUT_MS'] ?? String(DEFAULT_RETRY_CONFIG.defaultTimeoutMs),
    10
  ),
  apiName: 'google-api',
};

/**
 * Execute an operation with Google Sheets-aware retry logic.
 *
 * Extends serval-core's executeWithRetry with:
 * - Request context deadline checking (skips retry if deadline would be exceeded)
 * - Enhanced HTTP/2 GOAWAY detection via error messages
 * - Request-scoped logger with traceId/requestId
 */
export async function executeWithRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const requestContext = getRequestContext();
  const logger = getRequestLogger();

  // Merge timeout from request context if available
  const mergedOptions: RetryOptions = {
    ...options,
    timeoutMs: options.timeoutMs ?? requestContext?.timeoutMs,
    retryable: options.retryable ?? isRetryableError,
    onRetry: async (error: unknown, attempt: number) => {
      // Enhanced HTTP/2 error tracking via message patterns
      trackHttp2ErrorByMessage(error);

      // Deadline check: skip retry if we'd exceed the request deadline.
      // Use Retry-After header value when present so the deadline check matches
      // the actual wait time that serval-core will enforce (Fix 1).
      if (requestContext?.deadline) {
        const baseDelayMs = options.baseDelayMs ?? GOOGLE_SHEETS_RETRY_CONFIG.baseDelayMs;
        const maxDelayMs = options.maxDelayMs ?? GOOGLE_SHEETS_RETRY_CONFIG.maxDelayMs;
        const retryAfterMs = extractRetryAfterMs(error);
        const backoff = retryAfterMs ?? Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

        // Record metric and log when Retry-After is respected (Fix 5)
        if (retryAfterMs !== undefined) {
          const cap = parseInt(
            process.env['RETRY_AFTER_MAX_WAIT_MS'] ?? String(GOOGLE_SHEETS_RETRY_CONFIG.maxDelayMs),
            10
          );
          const bounded = Math.min(retryAfterMs, cap);
          googleApiRetryAfterWaitMs.observe(bounded);
          logger.warn('Retry-After header respected', { attempt, retryAfterMs, cappedMs: bounded });
        }

        if (Date.now() + backoff > requestContext.deadline) {
          logger.warn('Retry skipped due to request deadline', {
            attempt,
            delayMs: backoff,
          });
          throw error; // Propagate to abort the retry loop
        }
      }

      // Delegate to caller's onRetry if provided
      if (options.onRetry) {
        await options.onRetry(error, attempt);
      }
    },
  };

  return coreExecuteWithRetry(operation, mergedOptions, GOOGLE_SHEETS_RETRY_CONFIG);
}

/**
 * Google Sheets-enhanced retryable error detection.
 *
 * Extends serval-core's isRetryableError with:
 * - Response body inspection for 403/401 (userRateLimitExceeded, token revocation)
 * - Enhanced HTTP/2 message pattern detection
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const errAny = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    response?: { status?: number; data?: unknown; headers?: Record<string, string | string[]> };
  };

  const status = errAny.response?.status;

  // 403: only retry for userRateLimitExceeded, not permission errors
  if (status === 403) {
    const message = typeof errAny.message === 'string' ? errAny.message.toLowerCase() : '';
    const body = JSON.stringify(errAny.response?.data ?? '').toLowerCase();
    return (
      message.includes('userratelimitexceeded') ||
      body.includes('userratelimitexceeded') ||
      message.includes('rate limit') ||
      message.includes('quota exceeded')
    );
  }

  // 401: retry on token expiry, invalid credentials, revocation
  if (status === 401) {
    const message = typeof errAny.message === 'string' ? errAny.message.toLowerCase() : '';
    const body = JSON.stringify(errAny.response?.data ?? '').toLowerCase();
    return (
      message.includes('token expired') ||
      message.includes('token has been expired') ||
      message.includes('invalid_grant') ||
      message.includes('invalid credentials') ||
      message.includes('unauthorized') ||
      message.includes('invalid_token') ||
      message.includes('token has been revoked') ||
      body.includes('invalid_token') ||
      body.includes('token expired')
    );
  }

  // HTTP/2 stream errors — prefer stable Node.js error codes (ISSUE-143), fall back to message patterns
  if (error instanceof Error) {
    const errCode = (error as unknown as Record<string, unknown>)['code'];
    // ERR_HTTP2_GOAWAY_SESSION is the canonical Node.js code for HTTP/2 GOAWAY (more stable than message strings)
    if (
      errCode === 'ERR_HTTP2_GOAWAY_SESSION' ||
      errCode === 'ERR_HTTP2_SESSION_ERROR' ||
      errCode === 'ERR_HTTP2_STREAM_ERROR'
    ) {
      return true;
    }
    const msg = error.message.toLowerCase();
    if (
      msg.includes('nghttp2_refused_stream') ||
      msg.includes('stream was closed') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up')
    ) {
      return true;
    }
  }

  // Delegate everything else to serval-core's base detection
  return coreIsRetryableError(error, GOOGLE_SHEETS_RETRY_CONFIG);
}

/**
 * Extract Retry-After wait duration from a 429 error response header.
 * Mirrors serval-core's internal parseRetryAfter so the deadline check
 * in onRetry uses the same value that core will actually wait.
 */
function extractRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const headers = (
    error as { response?: { status?: number; headers?: Record<string, string | string[]> } }
  ).response?.headers;
  if (!headers) return undefined;

  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return undefined;

  const value = Array.isArray(raw) ? raw[0] : raw;
  const seconds = Number(value);
  if (!isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(String(value));
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * Track HTTP/2 errors that are detected by message pattern rather than error code.
 * Supplements serval-core's code-based detection.
 */
function trackHttp2ErrorByMessage(error: unknown): void {
  if (!(error instanceof Error)) return;
  const msg = error.message.toLowerCase();
  const errObj = error as unknown as Record<string, unknown>;
  const errCode = typeof errObj['code'] === 'string' ? errObj['code'] : '';

  if (
    // Prefer stable Node.js error codes (ISSUE-143 fix)
    errCode === 'ERR_HTTP2_GOAWAY_SESSION' ||
    errCode === 'ERR_HTTP2_SESSION_ERROR' ||
    errCode === 'ERR_HTTP2_STREAM_ERROR' ||
    // Fallback: message patterns for older Node.js / non-standard errors
    msg.includes('goaway') ||
    msg.includes('new streams cannot be created') ||
    (msg.includes('session') && msg.includes('error') && msg.includes('http2'))
  ) {
    recordHttp2Error(errCode || 'UNKNOWN', 'stream');
  }
}
