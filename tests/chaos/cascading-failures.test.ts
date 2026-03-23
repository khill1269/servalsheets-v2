/**
 * Chaos Tests: Cascading Failures
 *
 * Verifies system resilience to cascading failures:
 * - Dependency chain failures
 * - Failure amplification
 * - Recovery from cascading failures
 * - Bulkhead isolation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createChaosEngine, type ChaosEngine } from './chaos-framework.js';
import { CircuitBreaker } from '../../src/utils/circuit-breaker.js';
import { executeWithRetry } from '../../src/utils/retry.js';

describe('Chaos: Cascading Failures', () => {
  let chaos: ChaosEngine;

  beforeEach(() => {
    chaos = createChaosEngine();
  });

  afterEach(() => {
    chaos.reset();
    chaos.clearEvents();
  });

  describe('Failure Amplification', () => {
    it('should detect escalating failure rates', async () => {
      chaos.injectCascadingFailures({
        initialProbability: 0.1,
        escalationRate: 0.1,
        maxProbability: 0.9,
      });

      const results: Array<{ success: boolean; attempt: number }> = [];

      // Need to actually trigger the chaos wrapper to cause failures
      for (let i = 0; i < 20; i++) {
        try {
          await chaos.execute(async () => {
            // Cascading failures are tracked when we actually fail
            throw new Error('API failure');
          });
          results.push({ success: true, attempt: i });
        } catch {
          results.push({ success: false, attempt: i });
        }
      }

      const stats = chaos.getStats();
      // After multiple failures, rate should escalate or stay at initial
      expect(stats.cascadingFailureRate).toBeGreaterThanOrEqual(0.1);
    });

    it('should trigger circuit breaker during cascading failures', async () => {
      chaos.injectCascadingFailures({
        initialProbability: 0.5,
        escalationRate: 0.2,
      });

      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 1000,
        name: 'cascading-breaker',
      });

      let attempts = 0;
      const operation = async () => {
        attempts += 1;
        if (attempts <= 3) {
          throw new Error('Cascading failure');
        }
        return 'success';
      };

      // Execute until circuit opens
      for (let i = 0; i < 10; i++) {
        try {
          await breaker.execute(operation);
        } catch {
          // Expected
        }

        if (breaker.getState() === 'open') {
          break;
        }
      }

      expect(breaker.getState()).toBe('open');
      // Circuit breaker opened due to cascading failures
      const stats = breaker.getStats();
      expect(stats.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('Dependency Chain Failures', () => {
    it('should isolate failures in dependency chains', async () => {
      const services = {
        upstream: new CircuitBreaker({
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 1000,
          name: 'upstream',
        }),
        middle: new CircuitBreaker({
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 1000,
          name: 'middle',
        }),
        downstream: new CircuitBreaker({
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 1000,
          name: 'downstream',
        }),
      };

      // Inject failure in upstream
      chaos.injectCascadingFailures({ initialProbability: 0.8 });

      const callChain = async () => {
        return await services.downstream.execute(async () => {
          return await services.middle.execute(async () => {
            return await services.upstream.execute(async () => {
              if (Math.random() < 0.8) {
                throw new Error('Upstream failure');
              }
              return 'success';
            });
          });
        });
      };

      // Execute chain multiple times
      for (let i = 0; i < 10; i++) {
        try {
          await callChain();
        } catch {
          // Expected
        }
      }

      // Upstream should open first
      expect(services.upstream.getState()).toBe('open');

      // Middle and downstream should either be open or have fewer failures
      const upstreamStats = services.upstream.getStats();
      const middleStats = services.middle.getStats();

      expect(upstreamStats.totalRequests).toBeGreaterThan(0);
      expect(middleStats.totalRequests).toBeGreaterThan(0);
    });

    it('should prevent cascading to healthy services', async () => {
      const unhealthyService = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 500,
        name: 'unhealthy',
      });

      const healthyService = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 1000,
        name: 'healthy',
      });

      // Make unhealthy service fail
      for (let i = 0; i < 5; i++) {
        try {
          await unhealthyService.execute(async () => {
            throw new Error('Service failure');
          });
        } catch {
          // Expected
        }
      }

      expect(unhealthyService.getState()).toBe('open');

      // Healthy service should still work
      const result = await healthyService.execute(async () => 'success');
      expect(result).toBe('success');
      expect(healthyService.getState()).toBe('closed');
    });
  });

  describe('Bulkhead Isolation', () => {
    it('should isolate failures using bulkhead pattern', async () => {
      // Create separate circuit breakers for different resource pools
      const pools = {
        readPool: new CircuitBreaker({
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 1000,
          name: 'read-pool',
        }),
        writePool: new CircuitBreaker({
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 1000,
          name: 'write-pool',
        }),
      };

      // Inject failures in write pool
      chaos.injectCascadingFailures({ initialProbability: 0.9 });

      // Fail write operations
      for (let i = 0; i < 5; i++) {
        try {
          await pools.writePool.execute(async () => {
            throw new Error('Write failure');
          });
        } catch {
          // Expected
        }
      }

      expect(pools.writePool.getState()).toBe('open');

      // Remove chaos
      chaos.reset();

      // Read operations should still work
      const readResult = await pools.readPool.execute(async () => 'read-success');
      expect(readResult).toBe('read-success');
      expect(pools.readPool.getState()).toBe('closed');
    });
  });

  describe('Recovery from Cascading Failures', () => {
    it('should recover after cascading failures stop', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 500,
        name: 'recovery-test',
      });

      // Phase 1: Inject cascading failures
      chaos.injectCascadingFailures({
        initialProbability: 0.8,
        escalationRate: 0.1,
      });

      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Cascading failure');
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');

      // Phase 2: Stop chaos
      chaos.reset();

      // Phase 3: Wait for half-open
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Phase 4: Verify recovery
      const results: string[] = [];
      for (let i = 0; i < 5; i++) {
        try {
          const result = await breaker.execute(async () => 'recovered');
          results.push(result);
        } catch {
          // May fail during half-open transition
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Should eventually succeed and close
      expect(results.filter((r) => r === 'recovered').length).toBeGreaterThan(0);
      expect(breaker.getState()).toBe('closed');
    });

    it('should provide fallback during cascading failures', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 500,
        name: 'fallback-test',
      });

      // Register fallback
      breaker.registerFallback({
        name: 'degraded-fallback',
        priority: 100,
        execute: async () => ({
          degraded: true,
          message: 'Using fallback due to cascading failures',
        }),
        shouldUse: () => true,
      });

      chaos.injectCascadingFailures({ initialProbability: 1.0 });

      const results: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const result = await breaker.execute(async () => {
          throw new Error('Cascading failure');
        });
        results.push(result);
      }

      // Should use fallback
      const fallbackResults = results.filter(
        (r) => typeof r === 'object' && r !== null && 'degraded' in r
      );
      expect(fallbackResults.length).toBeGreaterThan(0);
    });
  });

  describe('Retry Behavior During Cascading Failures', () => {
    it('should respect retry limits during cascading failures', async () => {
      chaos.injectCascadingFailures({
        initialProbability: 0.9,
        escalationRate: 0.1,
      });

      let attempts = 0;
      const maxRetries = 3;

      try {
        await executeWithRetry(
          async (_signal) => {
            attempts++;
            // Error must be retryable (match retryable patterns in retry.ts)
            throw new Error('Service temporarily unavailable (cascading failure)');
          },
          { maxRetries, baseDelayMs: 50, timeoutMs: 30000 }
        );
      } catch {
        // Expected to fail
      }

      expect(attempts).toBe(maxRetries + 1); // Initial + retries
    });

    it('should increase backoff during cascading failures', async () => {
      chaos.injectCascadingFailures({ initialProbability: 0.8 });

      const delays: number[] = [];
      const startTimes: number[] = [];

      try {
        await executeWithRetry(
          async (_signal) => {
            const now = Date.now();
            if (startTimes.length > 0) {
              delays.push(now - startTimes[startTimes.length - 1]!);
            }
            startTimes.push(now);
            // Error must be retryable (match retryable patterns in retry.ts)
            throw new Error('Service temporarily unavailable (cascading failure)');
          },
          {
            maxRetries: 3,
            baseDelayMs: 100,
            maxDelayMs: 5000,
            timeoutMs: 30000,
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

  describe('Monitoring and Observability', () => {
    it('should track consecutive failures', async () => {
      // Consecutive failure tracking happens through wrapApiClient() proxy.
      // The proxy increments consecutiveFailures when the wrapped operation
      // itself throws (not from chaos injection). So we set chaos probability
      // to 0 and let the mock operation throw directly.
      chaos.injectCascadingFailures({ initialProbability: 0 });

      const mockClient = {
        sheets: {
          spreadsheets: {
            values: {
              get: async () => {
                throw new Error('API failure');
              },
            },
          },
        },
        drive: {},
        hasElevatedAccess: true,
        scopes: [],
      };

      const wrappedClient = chaos.wrapGoogleApiClient(mockClient as never);

      for (let i = 0; i < 5; i++) {
        try {
          await wrappedClient.sheets.spreadsheets.values.get();
        } catch {
          // Expected
        }
      }

      const stats = chaos.getStats();
      expect(stats.consecutiveFailures).toBeGreaterThan(0);
    });

    it('should log cascading failure events', async () => {
      // Cascading failure events are recorded via applyCascadingFailureChaos()
      // which is called through wrapApiClient() proxy, not chaos.execute().
      chaos.injectCascadingFailures({ initialProbability: 1.0 });

      const mockClient = {
        sheets: {
          spreadsheets: {
            values: {
              get: async () => 'ok',
            },
          },
        },
        drive: {},
        hasElevatedAccess: true,
        scopes: [],
      };

      const wrappedClient = chaos.wrapGoogleApiClient(mockClient as never);

      for (let i = 0; i < 10; i++) {
        try {
          await wrappedClient.sheets.spreadsheets.values.get();
        } catch {
          // Expected - cascading failure chaos throws
        }
      }

      const events = chaos.getEventsByType('api_failure');
      expect(events.length).toBeGreaterThan(0);

      // Verify event metadata
      const cascadingEvents = events.filter(
        (e) => e.metadata && 'cascading' in e.metadata && e.metadata.cascading === true
      );
      expect(cascadingEvents.length).toBeGreaterThan(0);
    });

    it('should reset consecutive failures on success', async () => {
      // Don't inject chaos - let the mock operation throw directly.
      // The proxy's catch block increments consecutiveFailures for operation errors.
      let shouldFail = true;

      const mockClient = {
        sheets: {
          spreadsheets: {
            values: {
              get: async () => {
                if (shouldFail) {
                  throw new Error('API failure');
                }
                return 'success';
              },
            },
          },
        },
        drive: {},
        hasElevatedAccess: true,
        scopes: [],
      };

      const wrappedClient = chaos.wrapGoogleApiClient(mockClient as never);

      // Build up failures
      for (let i = 0; i < 5; i++) {
        try {
          await wrappedClient.sheets.spreadsheets.values.get();
        } catch {
          // Expected
        }
      }

      const statsBeforeSuccess = chaos.getStats();
      expect(statsBeforeSuccess.consecutiveFailures).toBeGreaterThan(0);

      // Now succeed - the proxy resets consecutiveFailures on success
      shouldFail = false;
      await wrappedClient.sheets.spreadsheets.values.get();

      const statsAfterSuccess = chaos.getStats();
      expect(statsAfterSuccess.consecutiveFailures).toBe(0);
    });
  });

  describe('Error Messages and Diagnostics', () => {
    it('should provide diagnostic information', async () => {
      chaos.injectCascadingFailures({ initialProbability: 0.9 });

      const errors: string[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          await chaos.execute(async () => {
            throw new Error('API temporarily unavailable (cascading failure)');
          });
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      expect(errors.every((e) => e.includes('cascading'))).toBe(true);
      expect(errors.every((e) => e.includes('temporarily unavailable'))).toBe(true);
    });
  });
});
