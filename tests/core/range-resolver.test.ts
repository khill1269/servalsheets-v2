/**
 * ServalSheets v4 - Range Resolver Tests
 *
 * Tests for range resolution including sheet name escaping
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RangeResolver, RangeResolutionError } from '../../src/core/range-resolver.js';

// Mock Google Sheets API
const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn(),
    values: {
      get: vi.fn(),
    },
  },
});

describe('RangeResolver', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let resolver: RangeResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockSheetsApi();
    resolver = new RangeResolver({ sheetsApi: mockApi as any });
  });

  describe('Defensive input handling', () => {
    it('throws INVALID_RANGE instead of TypeError for undefined input', async () => {
      await expect(resolver.resolve('test-id', undefined as unknown as never)).rejects.toThrow(
        RangeResolutionError
      );

      try {
        await resolver.resolve('test-id', undefined as unknown as never);
      } catch (error) {
        expect((error as RangeResolutionError).code).toBe('INVALID_RANGE');
        expect((error as Error).message).toContain('Range input is required');
      }
    });

    it('accepts plain A1 strings directly', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      const result = await resolver.resolve('test-id', 'Sheet1!A1:B2');
      expect(result.a1Notation).toBe('Sheet1!A1:B2');
      expect(result.sheetId).toBe(0);
    });
  });

  describe('Sheet name escaping', () => {
    it('should escape single quotes in sheet names', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: "John's Data" } }],
        },
      });

      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Header1', 'Header2', 'Header3']] },
      });

      const result = await resolver.resolve('test-id', {
        semantic: { sheet: "John's Data", column: 'Header1', includeHeader: true },
      });

      // Should escape the single quote by doubling it
      expect(result.a1Notation).toContain("'John''s Data'");
    });

    it('should handle multiple single quotes', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: "It's John's Sheet" } }],
        },
      });

      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Col1']] },
      });

      const result = await resolver.resolve('test-id', {
        semantic: { sheet: "It's John's Sheet", column: 'Col1', includeHeader: true },
      });

      expect(result.a1Notation).toContain("'It''s John''s Sheet'");
    });

    it('should not double-escape already escaped quotes in A1 input', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: "John's Data" } }],
        },
      });

      // User provides pre-escaped A1 notation
      const result = await resolver.resolve('test-id', {
        a1: "'John''s Data'!A1:B10",
      });

      // Should work correctly
      expect(result.a1Notation).toBe("'John''s Data'!A1:B10");
      expect(result.sheetName).toBe("John's Data");
    });

    it('should handle sheet names without quotes correctly', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'SimpleSheet' } }],
        },
      });

      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Header']] },
      });

      const result = await resolver.resolve('test-id', {
        semantic: { sheet: 'SimpleSheet', column: 'Header', includeHeader: true },
      });

      expect(result.a1Notation).toContain("'SimpleSheet'");
    });
  });

  describe('A1 notation resolution', () => {
    it('should resolve direct A1 notation', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      const result = await resolver.resolve('test-id', {
        a1: 'Sheet1!A1:C10',
      });

      expect(result.a1Notation).toBe('Sheet1!A1:C10');
      expect(result.sheetName).toBe('Sheet1');
      expect(result.sheetId).toBe(0);
      expect(result.resolution.method).toBe('a1_direct');
      expect(result.resolution.confidence).toBe(1.0);
    });

    it('should handle quoted sheet names in A1 input', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet With Spaces' } }],
        },
      });

      const result = await resolver.resolve('test-id', {
        a1: "'Sheet With Spaces'!A1:B5",
      });

      expect(result.sheetName).toBe('Sheet With Spaces');
    });
  });

  describe('Named range resolution', () => {
    it('should resolve named ranges', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          namedRanges: [
            {
              name: 'SalesData',
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 100,
                startColumnIndex: 0,
                endColumnIndex: 5,
              },
            },
          ],
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      const result = await resolver.resolve('test-id', {
        namedRange: 'SalesData',
      });

      expect(result.resolution.method).toBe('named_range');
      expect(result.resolution.confidence).toBe(1.0);
    });

    it('should throw RANGE_NOT_FOUND for unknown named range', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          namedRanges: [{ name: 'ExistingRange', range: {} }],
          sheets: [],
        },
      });

      await expect(resolver.resolve('test-id', { namedRange: 'NonExistent' })).rejects.toThrow(
        RangeResolutionError
      );

      try {
        await resolver.resolve('test-id', { namedRange: 'NonExistent' });
      } catch (error) {
        expect((error as RangeResolutionError).code).toBe('RANGE_NOT_FOUND');
        expect((error as RangeResolutionError).details?.['available']).toContain('ExistingRange');
      }
    });
  });

  describe('Semantic range resolution', () => {
    beforeEach(() => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });
    });

    it('should resolve exact header match', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Name', 'Email', 'Phone']] },
      });

      const result = await resolver.resolve('test-id', {
        semantic: { sheet: 'Sheet1', column: 'Email', includeHeader: true },
      });

      expect(result.resolution.method).toBe('semantic_header');
      expect(result.resolution.confidence).toBe(1.0);
      expect(result.a1Notation).toContain('B'); // Email is column B
    });

    it('should resolve fuzzy header match when partial overlap', async () => {
      // "Customer Email" contains "Email" with sufficient overlap
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Customer Name', 'Customer Email', 'Phone Number']] },
      });

      // Using "Customer Email" directly should match exactly
      const result = await resolver.resolve('test-id', {
        semantic: { sheet: 'Sheet1', column: 'Customer Email', includeHeader: true },
      });

      expect(result.resolution.method).toBe('semantic_header');
      expect(result.resolution.confidence).toBe(1.0); // Exact match
    });

    it('should throw RANGE_NOT_FOUND when no headers match at all', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Name', 'Email', 'Phone']] },
      });

      await expect(
        resolver.resolve('test-id', {
          semantic: { sheet: 'Sheet1', column: 'Address', includeHeader: true },
        })
      ).rejects.toThrow(RangeResolutionError);

      try {
        await resolver.resolve('test-id', {
          semantic: { sheet: 'Sheet1', column: 'Address', includeHeader: true },
        });
      } catch (error) {
        expect((error as RangeResolutionError).code).toBe('RANGE_NOT_FOUND');
        expect((error as RangeResolutionError).details?.['available']).toContain('Name');
      }
    });

    it('should respect includeHeader option', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Name', 'Email']] },
      });

      const withHeader = await resolver.resolve('test-id', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: true },
      });

      const withoutHeader = await resolver.resolve('test-id', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: false },
      });

      // With header should start at row 1
      expect(withHeader.a1Notation).toMatch(/A1:/);
      // Without header should start at row 2
      expect(withoutHeader.a1Notation).toMatch(/A2:/);
    });
  });

  describe('Grid range resolution', () => {
    it('should resolve grid coordinates', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 123, title: 'DataSheet' } }],
        },
      });

      const result = await resolver.resolve('test-id', {
        grid: {
          sheetId: 123,
          startRowIndex: 0,
          endRowIndex: 10,
          startColumnIndex: 0,
          endColumnIndex: 3,
        },
      });

      expect(result.sheetId).toBe(123);
      expect(result.sheetName).toBe('DataSheet');
      expect(result.a1Notation).toContain('DataSheet');
    });

    it('should throw SHEET_NOT_FOUND for invalid sheetId', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      await expect(
        resolver.resolve('test-id', {
          grid: { sheetId: 999 },
        })
      ).rejects.toThrow(RangeResolutionError);
    });
  });

  describe('Cache behavior', () => {
    it('should cache headers', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Name', 'Email']] },
      });

      // First call
      await resolver.resolve('test-id', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: true },
      });

      // Second call - should use cache
      await resolver.resolve('test-id', {
        semantic: { sheet: 'Sheet1', column: 'Email', includeHeader: true },
      });

      // values.get should only be called once (cached)
      expect(mockApi.spreadsheets.values.get).toHaveBeenCalledTimes(1);
    });

    it('should clear cache on request', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Name', 'Email']] },
      });

      await resolver.resolve('test-id', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: true },
      });

      resolver.clearCache();

      await resolver.resolve('test-id', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: true },
      });

      // values.get should be called twice after cache clear
      expect(mockApi.spreadsheets.values.get).toHaveBeenCalledTimes(2);
    });

    it('should invalidate cache for specific spreadsheet', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['Name']] },
      });

      // Call for spreadsheet A
      await resolver.resolve('spreadsheet-a', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: true },
      });

      // Call for spreadsheet B
      await resolver.resolve('spreadsheet-b', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: true },
      });

      // Invalidate only spreadsheet A
      resolver.invalidateSpreadsheet('spreadsheet-a');

      // Call again - A should refetch, B should use cache
      await resolver.resolve('spreadsheet-a', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: true },
      });

      await resolver.resolve('spreadsheet-b', {
        semantic: { sheet: 'Sheet1', column: 'Name', includeHeader: true },
      });

      // A: 2 calls, B: 1 call = 3 total
      expect(mockApi.spreadsheets.values.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error conversion', () => {
    it('should convert RangeResolutionError to ErrorDetail', () => {
      const error = new RangeResolutionError('Test error', 'RANGE_NOT_FOUND', {
        available: ['Col1', 'Col2'],
      });

      const detail = error.toErrorDetail();

      expect(detail.code).toBe('RANGE_NOT_FOUND');
      expect(detail.message).toBe('Test error');
      expect(detail.details).toEqual({ available: ['Col1', 'Col2'] });
      expect(detail.retryable).toBe(false);
    });
  });
});
