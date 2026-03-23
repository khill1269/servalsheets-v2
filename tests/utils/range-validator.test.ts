/**
 * Range Validator Tests (P1-5)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { validateRangeWithinGrid } from '../../src/utils/range-validator.js';

describe('range-validator', () => {
  let mockCachedApi: any;

  beforeEach(() => {
    mockCachedApi = {
      getSpreadsheet: vi.fn(),
    };
  });

  it('should validate a valid range within grid dimensions', async () => {
    mockCachedApi.getSpreadsheet.mockResolvedValue({
      sheets: [
        {
          properties: {
            title: 'Sheet1',
            gridProperties: {
              rowCount: 1000,
              columnCount: 26,
            },
          },
        },
      ],
    } as sheets_v4.Schema$Spreadsheet);

    const result = await validateRangeWithinGrid(mockCachedApi, 'spreadsheetId', 'Sheet1!A1:Z100');

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject a range that exceeds row count', async () => {
    mockCachedApi.getSpreadsheet.mockResolvedValue({
      sheets: [
        {
          properties: {
            title: 'Sheet1',
            gridProperties: {
              rowCount: 100,
              columnCount: 26,
            },
          },
        },
      ],
    } as sheets_v4.Schema$Spreadsheet);

    const result = await validateRangeWithinGrid(mockCachedApi, 'spreadsheetId', 'Sheet1!A1:Z1000');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('extends beyond sheet grid dimensions');
    expect(result.hint).toContain('100 rows');
  });

  it('should reject a range that exceeds column count', async () => {
    mockCachedApi.getSpreadsheet.mockResolvedValue({
      sheets: [
        {
          properties: {
            title: 'Sheet1',
            gridProperties: {
              rowCount: 1000,
              columnCount: 5,
            },
          },
        },
      ],
    } as sheets_v4.Schema$Spreadsheet);

    const result = await validateRangeWithinGrid(mockCachedApi, 'spreadsheetId', 'Sheet1!A1:Z100');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('extends beyond sheet grid dimensions');
    expect(result.hint).toContain('5 columns');
  });

  it('should handle quoted sheet names', async () => {
    mockCachedApi.getSpreadsheet.mockResolvedValue({
      sheets: [
        {
          properties: {
            title: 'My Sheet',
            gridProperties: {
              rowCount: 1000,
              columnCount: 26,
            },
          },
        },
      ],
    } as sheets_v4.Schema$Spreadsheet);

    const result = await validateRangeWithinGrid(
      mockCachedApi,
      'spreadsheetId',
      "'My Sheet'!A1:Z100"
    );

    expect(result.valid).toBe(true);
  });

  it('should reject range with non-existent sheet', async () => {
    mockCachedApi.getSpreadsheet.mockResolvedValue({
      sheets: [
        {
          properties: {
            title: 'Sheet1',
            gridProperties: {
              rowCount: 1000,
              columnCount: 26,
            },
          },
        },
      ],
    } as sheets_v4.Schema$Spreadsheet);

    const result = await validateRangeWithinGrid(mockCachedApi, 'spreadsheetId', 'NonExistent!A1:B10');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Sheet "NonExistent" not found');
    expect(result.hint).toContain('Sheet1');
  });

  it('should gracefully handle API errors by allowing operation', async () => {
    mockCachedApi.getSpreadsheet.mockRejectedValue(new Error('API Error'));

    const result = await validateRangeWithinGrid(mockCachedApi, 'spreadsheetId', 'Sheet1!A1:B10');

    // Non-blocking: validation errors should not fail the operation
    expect(result.valid).toBe(true);
    expect(result.hint).toContain('skipped due to an error');
  });

  it('should include details in validation result', async () => {
    mockCachedApi.getSpreadsheet.mockResolvedValue({
      sheets: [
        {
          properties: {
            title: 'Sheet1',
            gridProperties: {
              rowCount: 1000,
              columnCount: 26,
            },
          },
        },
      ],
    } as sheets_v4.Schema$Spreadsheet);

    const result = await validateRangeWithinGrid(mockCachedApi, 'spreadsheetId', 'Sheet1!A1:Z100');

    expect(result.details).toBeDefined();
    expect(result.details?.sheetName).toBe('Sheet1');
    expect(result.details?.gridRows).toBe(1000);
    expect(result.details?.gridCols).toBe(26);
  });
});
