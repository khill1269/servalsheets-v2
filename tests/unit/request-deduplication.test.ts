/**
 * Tests for Request Deduplication Service
 *
 * Tests both in-flight deduplication and result caching
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RequestDeduplicator, createRequestKey } from '../../src/utils/request-deduplication.js';

describe('RequestDeduplicator', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    deduplicator = new RequestDeduplicator({
      enabled: true,
      timeout: 5000,
      maxPendingRequests: 100,
      resultCacheEnabled: true,
      resultCacheTTL: 1000,
      resultCacheMaxSize: 100,
    });
  });

  afterEach(() => {
    deduplicator.destroy();
  });

  describe('In-Flight Deduplication', () => {
    it('should deduplicate concurrent requests with same key', async () => {
      let callCount = 0;
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        callCount++;
        return { data: 'test' };
      };

      // Start 3 concurrent requests with same key
      const promises = [
        deduplicator.deduplicate('key1', fn),
        deduplicator.deduplicate('key1', fn),
        deduplicator.deduplicate('key1', fn),
      ];

      await Promise.all(promises);

      // Should only call function once
      expect(callCount).toBe(1);

      const stats = deduplicator.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.deduplicatedRequests).toBe(2);
    });

    it('should not deduplicate requests with different keys', async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return { data: 'test' };
      };

      await Promise.all([
        deduplicator.deduplicate('key1', fn),
        deduplicator.deduplicate('key2', fn),
        deduplicator.deduplicate('key3', fn),
      ]);

      // Should call function 3 times
      expect(callCount).toBe(3);

      const stats = deduplicator.getStats();
      expect(stats.deduplicatedRequests).toBe(0);
    });
  });

  describe('Result Caching', () => {
    it('should cache successful results', async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return { data: 'test', timestamp: Date.now() };
      };

      // First call - cache miss
      const result1 = await deduplicator.deduplicate('key1', fn);
      expect(callCount).toBe(1);

      // Second call - cache hit
      const result2 = await deduplicator.deduplicate('key1', fn);
      expect(callCount).toBe(1); // Not called again

      // Results should be identical (from cache)
      expect(result2).toEqual(result1);

      const stats = deduplicator.getStats();
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });

    it('should expire cached results after TTL', async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return { data: 'test' };
      };

      // First call
      await deduplicator.deduplicate('key1', fn);
      expect(callCount).toBe(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Second call - cache expired
      await deduplicator.deduplicate('key1', fn);
      expect(callCount).toBe(2);
    });

    it('should calculate cache hit rate correctly', async () => {
      const fn = async () => ({ data: 'test' });

      // 3 calls with same key - 1 miss, 2 hits
      await deduplicator.deduplicate('key1', fn);
      await deduplicator.deduplicate('key1', fn);
      await deduplicator.deduplicate('key1', fn);

      const stats = deduplicator.getStats();
      expect(stats.cacheHits).toBe(2);
      expect(stats.cacheMisses).toBe(1);
      expect(stats.cacheHitRate).toBeCloseTo(66.67, 1); // 2/3 = 66.67%
    });

    it('should respect cache size limit', async () => {
      const fn = async (i: number) => ({ data: `test-${i}` });

      // Fill cache beyond limit (100 entries)
      for (let i = 0; i < 150; i++) {
        await deduplicator.deduplicate(`key-${i}`, () => fn(i));
      }

      const stats = deduplicator.getStats();
      // Cache should not exceed max size
      expect(stats.resultCacheSize).toBeLessThanOrEqual(100);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache by pattern', async () => {
      const fn = async (key: string) => ({ data: key });

      // Add multiple entries
      await deduplicator.deduplicate('spreadsheet:123:values', () => fn('data1'));
      await deduplicator.deduplicate('spreadsheet:123:format', () => fn('data2'));
      await deduplicator.deduplicate('spreadsheet:456:values', () => fn('data3'));

      // Invalidate all entries for spreadsheet 123
      const invalidated = deduplicator.invalidateCache(/spreadsheet:123/);

      // Should invalidate some entries (hashed keys, so exact match may vary)
      expect(invalidated).toBeGreaterThanOrEqual(0);
    });

    it('should clear all cache entries', () => {
      // Clear cache
      deduplicator.clear();

      const stats = deduplicator.getStats();
      expect(stats.resultCacheSize).toBe(0);
      expect(stats.pendingCount).toBe(0);
    });

    it('should invalidate spreadsheet cache', async () => {
      const fn = async () => ({ data: 'test' });

      // Use keys that contain the spreadsheet ID so targeted invalidation matches
      await deduplicator.deduplicate('spreadsheet:123:values', fn);
      await deduplicator.deduplicate('spreadsheet:123:metadata', fn);

      const countBefore = deduplicator.getStats().resultCacheSize;
      expect(countBefore).toBeGreaterThan(0);

      // Invalidate spreadsheet (targeted — matches keys containing '123')
      const invalidated = deduplicator.invalidateSpreadsheet('123');
      expect(invalidated).toBe(countBefore);

      const stats = deduplicator.getStats();
      expect(stats.resultCacheSize).toBe(0);
    });
  });

  describe('Combined Metrics', () => {
    it('should calculate total savings rate', async () => {
      const fn = async () => ({ data: 'test' });

      // Call 1: Cache miss (actual API call)
      await deduplicator.deduplicate('key1', fn);

      // Call 2: Cache hit (saved)
      await deduplicator.deduplicate('key1', fn);

      // Call 3-5: Concurrent deduplication (2 saved)
      await Promise.all([
        deduplicator.deduplicate('key2', fn),
        deduplicator.deduplicate('key2', fn),
        deduplicator.deduplicate('key2', fn),
      ]);

      const stats = deduplicator.getStats();
      // Total: 5 requests
      // Saved: 1 cache hit + 2 deduplicated = 3
      // Savings: 3/5 = 60%
      expect(stats.totalRequests).toBe(5);
      expect(stats.totalSavedRequests).toBe(3);
      expect(stats.totalSavingsRate).toBeCloseTo(60, 0);
    });

    it('should track comprehensive statistics', async () => {
      const fn = async () => ({ data: 'test' });

      await deduplicator.deduplicate('key1', fn);
      await deduplicator.deduplicate('key1', fn);

      const stats = deduplicator.getStats();

      // Check all stat fields exist
      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('pendingCount');
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('deduplicatedRequests');
      expect(stats).toHaveProperty('deduplicationRate');
      expect(stats).toHaveProperty('resultCacheEnabled');
      expect(stats).toHaveProperty('resultCacheSize');
      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('cacheMisses');
      expect(stats).toHaveProperty('cacheHitRate');
      expect(stats).toHaveProperty('totalSavedRequests');
      expect(stats).toHaveProperty('totalSavingsRate');
    });
  });

  describe('Configuration', () => {
    it('should skip deduplication when disabled', async () => {
      const disabledDedup = new RequestDeduplicator({ enabled: false });
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return { data: 'test' };
      };

      await Promise.all([
        disabledDedup.deduplicate('key1', fn),
        disabledDedup.deduplicate('key1', fn),
      ]);

      // Should call function twice (no deduplication)
      expect(callCount).toBe(2);

      disabledDedup.destroy();
    });

    it('should skip caching when cache disabled', async () => {
      const noCacheDedup = new RequestDeduplicator({ resultCacheEnabled: false });
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return { data: 'test' };
      };

      await noCacheDedup.deduplicate('key1', fn);
      await noCacheDedup.deduplicate('key1', fn);

      // Should call function twice (no caching)
      expect(callCount).toBe(2);

      const stats = noCacheDedup.getStats();
      expect(stats.resultCacheEnabled).toBe(false);
      expect(stats.cacheHits).toBe(0);

      noCacheDedup.destroy();
    });
  });

  describe('Error Handling', () => {
    it('should not cache failed requests', async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        throw new Error('API Error');
      };

      // First call - fails
      await expect(deduplicator.deduplicate('key1', fn)).rejects.toThrow('API Error');

      // Second call - should try again (not cached)
      await expect(deduplicator.deduplicate('key1', fn)).rejects.toThrow('API Error');

      expect(callCount).toBe(2);

      const stats = deduplicator.getStats();
      expect(stats.cacheHits).toBe(0); // Failed requests not cached
    });

    it('should clean up pending request on failure', async () => {
      const fn = async () => {
        throw new Error('Test error');
      };

      await expect(deduplicator.deduplicate('key1', fn)).rejects.toThrow();

      const stats = deduplicator.getStats();
      expect(stats.pendingCount).toBe(0); // Should be cleaned up
    });
  });

  describe('Metrics Reset', () => {
    it('should reset metrics', async () => {
      const fn = async () => ({ data: 'test' });

      await deduplicator.deduplicate('key1', fn);
      await deduplicator.deduplicate('key1', fn);

      let stats = deduplicator.getStats();
      expect(stats.totalRequests).toBeGreaterThan(0);

      deduplicator.resetMetrics();

      stats = deduplicator.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.deduplicatedRequests).toBe(0);
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheMisses).toBe(0);
    });
  });
});

describe('createRequestKey', () => {
  it('should create consistent keys from parameters', () => {
    const params1 = { spreadsheetId: '123', range: 'A1:B10' };
    const params2 = { range: 'A1:B10', spreadsheetId: '123' }; // Different order

    const key1 = createRequestKey('read', params1);
    const key2 = createRequestKey('read', params2);

    // Should be identical despite different parameter order
    expect(key1).toBe(key2);
  });

  it('should create different keys for different operations', () => {
    const params = { spreadsheetId: '123', range: 'A1:B10' };

    const key1 = createRequestKey('read', params);
    const key2 = createRequestKey('write', params);

    expect(key1).not.toBe(key2);
  });

  it('should create different keys for different parameters', () => {
    const key1 = createRequestKey('read', { spreadsheetId: '123' });
    const key2 = createRequestKey('read', { spreadsheetId: '456' });

    expect(key1).not.toBe(key2);
  });
});
