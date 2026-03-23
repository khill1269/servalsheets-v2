/**
 * Tests for ConcurrencyCoordinator (Phase 1: Critical Stability)
 *
 * Validates global API concurrency control to prevent quota exhaustion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConcurrencyCoordinator,
  getConcurrencyCoordinator,
  resetConcurrencyCoordinator,
} from '../../src/services/concurrency-coordinator.js';
import { waitFor } from '../helpers/wait-for.js';

describe('ConcurrencyCoordinator', () => {
  let coordinator: ConcurrencyCoordinator;

  beforeEach(() => {
    resetConcurrencyCoordinator();
  });

  afterEach(() => {
    resetConcurrencyCoordinator();
  });

  describe('Basic Permit Management', () => {
    it('should allow operations up to maxConcurrent limit', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 3 });

      const permit1 = await coordinator.acquire('test1');
      const permit2 = await coordinator.acquire('test2');
      const permit3 = await coordinator.acquire('test3');

      expect(permit1).toBeDefined();
      expect(permit2).toBeDefined();
      expect(permit3).toBeDefined();

      const status = coordinator.getStatus();
      expect(status.active).toBe(3);
      expect(status.utilization).toBe(100); // 100% utilization
    });

    it('should queue operations when limit is reached', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2 });

      const permit1 = await coordinator.acquire('test1');
      await coordinator.acquire('test2');

      // Third operation should be queued
      const promise3 = coordinator.acquire('test3');

      // Should not resolve immediately
      const status = coordinator.getStatus();
      expect(status.active).toBe(2);
      expect(status.queued).toBe(1);

      // Release one permit
      coordinator.release(permit1);

      // Third operation should now acquire
      const permit3 = await promise3;
      expect(permit3).toBeDefined();

      const finalStatus = coordinator.getStatus();
      expect(finalStatus.active).toBe(2);
      expect(finalStatus.queued).toBe(0);
    });

    it('should release permits correctly', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2 });

      const permit1 = await coordinator.acquire('test1');
      await coordinator.acquire('test2');

      coordinator.release(permit1);

      const status = coordinator.getStatus();
      expect(status.active).toBe(1);
    });

    it('should handle double release gracefully', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2 });

      const permit1 = await coordinator.acquire('test1');

      coordinator.release(permit1);
      coordinator.release(permit1); // Double release should not throw

      const status = coordinator.getStatus();
      expect(status.active).toBe(0);
    });
  });

  describe('execute() Wrapper', () => {
    it('should automatically acquire and release permits', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2 });

      const result = await coordinator.execute('test', async () => {
        return 'success';
      });

      expect(result).toBe('success');

      const status = coordinator.getStatus();
      expect(status.active).toBe(0); // Permit released
    });

    it('should release permit even if operation throws', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2 });

      await expect(
        coordinator.execute('test', async () => {
          throw new Error('Operation failed');
        })
      ).rejects.toThrow('Operation failed');

      const status = coordinator.getStatus();
      expect(status.active).toBe(0); // Permit still released
    });

    it('should enforce concurrency limit with multiple execute() calls', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2 });

      let concurrentCount = 0;
      let peakConcurrent = 0;

      const operation = async () => {
        concurrentCount++;
        peakConcurrent = Math.max(peakConcurrent, concurrentCount);
        await waitFor(50);
        concurrentCount--;
      };

      // Start 5 operations concurrently
      await Promise.all([
        coordinator.execute('test1', operation),
        coordinator.execute('test2', operation),
        coordinator.execute('test3', operation),
        coordinator.execute('test4', operation),
        coordinator.execute('test5', operation),
      ]);

      // Peak concurrent should never exceed limit
      expect(peakConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('FIFO Queue Ordering', () => {
    it('should process queued operations in FIFO order', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 1 });

      const executionOrder: number[] = [];

      // Fill the slot
      const permit1 = await coordinator.acquire('test1');

      // Queue 3 operations
      const promise2 = coordinator.execute('test2', async () => {
        executionOrder.push(2);
      });
      const promise3 = coordinator.execute('test3', async () => {
        executionOrder.push(3);
      });
      const promise4 = coordinator.execute('test4', async () => {
        executionOrder.push(4);
      });

      // Release first permit
      coordinator.release(permit1);

      // Wait for all to complete
      await Promise.all([promise2, promise3, promise4]);

      // Should execute in order 2, 3, 4
      expect(executionOrder).toEqual([2, 3, 4]);
    });
  });

  describe('Metrics Tracking', () => {
    it('should track active operations', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 5, enableMetrics: true });

      await coordinator.execute('test', async () => {
        const metrics = coordinator.getMetrics();
        expect(metrics.activeOperations).toBe(1);
      });
    });

    it('should track peak concurrent operations', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 3, enableMetrics: true });

      const permit1 = await coordinator.acquire('test1');
      const permit2 = await coordinator.acquire('test2');
      await coordinator.acquire('test3');

      const metrics = coordinator.getMetrics();
      expect(metrics.peakConcurrent).toBe(3);

      coordinator.release(permit1);
      coordinator.release(permit2);

      const metrics2 = coordinator.getMetrics();
      expect(metrics2.peakConcurrent).toBe(3); // Peak should persist
      expect(metrics2.activeOperations).toBe(1);
    });

    it('should track limit reached count', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 1, enableMetrics: true });

      const permit1 = await coordinator.acquire('test1');

      // Try to acquire 3 more (should increment limit reached count)
      const promise2 = coordinator.acquire('test2');
      const promise3 = coordinator.acquire('test3');
      const promise4 = coordinator.acquire('test4');

      // Give async queue time to process
      await waitFor(10);

      const metrics = coordinator.getMetrics();
      expect(metrics.limitReachedCount).toBe(3);

      // Clean up: release first permit and then release each one that acquires
      coordinator.release(permit1);
      const permit2 = await promise2;
      coordinator.release(permit2);
      const permit3 = await promise3;
      coordinator.release(permit3);
      const permit4 = await promise4;
      coordinator.release(permit4);
    });

    it('should track average wait time', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 1, enableMetrics: true });

      const permit1 = await coordinator.acquire('test1');

      // Queue operation that will wait
      const promise2 = coordinator.acquire('test2');

      await waitFor(100);

      coordinator.release(permit1);
      await promise2;

      const metrics = coordinator.getMetrics();
      expect(metrics.averageWaitTimeMs).toBeGreaterThan(0);
    });

    it('should track total operations', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2, enableMetrics: true });

      await coordinator.execute('test1', async () => {});
      await coordinator.execute('test2', async () => {});
      await coordinator.execute('test3', async () => {});

      const metrics = coordinator.getMetrics();
      expect(metrics.totalOperations).toBe(3);
    });

    it('should calculate utilization correctly', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 4 });

      await coordinator.acquire('test1');
      await coordinator.acquire('test2');

      const status = coordinator.getStatus();
      expect(status.utilization).toBe(50); // 2/4 = 50%
    });
  });

  describe('Source Tracking', () => {
    it('should track operations by source', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 5, enableMetrics: true });

      await coordinator.execute('ParallelExecutor', async () => {});
      await coordinator.execute('BatchingSystem', async () => {});
      await coordinator.execute('PrefetchingSystem', async () => {});

      const metrics = coordinator.getMetrics();
      expect(metrics.totalOperations).toBe(3);
    });
  });

  describe('Global Singleton', () => {
    it('should return same instance from getConcurrencyCoordinator', () => {
      const coord1 = getConcurrencyCoordinator();
      const coord2 = getConcurrencyCoordinator();

      expect(coord1).toBe(coord2);
    });

    it('should initialize with default config', () => {
      const coordinator = getConcurrencyCoordinator();
      const status = coordinator.getStatus();

      expect(status.limit).toBe(25); // Default maxConcurrent
    });

    it('should respect environment variable for max concurrent', () => {
      process.env.GOOGLE_API_MAX_CONCURRENT = '10';

      resetConcurrencyCoordinator();
      const coordinator = getConcurrencyCoordinator();
      const status = coordinator.getStatus();

      expect(status.limit).toBe(10);

      delete process.env.GOOGLE_API_MAX_CONCURRENT;
    });

    it('should reset singleton with resetConcurrencyCoordinator', () => {
      const coord1 = getConcurrencyCoordinator();
      resetConcurrencyCoordinator();
      const coord2 = getConcurrencyCoordinator();

      expect(coord1).not.toBe(coord2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero maxConcurrent gracefully', async () => {
      // This is a pathological case - should queue everything
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 0 });

      coordinator.acquire('test');

      const status = coordinator.getStatus();
      expect(status.queued).toBe(1);

      // Should never resolve without external intervention
      // We won't await it to avoid hanging the test
    });

    it('should handle very high concurrency', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 1000 });

      const operations = Array.from({ length: 100 }, (_, i) =>
        coordinator.execute(`test${i}`, async () => i)
      );

      const results = await Promise.all(operations);
      expect(results).toHaveLength(100);
    });

    it('should handle rapid acquire/release cycles', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 5 });

      for (let i = 0; i < 100; i++) {
        const permit = await coordinator.acquire(`test${i}`);
        coordinator.release(permit);
      }

      const status = coordinator.getStatus();
      expect(status.active).toBe(0);
    });

    it('should handle concurrent execute() calls with varying durations', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 3 });

      const operations = [
        coordinator.execute('fast1', async () => {
          await waitFor(10);
          return 'fast1';
        }),
        coordinator.execute('slow', async () => {
          await waitFor(100);
          return 'slow';
        }),
        coordinator.execute('fast2', async () => {
          await waitFor(10);
          return 'fast2';
        }),
        coordinator.execute('fast3', async () => {
          await waitFor(10);
          return 'fast3';
        }),
      ];

      const results = await Promise.all(operations);
      expect(results).toEqual(['fast1', 'slow', 'fast2', 'fast3']);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in operations gracefully', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2 });

      const successOperation = coordinator.execute('success', async () => 'ok');
      const failOperation = coordinator.execute('fail', async () => {
        throw new Error('Simulated failure');
      });

      await expect(failOperation).rejects.toThrow('Simulated failure');
      const result = await successOperation;
      expect(result).toBe('ok');

      const status = coordinator.getStatus();
      expect(status.active).toBe(0); // Both permits released
    });

    it('should continue processing queue after operation errors', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 1 });

      await coordinator.execute('op1', async () => 'ok');

      await expect(
        coordinator.execute('op2', async () => {
          throw new Error('Error in op2');
        })
      ).rejects.toThrow('Error in op2');

      // Should still be able to execute more operations
      const result = await coordinator.execute('op3', async () => 'ok');
      expect(result).toBe('ok');
    });
  });

  describe('Performance', () => {
    it('should have minimal overhead for operations within limit', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 10 });

      const startTime = Date.now();

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          coordinator.execute(`test${i}`, async () => {
            // Simulate fast API call
            await waitFor(1);
          })
        )
      );

      const duration = Date.now() - startTime;

      // Should complete quickly (under 50ms with 1ms operations)
      expect(duration).toBeLessThan(50);
    });

    it('should enforce queue discipline under load', async () => {
      coordinator = new ConcurrencyCoordinator({ maxConcurrent: 2 });

      const startTimes: number[] = [];
      const endTimes: number[] = [];

      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          coordinator.execute(`test${i}`, async () => {
            startTimes.push(Date.now());
            await waitFor(50);
            endTimes.push(Date.now());
          })
        )
      );

      // Should complete in ~3 batches (6 ops / 2 concurrent = 3 batches)
      const totalDuration = Math.max(...endTimes) - Math.min(...startTimes);
      // Allow a small amount of timer jitter on shared CI runners.
      expect(totalDuration).toBeGreaterThanOrEqual(140);
      expect(totalDuration).toBeLessThan(250); // Allow overhead
    });
  });
});
