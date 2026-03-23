/**
 * Tests for Request Merger Service
 *
 * Tests range parsing, overlap detection, merging logic, and integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import {
  RequestMerger,
  parseA1Range,
  rangesOverlap,
  rangesOverlapOrAdjacent,
  mergeRanges,
  formatA1Range,
  splitResponse,
  type RangeInfo,
} from '../../src/services/request-merger.js';

describe('A1 Range Parsing', () => {
  describe('parseA1Range', () => {
    it('should parse simple cell reference', () => {
      const range = parseA1Range('A1');
      expect(range).toEqual({
        sheetName: '',
        startRow: 1,
        startCol: 1,
        endRow: 1,
        endCol: 1,
        originalA1: 'A1',
      });
    });

    it('should parse range reference', () => {
      const range = parseA1Range('A1:B10');
      expect(range).toEqual({
        sheetName: '',
        startRow: 1,
        startCol: 1,
        endRow: 10,
        endCol: 2,
        originalA1: 'A1:B10',
      });
    });

    it('should parse sheet with unquoted name', () => {
      const range = parseA1Range('Sheet1!A1:B10');
      expect(range.sheetName).toBe('Sheet1');
      expect(range.startRow).toBe(1);
      expect(range.startCol).toBe(1);
      expect(range.endRow).toBe(10);
      expect(range.endCol).toBe(2);
    });

    it('should parse sheet with quoted name', () => {
      const range = parseA1Range("'Sheet Name'!A1:B10");
      expect(range.sheetName).toBe('Sheet Name');
      expect(range.startRow).toBe(1);
      expect(range.endRow).toBe(10);
    });

    it('should parse sheet with spaces and escaped quotes', () => {
      const range = parseA1Range("'It''s a Sheet'!A1:B10");
      expect(range.sheetName).toBe("It's a Sheet");
    });

    it('should parse entire column range', () => {
      const range = parseA1Range('A:A');
      expect(range).toEqual({
        sheetName: '',
        startRow: 0,
        startCol: 1,
        endRow: 0,
        endCol: 1,
        originalA1: 'A:A',
      });
    });

    it('should parse multiple column range', () => {
      const range = parseA1Range('A:D');
      expect(range.startCol).toBe(1);
      expect(range.endCol).toBe(4);
      expect(range.startRow).toBe(0);
      expect(range.endRow).toBe(0);
    });

    it('should parse entire row range', () => {
      const range = parseA1Range('1:1');
      expect(range).toEqual({
        sheetName: '',
        startRow: 1,
        startCol: 0,
        endRow: 1,
        endCol: 0,
        originalA1: '1:1',
      });
    });

    it('should parse multiple row range', () => {
      const range = parseA1Range('1:10');
      expect(range.startRow).toBe(1);
      expect(range.endRow).toBe(10);
      expect(range.startCol).toBe(0);
      expect(range.endCol).toBe(0);
    });

    it('should parse large column letters', () => {
      const range = parseA1Range('Sheet1!AA1:ZZ100');
      expect(range.startCol).toBe(27); // AA
      expect(range.endCol).toBe(702); // ZZ
    });
  });

  describe('formatA1Range', () => {
    it('should format simple cell', () => {
      const rangeInfo: RangeInfo = {
        sheetName: '',
        startRow: 1,
        startCol: 1,
        endRow: 1,
        endCol: 1,
        originalA1: '',
      };
      expect(formatA1Range(rangeInfo)).toBe('A1');
    });

    it('should format range', () => {
      const rangeInfo: RangeInfo = {
        sheetName: '',
        startRow: 1,
        startCol: 1,
        endRow: 10,
        endCol: 2,
        originalA1: '',
      };
      expect(formatA1Range(rangeInfo)).toBe('A1:B10');
    });

    it('should format with sheet name', () => {
      const rangeInfo: RangeInfo = {
        sheetName: 'Sheet1',
        startRow: 1,
        startCol: 1,
        endRow: 10,
        endCol: 2,
        originalA1: '',
      };
      expect(formatA1Range(rangeInfo)).toBe("'Sheet1'!A1:B10");
    });

    it('should escape quotes in sheet name', () => {
      const rangeInfo: RangeInfo = {
        sheetName: "It's a Sheet",
        startRow: 1,
        startCol: 1,
        endRow: 10,
        endCol: 2,
        originalA1: '',
      };
      expect(formatA1Range(rangeInfo)).toBe("'It''s a Sheet'!A1:B10");
    });
  });
});

describe('Range Overlap Detection', () => {
  describe('rangesOverlap', () => {
    it('should detect identical ranges as overlapping', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet1!A1:C10');
      expect(rangesOverlap(range1, range2)).toBe(true);
    });

    it('should detect overlapping ranges', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet1!B5:D15');
      expect(rangesOverlap(range1, range2)).toBe(true);
    });

    it('should detect non-overlapping ranges', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet1!D11:F20');
      expect(rangesOverlap(range1, range2)).toBe(false);
    });

    it('should detect ranges on different sheets as non-overlapping', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet2!A1:C10');
      expect(rangesOverlap(range1, range2)).toBe(false);
    });

    it('should detect partial row overlap', () => {
      const range1 = parseA1Range('Sheet1!A1:A10');
      const range2 = parseA1Range('Sheet1!A5:A15');
      expect(rangesOverlap(range1, range2)).toBe(true);
    });

    it('should detect contained range as overlapping', () => {
      const range1 = parseA1Range('Sheet1!A1:Z100');
      const range2 = parseA1Range('Sheet1!D5:F10');
      expect(rangesOverlap(range1, range2)).toBe(true);
    });

    it('should handle single-cell ranges', () => {
      const range1 = parseA1Range('Sheet1!B5');
      const range2 = parseA1Range('Sheet1!A1:C10');
      expect(rangesOverlap(range1, range2)).toBe(true);
    });
  });

  describe('rangesOverlapOrAdjacent', () => {
    it('should detect adjacent ranges', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet1!D1:F10');
      expect(rangesOverlapOrAdjacent(range1, range2)).toBe(true);
    });

    it('should detect vertically adjacent ranges', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet1!A11:C20');
      expect(rangesOverlapOrAdjacent(range1, range2)).toBe(true);
    });

    it('should detect overlapping ranges as adjacent', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet1!B5:D15');
      expect(rangesOverlapOrAdjacent(range1, range2)).toBe(true);
    });

    it('should not detect non-adjacent ranges', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet1!E15:G25');
      expect(rangesOverlapOrAdjacent(range1, range2)).toBe(false);
    });
  });
});

describe('Range Merging', () => {
  describe('mergeRanges', () => {
    it('should return single range unchanged', () => {
      const range = parseA1Range('Sheet1!A1:C10');
      const merged = mergeRanges([range]);
      expect(merged.sheetName).toBe('Sheet1');
      expect(merged.startRow).toBe(1);
      expect(merged.endRow).toBe(10);
    });

    it('should merge two overlapping ranges', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet1!B5:D15');
      const merged = mergeRanges([range1, range2]);

      expect(merged.sheetName).toBe('Sheet1');
      expect(merged.startRow).toBe(1);
      expect(merged.startCol).toBe(1);
      expect(merged.endRow).toBe(15);
      expect(merged.endCol).toBe(4);
    });

    it('should merge multiple ranges into bounding box', () => {
      const range1 = parseA1Range('Sheet1!A1:B5');
      const range2 = parseA1Range('Sheet1!D3:E8');
      const range3 = parseA1Range('Sheet1!B7:C10');
      const merged = mergeRanges([range1, range2, range3]);

      expect(merged.startRow).toBe(1);
      expect(merged.startCol).toBe(1);
      expect(merged.endRow).toBe(10);
      expect(merged.endCol).toBe(5); // Column E
    });

    it('should throw error for empty range list', () => {
      expect(() => mergeRanges([])).toThrow('Cannot merge empty range list');
    });

    it('should throw error for ranges from different sheets', () => {
      const range1 = parseA1Range('Sheet1!A1:C10');
      const range2 = parseA1Range('Sheet2!A1:C10');
      expect(() => mergeRanges([range1, range2])).toThrow(
        'Cannot merge ranges from different sheets'
      );
    });
  });
});

describe('Response Splitting', () => {
  it('should split merged response to original range', () => {
    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:D10',
      values: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
        [17, 18, 19, 20],
      ],
      majorDimension: 'ROWS',
    };

    const mergedRange = parseA1Range('Sheet1!A1:D5');
    const targetRange = parseA1Range('Sheet1!B2:C4');

    const split = splitResponse(mergedData, mergedRange, targetRange);

    expect(split.values).toEqual([
      [6, 7],
      [10, 11],
      [14, 15],
    ]);
    expect(split.range).toBe('Sheet1!B2:C4');
  });

  it('should split first portion of merged response', () => {
    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:C3',
      values: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    };

    const mergedRange = parseA1Range('Sheet1!A1:C3');
    const targetRange = parseA1Range('Sheet1!A1:B2');

    const split = splitResponse(mergedData, mergedRange, targetRange);

    expect(split.values).toEqual([
      [1, 2],
      [4, 5],
    ]);
  });

  it('should split last portion of merged response', () => {
    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:C3',
      values: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    };

    const mergedRange = parseA1Range('Sheet1!A1:C3');
    const targetRange = parseA1Range('Sheet1!B2:C3');

    const split = splitResponse(mergedData, mergedRange, targetRange);

    expect(split.values).toEqual([
      [5, 6],
      [8, 9],
    ]);
  });

  it('should handle single cell extraction', () => {
    const mergedData: sheets_v4.Schema$ValueRange = {
      range: 'Sheet1!A1:C3',
      values: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    };

    const mergedRange = parseA1Range('Sheet1!A1:C3');
    const targetRange = parseA1Range('Sheet1!B2');

    const split = splitResponse(mergedData, mergedRange, targetRange);

    expect(split.values).toEqual([[5]]);
  });
});

describe('RequestMerger Integration', () => {
  let merger: RequestMerger;
  let mockSheetsApi: sheets_v4.Sheets;
  let apiCallCount: number;

  beforeEach(() => {
    apiCallCount = 0;

    // Mock Sheets API
    mockSheetsApi = {
      spreadsheets: {
        values: {
          get: vi.fn(async (params) => {
            apiCallCount++;

            // Simulate API delay
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Parse range to determine response
            const range = params.range as string;
            const rangeInfo = parseA1Range(range);

            // Generate sample data based on range
            const rows = rangeInfo.endRow - rangeInfo.startRow + 1 || 10;
            const cols = rangeInfo.endCol - rangeInfo.startCol + 1 || 4;

            const values = [];
            for (let r = 0; r < rows; r++) {
              const row = [];
              for (let c = 0; c < cols; c++) {
                row.push(`R${rangeInfo.startRow + r}C${rangeInfo.startCol + c}`);
              }
              values.push(row);
            }

            return {
              data: {
                range: params.range,
                values,
                majorDimension: params.majorDimension || 'ROWS',
              },
            };
          }),
        },
      },
    } as unknown as sheets_v4.Sheets;

    merger = new RequestMerger({
      enabled: true,
      windowMs: 50,
      mergeAdjacent: true,
    });
  });

  afterEach(() => {
    merger.destroy();
  });

  it('should merge concurrent overlapping requests', async () => {
    const results = await Promise.all([
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10'),
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!B5:D15'),
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:A10'),
    ]);

    // Should make only 1 API call for merged range
    expect(apiCallCount).toBe(1);

    // All requests should get their data
    expect(results[0]?.values).toBeDefined();
    expect(results[1]?.values).toBeDefined();
    expect(results[2]?.values).toBeDefined();

    // Check statistics
    const stats = merger.getStats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.apiCalls).toBe(1);
    expect(stats.mergedRequests).toBe(2);
    expect(stats.savingsRate).toBeCloseTo(66.67, 0); // 2/3 saved
  });

  it('should not merge requests for different spreadsheets', async () => {
    const results = await Promise.all([
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10'),
      merger.mergeRead(mockSheetsApi, 'spreadsheet2', 'Sheet1!A1:C10'),
    ]);

    // Should make 2 API calls (different spreadsheets)
    expect(apiCallCount).toBe(2);
    expect(results[0]?.values).toBeDefined();
    expect(results[1]?.values).toBeDefined();
  });

  it('should not merge requests for different sheets', async () => {
    await Promise.all([
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10'),
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet2!A1:C10'),
    ]);

    // Should make 2 API calls (different sheets)
    expect(apiCallCount).toBe(2);
  });

  it('should not merge requests with different options', async () => {
    await Promise.all([
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10', {
        valueRenderOption: 'FORMATTED_VALUE',
      }),
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10', {
        valueRenderOption: 'FORMULA',
      }),
    ]);

    // Should make 2 API calls (different options)
    expect(apiCallCount).toBe(2);
  });

  it('should handle single request efficiently', async () => {
    const result = await merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10');

    expect(apiCallCount).toBe(1);
    expect(result.values).toBeDefined();

    const stats = merger.getStats();
    expect(stats.totalRequests).toBe(1);
    expect(stats.apiCalls).toBe(1);
    expect(stats.mergedRequests).toBe(0);
  });

  it('should flush window when full', async () => {
    // Create merger with small window size
    const smallMerger = new RequestMerger({
      enabled: true,
      windowMs: 1000, // Long window
      maxWindowSize: 3, // Small max size
    });

    // Send 3 requests to fill window
    const promises = [
      smallMerger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10'),
      smallMerger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!B5:D15'),
      smallMerger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:A10'),
    ];

    await Promise.all(promises);

    // Should flush immediately due to window size limit
    expect(apiCallCount).toBe(1);

    smallMerger.destroy();
  });

  it('should track statistics correctly', async () => {
    // Reset stats
    merger.resetStats();

    // Execute multiple batches
    await Promise.all([
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10'),
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!B5:D15'),
    ]);

    await Promise.all([
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!E1:G10'),
      merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!F5:H15'),
    ]);

    const stats = merger.getStats();
    expect(stats.totalRequests).toBe(4);
    expect(stats.apiCalls).toBe(2);
    expect(stats.mergedRequests).toBe(2);
    expect(stats.savingsRate).toBe(50); // 2/4 = 50%
    expect(stats.averageWindowSize).toBe(2);
  });

  it('should handle API errors gracefully', async () => {
    // Mock API error
    (
      mockSheetsApi.spreadsheets.values.get as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error('API Error'));

    await expect(merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10')).rejects.toThrow(
      'API Error'
    );
  });

  it('should work when disabled', async () => {
    const disabledMerger = new RequestMerger({ enabled: false });

    const results = await Promise.all([
      disabledMerger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10'),
      disabledMerger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!B5:D15'),
    ]);

    // Should make 2 API calls (merging disabled)
    expect(apiCallCount).toBe(2);
    expect(results[0]?.values).toBeDefined();
    expect(results[1]?.values).toBeDefined();

    disabledMerger.destroy();
  });
});

describe('Performance and Edge Cases', () => {
  let merger: RequestMerger;
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    mockSheetsApi = {
      spreadsheets: {
        values: {
          get: vi.fn(async (params) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {
              data: {
                range: params.range,
                values: [[1, 2, 3]],
              },
            };
          }),
        },
      },
    } as unknown as sheets_v4.Sheets;

    merger = new RequestMerger({ enabled: true, windowMs: 50 });
  });

  afterEach(() => {
    merger.destroy();
  });

  it('should handle large number of concurrent requests', async () => {
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(merger.mergeRead(mockSheetsApi, 'spreadsheet1', `Sheet1!A${i}:C${i + 10}`));
    }

    const results = await Promise.all(promises);
    expect(results.length).toBe(50);

    // Should significantly reduce API calls through merging
    const stats = merger.getStats();
    expect(stats.savingsRate).toBeGreaterThan(25); // At least 25% savings
  });

  it('should handle empty values in response', async () => {
    (
      mockSheetsApi.spreadsheets.values.get as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      data: {
        range: 'Sheet1!A1:C10',
        values: [],
      },
    });

    const result = await merger.mergeRead(mockSheetsApi, 'spreadsheet1', 'Sheet1!A1:C10');

    expect(result.values).toEqual([]);
  });
});
