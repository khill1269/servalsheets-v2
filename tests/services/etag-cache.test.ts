/**
 * ETag Cache Service Tests (Phase 2A)
 *
 * Tests for ETagCache with Redis L2 support
 * Covers two-tier caching (memory L1 + Redis L2) and ETag management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ETagCache,
  getETagCache,
  initETagCache,
  resetETagCache,
} from '../../src/services/etag-cache.js';

describe('ETagCache', () => {
  let cache: ETagCache;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockRedis: any;

  beforeEach(() => {
    // Create mock Redis client
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      setEx: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      scan: vi.fn().mockResolvedValue({ cursor: 0, keys: [] }),
    };

    cache = new ETagCache({
      maxAge: 5 * 60 * 1000, // 5 minutes
      maxSize: 1000,
      redis: mockRedis,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    resetETagCache();
  });

  describe('constructor', () => {
    it('should initialize without Redis', () => {
      const noRedisCache = new ETagCache({
        maxAge: 5 * 60 * 1000,
        maxSize: 1000,
      });

      expect(noRedisCache).toBeDefined();
      const stats = noRedisCache.getStats();
      expect(stats.redisAvailable).toBe(false);
    });

    it('should initialize with Redis', () => {
      const withRedisCache = new ETagCache({
        maxAge: 5 * 60 * 1000,
        maxSize: 1000,
        redis: mockRedis,
      });

      expect(withRedisCache).toBeDefined();
      const stats = withRedisCache.getStats();
      expect(stats.redisAvailable).toBe(true);
    });

    it('should use default values when not specified', () => {
      const defaultCache = new ETagCache();

      expect(defaultCache).toBeDefined();
      const stats = defaultCache.getStats();
      expect(stats.maxAge).toBe(5 * 60 * 1000); // 5 minutes
      expect(stats.maxSize).toBe(1000);
    });
  });

  describe('getETag', () => {
    it('should return null for cache miss', () => {
      const result = cache.getETag({
        spreadsheetId: 'test-123',
        endpoint: 'metadata',
      });

      expect(result).toBeNull();
    });

    it('should return ETag from L1 cache', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await cache.setETag(key, 'etag-12345');
      const result = cache.getETag(key);

      expect(result).toBe('etag-12345');
      expect(mockRedis.get).not.toHaveBeenCalled(); // L1 hit, no Redis check
    });

    it('should return null for expired ETag', async () => {
      const shortTtlCache = new ETagCache({
        maxAge: 10, // 10ms TTL
        maxSize: 1000,
      });

      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await shortTtlCache.setETag(key, 'etag-12345');

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = shortTtlCache.getETag(key);
      expect(result).toBeNull();
    });

    it('should generate consistent cache keys', async () => {
      const key1 = {
        spreadsheetId: 'test-123',
        endpoint: 'values' as const,
        range: 'Sheet1!A1:B10',
      };

      const key2 = {
        spreadsheetId: 'test-123',
        endpoint: 'values' as const,
        range: 'Sheet1!A1:B10',
      };

      await cache.setETag(key1, 'etag-abc');
      const result = cache.getETag(key2);

      expect(result).toBe('etag-abc'); // Same key resolves to same entry
    });

    it('should differentiate keys by params', async () => {
      const key1 = {
        spreadsheetId: 'test-123',
        endpoint: 'values' as const,
        range: 'A1:B10',
        params: { includeGridData: true },
      };

      const key2 = {
        spreadsheetId: 'test-123',
        endpoint: 'values' as const,
        range: 'A1:B10',
        params: { includeGridData: false },
      };

      await cache.setETag(key1, 'etag-1');
      await cache.setETag(key2, 'etag-2');

      expect(cache.getETag(key1)).toBe('etag-1');
      expect(cache.getETag(key2)).toBe('etag-2');
    });
  });

  describe('getCachedData', () => {
    it('should return null for cache miss', async () => {
      const result = await cache.getCachedData({
        spreadsheetId: 'test-123',
        endpoint: 'metadata',
      });

      expect(result).toBeNull();
    });

    it('should return data from L1 cache', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      const data = { spreadsheetId: 'test-123', properties: { title: 'Test' } };

      await cache.setETag(key, 'etag-12345', data);
      const result = await cache.getCachedData(key);

      expect(result).toEqual(data);
      expect(mockRedis.get).not.toHaveBeenCalled(); // L1 hit
    });

    it('should return data from L2 Redis cache', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'values' as const,
        range: 'A1:B10',
      };

      const data = {
        values: [
          ['A1', 'B1'],
          ['A2', 'B2'],
        ],
      };

      const cached = {
        etag: 'etag-redis',
        cachedAt: 1704067200000,
        cachedData: data,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await cache.getCachedData(key);

      expect(result).toEqual(data);
      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringContaining('servalsheets:etag:test-123:values:A1:B10')
      );
    });

    it('should promote L2 hit to L1 cache', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      const data = { spreadsheetId: 'test-123' };

      const cached = {
        etag: 'etag-redis',
        cachedAt: 1704067200000,
        cachedData: data,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      // First call hits Redis
      await cache.getCachedData(key);

      // Second call should hit L1 (promoted)
      await cache.getCachedData(key);

      expect(mockRedis.get).toHaveBeenCalledTimes(1); // Only once, then L1
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await cache.getCachedData({
        spreadsheetId: 'test-123',
        endpoint: 'metadata',
      });

      expect(result).toBeNull(); // Falls back to null
    });

    it('should handle malformed Redis data', async () => {
      mockRedis.get.mockResolvedValue('invalid-json');

      const result = await cache.getCachedData({
        spreadsheetId: 'test-123',
        endpoint: 'metadata',
      });

      expect(result).toBeNull();
    });

    it('should return null if L1 expired and L2 miss', async () => {
      const shortTtlCache = new ETagCache({
        maxAge: 10, // 10ms TTL
        maxSize: 1000,
        redis: mockRedis,
      });

      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await shortTtlCache.setETag(key, 'etag-12345', { data: 'test' });

      // Wait for L1 expiry
      await new Promise((resolve) => setTimeout(resolve, 20));

      mockRedis.get.mockResolvedValue(null); // L2 miss

      const result = await shortTtlCache.getCachedData(key);
      expect(result).toBeNull();
    });
  });

  describe('setETag', () => {
    it('should store ETag in L1 cache', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await cache.setETag(key, 'etag-12345');

      const stats = cache.getStats();
      expect(stats.size).toBe(1);

      const etag = cache.getETag(key);
      expect(etag).toBe('etag-12345');
    });

    it('should store ETag and data in Redis L2', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'values' as const,
        range: 'A1:B10',
      };

      const data = { values: [['A1', 'B1']] };

      await cache.setETag(key, 'etag-12345', data);

      expect(mockRedis.setEx).toHaveBeenCalled();
      const setExCall = mockRedis.setEx.mock.calls[0];
      expect(setExCall[0]).toContain('servalsheets:etag:test-123:values:A1:B10');
      expect(setExCall[1]).toBe(600); // TTL in seconds (10 minutes)
      expect(typeof setExCall[2]).toBe('string'); // JSON string

      const parsedData = JSON.parse(setExCall[2]);
      expect(parsedData.etag).toBe('etag-12345');
      expect(parsedData.cachedData).toEqual(data);
    });

    it('should not cache to Redis if no data provided', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await cache.setETag(key, 'etag-12345'); // No data

      expect(mockRedis.setEx).not.toHaveBeenCalled();
    });

    it('should not cache empty ETag', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await cache.setETag(key, '', { data: 'test' });

      const stats = cache.getStats();
      expect(stats.size).toBe(0); // Not cached
    });

    it('should handle Redis errors gracefully when setting', async () => {
      mockRedis.setEx.mockRejectedValue(new Error('Redis write failed'));

      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      // Should not throw
      await expect(cache.setETag(key, 'etag-12345', { data: 'test' })).resolves.not.toThrow();

      // L1 cache should still work
      const etag = cache.getETag(key);
      expect(etag).toBe('etag-12345');
    });

    it('should enforce max size with LRU eviction', async () => {
      const smallCache = new ETagCache({
        maxAge: 5 * 60 * 1000,
        maxSize: 3, // Small size
      });

      await smallCache.setETag({ spreadsheetId: '1', endpoint: 'metadata' }, 'etag-1');
      await smallCache.setETag({ spreadsheetId: '2', endpoint: 'metadata' }, 'etag-2');
      await smallCache.setETag({ spreadsheetId: '3', endpoint: 'metadata' }, 'etag-3');

      let stats = smallCache.getStats();
      expect(stats.size).toBe(3);

      // Adding 4th should evict oldest (1)
      await smallCache.setETag({ spreadsheetId: '4', endpoint: 'metadata' }, 'etag-4');

      stats = smallCache.getStats();
      expect(stats.size).toBe(3);

      // Check that oldest was evicted
      const evicted = smallCache.getETag({ spreadsheetId: '1', endpoint: 'metadata' });
      expect(evicted).toBeNull();

      const newest = smallCache.getETag({ spreadsheetId: '4', endpoint: 'metadata' });
      expect(newest).toBe('etag-4');
    });

    it('should overwrite existing entries', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await cache.setETag(key, 'etag-old', { data: 'old' });
      await cache.setETag(key, 'etag-new', { data: 'new' });

      const etag = cache.getETag(key);
      expect(etag).toBe('etag-new');

      const data = await cache.getCachedData(key);
      expect(data).toEqual({ data: 'new' });
    });
  });

  describe('invalidate', () => {
    it('should clear entry from L1 cache', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await cache.setETag(key, 'etag-12345');
      await cache.invalidate(key);

      const result = cache.getETag(key);
      expect(result).toBeNull();
    });

    it('should clear entry from L2 Redis cache', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'values' as const,
        range: 'A1:B10',
      };

      await cache.setETag(key, 'etag-12345', { data: 'test' });
      await cache.invalidate(key);

      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringContaining('servalsheets:etag:test-123:values:A1:B10')
      );
    });

    it('should handle Redis errors gracefully when invalidating', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis delete failed'));

      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await expect(cache.invalidate(key)).resolves.not.toThrow();
    });

    it('should handle invalidating non-existent entry', async () => {
      const key = {
        spreadsheetId: 'nonexistent',
        endpoint: 'metadata' as const,
      };

      await expect(cache.invalidate(key)).resolves.not.toThrow();
    });
  });

  describe('invalidateSpreadsheet', () => {
    it('should clear all entries for a spreadsheet from L1', async () => {
      await cache.setETag({ spreadsheetId: 'test-123', endpoint: 'metadata' }, 'etag-1');
      await cache.setETag(
        { spreadsheetId: 'test-123', endpoint: 'values', range: 'A1:B10' },
        'etag-2'
      );
      await cache.setETag({ spreadsheetId: 'other-456', endpoint: 'metadata' }, 'etag-3');

      await cache.invalidateSpreadsheet('test-123');

      expect(cache.getETag({ spreadsheetId: 'test-123', endpoint: 'metadata' })).toBeNull();
      expect(
        cache.getETag({ spreadsheetId: 'test-123', endpoint: 'values', range: 'A1:B10' })
      ).toBeNull();
      expect(cache.getETag({ spreadsheetId: 'other-456', endpoint: 'metadata' })).toBe('etag-3'); // Unaffected
    });

    it('should clear all entries for a spreadsheet from L2 Redis', async () => {
      mockRedis.scan.mockResolvedValue({
        cursor: 0,
        keys: ['servalsheets:etag:test-123:metadata', 'servalsheets:etag:test-123:values:A1:B10'],
      });

      await cache.invalidateSpreadsheet('test-123');

      expect(mockRedis.scan).toHaveBeenCalledWith(0, {
        MATCH: 'servalsheets:etag:test-123:*',
        COUNT: 100,
      });
      expect(mockRedis.del).toHaveBeenCalledWith(
        'servalsheets:etag:test-123:metadata',
        'servalsheets:etag:test-123:values:A1:B10'
      );
    });

    it('should handle no matching keys in Redis', async () => {
      mockRedis.scan.mockResolvedValue({ cursor: 0, keys: [] });

      await cache.invalidateSpreadsheet('test-123');

      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Redis scan failed'));

      await expect(cache.invalidateSpreadsheet('test-123')).resolves.not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all L1 cache entries', async () => {
      await cache.setETag({ spreadsheetId: '1', endpoint: 'metadata' }, 'etag-1');
      await cache.setETag({ spreadsheetId: '2', endpoint: 'metadata' }, 'etag-2');
      await cache.setETag({ spreadsheetId: '3', endpoint: 'values', range: 'A1:B10' }, 'etag-3');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it('should not affect Redis cache', async () => {
      cache.clear();

      // clear() is synchronous and only affects L1
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      const stats = cache.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.maxSize).toBe('number');
      expect(typeof stats.maxAge).toBe('number');
      expect(typeof stats.redisAvailable).toBe('boolean');
      expect(Array.isArray(stats.entries)).toBe(true);
    });

    it('should track cache size', async () => {
      await cache.setETag({ spreadsheetId: '1', endpoint: 'metadata' }, 'etag-1');
      await cache.setETag({ spreadsheetId: '2', endpoint: 'metadata' }, 'etag-2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
    });

    it('should indicate Redis availability', () => {
      const withRedis = new ETagCache({ redis: mockRedis });
      const withoutRedis = new ETagCache();

      expect(withRedis.getStats().redisAvailable).toBe(true);
      expect(withoutRedis.getStats().redisAvailable).toBe(false);
    });

    it('should include entry ages', async () => {
      await cache.setETag({ spreadsheetId: '1', endpoint: 'metadata' }, 'etag-1');

      const stats = cache.getStats();
      expect(stats.entries.length).toBe(1);
      expect(stats.entries[0].key).toContain('1:metadata');
      expect(typeof stats.entries[0].age).toBe('number');
      expect(stats.entries[0].age).toBeGreaterThanOrEqual(0);
    });
  });

  describe('singleton functions', () => {
    afterEach(() => {
      resetETagCache();
    });

    it('should initialize with Redis', () => {
      const instance = initETagCache(mockRedis);

      expect(instance).toBeDefined();
      expect(instance.getStats().redisAvailable).toBe(true);
    });

    it('should initialize without Redis', () => {
      const instance = initETagCache();

      expect(instance).toBeDefined();
      expect(instance.getStats().redisAvailable).toBe(false);
    });

    it('should return singleton instance', () => {
      const instance1 = getETagCache();
      const instance2 = getETagCache();

      expect(instance1).toBe(instance2); // Same instance
    });

    it('should auto-initialize on first access', () => {
      const instance = getETagCache();

      expect(instance).toBeDefined();
      expect(instance.getStats()).toBeDefined();
    });

    it('should reset singleton', () => {
      const instance1 = getETagCache();
      resetETagCache();
      const instance2 = getETagCache();

      expect(instance1).not.toBe(instance2); // Different instances
    });
  });

  describe('edge cases', () => {
    it('should handle multiple spreadsheets independently', async () => {
      await cache.setETag({ spreadsheetId: '1', endpoint: 'metadata' }, 'etag-1', { data: '1' });
      await cache.setETag({ spreadsheetId: '2', endpoint: 'metadata' }, 'etag-2', { data: '2' });

      const etag1 = cache.getETag({ spreadsheetId: '1', endpoint: 'metadata' });
      const etag2 = cache.getETag({ spreadsheetId: '2', endpoint: 'metadata' });

      expect(etag1).toBe('etag-1');
      expect(etag2).toBe('etag-2');

      const data1 = await cache.getCachedData({ spreadsheetId: '1', endpoint: 'metadata' });
      const data2 = await cache.getCachedData({ spreadsheetId: '2', endpoint: 'metadata' });

      expect(data1).toEqual({ data: '1' });
      expect(data2).toEqual({ data: '2' });
    });

    it('should handle complex data structures', async () => {
      const complexData = {
        spreadsheetId: 'test-123',
        properties: {
          title: 'Test Sheet',
          locale: 'en_US',
        },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
            },
          },
        ],
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test-123',
      };

      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'metadata' as const,
      };

      await cache.setETag(key, 'etag-complex', complexData);

      const data = await cache.getCachedData(key);
      expect(data).toEqual(complexData);
    });

    it('should handle rapid cache operations', async () => {
      for (let i = 0; i < 100; i++) {
        await cache.setETag({ spreadsheetId: `sheet-${i}`, endpoint: 'metadata' }, `etag-${i}`, {
          data: i,
        });
      }

      const stats = cache.getStats();
      expect(stats.size).toBe(100);

      // Verify a few random entries
      expect(cache.getETag({ spreadsheetId: 'sheet-42', endpoint: 'metadata' })).toBe('etag-42');
      expect(
        await cache.getCachedData({ spreadsheetId: 'sheet-99', endpoint: 'metadata' })
      ).toEqual({ data: 99 });
    });

    it('should handle concurrent Redis operations', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          cache.setETag({ spreadsheetId: `sheet-${i}`, endpoint: 'metadata' }, `etag-${i}`, {
            data: i,
          })
        );
      }

      await Promise.all(promises);

      expect(mockRedis.setEx).toHaveBeenCalledTimes(10);
    });

    it('should handle params with special characters', async () => {
      const key = {
        spreadsheetId: 'test-123',
        endpoint: 'values' as const,
        range: 'Sheet1!A1:B10',
        params: {
          majorDimension: 'ROWS',
          valueRenderOption: 'FORMATTED_VALUE',
        },
      };

      await cache.setETag(key, 'etag-special', { data: 'test' });

      const etag = cache.getETag(key);
      expect(etag).toBe('etag-special');
    });

    it('should differentiate between endpoints', async () => {
      const spreadsheetId = 'test-123';

      await cache.setETag({ spreadsheetId, endpoint: 'metadata' }, 'etag-meta');
      await cache.setETag({ spreadsheetId, endpoint: 'values', range: 'A1:B10' }, 'etag-values');
      await cache.setETag({ spreadsheetId, endpoint: 'properties' }, 'etag-props');
      await cache.setETag({ spreadsheetId, endpoint: 'sheets' }, 'etag-sheets');

      expect(cache.getETag({ spreadsheetId, endpoint: 'metadata' })).toBe('etag-meta');
      expect(cache.getETag({ spreadsheetId, endpoint: 'values', range: 'A1:B10' })).toBe(
        'etag-values'
      );
      expect(cache.getETag({ spreadsheetId, endpoint: 'properties' })).toBe('etag-props');
      expect(cache.getETag({ spreadsheetId, endpoint: 'sheets' })).toBe('etag-sheets');
    });
  });
});
