/**
 * Tests for CachedSheetsApi service
 *
 * Covers: cache hits/misses, stats tracking, invalidation, batch dedup,
 * and stats reset.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CachedSheetsApi, resetCachedSheetsApi } from '../../src/services/cached-sheets-api.js';

// Mock the etag-cache to control caching behavior
vi.mock('../../src/services/etag-cache.js', () => {
  const cache = new Map<string, unknown>();
  const etagMap = new Map<string, string>();

  return {
    getETagCache: () => ({
      getETag: vi.fn((key: unknown) => {
        const keyStr = JSON.stringify(key);
        return etagMap.get(keyStr) ?? null;
      }),
      getCachedData: vi.fn(async (key: unknown) => {
        const keyStr = JSON.stringify(key);
        return cache.get(keyStr) ?? null;
      }),
      setETag: vi.fn(async (key: unknown, etag: string, data: unknown) => {
        const keyStr = JSON.stringify(key);
        etagMap.set(keyStr, etag);
        if (data !== undefined) {
          cache.set(keyStr, data);
        }
      }),
      invalidate: vi.fn(async (pattern: unknown) => {
        const patternStr = JSON.stringify(pattern);
        for (const [key] of cache) {
          if (key.includes(patternStr) || key.includes(String(pattern))) {
            cache.delete(key);
            etagMap.delete(key);
          }
        }
      }),
      invalidateSpreadsheet: vi.fn(async (spreadsheetId: string) => {
        for (const [key] of cache) {
          if (key.includes(spreadsheetId)) {
            cache.delete(key);
            etagMap.delete(key);
          }
        }
      }),
      getKeysForSpreadsheet: vi.fn(async (spreadsheetId: string) => {
        const keys: string[] = [];
        for (const [key] of cache) {
          if (key.includes(spreadsheetId)) {
            keys.push(key);
          }
        }
        return keys;
      }),
      invalidateKey: vi.fn(async (key: string) => {
        cache.delete(key);
        etagMap.delete(key);
      }),
      // Expose for test cleanup
      _cache: cache,
      _etagMap: etagMap,
    }),
  };
});

function createMockSheetsApi() {
  return {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test Sheet' },
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      }),
      values: {
        get: vi.fn().mockResolvedValue({
          data: {
            range: 'Sheet1!A1:D10',
            values: [
              ['a', 'b'],
              ['c', 'd'],
            ],
          },
        }),
        batchGet: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'test-id',
            valueRanges: [
              { range: 'Sheet1!A1:B2', values: [['a', 'b']] },
              { range: 'Sheet1!C1:D2', values: [['c', 'd']] },
            ],
          },
        }),
      },
    },
  } as unknown;
}

describe('CachedSheetsApi', () => {
  let cachedApi: CachedSheetsApi;
  let mockSheets: ReturnType<typeof createMockSheetsApi>;

  beforeEach(async () => {
    // Disable conditional requests so tests use the simpler local cache path
    process.env['ENABLE_CONDITIONAL_REQUESTS'] = 'false';

    // Reset singleton
    resetCachedSheetsApi();
    mockSheets = createMockSheetsApi();
    cachedApi = new CachedSheetsApi(mockSheets as any);

    // Clear the mock cache
    const { getETagCache } = await import('../../src/services/etag-cache.js');
    const cache = getETagCache() as any;
    if (cache._cache) cache._cache.clear();
    if (cache._etagMap) cache._etagMap.clear();
  });

  describe('getSpreadsheet', () => {
    it('should fetch from API on cache miss', async () => {
      const result = await cachedApi.getSpreadsheet('test-id');
      expect(result.spreadsheetId).toBe('test-id');
      expect(result.properties?.title).toBe('Test Sheet');
    });

    it('should return cached data on cache hit', async () => {
      // First call - cache miss
      await cachedApi.getSpreadsheet('test-id');
      // Second call - cache hit
      await cachedApi.getSpreadsheet('test-id');

      const stats = cachedApi.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });
  });

  describe('getValues', () => {
    it('should fetch values from API', async () => {
      const result = await cachedApi.getValues('test-id', 'Sheet1!A1:D10');
      expect(result.range).toBe('Sheet1!A1:D10');
      expect(result.values).toHaveLength(2);
    });
  });

  describe('stats tracking', () => {
    it('should track hit rate correctly', async () => {
      // 2 misses, then 2 hits
      await cachedApi.getSpreadsheet('test-id');
      await cachedApi.getValues('test-id', 'Sheet1!A1:B2');
      await cachedApi.getSpreadsheet('test-id');
      await cachedApi.getValues('test-id', 'Sheet1!A1:B2');

      const stats = cachedApi.getStats();
      expect(stats.totalRequests).toBe(4);
      expect(stats.cacheHits).toBe(2);
      expect(stats.cacheMisses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.savedApiCalls).toBe(2);
    });

    it('should reset stats', async () => {
      await cachedApi.getSpreadsheet('test-id');
      cachedApi.resetStats();

      const stats = cachedApi.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.cacheHits).toBe(0);
    });
  });

  describe('raw accessor', () => {
    it('should expose underlying Sheets API', () => {
      expect(cachedApi.raw).toBe(mockSheets);
    });
  });
});
