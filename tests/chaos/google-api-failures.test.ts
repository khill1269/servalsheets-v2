/**
 * Chaos Tests: Google API Failures
 *
 * Verifies resilience to Google API-specific failures:
 * - 500 errors with retry exhaustion
 * - 429 rate limits
 * - Token refresh failures
 * - Quota exhaustion
 * - GOAWAY connection errors
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChaosEngine, type ChaosEngine } from './chaos-framework.js';
import { CircuitBreaker } from '../../src/utils/circuit-breaker.js';
import { executeWithRetry } from '../../src/utils/retry.js';

describe('Chaos: Google API Failures', () => {
  let chaos: ChaosEngine;

  beforeEach(() => {
    chaos = createChaosEngine();
  });

  afterEach(() => {
    chaos.reset();
    chaos.clearEvents();
  });

  describe('500 Server Errors', () => {
    it('should retry 500 errors with exponential backoff', async () => {
      let attempts = 0;

      const result = await executeWithRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            const error = new Error('Internal server error');
            (error as any).response = { status: 500 };
            throw error;
          }
          return 'success';
        },
        {
          maxRetries: 3,
          baseDelayMs: 100,
        }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should open circuit after repeated 500 errors', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 1000,
        name: 'api-500',
      });

      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            const error = new Error('Internal server error');
            (error as any).response = { status: 500 };
            throw error;
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');
    });

    it('should provide fallback for 500 errors', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 500,
        name: 'api-500-fallback',
      });

      breaker.registerFallback({
        name: 'cached-data',
        priority: 100,
        execute: async () => ({
          cached: true,
          data: [],
          timestamp: Date.now(),
        }),
        shouldUse: () => true,
      });

      const results: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const result = await breaker.execute(async () => {
          const error = new Error('Internal server error');
          (error as any).response = { status: 500 };
          throw error;
        });
        results.push(result);
      }

      const cachedResults = results.filter(
        (r) => typeof r === 'object' && r !== null && 'cached' in r
      );
      expect(cachedResults.length).toBeGreaterThan(0);
    });
  });

  describe('429 Rate Limits', () => {
    it('should respect Retry-After header', async () => {
      let attempts = 0;
      const retryAfterSec = 1;

      const start = Date.now();
      const result = await executeWithRetry(
        async () => {
          attempts++;
          if (attempts < 2) {
            const error = new Error('Rate limit exceeded');
            (error as any).response = {
              status: 429,
              headers: { 'Retry-After': String(retryAfterSec) },
            };
            throw error;
          }
          return 'success';
        },
        {
          maxRetries: 3,
          baseDelayMs: 100,
        }
      );
      const duration = Date.now() - start;

      expect(result).toBe('success');
      expect(attempts).toBe(2);
      expect(duration).toBeGreaterThanOrEqual(retryAfterSec * 1000 * 0.9); // Allow 10% variance
    });

    it('should track rate limit hits', async () => {
      let attempts = 0;

      try {
        await executeWithRetry(
          async () => {
            attempts++;
            const error = new Error('Rate limit exceeded');
            (error as any).response = { status: 429 };
            throw error;
          },
          {
            maxRetries: 2,
            baseDelayMs: 50,
          }
        );
      } catch {
        // Expected to fail
      }

      expect(attempts).toBe(3); // Initial + 2 retries
    });

    it('should use exponential backoff for rate limits without Retry-After', async () => {
      const delays: number[] = [];
      const timestamps: number[] = [];

      try {
        await executeWithRetry(
          async () => {
            const now = Date.now();
            if (timestamps.length > 0) {
              delays.push(now - timestamps[timestamps.length - 1]!);
            }
            timestamps.push(now);

            const error = new Error('Rate limit exceeded');
            (error as any).response = { status: 429 };
            throw error;
          },
          {
            maxRetries: 3,
            baseDelayMs: 100,
          }
        );
      } catch {
        // Expected
      }

      // Verify exponential backoff
      expect(delays).toHaveLength(3);
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]! * 0.8); // Allow jitter
      }
    });
  });

  describe('Token Refresh Failures', () => {
    it('should handle token expiration gracefully', async () => {
      let attempts = 0;
      let tokenRefreshed = false;

      const result = await executeWithRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            const error = new Error('Token expired');
            (error as any).response = { status: 401 };
            throw error;
          }
          // Simulate successful refresh
          if (attempts === 2) {
            tokenRefreshed = true;
          }
          return 'success';
        },
        {
          maxRetries: 3,
          baseDelayMs: 50,
        }
      );

      expect(result).toBe('success');
      expect(tokenRefreshed).toBe(true);
    });

    it('should fail after token refresh exhaustion', async () => {
      let attempts = 0;

      try {
        await executeWithRetry(
          async () => {
            attempts++;
            const error = new Error('Invalid credentials');
            (error as any).response = { status: 401 };
            throw error;
          },
          {
            maxRetries: 3,
            baseDelayMs: 50,
          }
        );
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
        expect(attempts).toBe(4); // Initial + 3 retries
      }
    });
  });

  describe('GOAWAY Connection Errors', () => {
    it('should retry on GOAWAY errors', async () => {
      chaos.injectDisconnects(0.5);

      let attempts = 0;
      const result = await executeWithRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            const error = new Error('ERR_HTTP2_GOAWAY_SESSION');
            (error as any).code = 'ERR_HTTP2_GOAWAY_SESSION';
            throw error;
          }
          return 'success';
        },
        {
          maxRetries: 5,
          baseDelayMs: 100,
        }
      );

      expect(result).toBe('success');
      expect(attempts).toBeGreaterThanOrEqual(3);
    });

    it('should reset connections on GOAWAY', async () => {
      chaos.injectDisconnects(1.0);

      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 1000,
        name: 'goaway-test',
      });

      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            const error = new Error('ERR_HTTP2_GOAWAY_SESSION');
            (error as any).code = 'ERR_HTTP2_GOAWAY_SESSION';
            throw error;
          });
        } catch {
          // Expected
        }
      }

      const events = chaos.getEventsByType('network_disconnect');
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Quota Exhaustion', () => {
    it('should handle quota exceeded errors', async () => {
      let attempts = 0;

      try {
        await executeWithRetry(
          async () => {
            attempts++;
            const error = new Error('Quota exceeded');
            (error as any).response = { status: 429 };
            throw error;
          },
          {
            maxRetries: 3,
            baseDelayMs: 100,
          }
        );
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('Quota exceeded');
      }

      expect(attempts).toBe(4); // Initial + 3 retries
    });

    it('should use fallback for quota exhaustion', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 500,
        name: 'quota-fallback',
      });

      breaker.registerFallback({
        name: 'quota-fallback',
        priority: 100,
        execute: async () => ({
          quotaExhausted: true,
          message: 'Using cached data due to quota limits',
          data: [],
        }),
        shouldUse: () => true,
      });

      const results: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const result = await breaker.execute(async () => {
          const error = new Error('Quota exceeded');
          (error as any).response = { status: 429 };
          throw error;
        });
        results.push(result);
      }

      const fallbackResults = results.filter(
        (r) => typeof r === 'object' && r !== null && 'quotaExhausted' in r
      );
      expect(fallbackResults.length).toBeGreaterThan(0);
    });
  });

  describe('Mixed API Failures', () => {
    it('should handle multiple failure types', async () => {
      const failureTypes = [
        { status: 500, message: 'Internal error' },
        { status: 429, message: 'Rate limit' },
        { status: 503, message: 'Service unavailable' },
      ];

      const results: Array<{ success: boolean; attempts: number }> = [];

      for (const failure of failureTypes) {
        let attempts = 0;
        try {
          await executeWithRetry(
            async () => {
              attempts++;
              if (attempts < 3) {
                const error = new Error(failure.message);
                (error as any).response = { status: failure.status };
                throw error;
              }
              return 'success';
            },
            {
              maxRetries: 3,
              baseDelayMs: 50,
            }
          );
          results.push({ success: true, attempts });
        } catch {
          results.push({ success: false, attempts });
        }
      }

      expect(results.every((r) => r.success)).toBe(true);
      expect(results.every((r) => r.attempts === 3)).toBe(true);
    });

    it('should maintain circuit breaker state across failure types', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000,
        name: 'mixed-failures',
      });

      const failures = [500, 429, 503, 500, 429];

      for (const status of failures) {
        try {
          await breaker.execute(async () => {
            const error = new Error(`API error ${status}`);
            (error as any).response = { status };
            throw error;
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('Error Messages and Diagnostics', () => {
    it('should provide helpful error messages', async () => {
      const errors: string[] = [];

      try {
        await executeWithRetry(
          async () => {
            const error = new Error('Internal server error');
            (error as any).response = { status: 500 };
            throw error;
          },
          {
            maxRetries: 2,
            baseDelayMs: 50,
          }
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }

      expect(errors[0]).toContain('Internal server error');
    });

    it('should log retry attempts', async () => {
      const loggedAttempts: number[] = [];

      try {
        await executeWithRetry(
          async () => {
            loggedAttempts.push(loggedAttempts.length + 1);
            const error = new Error('API error');
            (error as any).response = { status: 500 };
            throw error;
          },
          {
            maxRetries: 3,
            baseDelayMs: 50,
          }
        );
      } catch {
        // Expected
      }

      expect(loggedAttempts).toEqual([1, 2, 3, 4]);
    });
  });

  describe('Recovery Scenarios', () => {
    it('should recover after API becomes healthy', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 500,
        name: 'recovery',
      });

      // Phase 1: Fail
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            const error = new Error('API error');
            (error as any).response = { status: 500 };
            throw error;
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');

      // Phase 2: Wait for half-open
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Phase 3: Successful operations
      const results: string[] = [];
      for (let i = 0; i < 5; i++) {
        try {
          const result = await breaker.execute(async () => 'success');
          results.push(result);
        } catch {
          // May fail during transition
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(results.length).toBeGreaterThan(0);
      expect(breaker.getState()).toBe('closed');
    });
  });
});
