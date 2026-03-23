/**
 * ParallelExecutor Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParallelExecutor } from '../../src/services/parallel-executor.js';

type ParallelStats = {
  totalExecuted: number;
  totalSucceeded: number;
  totalFailed: number;
  successRate: number;
  averageDuration: number;
};

describe('ParallelExecutor', () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    executor = new ParallelExecutor({
      concurrency: 3,
      verboseLogging: false,
      retryOnError: true,
      maxRetries: 2,
      retryDelayMs: 10, // Short delay for tests
    });
  });

  describe('executeAll', () => {
    it('should execute all tasks successfully', async () => {
      const tasks = [
        { id: '1', fn: async () => 'result1' },
        { id: '2', fn: async () => 'result2' },
        { id: '3', fn: async () => 'result3' },
      ];

      const results = await executor.executeAll(tasks);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(results.find((r) => r.id === '1')?.result).toBe('result1');
      expect(results.find((r) => r.id === '2')?.result).toBe('result2');
      expect(results.find((r) => r.id === '3')?.result).toBe('result3');
    });

    it('should respect concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `task-${i}`,
        fn: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 10));
          concurrent--;
          return i;
        },
      }));

      await executor.executeAll(tasks);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(maxConcurrent).toBeGreaterThan(0);
    });

    it('should handle task failures', async () => {
      const tasks = [
        { id: '1', fn: async () => 'success' },
        {
          id: '2',
          fn: async () => {
            throw new Error('Task failed');
          },
        },
        { id: '3', fn: async () => 'success' },
      ];

      const results = await executor.executeAll(tasks);

      expect(results).toHaveLength(3);
      expect(results.filter((r) => r.success)).toHaveLength(2);
      expect(results.filter((r) => !r.success)).toHaveLength(1);
      expect(results.find((r) => r.id === '2')?.error?.message).toBe('Task failed');
    });

    it('should retry failed tasks', async () => {
      let attempts = 0;

      const tasks = [
        {
          id: 'retry-task',
          fn: async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error('Not yet');
            }
            return 'success';
          },
        },
      ];

      const results = await executor.executeAll(tasks);

      expect(results[0]?.success).toBe(true);
      expect(results[0]?.retries).toBe(2);
      expect(attempts).toBe(3);
    });

    it('should respect priority ordering', async () => {
      const executionOrder: string[] = [];

      const tasks = [
        {
          id: 'low',
          fn: async () => {
            executionOrder.push('low');
            return 1;
          },
          priority: 1,
        },
        {
          id: 'high',
          fn: async () => {
            executionOrder.push('high');
            return 3;
          },
          priority: 3,
        },
        {
          id: 'medium',
          fn: async () => {
            executionOrder.push('medium');
            return 2;
          },
          priority: 2,
        },
      ];

      await executor.executeAll(tasks);

      // Higher priority tasks should start first
      expect(executionOrder[0]).toBe('high');
      expect(executionOrder[1]).toBe('medium');
      expect(executionOrder[2]).toBe('low');
    });

    it('should call progress callback', async () => {
      const progressUpdates: number[] = [];

      const tasks = Array.from({ length: 5 }, (_, i) => ({
        id: `task-${i}`,
        fn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return i;
        },
      }));

      await executor.executeAll(tasks, (progress) => {
        progressUpdates.push(progress.completed);
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(5);
    });

    it('should track task duration', async () => {
      const tasks = [
        {
          id: 'slow-task',
          fn: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 'done';
          },
        },
      ];

      const results = await executor.executeAll(tasks);

      // Allow minor timer jitter in CI/sandbox while preserving duration tracking guarantee.
      expect(results[0]?.duration).toBeGreaterThanOrEqual(45);
    });
  });

  describe('executeAllSuccessful', () => {
    it('should return only successful results', async () => {
      const tasks = [
        { id: '1', fn: async () => 'result1' },
        {
          id: '2',
          fn: async () => {
            throw new Error('Failed');
          },
        },
        { id: '3', fn: async () => 'result3' },
      ];

      const results = await executor.executeAllSuccessful(tasks);

      expect(results).toHaveLength(2);
      expect(results).toEqual(['result1', 'result3']);
    });
  });

  describe('executeAllOrFail', () => {
    it('should return all results when all succeed', async () => {
      const tasks = [
        { id: '1', fn: async () => 'result1' },
        { id: '2', fn: async () => 'result2' },
      ];

      const results = await executor.executeAllOrFail(tasks);

      expect(results).toEqual(['result1', 'result2']);
    });

    it('should throw when any task fails', async () => {
      const tasks = [
        { id: '1', fn: async () => 'result1' },
        {
          id: '2',
          fn: async () => {
            throw new Error('Task failed');
          },
        },
      ];

      await expect(executor.executeAllOrFail(tasks)).rejects.toThrow('1 task(s) failed');
    });
  });

  describe('statistics', () => {
    it('should track execution statistics', async () => {
      const tasks = [
        { id: '1', fn: async () => 'success' },
        {
          id: '2',
          fn: async () => {
            throw new Error('Failed');
          },
        },
        { id: '3', fn: async () => 'success' },
      ];

      await executor.executeAll(tasks);

      const stats = executor.getStats() as ParallelStats;

      expect(stats.totalExecuted).toBe(3);
      expect(stats.totalSucceeded).toBe(2);
      expect(stats.totalFailed).toBe(1);
      expect(stats.successRate).toBeCloseTo(66.67, 1);
      expect(stats.averageDuration).toBeGreaterThan(0);
    });

    it('should reset statistics', async () => {
      const tasks = [{ id: '1', fn: async () => 'success' }];

      await executor.executeAll(tasks);
      executor.resetStats();

      const stats = executor.getStats() as ParallelStats;

      expect(stats.totalExecuted).toBe(0);
      expect(stats.totalSucceeded).toBe(0);
      expect(stats.totalFailed).toBe(0);
    });
  });

  describe('retry logic', () => {
    it('should not retry when retryOnError is false', async () => {
      const noRetryExecutor = new ParallelExecutor({
        retryOnError: false,
        retryDelayMs: 10,
      });

      let attempts = 0;
      const tasks = [
        {
          id: 'task',
          fn: async () => {
            attempts++;
            throw new Error('Always fails');
          },
        },
      ];

      const results = await noRetryExecutor.executeAll(tasks);

      expect(attempts).toBe(1);
      expect(results[0]?.retries).toBe(0);
    });

    it('should respect maxRetries limit', async () => {
      const limitedRetryExecutor = new ParallelExecutor({
        maxRetries: 1,
        retryDelayMs: 10,
      });

      let attempts = 0;
      const tasks = [
        {
          id: 'task',
          fn: async () => {
            attempts++;
            throw new Error('Always fails');
          },
        },
      ];

      await limitedRetryExecutor.executeAll(tasks);

      expect(attempts).toBe(2); // 1 initial + 1 retry
    });
  });
});
