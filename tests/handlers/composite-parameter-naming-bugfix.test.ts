/**
 * Composite Handler - Parameter Naming Bug Fix Tests (Phase 0.10)
 *
 * Tests for bug: Unhelpful error messages when wrong parameter names used
 * Evidence from test log:
 * - Tried: {action: "smart_append", sheetName: "Sheet1"} - FAILED
 * - Error: "expected string, received undefined" (doesn't say which field)
 * - Second try: {action: "smart_append", sheet: "Sheet1"} - WORKED
 *
 * Root cause: Zod validation errors don't include field names in messages
 * Fix: Enhance error messages to clearly indicate expected parameter names
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompositeHandler } from '../../src/handlers/composite.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import { CompositeInputSchema } from '../../src/schemas/composite.js';

describe('CompositeHandler - Parameter Naming (BUG FIX 0.10)', () => {
  let handler: CompositeHandler;
  let mockContext: HandlerContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockSheetsApi: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockDriveApi: any;

  beforeEach(() => {
    // Create mock Google APIs
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'test-id',
            properties: { title: 'Test Sheet' },
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'Sheet1',
                  index: 0,
                  gridProperties: { rowCount: 1000, columnCount: 26 },
                },
              },
            ],
          },
        }),
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              values: [
                ['Header1', 'Header2'],
                ['Value1', 'Value2'],
              ],
            },
          }),
          clear: vi.fn().mockResolvedValue({ data: { clearedRange: 'Sheet1!A:Z' } }),
          update: vi.fn().mockResolvedValue({ data: {} }),
          append: vi.fn().mockResolvedValue({ data: {} }),
        },
        batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
      },
    };

    mockDriveApi = {
      files: {
        export: vi.fn().mockResolvedValue({ data: Buffer.from('mock xlsx') }),
        create: vi.fn().mockResolvedValue({
          data: { id: 'new-spreadsheet-id', name: 'Imported' },
        }),
      },
    };

    // Create mock context
    mockContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock client type
      googleClient: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock API type
      sheetsApi: mockSheetsApi as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock API type
      driveApi: mockDriveApi as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock auth type
      authClient: { credentials: { access_token: 'test-token' } } as any,
      authService: {
        isAuthenticated: vi.fn().mockReturnValue(true),
        getClient: vi.fn().mockResolvedValue({}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock service type
      } as any,
      rangeResolver: {
        resolve: vi.fn().mockResolvedValue({
          a1Notation: 'Sheet1!A1:A5',
          sheetId: 0,
          sheetName: 'Sheet1',
          gridRange: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 5,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          resolution: {
            method: 'a1_direct',
            confidence: 1.0,
            path: '',
          },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock resolver type
      } as any,
    };

    handler = new CompositeHandler(mockContext);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('parameter naming consistency (BUG FIX 0.10)', () => {
    it('should normalize import_csv sheetName to newSheetName during schema parsing', () => {
      const parsed = CompositeInputSchema.parse({
        request: {
          action: 'import_csv',
          spreadsheetId: 'test-id',
          sheetName: 'Imported CSV',
          csvData: 'Header1,Header2\nValue1,Value2',
        },
      });

      expect(parsed.request.action).toBe('import_csv');
      if (parsed.request.action === 'import_csv') {
        expect(parsed.request.newSheetName).toBe('Imported CSV');
      }
    });

    it('should reject sheetName parameter with helpful error', async () => {
      // Try using sheetName instead of sheet (common mistake)
      const result = await handler.handle({
        request: {
          action: 'smart_append',
          spreadsheetId: 'test-id',
          // @ts-expect-error - Testing invalid parameter
          sheetName: 'Sheet1', // Wrong parameter name
          data: [{ col1: 'value1' }],
        },
      });

      // Should return error
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();

      // BUG FIX 0.10: Error message should mention the correct parameter name
      const errorMessage = result.response.error?.message.toLowerCase();
      expect(errorMessage?.includes('sheet') || errorMessage?.includes('parameter')).toBe(true);
    });

    it('should accept sheet parameter correctly', async () => {
      const result = await handler.handle({
        request: {
          action: 'smart_append',
          spreadsheetId: 'test-id',
          sheet: 'Sheet1', // Correct parameter name
          data: [{ col1: 'value1' }],
        },
      });

      // Should succeed (mock will handle the actual operation)
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('should use sheet parameter for import_csv', async () => {
      const result = await handler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: 'test-id',
          sheet: 'Sheet1',
          csvData: 'Header1,Header2\nValue1,Value2',
        },
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('should treat import_csv sheetName as a newSheetName alias when creating a sheet', async () => {
      const authorizedContext = {
        ...mockContext,
        auth: {
          hasElevatedAccess: false,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file',
          ],
        },
      };
      const importHandler = new CompositeHandler(
        authorizedContext,
        mockSheetsApi,
        mockDriveApi
      );
      const result = await importHandler.handle({
        request: {
          action: 'import_csv',
          spreadsheetId: 'test-id',
          // @ts-expect-error - Testing legacy alias that bypasses schema parsing in direct handler tests
          sheetName: 'Imported CSV',
          csvData: 'Header1,Header2\nValue1,Value2',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.sheetName).toBe('Imported CSV');
      }
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: 'Imported CSV' },
                },
              },
            ],
          },
        })
      );
    });

    it('should use sheet parameter for bulk_update', async () => {
      const result = await handler.handle({
        request: {
          action: 'bulk_update',
          spreadsheetId: 'test-id',
          sheet: 'Sheet1',
          keyColumn: 'ID',
          updates: [{ ID: '1', Name: 'Updated' }],
        },
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('should use sheet parameter for deduplicate', async () => {
      const result = await handler.handle({
        request: {
          action: 'deduplicate',
          spreadsheetId: 'test-id',
          sheet: 'Sheet1',
          keyColumns: ['Email'],
        },
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('should use sheetName parameter for setup_sheet (different action)', async () => {
      // setup_sheet uses sheetName because it's creating a NEW sheet
      // This is intentional - new sheet name vs existing sheet reference
      const result = await handler.handle({
        request: {
          action: 'setup_sheet',
          spreadsheetId: 'test-id',
          sheetName: 'NewSheet', // Correct for setup_sheet
          headers: ['Col1', 'Col2'],
        },
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe('regression tests', () => {
    it('should handle unknown action gracefully', async () => {
      const result = await handler.handle({
        request: {
          // @ts-expect-error - Testing invalid action
          action: 'invalid_action',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should handle missing spreadsheetId', async () => {
      const result = await handler.handle({
        request: {
          action: 'smart_append',
          // @ts-expect-error - Testing missing required field
          sheet: 'Sheet1',
          data: [{ col1: 'value1' }],
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });
});
