/**
 * ServalSheets v4 - Retry Utility Tests
 *
 * Comprehensive tests for retry logic and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeWithRetry } from '../../src/utils/retry.js';

describe('executeWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Retryable Errors', () => {
    it('should retry on 429 rate limit and succeed', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('rate limit');
          (error as unknown as { response: { status: number } }).response = { status: 429 };
          return Promise.reject(error);
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        maxDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(3);
    });

    it('should retry on 503 service unavailable', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('service unavailable');
          (error as unknown as { response: { status: number } }).response = { status: 503 };
          return Promise.reject(error);
        }
        return Promise.resolve('success');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('success');
      expect(attempts).toBe(2);
    });

    it('should retry on 500 internal server error', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('internal server error');
          (error as unknown as { response: { status: number } }).response = { status: 500 };
          return Promise.reject(error);
        }
        return Promise.resolve('recovered');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('recovered');
      expect(attempts).toBe(2);
    });

    it('should retry on 502 bad gateway', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('bad gateway');
          (error as unknown as { response: { status: number } }).response = { status: 502 };
          return Promise.reject(error);
        }
        return Promise.resolve('success');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('success');
      expect(attempts).toBe(2);
    });

    it('should retry on 504 gateway timeout', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('gateway timeout');
          (error as unknown as { response: { status: number } }).response = { status: 504 };
          return Promise.reject(error);
        }
        return Promise.resolve('success');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('success');
      expect(attempts).toBe(2);
    });

    it('should retry on network errors (ETIMEDOUT)', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('timeout') as Error & { code: string };
          error.code = 'ETIMEDOUT';
          return Promise.reject(error);
        }
        return Promise.resolve('success');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('success');
      expect(attempts).toBe(2);
    });

    it('should retry on ECONNRESET', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('connection reset') as Error & { code: string };
          error.code = 'ECONNRESET';
          return Promise.reject(error);
        }
        return Promise.resolve('success');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('Non-Retryable Errors', () => {
    it('should NOT retry on 401 with non-token error message', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        const error = new Error('access denied to resource');
        (error as unknown as { response: { status: number } }).response = { status: 401 };
        return Promise.reject(error);
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await expect(promise).rejects.toThrow('access denied to resource');
      expect(attempts).toBe(1);
    });

    // Note: 401 with token-related messages (token expired, unauthorized, invalid_token, etc.)
    // ARE retried since these indicate transient auth issues that can be resolved via token refresh.
    // The non-retryable 401 test above uses "access denied to resource" which is NOT retried.

    it('should NOT retry on 403 forbidden', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        const error = new Error('forbidden');
        (error as unknown as { response: { status: number } }).response = { status: 403 };
        return Promise.reject(error);
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await expect(promise).rejects.toThrow('forbidden');
      expect(attempts).toBe(1);
    });

    it('should NOT retry on 404 not found', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        const error = new Error('not found');
        (error as unknown as { response: { status: number } }).response = { status: 404 };
        return Promise.reject(error);
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await expect(promise).rejects.toThrow('not found');
      expect(attempts).toBe(1);
    });

    it('should NOT retry on 400 bad request', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        const error = new Error('bad request');
        (error as unknown as { response: { status: number } }).response = { status: 400 };
        return Promise.reject(error);
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await expect(promise).rejects.toThrow('bad request');
      expect(attempts).toBe(1);
    });
  });

  describe('Exponential Backoff', () => {
    it('should use exponential backoff with correct delays', async () => {
      let attempts = 0;
      const delays: number[] = [];
      let lastTime = Date.now();

      const op = vi.fn().mockImplementation(() => {
        const currentTime = Date.now();
        if (attempts > 0) {
          delays.push(currentTime - lastTime);
        }
        lastTime = currentTime;
        attempts += 1;

        if (attempts < 4) {
          const error = new Error('rate limit');
          (error as unknown as { response: { status: number } }).response = { status: 429 };
          return Promise.reject(error);
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitterRatio: 0, // No jitter for predictable testing
        timeoutMs: 5000,
      });

      // Advance through all retries
      await vi.advanceTimersByTimeAsync(100); // First retry
      await vi.advanceTimersByTimeAsync(200); // Second retry
      await vi.advanceTimersByTimeAsync(400); // Third retry

      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(4);

      // Verify exponential backoff: 100ms, 200ms, 400ms
      expect(delays[0]).toBeGreaterThanOrEqual(100);
      expect(delays[1]).toBeGreaterThanOrEqual(200);
      expect(delays[2]).toBeGreaterThanOrEqual(400);
    });

    it('should respect maxDelayMs cap', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 6) {
          const error = new Error('rate limit');
          (error as unknown as { response: { status: number } }).response = { status: 429 };
          return Promise.reject(error);
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 2000, // Cap at 2 seconds
        jitterRatio: 0,
        timeoutMs: 20000,
      });

      // Even though exponential backoff would be 1s, 2s, 4s, 8s, 16s
      // It should be capped at 2s: 1s, 2s, 2s, 2s, 2s
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(6);
    });
  });

  describe('Retry-After Header', () => {
    it('should respect Retry-After header (numeric seconds)', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('rate limit');
          (
            error as unknown as { response: { status: number; headers: Record<string, string> } }
          ).response = {
            status: 429,
            headers: { 'retry-after': '5' }, // 5 seconds
          };
          return Promise.reject(error);
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 100,
        jitterRatio: 0,
        timeoutMs: 10000,
      });

      // Should wait 5000ms (5 seconds) instead of exponential backoff
      await vi.advanceTimersByTimeAsync(5000);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(2);
    });
  });

  describe('Max Retries', () => {
    it('should respect maxRetries limit', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        const error = new Error('always fails');
        (error as unknown as { response: { status: number } }).response = { status: 503 };
        return Promise.reject(error);
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 2,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      // Ensure promise rejection is caught before advancing timers
      const resultPromise = promise.catch((e) => e);
      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('always fails');
      // Initial attempt + 2 retries = 3 total attempts
      expect(attempts).toBe(3);
    });

    it('should succeed on first attempt if no error', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        return Promise.resolve('immediate success');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await expect(promise).resolves.toBe('immediate success');
      expect(attempts).toBe(1);
    });
  });

  describe('Timeout', () => {
    it('should abort operation on timeout', async () => {
      vi.useRealTimers();
      const op = vi.fn().mockImplementation((signal: AbortSignal) => {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('Request timed out'));
          });
          // Never resolves
        });
      });

      const promise = executeWithRetry(op, {
        maxRetries: 0,
        baseDelayMs: 1,
        jitterRatio: 0,
        timeoutMs: 20,
      });

      await expect(promise).rejects.toThrow(/timed out/i);
    });
  });

  describe('Custom Retryable Errors', () => {
    it('should use custom retryable function', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('custom error');
          (error as Error & { customCode: string }).customCode = 'CUSTOM_RETRYABLE';
          return Promise.reject(error);
        }
        return Promise.resolve('ok');
      });

      const customRetryable = (error: unknown): boolean => {
        const err = error as Error & { customCode?: string };
        return err.customCode === 'CUSTOM_RETRYABLE';
      };

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
        retryable: customRetryable,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(2);
    });
  });

  describe('HTTP/2 GOAWAY Error Handling', () => {
    it('should retry on GOAWAY message error', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 3) {
          return Promise.reject(
            new Error('New streams cannot be created after receiving a GOAWAY')
          );
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        maxDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(30);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(3);
    });

    it('should retry on ERR_HTTP2_GOAWAY_SESSION code', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('HTTP/2 session closed');
          (error as Error & { code: string }).code = 'ERR_HTTP2_GOAWAY_SESSION';
          return Promise.reject(error);
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(2);
    });

    it('should retry on socket hang up error', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          return Promise.reject(new Error('socket hang up'));
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(2);
    });

    it('should retry on stream closed error', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          return Promise.reject(
            new Error('The stream was closed with error code NGHTTP2_REFUSED_STREAM')
          );
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(2);
    });

    it('should retry on connection closed error', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          return Promise.reject(new Error('The connection was closed'));
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(2);
    });

    it('should retry on ERR_HTTP2_SESSION_ERROR code', async () => {
      let attempts = 0;
      const op = vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('Session error');
          (error as Error & { code: string }).code = 'ERR_HTTP2_SESSION_ERROR';
          return Promise.reject(error);
        }
        return Promise.resolve('ok');
      });

      const promise = executeWithRetry((signal) => op(signal), {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterRatio: 0,
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(2);
    });
  });
});
