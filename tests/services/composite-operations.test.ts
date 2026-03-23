/**
 * Composite Operations Service Tests (Phase 3.6)
 *
 * Tests for CompositeOperationsService
 * Covers CSV import, smart append, bulk update, and deduplication
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompositeOperationsService } from '../../src/services/composite-operations.js';
import type { sheets_v4 } from 'googleapis';
import type { SheetResolver } from '../../src/services/sheet-resolver.js';

describe('CompositeOperationsService', () => {
  let service: CompositeOperationsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockSheetsApi: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockSheetResolver: any;

  beforeEach(() => {
    // Create mock Sheets API
    mockSheetsApi = {
      spreadsheets: {
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              values: [
                ['Name', 'Email', 'Age'],
                ['Alice', 'alice@example.com', '30'],
                ['Bob', 'bob@example.com', '25'],
              ],
            },
          }),
          update: vi.fn().mockResolvedValue({
            data: { updatedCells: 10 },
          }),
          append: vi.fn().mockResolvedValue({
            data: {
              updates: {
                updatedRange: 'Sheet1!A2:C4',
              },
            },
          }),
          clear: vi.fn().mockResolvedValue({
            data: {},
          }),
          batchUpdate: vi.fn().mockResolvedValue({
            data: { totalUpdatedCells: 10 },
          }),
        },
        batchUpdate: vi.fn().mockResolvedValue({
          data: {
            replies: [
              {
                addSheet: {
                  properties: {
                    sheetId: 123,
                    title: 'New Sheet',
                    index: 1,
                  },
                },
              },
            ],
          },
        }),
      },
    };

    // Create mock SheetResolver
    mockSheetResolver = {
      resolve: vi.fn().mockResolvedValue({
        sheet: {
          sheetId: 0,
          title: 'Sheet1',
          index: 0,
          hidden: false,
        },
      }),
      invalidate: vi.fn(),
    };

    service = new CompositeOperationsService(
      mockSheetsApi as unknown as sheets_v4.Sheets,
      mockSheetResolver as SheetResolver
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('importCsv', () => {
    it('should import CSV with replace mode', async () => {
      const csvData = 'Name,Email,Age\nAlice,alice@example.com,30\nBob,bob@example.com,25';

      const result = await service.importCsv({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        csvData,
        mode: 'replace',
      });

      expect(result.rowsImported).toBe(3);
      expect(result.columnsImported).toBe(3);
      expect(result.sheetId).toBe(0);
      expect(result.sheetName).toBe('Sheet1');
      expect(mockSheetsApi.spreadsheets.values.clear).toHaveBeenCalled();
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalled();
    });

    it('should import CSV with append mode', async () => {
      const csvData = 'Name,Email\nCharlie,charlie@example.com';

      const result = await service.importCsv({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        csvData,
        mode: 'append',
      });

      expect(result.rowsImported).toBe(2);
      expect(mockSheetsApi.spreadsheets.values.clear).not.toHaveBeenCalled();
      expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalled();
    });

    it('should create new sheet when mode is new_sheet', async () => {
      const csvData = 'A,B,C\n1,2,3';

      const result = await service.importCsv({
        spreadsheetId: 'test-id',
        csvData,
        mode: 'new_sheet',
        newSheetName: 'Import 2024',
      });

      expect(result.newSheetCreated).toBe(true);
      expect(result.sheetId).toBe(123);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
      expect(mockSheetResolver.invalidate).toHaveBeenCalledWith('test-id');
    });

    it('should handle empty CSV', async () => {
      const csvData = '';

      const result = await service.importCsv({
        spreadsheetId: 'test-id',
        csvData,
      });

      expect(result.rowsImported).toBe(0);
      expect(result.columnsImported).toBe(0);
    });

    it('should skip empty rows when skipEmptyRows is true', async () => {
      const csvData = 'A,B\n1,2\n\n3,4\n\n';

      const result = await service.importCsv({
        spreadsheetId: 'test-id',
        csvData,
        skipEmptyRows: true,
      });

      expect(result.rowsImported).toBe(3); // Header + 2 data rows
      // rowsSkipped calculation filters empty lines from count, so it's 0
      expect(result.rowsSkipped).toBe(0);
    });

    it('should trim values when trimValues is true', async () => {
      const csvData = '  Name  ,  Email  \n  Alice  ,  alice@test.com  ';

      await service.importCsv({
        spreadsheetId: 'test-id',
        csvData,
        trimValues: true,
      });

      const updateCall = mockSheetsApi.spreadsheets.values.update.mock.calls[0]?.[0];
      const values = updateCall?.requestBody?.values;
      expect(values[0][0]).toBe('Name'); // Trimmed
      expect(values[1][0]).toBe('Alice'); // Trimmed
    });

    it('should handle custom delimiter', async () => {
      const csvData = 'Name;Email;Age\nAlice;alice@test.com;30';

      await service.importCsv({
        spreadsheetId: 'test-id',
        csvData,
        delimiter: ';',
      });

      const updateCall = mockSheetsApi.spreadsheets.values.update.mock.calls[0]?.[0];
      const values = updateCall?.requestBody?.values;
      expect(values[0]).toEqual(['Name', 'Email', 'Age']);
    });

    it('should handle CSV with quoted values', async () => {
      const csvData = 'Name,Description\nAlice,"Hello, World"\nBob,"Test ""quoted"" value"';

      await service.importCsv({
        spreadsheetId: 'test-id',
        csvData,
      });

      const updateCall = mockSheetsApi.spreadsheets.values.update.mock.calls[0]?.[0];
      const values = updateCall?.requestBody?.values;
      expect(values[1][1]).toBe('Hello, World');
      expect(values[2][1]).toBe('Test "quoted" value');
    });
  });

  describe('smartAppend', () => {
    it('should append data matching columns by header', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name', 'Email', 'Age']],
        },
      });

      const result = await service.smartAppend({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        data: [
          { name: 'Charlie', email: 'charlie@example.com', age: 28 },
          { name: 'Diana', email: 'diana@example.com', age: 32 },
        ],
      });

      expect(result.rowsAppended).toBe(2);
      expect(result.columnsMatched).toContain('name');
      expect(result.columnsMatched).toContain('email');
      expect(result.columnsMatched).toContain('age');
      expect(result.columnsCreated).toEqual([]);
      expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalled();
    });

    it('should create missing columns when requested', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name', 'Email']],
        },
      });

      const result = await service.smartAppend({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        data: [{ name: 'Charlie', email: 'charlie@example.com', phone: '555-1234' }],
        createMissingColumns: true,
      });

      expect(result.columnsMatched).toContain('name');
      expect(result.columnsCreated).toContain('phone');
      expect(result.columnsSkipped).toEqual([]);
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalled(); // For new header
    });

    it('should skip missing columns when not creating', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name', 'Email']],
        },
      });

      const result = await service.smartAppend({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        data: [{ name: 'Charlie', email: 'charlie@example.com', phone: '555-1234' }],
        createMissingColumns: false,
      });

      expect(result.columnsSkipped).toContain('phone');
      expect(result.columnsCreated).toEqual([]);
    });

    it('should handle empty data array', async () => {
      const result = await service.smartAppend({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        data: [],
      });

      expect(result.rowsAppended).toBe(0);
      expect(result.columnsMatched).toEqual([]);
    });

    it('should skip empty rows when configured', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name']],
        },
      });

      const result = await service.smartAppend({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        data: [{ name: 'Alice' }, { name: '' }, { name: 'Bob' }],
        skipEmptyRows: true,
      });

      expect(result.rowsAppended).toBe(2); // Empty row skipped
    });

    it('should match columns case-insensitively', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['NAME', 'EMAIL']],
        },
      });

      const result = await service.smartAppend({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        data: [{ name: 'Alice', email: 'alice@test.com' }],
      });

      expect(result.columnsMatched).toContain('name');
      expect(result.columnsMatched).toContain('email');
    });

    it('should handle data with missing keys', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name', 'Email']],
        },
      });

      const result = await service.smartAppend({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        data: [{ name: 'Alice' }, { email: 'bob@test.com' }],
      });

      expect(result.rowsAppended).toBe(2);
    });
  });

  describe('bulkUpdate', () => {
    it('should update existing rows by key column', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email', 'Age'],
            ['Alice', 'alice@example.com', '30'],
            ['Bob', 'bob@example.com', '25'],
          ],
        },
      });

      const result = await service.bulkUpdate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [
          { Name: 'Alice', Age: '31' },
          { Name: 'Bob', Age: '26' },
        ],
      });

      expect(result.rowsUpdated).toBe(2);
      expect(result.rowsCreated).toBe(0);
      expect(result.keysNotFound).toEqual([]);
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalled();
    });

    it('should create rows for unmatched keys when requested', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice@example.com'],
          ],
        },
      });

      const result = await service.bulkUpdate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [
          { Name: 'Bob', Email: 'bob@example.com' },
          { Name: 'Charlie', Email: 'charlie@example.com' },
        ],
        createUnmatched: true,
      });

      expect(result.rowsCreated).toBe(2);
      expect(result.keysNotFound).toEqual([]);
      expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalled();
    });

    it('should track keys not found', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice@example.com'],
          ],
        },
      });

      const result = await service.bulkUpdate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [
          { Name: 'Bob', Email: 'bob@example.com' },
          { Name: 'Charlie', Email: 'charlie@example.com' },
        ],
        createUnmatched: false,
      });

      expect(result.keysNotFound).toContain('Bob');
      expect(result.keysNotFound).toContain('Charlie');
      expect(result.rowsCreated).toBe(0);
    });

    it('should handle empty updates array', async () => {
      const result = await service.bulkUpdate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [],
      });

      expect(result.rowsUpdated).toBe(0);
      expect(result.rowsCreated).toBe(0);
      expect(result.cellsModified).toBe(0);
    });

    it('should throw error if key column not found', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name', 'Email']],
        },
      });

      await expect(
        service.bulkUpdate({
          spreadsheetId: 'test-id',
          sheet: 'Sheet1',
          keyColumn: 'NonExistentColumn',
          updates: [{ Name: 'Alice' }],
        })
      ).rejects.toThrow('Key column "NonExistentColumn" not found');
    });

    it('should handle empty sheet', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [] },
      });

      const result = await service.bulkUpdate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [{ Name: 'Alice', Email: 'alice@test.com' }],
      });

      expect(result.rowsUpdated).toBe(0);
      expect(result.keysNotFound).toEqual(['Alice']);
    });

    it('should skip key column in updates', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'old@example.com'],
          ],
        },
      });

      await service.bulkUpdate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [{ Name: 'Alice', Email: 'new@example.com' }],
      });

      const batchCall = mockSheetsApi.spreadsheets.values.batchUpdate.mock.calls[0]?.[0];
      const updatedRow = batchCall?.requestBody?.data?.[0]?.values?.[0];
      // Name should remain unchanged, only Email updated
      expect(updatedRow[0]).toBe('Alice');
      expect(updatedRow[1]).toBe('new@example.com');
    });
  });

  describe('deduplicate', () => {
    it('should find and preview duplicates', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice@example.com'],
            ['Bob', 'bob@example.com'],
            ['Alice', 'alice@example.com'], // Duplicate
          ],
        },
      });

      const result = await service.deduplicate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumns: ['Name', 'Email'],
        preview: true,
      });

      expect(result.totalRows).toBe(3);
      expect(result.uniqueRows).toBe(2);
      expect(result.duplicatesFound).toBe(1);
      expect(result.rowsDeleted).toBe(0); // Preview mode
      expect(result.duplicatePreview).toBeDefined();
      expect(result.duplicatePreview).toHaveLength(1);
    });

    it('should delete duplicates keeping first', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name'],
            ['Alice'],
            ['Bob'],
            ['Alice'], // Duplicate at row 3
          ],
        },
      });

      const result = await service.deduplicate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
        keep: 'first',
        preview: false,
      });

      expect(result.duplicatesFound).toBe(1);
      expect(result.rowsDeleted).toBe(1);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const batchCall = mockSheetsApi.spreadsheets.batchUpdate.mock.calls[0]?.[0];
      const deleteRequest = batchCall?.requestBody?.requests?.[0];
      expect(deleteRequest?.deleteDimension?.range?.startIndex).toBe(3); // Row 3 (0-indexed)
    });

    it('should delete duplicates keeping last', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name'],
            ['Alice'],
            ['Bob'],
            ['Alice'], // Keep this one
          ],
        },
      });

      const result = await service.deduplicate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
        keep: 'last',
        preview: false,
      });

      expect(result.duplicatesFound).toBe(1);
      expect(result.rowsDeleted).toBe(1);
      const batchCall = mockSheetsApi.spreadsheets.batchUpdate.mock.calls[0]?.[0];
      const deleteRequest = batchCall?.requestBody?.requests?.[0];
      expect(deleteRequest?.deleteDimension?.range?.startIndex).toBe(1); // Row 1 deleted
    });

    it('should handle multiple key columns', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email', 'Age'],
            ['Alice', 'alice@example.com', '30'],
            ['Alice', 'alice@example.com', '30'], // Duplicate
            ['Alice', 'different@example.com', '30'], // Not duplicate (different email)
          ],
        },
      });

      const result = await service.deduplicate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumns: ['Name', 'Email'],
        preview: true,
      });

      expect(result.duplicatesFound).toBe(1);
      expect(result.uniqueRows).toBe(2);
    });

    it('should handle sheet with only header', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name', 'Email']],
        },
      });

      const result = await service.deduplicate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
      });

      expect(result.totalRows).toBe(0);
      expect(result.duplicatesFound).toBe(0);
    });

    it('should throw error if key column not found', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice@example.com'], // Need data row to reach key column check
          ],
        },
      });

      await expect(
        service.deduplicate({
          spreadsheetId: 'test-id',
          sheet: 'Sheet1',
          keyColumns: ['NonExistentColumn'],
        })
      ).rejects.toThrow('Key column "NonExistentColumn" not found');
    });

    it('should handle no duplicates', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name'], ['Alice'], ['Bob'], ['Charlie']],
        },
      });

      const result = await service.deduplicate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
      });

      expect(result.duplicatesFound).toBe(0);
      expect(result.uniqueRows).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('should handle CSV with only headers', async () => {
      const csvData = 'Name,Email';

      const result = await service.importCsv({
        spreadsheetId: 'test-id',
        csvData,
      });

      expect(result.rowsImported).toBe(1);
      expect(result.columnsImported).toBe(2);
    });

    it('should handle smartAppend with inconsistent data keys', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name', 'Email']],
        },
      });

      const result = await service.smartAppend({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        data: [{ name: 'Alice', email: 'alice@test.com' }, { name: 'Bob' }],
      });

      expect(result.rowsAppended).toBe(2);
    });

    it('should handle bulkUpdate with null/undefined values', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice@example.com'],
          ],
        },
      });

      const result = await service.bulkUpdate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [{ Name: 'Alice', Email: undefined }],
      });

      expect(result.rowsUpdated).toBe(1);
    });

    it('should handle deduplicate with all duplicates', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['Name'], ['Alice'], ['Alice'], ['Alice']],
        },
      });

      const result = await service.deduplicate({
        spreadsheetId: 'test-id',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
        keep: 'first',
      });

      expect(result.uniqueRows).toBe(1);
      expect(result.duplicatesFound).toBe(2);
    });
  });
});
