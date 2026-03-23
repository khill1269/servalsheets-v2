/**
 * ServalSheets - Handler Optimization Tests
 *
 * Tests for Phase 2 handler optimization utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  createActionDispatcher,
  fastCacheKey,
  spreadsheetCacheKey,
  countCells,
  countRows,
  countColumns,
  truncateValues,
  hasRequiredParams,
  getSpreadsheetId,
  getAction,
  fastSuccess,
  fastError,
  fastParseA1Range,
  estimateRangeCells,
  columnLetterToIndex,
  LazyContextTracker,
  batchAsync,
} from '../../src/handlers/optimization.js';

describe('Cache Key Generation', () => {
  describe('fastCacheKey', () => {
    it('should generate key from prefix and parts', () => {
      const key = fastCacheKey('values', 'spreadsheet1', 'Sheet1!A1');
      expect(key).toBe('values:spreadsheet1:Sheet1!A1');
    });

    it('should skip undefined parts', () => {
      const key = fastCacheKey('values', 'spreadsheet1', undefined, 'extra');
      expect(key).toBe('values:spreadsheet1:extra');
    });

    it('should handle numbers', () => {
      const key = fastCacheKey('sheet', 'spreadsheet1', 123);
      expect(key).toBe('sheet:spreadsheet1:123');
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('spreadsheetCacheKey', () => {
    it('should generate key with range', () => {
      const key = spreadsheetCacheKey('values:read', 'ss123', 'Sheet1!A1:B10');
      expect(key).toBe('values:read:ss123:Sheet1!A1:B10');
    });

    it('should generate key without range', () => {
      const key = spreadsheetCacheKey('metadata', 'ss123');
      expect(key).toBe('metadata:ss123');
    });

    it('should generate key with extra', () => {
      const key = spreadsheetCacheKey('values:read', 'ss123', 'A1', 'formatted');
      expect(key).toBe('values:read:ss123:A1:formatted');
    });
  });
});

describe('Parameter Utilities', () => {
  describe('hasRequiredParams', () => {
    it('should return true when all params present', () => {
      const input = { spreadsheetId: 'ss1', range: 'A1', action: 'read' };
      expect(hasRequiredParams(input, 'spreadsheetId', 'range')).toBe(true);
    });

    it('should return false when param missing', () => {
      const input = { spreadsheetId: 'ss1' };
      expect(hasRequiredParams(input, 'spreadsheetId', 'range')).toBe(false);
    });

    it('should handle empty required list', () => {
      expect(hasRequiredParams({})).toBe(true);
    });
  });

  describe('getSpreadsheetId', () => {
    it('should extract spreadsheetId', () => {
      expect(getSpreadsheetId({ spreadsheetId: 'ss123' })).toBe('ss123');
    });

    it('should return undefined for missing', () => {
      expect(getSpreadsheetId({})).toBeUndefined();
    });

    it('should return undefined for non-string', () => {
      expect(getSpreadsheetId({ spreadsheetId: 123 })).toBeUndefined();
    });
  });

  describe('getAction', () => {
    it('should extract action', () => {
      expect(getAction({ action: 'read' })).toBe('read');
    });

    it('should return undefined for missing', () => {
      expect(getAction({})).toBeUndefined();
    });
  });
});

describe('Response Builders', () => {
  describe('fastSuccess', () => {
    it('should create success response', () => {
      const result = fastSuccess('read', { values: [[1, 2]], range: 'A1' });
      expect(result.success).toBe(true);
      expect(result.action).toBe('read');
      expect(result.values).toEqual([[1, 2]]);
      expect(result.range).toBe('A1');
    });
  });

  describe('fastError', () => {
    it('should create error response', () => {
      const result = fastError('NOT_FOUND', 'Spreadsheet not found');
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toBe('Spreadsheet not found');
      expect(result.error.retryable).toBe(false);
    });

    it('should set retryable flag', () => {
      const result = fastError('RATE_LIMIT', 'Too many requests', true);
      expect(result.error.retryable).toBe(true);
    });
  });
});

describe('Values Array Utilities', () => {
  const sampleValues = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ];

  describe('countCells', () => {
    it('should count total cells', () => {
      expect(countCells(sampleValues)).toBe(9);
    });

    it('should handle empty array', () => {
      expect(countCells([])).toBe(0);
    });

    it('should handle jagged arrays', () => {
      const jagged = [[1, 2], [3], [4, 5, 6, 7]];
      expect(countCells(jagged)).toBe(7);
    });
  });

  describe('countRows', () => {
    it('should count rows', () => {
      expect(countRows(sampleValues)).toBe(3);
    });

    it('should handle empty array', () => {
      expect(countRows([])).toBe(0);
    });
  });

  describe('countColumns', () => {
    it('should count columns from first row', () => {
      expect(countColumns(sampleValues)).toBe(3);
    });

    it('should handle empty array', () => {
      expect(countColumns([])).toBe(0);
    });
  });

  describe('truncateValues', () => {
    const largeValues = Array.from({ length: 100 }, (_, i) =>
      Array.from({ length: 10 }, (_, j) => `${i},${j}`)
    );

    it('should not truncate small arrays', () => {
      const result = truncateValues(sampleValues, 100, 1000);
      expect(result.truncated).toBe(false);
      expect(result.values).toBe(sampleValues);
    });

    it('should truncate by row count', () => {
      const result = truncateValues(largeValues, 10, 10000);
      expect(result.truncated).toBe(true);
      expect(result.values.length).toBe(10);
      expect(result.originalRows).toBe(100);
    });

    it('should truncate by cell count', () => {
      const result = truncateValues(largeValues, 100, 50);
      expect(result.truncated).toBe(true);
      expect(result.originalCells).toBe(1000);
    });
  });
});

describe('Range Utilities', () => {
  describe('fastParseA1Range', () => {
    it('should parse simple range', () => {
      const result = fastParseA1Range('A1:B10');
      expect(result).toEqual({
        sheet: undefined,
        startCol: 'A',
        startRow: 1,
        endCol: 'B',
        endRow: 10,
      });
    });

    it('should parse range with sheet name', () => {
      const result = fastParseA1Range('Sheet1!A1:Z100');
      expect(result).toEqual({
        sheet: 'Sheet1',
        startCol: 'A',
        startRow: 1,
        endCol: 'Z',
        endRow: 100,
      });
    });

    it('should parse single cell', () => {
      const result = fastParseA1Range('B5');
      expect(result).toEqual({
        sheet: undefined,
        startCol: 'B',
        startRow: 5,
        endCol: undefined,
        endRow: undefined,
      });
    });

    it('should return null for invalid range', () => {
      expect(fastParseA1Range('invalid')).toBeNull();
    });
  });

  describe('estimateRangeCells', () => {
    it('should estimate cells for range', () => {
      expect(estimateRangeCells('A1:B10')).toBe(20); // 2 cols * 10 rows
    });

    it('should estimate cells for large range', () => {
      expect(estimateRangeCells('A1:Z100')).toBe(2600); // 26 cols * 100 rows
    });

    it('should return 1 for single cell', () => {
      expect(estimateRangeCells('A1')).toBe(1);
    });

    it('should return 0 for invalid range', () => {
      expect(estimateRangeCells('invalid')).toBe(0);
    });
  });

  describe('columnLetterToIndex', () => {
    it('should convert single letters', () => {
      expect(columnLetterToIndex('A')).toBe(0);
      expect(columnLetterToIndex('B')).toBe(1);
      expect(columnLetterToIndex('Z')).toBe(25);
    });

    it('should convert double letters', () => {
      expect(columnLetterToIndex('AA')).toBe(26);
      expect(columnLetterToIndex('AB')).toBe(27);
      expect(columnLetterToIndex('AZ')).toBe(51);
      expect(columnLetterToIndex('BA')).toBe(52);
    });

    it('should cache results', () => {
      // Call twice - second should be cached
      const first = columnLetterToIndex('ZZ');
      const second = columnLetterToIndex('ZZ');
      expect(first).toBe(second);
      expect(first).toBe(701); // ZZ = 702nd column, 0-indexed = 701
    });
  });
});

describe('LazyContextTracker', () => {
  it('should track context changes', () => {
    const updates: unknown[] = [];
    const tracker = new LazyContextTracker((params) => updates.push(params));

    tracker.track({ spreadsheetId: 'ss1' });
    tracker.track({ spreadsheetId: 'ss1' }); // Same, should not trigger
    tracker.track({ spreadsheetId: 'ss2' }); // Different, should trigger

    expect(updates.length).toBe(2);
    expect(updates[0]).toEqual({ spreadsheetId: 'ss1' });
    expect(updates[1]).toEqual({ spreadsheetId: 'ss2' });
  });

  it('should track all parameter changes', () => {
    const updates: unknown[] = [];
    const tracker = new LazyContextTracker((params) => updates.push(params));

    tracker.track({ spreadsheetId: 'ss1', sheetId: 0, range: 'A1' });
    tracker.track({ spreadsheetId: 'ss1', sheetId: 0, range: 'A1' }); // Same
    tracker.track({ spreadsheetId: 'ss1', sheetId: 0, range: 'B1' }); // Range changed

    expect(updates.length).toBe(2);
  });

  it('should reset tracking state', () => {
    const updates: unknown[] = [];
    const tracker = new LazyContextTracker((params) => updates.push(params));

    tracker.track({ spreadsheetId: 'ss1' });
    tracker.reset();
    tracker.track({ spreadsheetId: 'ss1' }); // Should trigger after reset

    expect(updates.length).toBe(2);
  });
});

describe('Async Utilities', () => {
  describe('batchAsync', () => {
    it('should process items in batches', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const results = await batchAsync(items, async (n) => n * 2, 3);
      expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    });

    it('should handle empty array', async () => {
      const results = await batchAsync([], async (n: number) => n * 2, 5);
      expect(results).toEqual([]);
    });
  });
});

describe('Action Dispatcher', () => {
  it('should dispatch to correct handler', async () => {
    const handlers = {
      read: async (input: { action: string; value: number }) => input.value * 2,
      write: async (input: { action: string; value: number }) => input.value * 3,
    };

    const dispatcher = createActionDispatcher(handlers);

    expect(await dispatcher({ action: 'read', value: 5 })).toBe(10);
    expect(await dispatcher({ action: 'write', value: 5 })).toBe(15);
  });

  it('should throw for unknown action', async () => {
    const dispatcher = createActionDispatcher({
      read: async () => 'read',
    });

    await expect(dispatcher({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown');
  });
});
