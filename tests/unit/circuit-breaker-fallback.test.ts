/**
 * Tests for Circuit Breaker Fallback Strategies
 *
 * Tests the new multi-strategy fallback system for production resilience
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  FallbackStrategies,
  type FallbackStrategy,
} from '../../src/utils/circuit-breaker.js';

describe('CircuitBreaker - Fallback Strategies', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 1000,
      name: 'test-breaker',
    });
  });

  describe('Fallback Strategy Registration', () => {
    it('should register and sort strategies by priority', () => {
      const lowPriority: FallbackStrategy<string> = {
        name: 'low',
        priority: 10,
        execute: async () => 'low',
        shouldUse: () => true,
      };

      const highPriority: FallbackStrategy<string> = {
        name: 'high',
        priority: 100,
        execute: async () => 'high',
        shouldUse: () => true,
      };

      breaker.registerFallback(lowPriority);
      breaker.registerFallback(highPriority);

      const stats = breaker.getStats();
      expect(stats.registeredFallbacks).toBe(2);
    });

    it('should clear all fallback strategies', () => {
      breaker.registerFallback({
        name: 'test',
        execute: async () => 'test',
        shouldUse: () => true,
      });

      expect(breaker.getStats().registeredFallbacks).toBe(1);

      breaker.clearFallbacks();

      expect(breaker.getStats().registeredFallbacks).toBe(0);
    });
  });

  describe('Fallback Execution Order', () => {
    it('should execute fallbacks in priority order', async () => {
      const executionOrder: string[] = [];

      breaker.registerFallback({
        name: 'low-priority',
        priority: 10,
        execute: async () => {
          executionOrder.push('low');
          throw new Error('Low priority failed');
        },
        shouldUse: () => true,
      });

      breaker.registerFallback({
        name: 'high-priority',
        priority: 100,
        execute: async () => {
          executionOrder.push('high');
          return 'high-success';
        },
        shouldUse: () => true,
      });

      // Operation fails, fallbacks should execute immediately (new behavior)
      const result = await breaker.execute(async () => {
        throw new Error('fail');
      });

      expect(result).toBe('high-success');
      expect(executionOrder).toEqual(['high']); // High priority tried first and succeeded
    });

    it('should try next fallback if previous fails', async () => {
      const executionOrder: string[] = [];

      breaker.registerFallback({
        name: 'fallback-1',
        priority: 100,
        execute: async () => {
          executionOrder.push('fallback-1');
          throw new Error('Fallback 1 failed');
        },
        shouldUse: () => true,
      });

      breaker.registerFallback({
        name: 'fallback-2',
        priority: 50,
        execute: async () => {
          executionOrder.push('fallback-2');
          return 'fallback-2-success';
        },
        shouldUse: () => true,
      });

      // Operation fails, should try both fallbacks
      const result = await breaker.execute(async () => {
        throw new Error('fail');
      });

      expect(result).toBe('fallback-2-success');
      expect(executionOrder).toEqual(['fallback-1', 'fallback-2']);
    });
  });

  describe('shouldUse Filter', () => {
    it('should skip fallbacks when shouldUse returns false', async () => {
      const executionOrder: string[] = [];

      breaker.registerFallback({
        name: 'auth-only',
        priority: 100,
        execute: async () => {
          executionOrder.push('auth-only');
          return 'auth-fallback';
        },
        shouldUse: (error) => error.message.includes('auth'),
      });

      breaker.registerFallback({
        name: 'catch-all',
        priority: 50,
        execute: async () => {
          executionOrder.push('catch-all');
          return 'catch-all-fallback';
        },
        shouldUse: () => true,
      });

      // Operation fails with non-auth error, should skip auth-only and use catch-all
      const nonAuthError = new Error('network timeout');
      const result = await breaker.execute(async () => {
        throw nonAuthError;
      });

      expect(result).toBe('catch-all-fallback');
      expect(executionOrder).toEqual(['catch-all']); // auth-only was skipped
    });
  });

  describe('FallbackStrategies Helpers', () => {
    describe('cachedData', () => {
      it('should return cached data when available', async () => {
        const cache = new Map<string, { value: string }>();
        cache.set('test-key', { value: 'cached-data' });

        const strategy = FallbackStrategies.cachedData(cache, 'test-key', 100);

        const result = await strategy.execute();
        expect(result).toEqual({ value: 'cached-data' });
      });

      it('should throw when cache key not found', async () => {
        const cache = new Map<string, string>();
        const strategy = FallbackStrategies.cachedData(cache, 'missing-key', 100);

        await expect(strategy.execute()).rejects.toThrow('No cached data available');
      });

      it('should skip on auth errors', () => {
        const cache = new Map<string, string>();
        const strategy = FallbackStrategies.cachedData(cache, 'key', 100);

        expect(strategy.shouldUse(new Error('Authentication failed'))).toBe(false);
        expect(strategy.shouldUse(new Error('Permission denied'))).toBe(false);
        expect(strategy.shouldUse(new Error('Network error'))).toBe(true);
      });
    });

    describe('degradedMode', () => {
      it('should return degraded data', async () => {
        const degradedData = { warning: 'Degraded mode active', data: [] };
        const strategy = FallbackStrategies.degradedMode(degradedData, 50);

        const result = await strategy.execute();
        expect(result).toEqual(degradedData);
      });

      it('should always be usable', () => {
        const strategy = FallbackStrategies.degradedMode({}, 50);

        expect(strategy.shouldUse(new Error('Any error'))).toBe(true);
      });
    });

    describe('retryWithBackoff', () => {
      it('should retry operation with exponential backoff', async () => {
        let attempts = 0;
        const operation = vi.fn(async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Transient failure');
          }
          return 'success-on-third-try';
        });

        const strategy = FallbackStrategies.retryWithBackoff(operation, 3, 100, 80);

        const result = await strategy.execute();

        expect(result).toBe('success-on-third-try');
        expect(operation).toHaveBeenCalledTimes(3);
      });

      it('should only retry transient errors', () => {
        const strategy = FallbackStrategies.retryWithBackoff(async () => 'test', 3, 100, 80);

        expect(strategy.shouldUse(new Error('timeout'))).toBe(true);
        expect(strategy.shouldUse(new Error('network failure'))).toBe(true);
        expect(strategy.shouldUse(new Error('503 Service Unavailable'))).toBe(true);
        expect(strategy.shouldUse(new Error('429 Too Many Requests'))).toBe(true);
        expect(strategy.shouldUse(new Error('Invalid data'))).toBe(false);
      });
    });

    describe('Integration with Circuit States', () => {
      it('should use fallbacks when circuit is OPEN', async () => {
        breaker.registerFallback({
          name: 'open-fallback',
          execute: async () => 'fallback-data',
          shouldUse: () => true,
        });

        // Force circuit to open (first call uses fallback, so we need to count failures)
        // Clear fallbacks temporarily to force real failures
        breaker.clearFallbacks();
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();

        expect(breaker.getState()).toBe('open');

        // Re-register fallback
        breaker.registerFallback({
          name: 'open-fallback',
          execute: async () => 'fallback-data',
          shouldUse: () => true,
        });

        // Should use fallback instead of throwing
        const result = await breaker.execute(async () => {
          throw new Error('fail');
        });
        expect(result).toBe('fallback-data');
      });
    });
  });

  describe('Backwards Compatibility', () => {
    it('should support legacy single fallback parameter', async () => {
      // Force circuit to open (no registered strategies)
      await expect(
        breaker.execute(async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow();

      expect(breaker.getState()).toBe('open');

      // Use legacy fallback parameter (no registered strategies)
      const result = await breaker.execute(
        async () => {
          throw new Error('fail');
        },
        async () => 'legacy-fallback'
      );

      expect(result).toBe('legacy-fallback');
      expect(breaker.getStats().fallbackUsageCount).toBe(1);
    });

    it('should prefer registered strategies over legacy fallback', async () => {
      breaker.registerFallback({
        name: 'registered',
        priority: 100,
        execute: async () => 'registered-fallback',
        shouldUse: () => true,
      });

      // Operation fails, should use registered strategy over legacy fallback
      const result = await breaker.execute(
        async () => {
          throw new Error('fail');
        },
        async () => 'legacy-fallback'
      );

      expect(result).toBe('registered-fallback');
    });
  });
});
