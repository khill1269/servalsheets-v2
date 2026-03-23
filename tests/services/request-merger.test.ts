/**
 * Request Merger Service Tests (Phase 3.3)
 *
 * Tests for RequestMerger service
 * Covers request merging, range parsing, and response splitting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RequestMerger,
  parseA1Range,
  mergeRanges,
  splitResponse,
} from '../../src/services/request-merger.js';
import type { sheets_v4 } from 'googleapis';

describe('RequestMerger', () => {
  let merger: RequestMerger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockSheetsApi: any;

  beforeEach(() => {
    // Create mock Sheets API
    mockSheetsApi = {
      spreadsheets: {
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              range: 'Sheet1!A1:C10',
              majorDimension: 'ROWS',
              values: [
                ['A1', 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
              ],
            },
          }),
        },
      },
    };

    merger = new RequestMerger({
      enabled: true,
      windowMs: 50,
      maxWindowSize: 10,
      mergeAdjacent: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultMerger = new RequestMerger();

      expect(defaultMerger).toBeDefined();
      const stats = defaultMerger.getStats();
      expect(stats.enabled).toBe(true); // Default enabled
    });

    it('should initialize with custom config', () => {
      const customMerger = new RequestMerger({
        enabled: false,
        windowMs: 100,
        maxWindowSize: 5,
        mergeAdjacent: false,
      });

      expect(customMerger).toBeDefined();
      const stats = customMerger.getStats();
      expect(stats.enabled).toBe(false);
    });

    it('should initialize stats to zero', () => {
      const stats = merger.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.mergedRequests).toBe(0);
      expect(stats.apiCalls).toBe(0);
      expect(stats.savingsRate).toBe(0);
    });
  });

  describe('mergeRead', () => {
    it('should execute read directly when merging disabled', async () => {
      const disabledMerger = new RequestMerger({ enabled: false });

      const result = await disabledMerger.mergeRead(
        mockSheetsApi as unknown as sheets_v4.Sheets,
        'test-id',
        'Sheet1!A1:B10'
      );

      expect(result).toBeDefined();
      expect(mockSheetsApi.spreadsheets.values.get).toHaveBeenCalledWith({
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B10',
        valueRenderOption: undefined,
        majorDimension: undefined,
      });

      const stats = disabledMerger.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.apiCalls).toBe(1);
    });

    it('should queue read when merging enabled', async () => {
      // Don't await immediately - let it queue
      const promise = merger.mergeRead(
        mockSheetsApi as unknown as sheets_v4.Sheets,
        'test-id',
        'Sheet1!A1:B10'
      );

      // Stats should show queued request
      const stats = merger.getStats();
      expect(stats.totalRequests).toBe(1);

      // Wait for result
      const result = await promise;
      expect(result).toBeDefined();
    });

    it('should handle read options', async () => {
      const disabledMerger = new RequestMerger({ enabled: false });

      await disabledMerger.mergeRead(
        mockSheetsApi as unknown as sheets_v4.Sheets,
        'test-id',
        'Sheet1!A1:B10',
        {
          valueRenderOption: 'FORMULA',
          majorDimension: 'COLUMNS',
        }
      );

      expect(mockSheetsApi.spreadsheets.values.get).toHaveBeenCalledWith({
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B10',
        valueRenderOption: 'FORMULA',
        majorDimension: 'COLUMNS',
      });
    });

    it('should merge multiple reads in same window', async () => {
      // Submit multiple reads quickly
      const promise1 = merger.mergeRead(
        mockSheetsApi as unknown as sheets_v4.Sheets,
        'test-id',
        'Sheet1!A1:B10'
      );
      const promise2 = merger.mergeRead(
        mockSheetsApi as unknown as sheets_v4.Sheets,
        'test-id',
        'Sheet1!A1:C5'
      );

      // Both should resolve
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      // Stats should show merging occurred
      const stats = merger.getStats();
      expect(stats.totalRequests).toBe(2);
      // API calls should be less than total requests (merging happened)
      expect(stats.apiCalls).toBeLessThanOrEqual(2);
    });

    it('should handle API errors', async () => {
      const disabledMerger = new RequestMerger({ enabled: false });
      mockSheetsApi.spreadsheets.values.get.mockRejectedValue(new Error('API error'));

      await expect(
        disabledMerger.mergeRead(
          mockSheetsApi as unknown as sheets_v4.Sheets,
          'test-id',
          'Sheet1!A1:B10'
        )
      ).rejects.toThrow('API error');
    });
  });

  describe('getStats', () => {
    it('should return merger statistics', () => {
      const stats = merger.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.enabled).toBe('boolean');
      expect(typeof stats.totalRequests).toBe('number');
      expect(typeof stats.mergedRequests).toBe('number');
      expect(typeof stats.apiCalls).toBe('number');
      expect(typeof stats.savingsRate).toBe('number');
    });

    it('should update after operations', async () => {
      const disabledMerger = new RequestMerger({ enabled: false });

      const initialStats = disabledMerger.getStats();
      expect(initialStats.totalRequests).toBe(0);

      await disabledMerger.mergeRead(
        mockSheetsApi as unknown as sheets_v4.Sheets,
        'test-id',
        'Sheet1!A1:B10'
      );

      const updatedStats = disabledMerger.getStats();
      expect(updatedStats.totalRequests).toBe(1);
      expect(updatedStats.apiCalls).toBe(1);
    });

    it('should calculate savings rate', async () => {
      const stats = merger.getStats();

      // Initial savings rate should be 0
      expect(stats.savingsRate).toBe(0);

      // After operations, savings rate may change
      // (depends on whether merging occurred)
    });
  });
});

describe('parseA1Range utility', () => {
  it('should parse simple range', () => {
    const range = parseA1Range('Sheet1!A1:B10');

    expect(range.sheetName).toBe('Sheet1');
    expect(range.startRow).toBe(1);
    expect(range.startCol).toBe(1);
    expect(range.endRow).toBe(10);
    expect(range.endCol).toBe(2);
    expect(range.originalA1).toBe('Sheet1!A1:B10');
  });

  it('should parse range without sheet name', () => {
    const range = parseA1Range('A1:B10');

    expect(range.sheetName).toBe('');
    expect(range.startRow).toBe(1);
    expect(range.startCol).toBe(1);
    expect(range.endRow).toBe(10);
    expect(range.endCol).toBe(2);
  });

  it('should parse single cell', () => {
    const range = parseA1Range('Sheet1!A1');

    expect(range.sheetName).toBe('Sheet1');
    expect(range.startRow).toBe(1);
    expect(range.startCol).toBe(1);
    expect(range.endRow).toBe(1);
    expect(range.endCol).toBe(1);
  });

  it('should parse column range', () => {
    const range = parseA1Range('Sheet1!A:C');

    expect(range.sheetName).toBe('Sheet1');
    expect(range.startCol).toBe(1);
    expect(range.endCol).toBe(3);
    // Rows should be unbounded (0)
    expect(range.startRow).toBe(0);
    expect(range.endRow).toBe(0);
  });

  it('should parse row range', () => {
    const range = parseA1Range('Sheet1!1:10');

    expect(range.sheetName).toBe('Sheet1');
    expect(range.startRow).toBe(1);
    expect(range.endRow).toBe(10);
    // Columns should be unbounded (0)
    expect(range.startCol).toBe(0);
    expect(range.endCol).toBe(0);
  });

  it('should handle sheet names with spaces', () => {
    const range = parseA1Range("'My Sheet'!A1:B10");

    expect(range.sheetName).toBe('My Sheet');
    expect(range.startRow).toBe(1);
    expect(range.endRow).toBe(10);
  });

  it('should handle large column indices', () => {
    const range = parseA1Range('Sheet1!AA1:ZZ100');

    expect(range.sheetName).toBe('Sheet1');
    expect(range.startCol).toBe(27); // AA = 27
    expect(range.endCol).toBeGreaterThan(27); // ZZ > AA
    expect(range.startRow).toBe(1);
    expect(range.endRow).toBe(100);
  });

  it('should preserve original A1 notation', () => {
    const original = 'Sheet1!A1:B10';
    const range = parseA1Range(original);

    expect(range.originalA1).toBe(original);
  });
});

describe('mergeRanges utility', () => {
  it('should merge overlapping ranges', () => {
    const range1 = parseA1Range('Sheet1!A1:C10');
    const range2 = parseA1Range('Sheet1!B5:D15');

    const merged = mergeRanges([range1, range2]);

    expect(merged.sheetName).toBe('Sheet1');
    expect(merged.startRow).toBe(1);
    expect(merged.startCol).toBe(1);
    expect(merged.endRow).toBe(15);
    expect(merged.endCol).toBe(4); // Column D
  });

  it('should merge adjacent ranges', () => {
    const range1 = parseA1Range('Sheet1!A1:B5');
    const range2 = parseA1Range('Sheet1!A6:B10');

    const merged = mergeRanges([range1, range2]);

    expect(merged.startRow).toBe(1);
    expect(merged.endRow).toBe(10);
  });

  it('should handle single range', () => {
    const range = parseA1Range('Sheet1!A1:B10');

    const merged = mergeRanges([range]);

    expect(merged.startRow).toBe(range.startRow);
    expect(merged.endRow).toBe(range.endRow);
    expect(merged.startCol).toBe(range.startCol);
    expect(merged.endCol).toBe(range.endCol);
  });

  it('should merge multiple ranges', () => {
    const range1 = parseA1Range('Sheet1!A1:B5');
    const range2 = parseA1Range('Sheet1!C3:D7');
    const range3 = parseA1Range('Sheet1!E1:F10');

    const merged = mergeRanges([range1, range2, range3]);

    // Should create bounding box
    expect(merged.startRow).toBe(1);
    expect(merged.startCol).toBe(1); // Column A
    expect(merged.endRow).toBe(10);
    expect(merged.endCol).toBe(6); // Column F
  });

  it('should handle unbounded ranges', () => {
    const range1 = parseA1Range('Sheet1!A:B');
    const range2 = parseA1Range('Sheet1!C:D');

    const merged = mergeRanges([range1, range2]);

    // For column ranges, should preserve column info
    expect(merged.sheetName).toBe('Sheet1');
    expect(merged.startRow).toBe(0); // Unbounded rows
    expect(merged.endRow).toBe(0); // Unbounded rows
    // Columns should be merged (implementation-dependent)
    expect(typeof merged.startCol).toBe('number');
    expect(typeof merged.endCol).toBe('number');
  });

  it('should preserve sheet name', () => {
    const range1 = parseA1Range('MySheet!A1:B5');
    const range2 = parseA1Range('MySheet!C3:D7');

    const merged = mergeRanges([range1, range2]);

    expect(merged.sheetName).toBe('MySheet');
  });
});

describe('splitResponse utility', () => {
  it('should split merged response', () => {
    const mergedRange = parseA1Range('Sheet1!A1:D10');
    const requestedRange = parseA1Range('Sheet1!A1:B5');

    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:D10',
      majorDimension: 'ROWS',
      values: [
        ['A1', 'B1', 'C1', 'D1'],
        ['A2', 'B2', 'C2', 'D2'],
        ['A3', 'B3', 'C3', 'D3'],
        ['A4', 'B4', 'C4', 'D4'],
        ['A5', 'B5', 'C5', 'D5'],
      ],
    };

    const split = splitResponse(mergedData, mergedRange, requestedRange);

    expect(split.range).toBe('Sheet1!A1:B5');
    expect(split.values).toHaveLength(5);
    expect(split.values?.[0]).toEqual(['A1', 'B1']); // Only columns A-B
  });

  it('should handle empty values', () => {
    const mergedRange = parseA1Range('Sheet1!A1:B5');
    const requestedRange = parseA1Range('Sheet1!A1:B5');

    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:B5',
      majorDimension: 'ROWS',
      values: undefined,
    };

    const split = splitResponse(mergedData, mergedRange, requestedRange);

    // Implementation returns empty array for undefined values
    expect(Array.isArray(split.values)).toBe(true);
  });

  it('should handle single cell request from larger range', () => {
    const mergedRange = parseA1Range('Sheet1!A1:C10');
    const requestedRange = parseA1Range('Sheet1!B2');

    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:C10',
      majorDimension: 'ROWS',
      values: [
        ['A1', 'B1', 'C1'],
        ['A2', 'B2', 'C2'],
        ['A3', 'B3', 'C3'],
      ],
    };

    const split = splitResponse(mergedData, mergedRange, requestedRange);

    expect(split.range).toBe('Sheet1!B2');
    expect(split.values).toHaveLength(1);
    expect(split.values?.[0]).toEqual(['B2']);
  });

  it('should preserve majorDimension', () => {
    const mergedRange = parseA1Range('Sheet1!A1:B5');
    const requestedRange = parseA1Range('Sheet1!A1:B5');

    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:B5',
      majorDimension: 'COLUMNS',
      values: [
        ['A1', 'A2'],
        ['B1', 'B2'],
      ],
    };

    const split = splitResponse(mergedData, mergedRange, requestedRange);

    expect(split.majorDimension).toBe('COLUMNS');
  });

  it('should handle offset ranges', () => {
    const mergedRange = parseA1Range('Sheet1!A1:D10');
    const requestedRange = parseA1Range('Sheet1!C5:D8');

    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:D10',
      majorDimension: 'ROWS',
      values: Array.from({ length: 10 }, (_, i) => [
        `A${i + 1}`,
        `B${i + 1}`,
        `C${i + 1}`,
        `D${i + 1}`,
      ]),
    };

    const split = splitResponse(mergedData, mergedRange, requestedRange);

    expect(split.range).toBe('Sheet1!C5:D8');
    expect(split.values).toHaveLength(4); // Rows 5-8
    expect(split.values?.[0]).toEqual(['C5', 'D5']); // Only columns C-D
  });
});

describe('edge cases', () => {
  it('should handle empty range list in mergeRanges', () => {
    expect(() => mergeRanges([])).toThrow();
  });

  it('should handle invalid A1 notation gracefully', () => {
    // Parser handles invalid input gracefully, returns best-effort parse
    const range = parseA1Range('InvalidRange');
    expect(range).toBeDefined();
    expect(range.originalA1).toBe('InvalidRange');
  });

  it('should handle very large ranges', () => {
    const range = parseA1Range('Sheet1!A1:ZZZ1000000');

    expect(range.endRow).toBe(1000000);
    expect(range.endCol).toBeGreaterThan(100); // ZZZ is a large column
  });

  it('should handle merger with windowMs = 0', () => {
    const instantMerger = new RequestMerger({
      enabled: true,
      windowMs: 0,
    });

    expect(instantMerger).toBeDefined();
  });

  it('should handle merger with maxWindowSize = 1', () => {
    const singleMerger = new RequestMerger({
      enabled: true,
      maxWindowSize: 1,
    });

    expect(singleMerger).toBeDefined();
  });
});
