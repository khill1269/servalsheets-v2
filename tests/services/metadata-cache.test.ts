/**
 * Tests for MetadataCache
 *
 * Tests session-level metadata caching to eliminate N+1 queries.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { MetadataCache, createMetadataCache } from '../../src/services/metadata-cache.js';

describe('MetadataCache', () => {
  let mockSheetsApi: {
    spreadsheets: {
      get: ReturnType<typeof vi.fn>;
    };
  };
  let cache: MetadataCache;

  beforeEach(() => {
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn(),
      },
    };
    cache = new MetadataCache(mockSheetsApi as unknown as sheets_v4.Sheets);
  });

  describe('getOrFetch', () => {
    it('should fetch metadata on cache miss', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: {
            title: 'Test Spreadsheet',
            locale: 'en_US',
            timeZone: 'America/New_York',
          },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                gridProperties: {
                  rowCount: 100,
                  columnCount: 26,
                },
              },
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      const metadata = await cache.getOrFetch('test-id');

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledWith({
        spreadsheetId: 'test-id',
        fields: expect.stringContaining('spreadsheetId,properties'),
      });
      expect(metadata.spreadsheetId).toBe('test-id');
      expect(metadata.properties.title).toBe('Test Spreadsheet');
      expect(metadata.sheets).toHaveLength(1);
      expect(metadata.sheets[0]?.title).toBe('Sheet1');
      expect(metadata.fetchedAt).toBeGreaterThan(0);
    });

    it('should return cached metadata on cache hit', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      // First call - cache miss
      const metadata1 = await cache.getOrFetch('test-id');

      // Second call - cache hit
      const metadata2 = await cache.getOrFetch('test-id');

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1); // Only called once
      expect(metadata1).toBe(metadata2); // Same object reference
    });

    it('should track cache hits and misses', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      // First call - miss
      await cache.getOrFetch('test-id');
      let stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0);

      // Second call - hit
      await cache.getOrFetch('test-id');
      stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);

      // Third call - hit
      await cache.getOrFetch('test-id');
      stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should handle multiple spreadsheets independently', async () => {
      const mockResponse1 = {
        data: {
          spreadsheetId: 'test-id-1',
          properties: { title: 'Spreadsheet 1', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      const mockResponse2 = {
        data: {
          spreadsheetId: 'test-id-2',
          properties: { title: 'Spreadsheet 2', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockImplementation((params) => {
        if (params.spreadsheetId === 'test-id-1') return Promise.resolve(mockResponse1);
        if (params.spreadsheetId === 'test-id-2') return Promise.resolve(mockResponse2);
        throw new Error('Unexpected spreadsheet ID');
      });

      const metadata1 = await cache.getOrFetch('test-id-1');
      const metadata2 = await cache.getOrFetch('test-id-2');

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
      expect(metadata1.properties.title).toBe('Spreadsheet 1');
      expect(metadata2.properties.title).toBe('Spreadsheet 2');

      const stats = cache.getStats();
      expect(stats.cacheSize).toBe(2);
      expect(stats.misses).toBe(2);
    });

    it('should handle missing optional properties', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: {
            title: 'Test',
            // Missing locale and timeZone - should use defaults
          },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                gridProperties: {
                  rowCount: 100,
                  columnCount: 26,
                  // Missing frozenRowCount and frozenColumnCount
                },
              },
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      const metadata = await cache.getOrFetch('test-id');

      expect(metadata.properties.locale).toBe('en_US'); // Default
      expect(metadata.properties.timeZone).toBe('America/New_York'); // Default
      expect(metadata.sheets[0]?.gridProperties?.frozenRowCount).toBeUndefined();
      expect(metadata.sheets[0]?.gridProperties?.frozenColumnCount).toBeUndefined();
    });

    it('should handle sheets without grid properties', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                // No gridProperties
              },
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      const metadata = await cache.getOrFetch('test-id');

      expect(metadata.sheets[0]?.gridProperties).toBeUndefined();
    });

    it('should handle empty sheets array', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      const metadata = await cache.getOrFetch('test-id');

      expect(metadata.sheets).toEqual([]);
    });
  });

  describe('getSheetId', () => {
    beforeEach(() => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                gridProperties: { rowCount: 100, columnCount: 26 },
              },
            },
            {
              properties: {
                sheetId: 123,
                title: 'Sales Data',
                index: 1,
                gridProperties: { rowCount: 50, columnCount: 10 },
              },
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);
    });

    it('should return sheet ID for existing sheet', async () => {
      const sheetId = await cache.getSheetId('test-id', 'Sales Data');

      expect(sheetId).toBe(123);
    });

    it('should return undefined for non-existent sheet', async () => {
      const sheetId = await cache.getSheetId('test-id', 'NonExistent');

      expect(sheetId).toBeUndefined();
    });

    it('should use cached metadata', async () => {
      await cache.getSheetId('test-id', 'Sheet1');
      await cache.getSheetId('test-id', 'Sales Data');

      // Should only call API once (cached on first call)
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should be case-sensitive', async () => {
      const sheetId1 = await cache.getSheetId('test-id', 'Sheet1');
      const sheetId2 = await cache.getSheetId('test-id', 'sheet1'); // Different case

      expect(sheetId1).toBe(0);
      expect(sheetId2).toBeUndefined();
    });
  });

  describe('getSheetName', () => {
    beforeEach(() => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                gridProperties: { rowCount: 100, columnCount: 26 },
              },
            },
            {
              properties: {
                sheetId: 456,
                title: 'Analytics',
                index: 1,
                gridProperties: { rowCount: 75, columnCount: 15 },
              },
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);
    });

    it('should return sheet name for existing sheet ID', async () => {
      const sheetName = await cache.getSheetName('test-id', 456);

      expect(sheetName).toBe('Analytics');
    });

    it('should return undefined for non-existent sheet ID', async () => {
      const sheetName = await cache.getSheetName('test-id', 999);

      expect(sheetName).toBeUndefined();
    });

    it('should use cached metadata', async () => {
      await cache.getSheetName('test-id', 0);
      await cache.getSheetName('test-id', 456);

      // Should only call API once
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSheetNames', () => {
    it('should return all sheet names', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
              },
            },
            {
              properties: {
                sheetId: 1,
                title: 'Sheet2',
                index: 1,
              },
            },
            {
              properties: {
                sheetId: 2,
                title: 'Sheet3',
                index: 2,
              },
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      const sheetNames = await cache.getSheetNames('test-id');

      expect(sheetNames).toEqual(['Sheet1', 'Sheet2', 'Sheet3']);
    });

    it('should return empty array for spreadsheet with no sheets', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      const sheetNames = await cache.getSheetNames('test-id');

      expect(sheetNames).toEqual([]);
    });

    it('should use cached metadata', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [
            {
              properties: { sheetId: 0, title: 'Sheet1', index: 0 },
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      await cache.getSheetNames('test-id');
      await cache.getSheetNames('test-id');

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('should clear cache and reset stats', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      // Build up cache
      await cache.getOrFetch('test-id');
      await cache.getOrFetch('test-id'); // Hit

      let stats = cache.getStats();
      expect(stats.cacheSize).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      // Clear
      cache.clear();

      stats = cache.getStats();
      expect(stats.cacheSize).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should require fresh fetch after clear', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      // First fetch
      await cache.getOrFetch('test-id');
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);

      // Clear cache
      cache.clear();

      // Second fetch should call API again
      await cache.getOrFetch('test-id');
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const stats = cache.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.cacheSize).toBe(0);
      expect(stats.totalFetches).toBe(0);
    });

    it('should calculate hit rate correctly', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      // 1 miss + 3 hits = 75% hit rate
      await cache.getOrFetch('test-id'); // Miss
      await cache.getOrFetch('test-id'); // Hit
      await cache.getOrFetch('test-id'); // Hit
      await cache.getOrFetch('test-id'); // Hit

      const stats = cache.getStats();
      expect(stats.totalFetches).toBe(4);
      expect(stats.hitRate).toBe(0.75);
    });

    it('should track cache size', async () => {
      mockSheetsApi.spreadsheets.get.mockImplementation((params) => {
        return Promise.resolve({
          data: {
            spreadsheetId: params.spreadsheetId,
            properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
            sheets: [],
          },
        });
      });

      await cache.getOrFetch('id-1');
      await cache.getOrFetch('id-2');
      await cache.getOrFetch('id-3');

      const stats = cache.getStats();
      expect(stats.cacheSize).toBe(3);
    });
  });

  describe('invalidate', () => {
    it('should remove specific spreadsheet from cache', async () => {
      const mockResponse1 = {
        data: {
          spreadsheetId: 'id-1',
          properties: { title: 'Spreadsheet 1', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      const mockResponse2 = {
        data: {
          spreadsheetId: 'id-2',
          properties: { title: 'Spreadsheet 2', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockImplementation((params) => {
        if (params.spreadsheetId === 'id-1') return Promise.resolve(mockResponse1);
        if (params.spreadsheetId === 'id-2') return Promise.resolve(mockResponse2);
        throw new Error('Unexpected ID');
      });

      // Cache both
      await cache.getOrFetch('id-1');
      await cache.getOrFetch('id-2');

      let stats = cache.getStats();
      expect(stats.cacheSize).toBe(2);

      // Invalidate one
      cache.invalidate('id-1');

      stats = cache.getStats();
      expect(stats.cacheSize).toBe(1);

      // Next fetch of id-1 should call API again
      await cache.getOrFetch('id-1');
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(3); // 2 initial + 1 refetch

      // id-2 should still be cached
      await cache.getOrFetch('id-2');
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(3); // No additional call
    });

    it('should not affect stats when invalidating', async () => {
      const mockResponse = {
        data: {
          spreadsheetId: 'test-id',
          properties: { title: 'Test', locale: 'en_US', timeZone: 'UTC' },
          sheets: [],
        },
      };

      mockSheetsApi.spreadsheets.get.mockResolvedValue(mockResponse);

      await cache.getOrFetch('test-id'); // Miss
      await cache.getOrFetch('test-id'); // Hit

      cache.invalidate('test-id');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1); // Stats unchanged
      expect(stats.misses).toBe(1);
      expect(stats.cacheSize).toBe(0); // But cache is empty
    });

    it('should handle invalidating non-existent spreadsheet', () => {
      // Should not throw
      expect(() => cache.invalidate('non-existent-id')).not.toThrow();

      const stats = cache.getStats();
      expect(stats.cacheSize).toBe(0);
    });
  });

  describe('createMetadataCache', () => {
    it('should create cache instance', () => {
      const cache = createMetadataCache(mockSheetsApi as unknown as sheets_v4.Sheets);

      expect(cache).toBeInstanceOf(MetadataCache);
    });
  });
});
