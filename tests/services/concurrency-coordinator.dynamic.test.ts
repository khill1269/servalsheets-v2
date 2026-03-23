/**
 * Tests for Dynamic Concurrency Adjustment (429 Error Elimination)
 *
 * Validates adaptive concurrency based on quota headroom and rate limit errors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConcurrencyCoordinator,
  resetConcurrencyCoordinator,
} from '../../src/services/concurrency-coordinator.js';

describe('ConcurrencyCoordinator - Dynamic Adjustment', () => {
  let coordinator: ConcurrencyCoordinator;

  beforeEach(() => {
    resetConcurrencyCoordinator();
    vi.useFakeTimers();
  });

  afterEach(() => {
    coordinator?.stopAdaptiveAdjustment();
    resetConcurrencyCoordinator();
    vi.useRealTimers();
  });

  describe('Quota-Based Adjustment', () => {
    it('should decrease concurrency when quota utilization is high (>80%)', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        adjustmentIntervalMs: 10000,
      });

      // Simulate high quota usage (85%)
      for (let i = 0; i < 51; i++) {
        coordinator.reportQuotaUsage(1);
      }

      const initialStatus = coordinator.getStatus();
      expect(initialStatus.limit).toBe(15);

      // Advance timer to trigger adjustment
      vi.advanceTimersByTime(10000);

      const newStatus = coordinator.getStatus();
      expect(newStatus.limit).toBeLessThan(15);
      expect(newStatus.limit).toBeGreaterThanOrEqual(5); // Not below minimum
    });

    it('should increase concurrency when quota utilization is low (<50%)', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        adjustmentIntervalMs: 10000,
      });

      // Simulate low quota usage (25%)
      for (let i = 0; i < 15; i++) {
        coordinator.reportQuotaUsage(1);
      }

      const initialStatus = coordinator.getStatus();
      expect(initialStatus.limit).toBe(15);

      // Advance timer to trigger adjustment
      vi.advanceTimersByTime(10000);

      const newStatus = coordinator.getStatus();
      expect(newStatus.limit).toBeGreaterThan(15);
      expect(newStatus.limit).toBeLessThanOrEqual(30); // Not above ceiling
    });

    it('should maintain concurrency when quota utilization is moderate (50-80%)', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        adjustmentIntervalMs: 10000,
      });

      // Simulate moderate quota usage (65%)
      for (let i = 0; i < 39; i++) {
        coordinator.reportQuotaUsage(1);
      }

      const initialStatus = coordinator.getStatus();
      expect(initialStatus.limit).toBe(15);

      // Advance timer to trigger adjustment
      vi.advanceTimersByTime(10000);

      const newStatus = coordinator.getStatus();
      expect(newStatus.limit).toBe(15); // Should not change
    });

    it('should not decrease below minimum concurrent limit', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 8,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        adjustmentIntervalMs: 10000,
      });

      // Simulate very high quota usage repeatedly
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 55; j++) {
          coordinator.reportQuotaUsage(1);
        }
        vi.advanceTimersByTime(10000);
      }

      const finalStatus = coordinator.getStatus();
      expect(finalStatus.limit).toBeGreaterThanOrEqual(5);
    });

    it('should not increase above maximum ceiling', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 25,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        adjustmentIntervalMs: 10000,
      });

      // Simulate very low quota usage repeatedly
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 10; j++) {
          coordinator.reportQuotaUsage(1);
        }
        vi.advanceTimersByTime(10000);
      }

      const finalStatus = coordinator.getStatus();
      expect(finalStatus.limit).toBeLessThanOrEqual(30);
    });
  });

  describe('429 Error Response', () => {
    it('should immediately reduce concurrency on 429 error', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
      });

      const initialStatus = coordinator.getStatus();
      expect(initialStatus.limit).toBe(15);

      // Simulate 429 error
      coordinator.on429Error();

      const newStatus = coordinator.getStatus();
      expect(newStatus.limit).toBeLessThan(15);
      expect(newStatus.limit).toBe(10); // Should decrease by 5
    });

    it('should handle multiple consecutive 429 errors', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 20,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
      });

      coordinator.on429Error();
      expect(coordinator.getStatus().limit).toBe(15); // 20 - 5

      coordinator.on429Error();
      expect(coordinator.getStatus().limit).toBe(10); // 15 - 5

      coordinator.on429Error();
      expect(coordinator.getStatus().limit).toBe(5); // 10 - 5 (at minimum)

      coordinator.on429Error();
      expect(coordinator.getStatus().limit).toBe(5); // Should not go below minimum
    });

    it('should respect minimum limit when handling 429 errors', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 8,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
      });

      coordinator.on429Error();

      const status = coordinator.getStatus();
      expect(status.limit).toBeGreaterThanOrEqual(5);
    });

    it('should track 429 error count in metrics', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        enableMetrics: true,
      });

      coordinator.on429Error();
      coordinator.on429Error();

      const metrics = coordinator.getMetrics();
      expect(metrics.rateLimitErrorCount).toBe(2);
    });
  });

  describe('Quota Window Reset', () => {
    it('should reset quota tracking after 60 seconds', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
      });

      // Use up quota
      for (let i = 0; i < 50; i++) {
        coordinator.reportQuotaUsage(1);
      }

      const status1 = coordinator.getQuotaStatus();
      expect(status1.used).toBe(50);

      // Advance past quota window
      vi.advanceTimersByTime(61000);

      // Report more usage - should reset
      coordinator.reportQuotaUsage(1);

      const status2 = coordinator.getQuotaStatus();
      expect(status2.used).toBe(1); // Should have reset
    });

    it('should track quota utilization percentage', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
      });

      for (let i = 0; i < 30; i++) {
        coordinator.reportQuotaUsage(1);
      }

      const status = coordinator.getQuotaStatus();
      expect(status.utilization).toBe(0.5); // 30/60 = 50%
    });
  });

  describe('Recovery After Rate Limits', () => {
    it('should gradually increase limit after 429 errors stop', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        adjustmentIntervalMs: 10000,
      });

      // Hit rate limits
      coordinator.on429Error();
      coordinator.on429Error();

      const afterErrorsLimit = coordinator.getStatus().limit;
      expect(afterErrorsLimit).toBeLessThan(15);

      // Simulate low quota usage (recovery period)
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 10; j++) {
          coordinator.reportQuotaUsage(1);
        }
        vi.advanceTimersByTime(10000);
      }

      const recoveredLimit = coordinator.getStatus().limit;
      expect(recoveredLimit).toBeGreaterThan(afterErrorsLimit);
    });

    it('should track time since last 429 error', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
      });

      coordinator.on429Error();

      vi.advanceTimersByTime(5000);

      const metrics = coordinator.getMetrics();
      expect(metrics.timeSinceLast429Ms).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('Metrics and Observability', () => {
    it('should track limit adjustment events', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        enableMetrics: true,
        adjustmentIntervalMs: 10000,
      });

      // Trigger decrease
      for (let i = 0; i < 55; i++) {
        coordinator.reportQuotaUsage(1);
      }
      vi.advanceTimersByTime(10000);

      const metrics = coordinator.getMetrics();
      expect(metrics.limitAdjustmentCount).toBeGreaterThan(0);
    });

    it('should track current limit in metrics', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        enableMetrics: true,
      });

      const metrics = coordinator.getMetrics();
      expect(metrics.currentLimit).toBe(15);

      coordinator.on429Error();

      const metricsAfter = coordinator.getMetrics();
      expect(metricsAfter.currentLimit).toBe(10);
    });

    it('should track minimum and maximum limits reached', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        enableMetrics: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        adjustmentIntervalMs: 10000,
      });

      // Hit minimum
      for (let i = 0; i < 10; i++) {
        coordinator.on429Error();
      }

      const metrics1 = coordinator.getMetrics();
      expect(metrics1.minimumLimitReached).toBe(true);

      // Reset and hit maximum
      resetConcurrencyCoordinator();
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 28,
        enableAdaptive: true,
        enableMetrics: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        adjustmentIntervalMs: 10000,
      });

      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 10; j++) {
          coordinator.reportQuotaUsage(1);
        }
        vi.advanceTimersByTime(10000);
      }

      const metrics2 = coordinator.getMetrics();
      expect(metrics2.maximumLimitReached).toBe(true);
    });

    it('should provide detailed adjustment history', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        adjustmentIntervalMs: 10000,
      });

      coordinator.on429Error();

      for (let i = 0; i < 55; i++) {
        coordinator.reportQuotaUsage(1);
      }
      vi.advanceTimersByTime(10000);

      const history = coordinator.getAdjustmentHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toMatchObject({
        timestamp: expect.any(Number),
        oldLimit: expect.any(Number),
        newLimit: expect.any(Number),
        reason: expect.any(String),
        quotaUtilization: expect.any(Number),
      });
    });
  });

  describe('Concurrent Operations Under Dynamic Limits', () => {
    it('should respect dynamically adjusted limits', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 10,
        enableAdaptive: true,
      });

      let concurrentCount = 0;
      let peakConcurrent = 0;

      const operation = async () => {
        concurrentCount++;
        peakConcurrent = Math.max(peakConcurrent, concurrentCount);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentCount--;
      };

      // Start 20 operations
      const operations = Array.from({ length: 20 }, (_, i) =>
        coordinator.execute(`test${i}`, operation)
      );

      // Advance timers and reduce limit mid-execution
      vi.advanceTimersByTime(15);
      coordinator.on429Error();

      // Complete all operations
      await vi.advanceTimersByTimeAsync(200);
      await Promise.all(operations);

      // Peak should never exceed initial limit of 10
      expect(peakConcurrent).toBeLessThanOrEqual(10);
    });

    it('should handle limit changes during queued operations', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 10,
        minConcurrent: 2,
        enableAdaptive: true,
        enableMetrics: true,
      });

      const completedOps: number[] = [];

      const operation = async (id: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        completedOps.push(id);
      };

      // Start 10 operations (will queue since limit is 10)
      const operations = Array.from({ length: 10 }, (_, i) =>
        coordinator.execute(`test${i}`, () => operation(i))
      );

      // Advance timers a bit then reduce limit
      vi.advanceTimersByTime(15);
      coordinator.on429Error();

      // Advance timers to complete all operations
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all(operations);

      // All operations should complete
      expect(completedOps).toHaveLength(10);
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle adaptive mode disabled', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: false,
      });

      for (let i = 0; i < 60; i++) {
        coordinator.reportQuotaUsage(1);
      }

      vi.advanceTimersByTime(10000);

      const status = coordinator.getStatus();
      expect(status.limit).toBe(15); // Should not change
    });

    it('should handle manual limit override during adaptive mode', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
      });

      // Manual override
      coordinator.setManualLimit(20);

      const status = coordinator.getStatus();
      expect(status.limit).toBe(20);

      // Adaptive adjustments should respect manual override
      for (let i = 0; i < 55; i++) {
        coordinator.reportQuotaUsage(1);
      }
      vi.advanceTimersByTime(10000);

      // Should still be affected by adaptive adjustments
      const statusAfter = coordinator.getStatus();
      expect(statusAfter.limit).toBeLessThan(20);
    });

    it('should handle zero quota limit gracefully', () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
      });

      // This shouldn't crash
      expect(() => {
        coordinator.setQuotaLimit(0);
      }).not.toThrow();
    });

    it('should validate concurrency bounds', () => {
      expect(() => {
        new ConcurrencyCoordinator({
          maxConcurrent: 3,
          minConcurrent: 5, // Invalid: min > max
          enableAdaptive: true,
        });
      }).toThrow();
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle burst traffic followed by rate limiting', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 20,
        enableAdaptive: true,
        minConcurrent: 5,
        maxConcurrentCeiling: 30,
        enableMetrics: true,
      });

      // Simulate burst - start many operations
      const operations: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        operations.push(
          coordinator.execute(`burst${i}`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            coordinator.reportQuotaUsage(1);
          })
        );
      }

      // Hit rate limits mid-burst
      vi.advanceTimersByTime(10);
      coordinator.on429Error();
      coordinator.on429Error();

      // Complete all operations
      await vi.advanceTimersByTimeAsync(300);
      await Promise.all(operations);

      const metrics = coordinator.getMetrics();
      expect(metrics.rateLimitErrorCount).toBe(2);
      expect(metrics.currentLimit).toBeLessThan(20);
    });

    it('should handle gradual load increase', async () => {
      coordinator = new ConcurrencyCoordinator({
        maxConcurrent: 15,
        enableAdaptive: true,
        adjustmentIntervalMs: 10000,
        enableMetrics: true,
      });

      // Start with low load
      for (let i = 0; i < 10; i++) {
        coordinator.reportQuotaUsage(1);
      }
      vi.advanceTimersByTime(10000);

      const limit1 = coordinator.getStatus().limit;

      // Increase load
      for (let i = 0; i < 50; i++) {
        coordinator.reportQuotaUsage(1);
      }
      vi.advanceTimersByTime(10000);

      const limit2 = coordinator.getStatus().limit;

      // Limit should have increased then decreased
      expect(limit1).toBeGreaterThan(15); // Increased from low load
      expect(limit2).toBeLessThan(limit1); // Decreased from high load
    });
  });
});
