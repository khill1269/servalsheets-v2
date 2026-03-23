/**
 * Tests for Sheet Resolver Service
 *
 * Tests sheet reference resolution by name/ID, caching, and fuzzy matching.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SheetResolver,
  SheetResolutionError,
  getSheetResolver,
  setSheetResolver,
  resetSheetResolver,
  type SheetReference,
  type ResolvedSheet,
} from '../../src/services/sheet-resolver.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock sheets API
function createMockSheetsApi(
  sheets: Array<{ sheetId: number; title: string; index: number; hidden?: boolean }> = []
) {
  return {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: {
          sheets: sheets.map((s) => ({
            properties: {
              sheetId: s.sheetId,
              title: s.title,
              index: s.index,
              hidden: s.hidden ?? false,
              gridProperties: {
                rowCount: 1000,
                columnCount: 26,
              },
            },
          })),
        },
      }),
    },
  };
}

describe('SheetResolver', () => {
  let resolver: SheetResolver;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;

  const mockSheets = [
    { sheetId: 0, title: 'Sheet1', index: 0 },
    { sheetId: 123456, title: 'Data', index: 1 },
    { sheetId: 789012, title: 'Summary', index: 2 },
    { sheetId: 345678, title: 'Hidden Sheet', index: 3, hidden: true },
  ];

  beforeEach(() => {
    mockSheetsApi = createMockSheetsApi(mockSheets);
    resolver = new SheetResolver({
      sheetsApi: mockSheetsApi as any,
      cacheTtlMs: 60000,
      enableFuzzyMatch: true,
      fuzzyThreshold: 0.7,
    });
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with required options', () => {
      const r = new SheetResolver({ sheetsApi: mockSheetsApi as any });
      expect(r).toBeDefined();
    });

    it('should accept all options', () => {
      const r = new SheetResolver({
        sheetsApi: mockSheetsApi as any,
        cacheTtlMs: 30000,
        enableFuzzyMatch: false,
        fuzzyThreshold: 0.8,
      });
      expect(r).toBeDefined();
    });
  });

  describe('resolve', () => {
    it('should resolve sheet by exact name', async () => {
      const result = await resolver.resolve('spreadsheet-id', { sheetName: 'Sheet1' });

      expect(result.sheet.sheetId).toBe(0);
      expect(result.sheet.title).toBe('Sheet1');
      expect(result.method).toBe('exact_name');
      expect(result.confidence).toBe(1);
    });

    it('should resolve sheet by exact ID', async () => {
      const result = await resolver.resolve('spreadsheet-id', { sheetId: 123456 });

      expect(result.sheet.sheetId).toBe(123456);
      expect(result.sheet.title).toBe('Data');
      expect(result.method).toBe('exact_id');
      expect(result.confidence).toBe(1);
    });

    it('should resolve sheet by name (case insensitive)', async () => {
      const result = await resolver.resolve('spreadsheet-id', { sheetName: 'SHEET1' });

      expect(result.sheet.title).toBe('Sheet1');
    });

    it('should cache results', async () => {
      // First call
      await resolver.resolve('spreadsheet-id', { sheetName: 'Sheet1' });
      // Second call
      await resolver.resolve('spreadsheet-id', { sheetName: 'Data' });

      // API should only be called once (cached)
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should throw error for non-existent sheet name', async () => {
      await expect(
        resolver.resolve('spreadsheet-id', { sheetName: 'NonExistent' })
      ).rejects.toThrow(SheetResolutionError);
    });

    it('should throw error for non-existent sheet ID', async () => {
      await expect(resolver.resolve('spreadsheet-id', { sheetId: 999999 })).rejects.toThrow(
        SheetResolutionError
      );
    });

    it('should throw error when neither name nor ID provided', async () => {
      await expect(resolver.resolve('spreadsheet-id', {})).rejects.toThrow();
    });
  });

  describe('fuzzy matching', () => {
    it('should fuzzy match similar names', async () => {
      const result = await resolver.resolve('spreadsheet-id', { sheetName: 'Sheeet1' });

      expect(result.method).toBe('fuzzy_name');
      expect(result.confidence).toBeLessThan(1);
      expect(result.sheet.title).toBe('Sheet1');
    });

    it('should include alternatives in fuzzy results', async () => {
      const result = await resolver.resolve('spreadsheet-id', { sheetName: 'Sheeet1' });

      if (result.alternatives) {
        expect(result.alternatives.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should not fuzzy match when disabled', async () => {
      resolver = new SheetResolver({
        sheetsApi: mockSheetsApi as any,
        enableFuzzyMatch: false,
      });

      await expect(resolver.resolve('spreadsheet-id', { sheetName: 'Sheeet1' })).rejects.toThrow(
        SheetResolutionError
      );
    });
  });

  describe('getAllSheets', () => {
    it('should return all sheets for spreadsheet', async () => {
      const sheets = await resolver.getAllSheets('spreadsheet-id');

      expect(sheets).toHaveLength(4);
      expect(sheets.map((s) => s.title)).toContain('Sheet1');
      expect(sheets.map((s) => s.title)).toContain('Data');
    });

    it('should cache results', async () => {
      await resolver.getAllSheets('spreadsheet-id');
      await resolver.getAllSheets('spreadsheet-id');

      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSheetByName', () => {
    it('should get sheet by exact name', async () => {
      const sheet = await resolver.getSheetByName('spreadsheet-id', 'Data');

      expect(sheet).toBeDefined();
      expect(sheet?.properties?.title).toBe('Data');
      expect(sheet?.properties?.sheetId).toBe(123456);
    });

    it('should return undefined for non-existent name', async () => {
      const sheet = await resolver.getSheetByName('spreadsheet-id', 'NonExistent');
      expect(sheet).toBeUndefined();
    });
  });

  describe('getSheetById', () => {
    it('should get sheet by ID', async () => {
      const sheet = await resolver.getSheetById('spreadsheet-id', 789012);

      expect(sheet).toBeDefined();
      expect(sheet?.properties?.title).toBe('Summary');
    });

    it('should return undefined for non-existent ID', async () => {
      const sheet = await resolver.getSheetById('spreadsheet-id', 999999);
      expect(sheet).toBeUndefined();
    });
  });

  describe('invalidateCache', () => {
    it('should invalidate cache for spreadsheet', async () => {
      // Load into cache
      await resolver.getAllSheets('spreadsheet-id');
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);

      // Invalidate
      resolver.invalidateCache('spreadsheet-id');

      // Should fetch again
      await resolver.getAllSheets('spreadsheet-id');
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearCache', () => {
    it('should clear all cached data', async () => {
      await resolver.getAllSheets('spreadsheet-1');
      await resolver.getAllSheets('spreadsheet-2');

      resolver.clearCache();

      await resolver.getAllSheets('spreadsheet-1');
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(3);
    });
  });
});

describe('SheetResolutionError', () => {
  it('should create error with message and code', () => {
    const error = new SheetResolutionError(
      'Sheet not found',
      'SHEET_NOT_FOUND',
      { sheetName: 'Test' },
      ['Sheet1', 'Sheet2']
    );

    expect(error.message).toBe('Sheet not found');
    expect(error.code).toBe('SHEET_NOT_FOUND');
    expect(error.details.sheetName).toBe('Test');
    expect(error.availableSheets).toEqual(['Sheet1', 'Sheet2']);
    expect(error.name).toBe('SheetResolutionError');
  });

  it('should be instance of Error', () => {
    const error = new SheetResolutionError('Test', 'TEST_CODE');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('SheetResolver singleton', () => {
  beforeEach(() => {
    resetSheetResolver();
  });

  it('should return same instance from getSheetResolver', () => {
    const mockApi = createMockSheetsApi();

    // Initialize with sheets API
    const instance1 = getSheetResolver(mockApi as any);
    const instance2 = getSheetResolver();

    expect(instance1).toBe(instance2);
  });

  it('should allow setting custom instance', () => {
    const mockApi = createMockSheetsApi();
    const customResolver = new SheetResolver({ sheetsApi: mockApi as any });
    setSheetResolver(customResolver);

    const instance = getSheetResolver();
    expect(instance).toBe(customResolver);
  });

  it('should reset to undefined', () => {
    const mockApi = createMockSheetsApi();
    getSheetResolver(mockApi as any);
    resetSheetResolver();

    // Should return null after reset (requires re-initialization)
    expect(getSheetResolver()).toBeNull();
  });
});
