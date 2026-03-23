/**
 * Extended tests for Sheet Resolver Service
 *
 * Tests semantic range resolution, header matching, and named range handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/request-context.js', () => ({
  getRequestContext: vi.fn().mockReturnValue({ requestId: 'test-req-id' }),
}));

// Mock Google API
const mockSheetsGet = vi.fn();
const mockValuesGet = vi.fn();

vi.mock('../../src/services/google-api.js', () => ({
  GoogleApiClient: vi.fn().mockImplementation(() => ({
    sheets: {
      spreadsheets: {
        get: mockSheetsGet,
        values: {
          get: mockValuesGet,
        },
      },
    },
  })),
}));

import {
  SheetResolver,
  getSheetResolver,
  resetSheetResolver,
} from '../../src/services/sheet-resolver.js';

describe('SheetResolver', () => {
  let resolver: SheetResolver;
  let mockSheetsApi: any;

  beforeEach(() => {
    resetSheetResolver();
    vi.clearAllMocks();

    // Default mock responses
    mockSheetsGet.mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet',
        sheets: [
          {
            properties: { sheetId: 0, title: 'Sheet1' },
          },
          {
            properties: { sheetId: 1, title: 'Data' },
          },
        ],
        namedRanges: [
          {
            name: 'Revenue',
            range: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 10,
              startColumnIndex: 1,
              endColumnIndex: 2,
            },
          },
          {
            name: 'Expenses',
            range: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 10,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
          },
        ],
      },
    });

    mockValuesGet.mockResolvedValue({
      data: {
        values: [
          ['Name', 'Revenue', 'Expenses', 'Profit'],
          ['Q1', '100', '50', '50'],
          ['Q2', '150', '60', '90'],
        ],
      },
    });

    // Create mock API that matches the test expectations
    mockSheetsApi = {
      spreadsheets: {
        get: mockSheetsGet,
        values: {
          get: mockValuesGet,
        },
      },
    };

    resolver = new SheetResolver({ sheetsApi: mockSheetsApi });
  });

  afterEach(() => {
    resetSheetResolver();
  });

  describe('resolveRange', () => {
    it('should pass through A1 notation unchanged', async () => {
      const result = await resolver.resolveRange('test-spreadsheet', 'Sheet1!A1:B10', null as any);

      expect(result.resolvedRange).toBe('Sheet1!A1:B10');
      expect(result.wasResolved).toBe(false);
    });

    it('should resolve named range to A1 notation', async () => {
      const result = await resolver.resolveRange('test-spreadsheet', 'Revenue', null as any);

      expect(result.wasResolved).toBe(true);
      expect(result.originalInput).toBe('Revenue');
    });

    it('should resolve semantic column query', async () => {
      const result = await resolver.resolveRange(
        'test-spreadsheet',
        { semantic: { column: 'Revenue', sheet: 'Sheet1' } },
        null as any
      );

      expect(result.wasResolved).toBe(true);
      expect(result.resolvedRange).toContain('B'); // Revenue is column B
    });

    it('should handle unknown named range', async () => {
      await expect(
        resolver.resolveRange('test-spreadsheet', 'UnknownRange', null as any)
      ).rejects.toThrow();
    });
  });

  describe('getSheetByName', () => {
    it('should find sheet by exact name', async () => {
      const sheet = await resolver.getSheetByName('test-spreadsheet', 'Sheet1', null as any);

      expect(sheet).toBeDefined();
      expect(sheet?.properties?.title).toBe('Sheet1');
      expect(sheet?.properties?.sheetId).toBe(0);
    });

    it('should find sheet case-insensitively', async () => {
      const sheet = await resolver.getSheetByName('test-spreadsheet', 'sheet1', null as any);

      expect(sheet).toBeDefined();
      expect(sheet?.properties?.title).toBe('Sheet1');
    });

    it('should return undefined for unknown sheet', async () => {
      const sheet = await resolver.getSheetByName('test-spreadsheet', 'UnknownSheet', null as any);

      expect(sheet).toBeUndefined();
    });
  });

  describe('getSheetById', () => {
    it('should find sheet by ID', async () => {
      const sheet = await resolver.getSheetById('test-spreadsheet', 1, null as any);

      expect(sheet).toBeDefined();
      expect(sheet?.properties?.title).toBe('Data');
    });

    it('should return undefined for unknown sheet ID', async () => {
      const sheet = await resolver.getSheetById('test-spreadsheet', 999, null as any);

      expect(sheet).toBeUndefined();
    });
  });

  describe('getNamedRanges', () => {
    it('should return all named ranges', async () => {
      const namedRanges = await resolver.getNamedRanges('test-spreadsheet', null as any);

      expect(namedRanges.length).toBe(2);
      expect(namedRanges.map((nr) => nr.name)).toContain('Revenue');
      expect(namedRanges.map((nr) => nr.name)).toContain('Expenses');
    });
  });

  describe('findColumnByHeader', () => {
    it('should find column index by header name', async () => {
      const columnIndex = await resolver.findColumnByHeader(
        'test-spreadsheet',
        'Sheet1',
        'Revenue',
        null as any
      );

      expect(columnIndex).toBe(1); // B column = index 1
    });

    it('should find column case-insensitively', async () => {
      const columnIndex = await resolver.findColumnByHeader(
        'test-spreadsheet',
        'Sheet1',
        'revenue',
        null as any
      );

      expect(columnIndex).toBe(1);
    });

    it('should return -1 for unknown header', async () => {
      const columnIndex = await resolver.findColumnByHeader(
        'test-spreadsheet',
        'Sheet1',
        'UnknownColumn',
        null as any
      );

      expect(columnIndex).toBe(-1);
    });
  });

  describe('getHeaders', () => {
    it('should return first row as headers', async () => {
      const headers = await resolver.getHeaders('test-spreadsheet', 'Sheet1', null as any);

      expect(headers).toEqual(['Name', 'Revenue', 'Expenses', 'Profit']);
    });

    it('should handle empty sheet', async () => {
      mockValuesGet.mockResolvedValueOnce({ data: { values: [] } });

      const headers = await resolver.getHeaders('test-spreadsheet', 'EmptySheet', null as any);

      expect(headers).toEqual([]);
    });
  });

  describe('columnIndexToLetter', () => {
    it('should convert column index to letter', () => {
      expect(resolver.columnIndexToLetter(0)).toBe('A');
      expect(resolver.columnIndexToLetter(1)).toBe('B');
      expect(resolver.columnIndexToLetter(25)).toBe('Z');
      expect(resolver.columnIndexToLetter(26)).toBe('AA');
      expect(resolver.columnIndexToLetter(27)).toBe('AB');
      expect(resolver.columnIndexToLetter(701)).toBe('ZZ');
      expect(resolver.columnIndexToLetter(702)).toBe('AAA');
    });
  });

  describe('letterToColumnIndex', () => {
    it('should convert column letter to index', () => {
      expect(resolver.letterToColumnIndex('A')).toBe(0);
      expect(resolver.letterToColumnIndex('B')).toBe(1);
      expect(resolver.letterToColumnIndex('Z')).toBe(25);
      expect(resolver.letterToColumnIndex('AA')).toBe(26);
      expect(resolver.letterToColumnIndex('AB')).toBe(27);
      expect(resolver.letterToColumnIndex('ZZ')).toBe(701);
      expect(resolver.letterToColumnIndex('AAA')).toBe(702);
    });
  });

  describe('parseA1Notation', () => {
    it('should parse simple cell reference', () => {
      const parsed = resolver.parseA1Notation('A1');

      expect(parsed.startColumn).toBe('A');
      expect(parsed.startRow).toBe(1);
      expect(parsed.endColumn).toBeUndefined();
      expect(parsed.endRow).toBeUndefined();
    });

    it('should parse range reference', () => {
      const parsed = resolver.parseA1Notation('A1:C10');

      expect(parsed.startColumn).toBe('A');
      expect(parsed.startRow).toBe(1);
      expect(parsed.endColumn).toBe('C');
      expect(parsed.endRow).toBe(10);
    });

    it('should parse sheet-qualified reference', () => {
      const parsed = resolver.parseA1Notation('Sheet1!A1:B5');

      expect(parsed.sheetName).toBe('Sheet1');
      expect(parsed.startColumn).toBe('A');
      expect(parsed.startRow).toBe(1);
      expect(parsed.endColumn).toBe('B');
      expect(parsed.endRow).toBe(5);
    });

    it('should parse column-only range', () => {
      const parsed = resolver.parseA1Notation('A:C');

      expect(parsed.startColumn).toBe('A');
      expect(parsed.endColumn).toBe('C');
      expect(parsed.startRow).toBeUndefined();
      expect(parsed.endRow).toBeUndefined();
    });

    it('should parse row-only range', () => {
      const parsed = resolver.parseA1Notation('1:10');

      expect(parsed.startRow).toBe(1);
      expect(parsed.endRow).toBe(10);
      expect(parsed.startColumn).toBeUndefined();
      expect(parsed.endColumn).toBeUndefined();
    });

    it('should handle quoted sheet names with spaces', () => {
      const parsed = resolver.parseA1Notation("'My Sheet'!A1:B5");

      expect(parsed.sheetName).toBe('My Sheet');
    });
  });

  describe('buildA1Notation', () => {
    it('should build simple cell reference', () => {
      const a1 = resolver.buildA1Notation({ startColumn: 'A', startRow: 1 });
      expect(a1).toBe('A1');
    });

    it('should build range reference', () => {
      const a1 = resolver.buildA1Notation({
        startColumn: 'A',
        startRow: 1,
        endColumn: 'C',
        endRow: 10,
      });
      expect(a1).toBe('A1:C10');
    });

    it('should build sheet-qualified reference', () => {
      const a1 = resolver.buildA1Notation({
        sheetName: 'Sheet1',
        startColumn: 'A',
        startRow: 1,
        endColumn: 'B',
        endRow: 5,
      });
      expect(a1).toBe('Sheet1!A1:B5');
    });

    it('should quote sheet names with special characters', () => {
      const a1 = resolver.buildA1Notation({
        sheetName: 'My Sheet',
        startColumn: 'A',
        startRow: 1,
      });
      expect(a1).toBe("'My Sheet'!A1");
    });
  });

  describe('caching', () => {
    it('should cache spreadsheet metadata', async () => {
      await resolver.getSheetByName('test-spreadsheet', 'Sheet1', null as any);
      await resolver.getSheetByName('test-spreadsheet', 'Data', null as any);

      // Should only call API once due to caching
      expect(mockSheetsGet).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache when requested', async () => {
      await resolver.getSheetByName('test-spreadsheet', 'Sheet1', null as any);
      resolver.invalidateCache('test-spreadsheet');
      await resolver.getSheetByName('test-spreadsheet', 'Sheet1', null as any);

      expect(mockSheetsGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('singleton management', () => {
    it('should return same instance from getSheetResolver', () => {
      const instance1 = getSheetResolver();
      const instance2 = getSheetResolver();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton with resetSheetResolver', () => {
      const mockApi = {
        spreadsheets: {
          get: mockSheetsGet,
          values: { get: mockValuesGet },
        },
      };

      const instance1 = getSheetResolver({ sheetsApi: mockApi as any });
      resetSheetResolver();
      const instance2 = getSheetResolver({ sheetsApi: mockApi as any });
      expect(instance1).not.toBe(instance2);
    });
  });
});
