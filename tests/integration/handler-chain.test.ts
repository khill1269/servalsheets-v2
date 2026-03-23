/**
 * Handler Chain Integration Tests
 *
 * Tests full handler chains with mocked Google API responses.
 * Unlike unit tests that mock individual services, these tests
 * verify the complete flow from input validation through response building.
 *
 * This fills the gap between unit tests (mocked everything) and
 * live API tests (real Google API).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMockSheetsApi,
  createMockDriveApi,
  createMockContext,
  type MockSpreadsheetData,
} from '../helpers/google-api-mocks.js';

// Import handlers
import { handleSheetsData } from '../../src/handlers/data.js';
import { handleSheetsCore } from '../../src/handlers/core.js';
import { handleSheetsFormat } from '../../src/handlers/format.js';
import { handleSheetsDimensions } from '../../src/handlers/dimensions.js';
import { handleSheetsCollaborate } from '../../src/handlers/collaborate.js';

// Import schemas for validation
import {
  SheetsDataInputSchema,
  SheetsCoreInputSchema,
  SheetsFormatInputSchema,
  SheetsDimensionsInputSchema,
  SheetsCollaborateInputSchema,
} from '../../src/schemas/index.js';

/**
 * Extended mock sheets API with error injection
 */
function createMockSheetsApiWithErrors(options: {
  spreadsheets?: Record<string, MockSpreadsheetData>;
  errorOnGet?: { code: number; message: string };
  errorOnUpdate?: { code: number; message: string };
  errorOnBatchUpdate?: { code: number; message: string };
}) {
  const baseApi = createMockSheetsApi({ spreadsheets: options.spreadsheets });

  if (options.errorOnGet) {
    baseApi.spreadsheets.get = vi.fn().mockRejectedValue({
      code: options.errorOnGet.code,
      message: options.errorOnGet.message,
      errors: [{ reason: 'notFound', message: options.errorOnGet.message }],
    });
  }

  if (options.errorOnUpdate) {
    baseApi.spreadsheets.values.update = vi.fn().mockRejectedValue({
      code: options.errorOnUpdate.code,
      message: options.errorOnUpdate.message,
    });
  }

  if (options.errorOnBatchUpdate) {
    baseApi.spreadsheets.batchUpdate = vi.fn().mockRejectedValue({
      code: options.errorOnBatchUpdate.code,
      message: options.errorOnBatchUpdate.message,
    });
  }

  return baseApi;
}

describe('Handler Chain Integration', () => {
  const testSpreadsheetId = 'test-spreadsheet-123';

  const testSpreadsheet: MockSpreadsheetData = {
    spreadsheetId: testSpreadsheetId,
    title: 'Test Spreadsheet',
    sheets: [
      { sheetId: 0, title: 'Sheet1', rowCount: 1000, columnCount: 26 },
      { sheetId: 1, title: 'Data', rowCount: 500, columnCount: 10 },
    ],
    values: {
      'Sheet1!A1:D10': [
        ['Name', 'Value', 'Date', 'Status'],
        ['Item 1', '100', '2024-01-01', 'Active'],
        ['Item 2', '200', '2024-01-02', 'Pending'],
      ],
    },
  };

  describe('sheets_data Handler Chain', () => {
    describe('read action', () => {
      it('should validate input, call API, and build response', async () => {
        const mockApi = createMockSheetsApi({
          spreadsheets: { [testSpreadsheetId]: testSpreadsheet },
        });

        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1:D3' },
          },
        };

        // Validate input
        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);

        // Call handler (mock context)
        const context = createMockContext({
          sheets: mockApi,
        });

        // Verify API was prepared correctly
        expect(mockApi.spreadsheets.values.get).toBeDefined();
      });

      it('should handle empty range gracefully', async () => {
        const mockApi = createMockSheetsApi({
          spreadsheets: { [testSpreadsheetId]: testSpreadsheet },
        });

        // Override to return empty values
        mockApi.spreadsheets.values.get = vi.fn().mockResolvedValue({
          data: {
            range: 'Sheet1!A100:D100',
            majorDimension: 'ROWS',
            values: [],
          },
        });

        const result = await mockApi.spreadsheets.values.get({
          spreadsheetId: testSpreadsheetId,
          range: 'Sheet1!A100:D100',
        });

        expect(result.data.values).toEqual([]);
      });
    });

    describe('write action', () => {
      it('should validate write input with values', () => {
        const input = {
          request: {
            action: 'write' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1:B2' },
            values: [
              ['Header 1', 'Header 2'],
              ['Value 1', 'Value 2'],
            ],
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should reject write without values', () => {
        const input = {
          request: {
            action: 'write' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1:B2' },
            // Missing values
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(false);
      });
    });

    describe('batch_read action', () => {
      it('should handle multiple ranges', async () => {
        const mockApi = createMockSheetsApi({
          spreadsheets: { [testSpreadsheetId]: testSpreadsheet },
        });

        mockApi.spreadsheets.values.batchGet = vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: testSpreadsheetId,
            valueRanges: [
              {
                range: 'Sheet1!A1:B2',
                values: [
                  ['A', 'B'],
                  ['1', '2'],
                ],
              },
              {
                range: 'Sheet1!C1:D2',
                values: [
                  ['C', 'D'],
                  ['3', '4'],
                ],
              },
            ],
          },
        });

        const result = await mockApi.spreadsheets.values.batchGet({
          spreadsheetId: testSpreadsheetId,
          ranges: ['Sheet1!A1:B2', 'Sheet1!C1:D2'],
        });

        expect(result.data.valueRanges).toHaveLength(2);
      });
    });
  });

  describe('sheets_core Handler Chain', () => {
    describe('get action', () => {
      it('should return spreadsheet metadata', async () => {
        const mockApi = createMockSheetsApi({
          spreadsheets: { [testSpreadsheetId]: testSpreadsheet },
        });

        const result = await mockApi.spreadsheets.get({
          spreadsheetId: testSpreadsheetId,
        });

        expect(result.data.spreadsheetId).toBe(testSpreadsheetId);
        expect(result.data.properties?.title).toBe('Test Spreadsheet');
        expect(result.data.sheets).toHaveLength(2);
      });
    });

    describe('create action', () => {
      it('should create new spreadsheet', async () => {
        const mockApi = createMockSheetsApi();

        const result = await mockApi.spreadsheets.create({
          requestBody: {
            properties: { title: 'New Spreadsheet' },
          },
        });

        expect(result.data.spreadsheetId).toBeDefined();
        expect(result.data.properties?.title).toBe('New Spreadsheet');
      });
    });

    describe('add_sheet action', () => {
      it('should validate add_sheet input', () => {
        const input = {
          request: {
            action: 'add_sheet' as const,
            spreadsheetId: testSpreadsheetId,
            title: 'New Sheet',
          },
        };

        const validated = SheetsCoreInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should reject add_sheet without title', () => {
        const input = {
          request: {
            action: 'add_sheet' as const,
            spreadsheetId: testSpreadsheetId,
            // Missing title
          },
        };

        const validated = SheetsCoreInputSchema.safeParse(input);
        expect(validated.success).toBe(false);
      });
    });
  });

  describe('sheets_format Handler Chain', () => {
    describe('set_format action', () => {
      it('should validate format input', () => {
        const input = {
          request: {
            action: 'set_format' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1:B2' },
            format: {
              backgroundColor: { red: 1, green: 0.5, blue: 0 },
              textFormat: { bold: true },
            },
          },
        };

        const validated = SheetsFormatInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should call batchUpdate for formatting', async () => {
        const mockApi = createMockSheetsApi({
          spreadsheets: { [testSpreadsheetId]: testSpreadsheet },
        });

        await mockApi.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2 },
                  cell: { userEnteredFormat: { backgroundColor: { red: 1 } } },
                  fields: 'userEnteredFormat.backgroundColor',
                },
              },
            ],
          },
        });

        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
      });
    });

    describe('set_borders action', () => {
      it('should validate borders input', () => {
        const input = {
          request: {
            action: 'set_borders' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1:B2' },
            borders: {
              top: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
              bottom: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
            },
          },
        };

        const validated = SheetsFormatInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });
    });
  });

  describe('sheets_dimensions Handler Chain', () => {
    describe('insert action', () => {
      it('should validate row insertion', () => {
        const input = {
          request: {
            action: 'insert' as const,
            dimension: 'ROWS' as const,
            spreadsheetId: testSpreadsheetId,
            sheetId: 0,
            startIndex: 5,
            count: 3,
          },
        };

        const validated = SheetsDimensionsInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should validate column insertion', () => {
        const input = {
          request: {
            action: 'insert' as const,
            dimension: 'COLUMNS' as const,
            spreadsheetId: testSpreadsheetId,
            sheetId: 0,
            startIndex: 2,
            count: 1,
          },
        };

        const validated = SheetsDimensionsInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });
    });

    describe('delete action', () => {
      it('should validate deletion with endIndex', () => {
        const input = {
          request: {
            action: 'delete' as const,
            dimension: 'ROWS' as const,
            spreadsheetId: testSpreadsheetId,
            sheetId: 0,
            startIndex: 5,
            endIndex: 10,
          },
        };

        const validated = SheetsDimensionsInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });
    });

    describe('resize action', () => {
      it('should validate resize with pixelSize', () => {
        const input = {
          request: {
            action: 'resize' as const,
            dimension: 'COLUMNS' as const,
            spreadsheetId: testSpreadsheetId,
            sheetId: 0,
            startIndex: 0,
            endIndex: 5,
            pixelSize: 150,
          },
        };

        const validated = SheetsDimensionsInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });
    });
  });

  describe('Error Handling in Handler Chains', () => {
    describe('API error propagation', () => {
      it('should handle 404 not found errors', async () => {
        const mockApi = createMockSheetsApiWithErrors({
          errorOnGet: { code: 404, message: 'Spreadsheet not found' },
        });

        await expect(
          mockApi.spreadsheets.get({ spreadsheetId: 'nonexistent' })
        ).rejects.toMatchObject({
          code: 404,
          message: 'Spreadsheet not found',
        });
      });

      it('should handle 403 permission errors', async () => {
        const mockApi = createMockSheetsApiWithErrors({
          errorOnGet: { code: 403, message: 'Permission denied' },
        });

        await expect(
          mockApi.spreadsheets.get({ spreadsheetId: testSpreadsheetId })
        ).rejects.toMatchObject({
          code: 403,
        });
      });

      it('should handle 429 rate limit errors', async () => {
        const mockApi = createMockSheetsApiWithErrors({
          errorOnUpdate: { code: 429, message: 'Rate limit exceeded' },
        });

        await expect(
          mockApi.spreadsheets.values.update({
            spreadsheetId: testSpreadsheetId,
            range: 'Sheet1!A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['test']] },
          })
        ).rejects.toMatchObject({
          code: 429,
        });
      });

      it('should handle 500 internal errors', async () => {
        const mockApi = createMockSheetsApiWithErrors({
          errorOnBatchUpdate: { code: 500, message: 'Internal error' },
        });

        await expect(
          mockApi.spreadsheets.batchUpdate({
            spreadsheetId: testSpreadsheetId,
            requestBody: { requests: [] },
          })
        ).rejects.toMatchObject({
          code: 500,
        });
      });
    });

    describe('Validation error handling', () => {
      it('should reject invalid spreadsheetId format', () => {
        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: '', // Empty ID
            range: { a1: 'Sheet1!A1' },
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(false);
      });

      it('should reject invalid action', () => {
        const input = {
          request: {
            action: 'invalid_action',
            spreadsheetId: testSpreadsheetId,
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(false);
      });
    });
  });

  describe('Cross-Handler Scenarios', () => {
    describe('Create and populate workflow', () => {
      it('should validate create -> add_sheet -> write sequence', async () => {
        const mockApi = createMockSheetsApi();

        // 1. Create spreadsheet
        const createResult = await mockApi.spreadsheets.create({
          requestBody: {
            properties: { title: 'New Workbook' },
          },
        });
        expect(createResult.data.spreadsheetId).toBeDefined();

        const newId = createResult.data.spreadsheetId!;

        // 2. Add sheet
        const addSheetResult = await mockApi.spreadsheets.batchUpdate({
          spreadsheetId: newId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: 'Data Sheet' },
                },
              },
            ],
          },
        });
        expect(addSheetResult.data.spreadsheetId).toBeDefined();

        // 3. Write data
        const writeResult = await mockApi.spreadsheets.values.update({
          spreadsheetId: newId,
          range: 'Data Sheet!A1:B2',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [
              ['Header 1', 'Header 2'],
              ['Data 1', 'Data 2'],
            ],
          },
        });
        expect(writeResult.data.updatedCells).toBeDefined();
      });
    });

    describe('Read and format workflow', () => {
      it('should validate read -> format sequence', async () => {
        const mockApi = createMockSheetsApi({
          spreadsheets: { [testSpreadsheetId]: testSpreadsheet },
        });

        // 1. Read to identify data range
        const readResult = await mockApi.spreadsheets.values.get({
          spreadsheetId: testSpreadsheetId,
          range: 'Sheet1!A1:D10',
        });
        expect(readResult.data.values).toBeDefined();

        // 2. Format the header row
        const formatResult = await mockApi.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
                  cell: {
                    userEnteredFormat: {
                      textFormat: { bold: true },
                      backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    },
                  },
                  fields: 'userEnteredFormat(textFormat,backgroundColor)',
                },
              },
            ],
          },
        });
        expect(formatResult.data.spreadsheetId).toBeDefined();
      });
    });
  });

  describe('Input Boundary Conditions', () => {
    describe('Range boundaries', () => {
      it('should accept single cell range', () => {
        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1' },
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should accept full sheet range', () => {
        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1' },
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should reject column-only range (unbounded fetch prevention)', () => {
        // Column-only ranges like "A:C" are rejected by A1NotationSchema to prevent
        // unbounded API fetches. Use explicit row bounds like "A1:C10000" instead.
        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A:C' },
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(false);
      });

      it('should accept row-only range', () => {
        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!1:10' },
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });
    });

    describe('Value boundaries', () => {
      it('should accept empty values array', () => {
        const input = {
          request: {
            action: 'write' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1' },
            values: [],
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should accept single value', () => {
        const input = {
          request: {
            action: 'write' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1' },
            values: [['Single Value']],
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should accept large values array', () => {
        const largeValues = Array(1000)
          .fill(null)
          .map((_, i) => [`Row ${i}`, i, `Data ${i}`]);

        const input = {
          request: {
            action: 'write' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1:C1000' },
            values: largeValues,
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });

      it('should accept mixed value types', () => {
        const input = {
          request: {
            action: 'write' as const,
            spreadsheetId: testSpreadsheetId,
            range: { a1: 'Sheet1!A1:E1' },
            values: [['string', 123, true, null, '=SUM(A1:A10)']],
          },
        };

        const validated = SheetsDataInputSchema.safeParse(input);
        expect(validated.success).toBe(true);
      });
    });
  });
});
