/**
 * ServalSheets - Infrastructure Tests
 *
 * Tests for Phase 5 infrastructure optimization utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RequestCoalescer,
  PrefetchPredictor,
  ConnectionPool,
  getRequestCoalescer,
  getPrefetchPredictor,
  getConnectionPool,
} from '../../src/utils/infrastructure.js';
import { waitFor } from '../helpers/wait-for.js';

describe('RequestCoalescer', () => {
  let coalescer: RequestCoalescer;

  beforeEach(() => {
    coalescer = new RequestCoalescer({ coalesceWindowMs: 5, maxCoalesceSize: 10 });
  });

  afterEach(async () => {
    await coalescer.flushAll();
  });

  it('should queue and execute requests', async () => {
    const operation = vi.fn().mockResolvedValue('result');

    const result = await coalescer.queue('spreadsheet1', operation);

    expect(result).toBe('result');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('should coalesce multiple requests to same spreadsheet', async () => {
    const operations = [
      vi.fn().mockResolvedValue('result1'),
      vi.fn().mockResolvedValue('result2'),
      vi.fn().mockResolvedValue('result3'),
    ];

    const promises = operations.map((op) => coalescer.queue('spreadsheet1', op));

    const results = await Promise.all(promises);

    expect(results).toEqual(['result1', 'result2', 'result3']);
    operations.forEach((op) => expect(op).toHaveBeenCalledOnce());

    const stats = coalescer.getStats();
    expect(stats.executed).toBe(3);
    expect(stats.coalesced).toBeGreaterThanOrEqual(1);
  });

  it('should handle errors in operations', async () => {
    const error = new Error('Test error');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(coalescer.queue('spreadsheet1', operation)).rejects.toThrow('Test error');
  });

  it('should flush immediately when batch is full', async () => {
    const coalescer = new RequestCoalescer({
      coalesceWindowMs: 1000, // Long window
      maxCoalesceSize: 3, // Small batch size
    });

    const operations = [
      vi.fn().mockResolvedValue('result1'),
      vi.fn().mockResolvedValue('result2'),
      vi.fn().mockResolvedValue('result3'),
    ];

    // Queue 3 requests - should trigger immediate flush
    const startTime = Date.now();
    const promises = operations.map((op) => coalescer.queue('spreadsheet1', op));
    const results = await Promise.all(promises);
    const elapsed = Date.now() - startTime;

    expect(results).toEqual(['result1', 'result2', 'result3']);
    // Should complete quickly (not wait for 1000ms window)
    expect(elapsed).toBeLessThan(500);
  });

  it('should track statistics', async () => {
    const operation = vi.fn().mockResolvedValue('result');

    await coalescer.queue('spreadsheet1', operation);
    await coalescer.queue('spreadsheet1', operation);
    await coalescer.queue('spreadsheet2', operation);

    const stats = coalescer.getStats();
    expect(stats.executed).toBe(3);
    expect(stats.pending).toBe(0);
  });

  it('should reset statistics', async () => {
    const operation = vi.fn().mockResolvedValue('result');
    await coalescer.queue('spreadsheet1', operation);

    coalescer.resetStats();

    const stats = coalescer.getStats();
    expect(stats.executed).toBe(0);
    expect(stats.coalesced).toBe(0);
  });
});

describe('PrefetchPredictor', () => {
  let predictor: PrefetchPredictor;

  beforeEach(() => {
    predictor = new PrefetchPredictor();
  });

  it('should predict sequential ranges', () => {
    const predictions = predictor.recordAccess('ss1', 'Sheet1!A1:E10');

    expect(predictions).toContain('Sheet1!A11:E20');
  });

  it('should learn from access patterns', () => {
    // Create a pattern: A1:E10 -> F1:J10
    predictor.recordAccess('ss1', 'Sheet1!A1:E10');
    predictor.recordAccess('ss1', 'Sheet1!F1:J10');

    // Now access A1:E10 again and expect F1:J10 to be predicted
    const predictions = predictor.recordAccess('ss1', 'Sheet1!A1:E10');

    expect(predictions).toContain('Sheet1!F1:J10');
  });

  it('should store and retrieve prefetch data', () => {
    predictor.storePrefetch('key1', { data: 'test' });

    const result = predictor.getPrefetch('key1');
    expect(result).toEqual({ data: 'test' });
  });

  it('should return undefined for missing prefetch', () => {
    const result = predictor.getPrefetch('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should clear expired prefetch entries', async () => {
    // Create predictor with short TTL for testing
    const testPredictor = new (class extends PrefetchPredictor {
      constructor() {
        super();
        // Override TTL to 10ms for testing
        (this as unknown as { prefetchTtl: number }).prefetchTtl = 10;
      }
    })();

    testPredictor.storePrefetch('key1', { data: 'test' });

    // Wait for expiry
    await waitFor(20);

    const cleared = testPredictor.clearExpired();
    expect(cleared).toBe(1);

    const result = testPredictor.getPrefetch('key1');
    expect(result).toBeUndefined();
  });
});

describe('ConnectionPool', () => {
  it('should execute operations', async () => {
    const pool = new ConnectionPool(5);
    const operation = vi.fn().mockResolvedValue('result');

    const result = await pool.execute(operation);

    expect(result).toBe('result');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('should limit concurrent operations', async () => {
    const pool = new ConnectionPool(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const createOperation = () => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await waitFor(10);
      concurrent--;
      return 'done';
    };

    // Start 5 operations with max concurrency of 2
    const promises = Array.from({ length: 5 }, () => pool.execute(createOperation()));

    await Promise.all(promises);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should track stats', async () => {
    const pool = new ConnectionPool(3);
    let _activeCount = 0;

    // Create operations that complete quickly but track concurrency
    const createOperation = () => async () => {
      _activeCount++;
      await waitFor(50);
      _activeCount--;
      return 'done';
    };

    // Start 5 operations with max concurrency of 3
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(pool.execute(createOperation()));
    }

    // Check stats immediately after starting
    await waitFor(10);
    const stats = pool.getStats();
    expect(stats.maxConcurrent).toBe(3);
    // Some should be active, some queued
    expect(stats.active + stats.queued).toBe(5);

    // Wait for all to complete
    await Promise.all(promises);

    const finalStats = pool.getStats();
    expect(finalStats.active).toBe(0);
    expect(finalStats.queued).toBe(0);
  });

  it('should handle errors', async () => {
    const pool = new ConnectionPool(5);
    const error = new Error('Test error');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(pool.execute(operation)).rejects.toThrow('Test error');
  });
});

describe('Singleton Factories', () => {
  it('should return singleton RequestCoalescer', () => {
    const coalescer1 = getRequestCoalescer();
    const coalescer2 = getRequestCoalescer();

    expect(coalescer1).toBe(coalescer2);
  });

  it('should return singleton PrefetchPredictor', () => {
    const predictor1 = getPrefetchPredictor();
    const predictor2 = getPrefetchPredictor();

    expect(predictor1).toBe(predictor2);
  });

  it('should return singleton ConnectionPool', () => {
    const pool1 = getConnectionPool();
    const pool2 = getConnectionPool();

    expect(pool1).toBe(pool2);
  });
});
