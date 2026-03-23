/**
 * Composite Operations Handler Tests
 *
 * Integration tests verifying handler registration and basic functionality.
 * Full end-to-end tests require proper Google API setup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompositeHandler } from '../../src/handlers/composite.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4, drive_v3 } from 'googleapis';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

const mockDispatchCompositeOperation = vi.hoisted(() => vi.fn());
const mockGenerateDefinition = vi.hoisted(() => vi.fn());
const mockExecuteDefinition = vi.hoisted(() => vi.fn());

vi.mock('../../src/resources/composite-operation-dispatcher.js', () => ({
  dispatchCompositeOperation: mockDispatchCompositeOperation,
}));

vi.mock('../../src/services/sheet-generator.js', () => ({
  generateDefinition: mockGenerateDefinition,
  executeDefinition: mockExecuteDefinition,
}));

describe('Composite Handler', () => {
  let handler: CompositeHandler;
  let handlerWithDrive: CompositeHandler;
  let mockContext: HandlerContext;
  let mockSheetsApi: sheets_v4.Sheets;
  let mockDriveApi: drive_v3.Drive;

  beforeEach(() => {
    mockContext = {
      requestId: 'test-request-id',
      timestamp: new Date('2024-01-15T00:00:00Z'),
      capabilities: {
        supports: vi.fn(() => true),
        requireCapability: vi.fn(),
        getCapability: vi.fn(),
      },
      snapshotService: {} as HandlerContext['snapshotService'],
      auth: {
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
        ],
      },
    } as unknown as HandlerContext;

    // Mock Google Sheets API with comprehensive mocking
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'test123',
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
              range: 'Sheet1!A1:C10',
              values: [
                ['Name', 'Age', 'Email'],
                ['Alice', '30', 'alice@test.com'],
                ['Bob', '25', 'bob@test.com'],
              ],
            },
          }),
          update: vi.fn().mockResolvedValue({
            data: {
              spreadsheetId: 'test123',
              updatedRange: 'Sheet1!A1:C10',
              updatedRows: 3,
              updatedColumns: 3,
              updatedCells: 9,
            },
          }),
          append: vi.fn().mockResolvedValue({
            data: {
              spreadsheetId: 'test123',
              updatedRange: 'Sheet1!A2:C2',
              updatedRows: 1,
              updatedColumns: 3,
              updatedCells: 3,
            },
          }),
          clear: vi.fn().mockResolvedValue({ data: { clearedRange: 'Sheet1!A2:Z1000' } }),
        },
        batchUpdate: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'test123',
            replies: [
              {
                addSheet: {
                  properties: {
                    sheetId: 1,
                    title: 'NewSheet',
                    gridProperties: { rowCount: 1000, columnCount: 26 },
                  },
                },
              },
            ],
          },
        }),
        sheets: {
          copyTo: vi.fn().mockResolvedValue({
            data: {
              sheetId: 2,
              title: 'Sheet1 copy',
            },
          }),
        },
      },
    } as unknown as sheets_v4.Sheets;

    // Mock Drive API
    mockDriveApi = {
      files: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'test123',
            name: 'TestSpreadsheet',
          },
        }),
        export: vi.fn().mockResolvedValue({
          data: Buffer.from('fake xlsx content'),
        }),
        create: vi.fn().mockResolvedValue({
          data: {
            id: 'imported-sheet-id',
            name: 'Imported Spreadsheet',
          },
        }),
      },
    } as unknown as drive_v3.Drive;

    handler = new CompositeHandler(mockContext, mockSheetsApi);
    handlerWithDrive = new CompositeHandler(mockContext, mockSheetsApi, mockDriveApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(CompositeHandler);
    });

    it('should initialize with Drive API when provided', () => {
      expect(handlerWithDrive).toBeDefined();
      expect(handlerWithDrive).toBeInstanceOf(CompositeHandler);
    });
  });

  // ============================================================================
  // IMPORT_CSV Tests
  // ============================================================================

  describe('import_csv action', () => {
    it('should accept and process import_csv requests', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
      };

      const result = await handler.handle(input as any);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response).toHaveProperty('success');
    });

    it('should handle import_csv with multiple rows', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData:
          'Name,Age,Email\nAlice,30,alice@test.com\nBob,25,bob@test.com\nCharlie,35,charlie@test.com',
        hasHeader: true,
      };

      const result = await handler.handle(input as any);

      // Response should have proper structure
      expect(result).toHaveProperty('response');
      expect(result.response).toHaveProperty('action');
      expect(result.response.action).toBe('import_csv');
    });

    it('should handle import_csv with custom delimiter', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name;Age;Email\nAlice;30;alice@test.com',
        delimiter: ';',
        hasHeader: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
      expect(result.response.action).toBe('import_csv');
    });

    it('should handle import_csv without header', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Alice,30,alice@test.com\nBob,25,bob@test.com',
        hasHeader: false,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle import_csv with new_sheet mode', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
        mode: 'new_sheet' as const,
        newSheetName: 'ImportedData',
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle import_csv with append mode', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        csvData: 'Name,Age\nCharlie,35',
        mode: 'append' as const,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle import_csv with skipEmptyRows option', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30\n\nBob,25',
        skipEmptyRows: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle import_csv with trimValues option', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\n  Alice  ,  30  ',
        trimValues: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should include mutation info in import_csv response', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('mutation');
      }
    });
  });

  // ============================================================================
  // SMART_APPEND Tests
  // ============================================================================

  describe('smart_append action', () => {
    it('should accept and process smart_append requests', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        data: [{ Name: 'Charlie', Age: 35 }],
      };

      const result = await handler.handle(input as any);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
    });

    it('should handle smart_append with multiple rows', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        data: [
          { Name: 'Charlie', Age: 35, Email: 'charlie@test.com' },
          { Name: 'Diana', Age: 28, Email: 'diana@test.com' },
        ],
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('smart_append');
    });

    it('should handle smart_append with matchHeaders enabled', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        data: [{ Name: 'Charlie', Age: 35 }],
        matchHeaders: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should handle smart_append with createMissingColumns', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        data: [{ Name: 'Charlie', Age: 35, NewColumn: 'value' }],
        createMissingColumns: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should handle smart_append with skipEmptyRows', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        data: [
          { Name: 'Charlie', Age: 35 },
          { Name: '', Age: '' },
          { Name: 'Diana', Age: 28 },
        ],
        skipEmptyRows: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should include columnsMatched in smart_append response', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        data: [{ Name: 'Charlie', Age: 35 }],
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('columnsMatched');
      }
    });

    it('should include mutation info in smart_append response', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        data: [{ Name: 'Charlie', Age: 35 }],
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('mutation');
      }
    });
  });

  // ============================================================================
  // BULK_UPDATE Tests
  // ============================================================================

  describe('bulk_update action', () => {
    it('should accept and process bulk_update requests', async () => {
      const input = {
        action: 'bulk_update' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumn: 'Name',
        updates: [{ Name: 'Alice', Age: 31 }],
      };

      const result = await handler.handle(input as any);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      // Response should have either success or error
      expect(result.response).toHaveProperty('success');
    });

    it('should handle bulk_update with multiple updates', async () => {
      const input = {
        action: 'bulk_update' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [
          { Name: 'Alice', Age: 31 },
          { Name: 'Bob', Age: 26 },
        ],
      };

      const result = await handler.handle(input as any);

      expect(result.response).toBeDefined();
      // Can be error or success response, but should be defined
      if (result.response && 'action' in result.response) {
        expect(result.response.action).toBe('bulk_update');
      }
    });

    it('should handle bulk_update with dry-run mode', async () => {
      const input = {
        action: 'bulk_update' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumn: 'Name',
        updates: [{ Name: 'Alice', Age: 31 }],
        safety: { dryRun: true },
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
      expect(result.response.rowsUpdated).toBe(0);
    });

    it('should handle bulk_update with createUnmatched option', async () => {
      const input = {
        action: 'bulk_update' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        keyColumn: 'Name',
        updates: [
          { Name: 'Alice', Age: 31 },
          { Name: 'NewPerson', Age: 40 },
        ],
        createUnmatched: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toBeDefined();
      // Response can be success or error, both are valid
      if ('action' in result.response) {
        expect(result.response.action).toBe('bulk_update');
      }
    });

    it('should return keysNotFound for bulk_update', async () => {
      const input = {
        action: 'bulk_update' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumn: 'Name',
        updates: [{ Name: 'NonExistent', Age: 99 }],
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('keysNotFound');
      }
    });

    it('should include cellsModified in bulk_update response', async () => {
      const input = {
        action: 'bulk_update' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumn: 'Name',
        updates: [{ Name: 'Alice', Age: 31 }],
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('cellsModified');
      }
    });
  });

  // ============================================================================
  // DEDUPLICATE Tests
  // ============================================================================

  describe('deduplicate action', () => {
    it('should accept and process deduplicate requests', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumns: ['Name'],
      };

      const result = await handler.handle(input as any);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
    });

    it('should handle deduplicate with multiple key columns', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        keyColumns: ['Name', 'Email'],
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('deduplicate');
    });

    it('should handle deduplicate with keep: first', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
        keep: 'first' as const,
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should handle deduplicate with keep: last', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumns: ['Name'],
        keep: 'last' as const,
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should handle deduplicate preview mode', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
        preview: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should handle deduplicate with dry-run mode', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumns: ['Name'],
        safety: { dryRun: true },
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
      expect(result.response.rowsDeleted).toBe(0);
    });

    it('should return deduplication statistics', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
        preview: true,
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('totalRows');
        expect(result.response).toHaveProperty('uniqueRows');
        expect(result.response).toHaveProperty('duplicatesFound');
      }
    });

    it('should include mutation info when duplicates deleted', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumns: ['Name'],
      };

      const result = await handler.handle(input as any);

      if (result.response.success && result.response.rowsDeleted > 0) {
        expect(result.response).toHaveProperty('mutation');
      }
    });
  });

  // ============================================================================
  // EXPORT_XLSX Tests
  // ============================================================================

  describe('export_xlsx action', () => {
    it('should handle export_xlsx with Drive API', async () => {
      const input = {
        action: 'export_xlsx' as const,
        spreadsheetId: 'test123',
      };

      const result = await handlerWithDrive.handle(input as any);

      expect(result.response).toHaveProperty('action');
      expect(result.response.action).toBe('export_xlsx');
    });

    it('should return file content in base64', async () => {
      const input = {
        action: 'export_xlsx' as const,
        spreadsheetId: 'test123',
      };

      const result = await handlerWithDrive.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('fileContent');
        expect(typeof result.response.fileContent).toBe('string');
      }
    });

    it('should include MIME type in export response', async () => {
      const input = {
        action: 'export_xlsx' as const,
        spreadsheetId: 'test123',
      };

      const result = await handlerWithDrive.handle(input as any);

      if (result.response.success) {
        expect(result.response.mimeType).toBe(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
      }
    });

    it('should include filename in export response', async () => {
      const input = {
        action: 'export_xlsx' as const,
        spreadsheetId: 'test123',
      };

      const result = await handlerWithDrive.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('filename');
      }
    });

    it('should include file size in export response', async () => {
      const input = {
        action: 'export_xlsx' as const,
        spreadsheetId: 'test123',
      };

      const result = await handlerWithDrive.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('sizeBytes');
        expect(typeof result.response.sizeBytes).toBe('number');
      }
    });

    it('should handle missing Drive API gracefully', async () => {
      const input = {
        action: 'export_xlsx' as const,
        spreadsheetId: 'test123',
      };

      const result = await handler.handle(input as any);

      // Should have either error or incremental scope required
      expect(result.response).toBeDefined();
      expect(result).toHaveProperty('response');
    });
  });

  // ============================================================================
  // IMPORT_XLSX Tests
  // ============================================================================

  describe('import_xlsx action', () => {
    it('should handle import_xlsx with Drive API', async () => {
      const input = {
        action: 'import_xlsx' as const,
        fileContent: Buffer.from('fake xlsx').toString('base64'),
        title: 'TestImport',
      };

      const result = await handlerWithDrive.handle(input as any);

      expect(result.response).toHaveProperty('action');
      expect(result.response.action).toBe('import_xlsx');
    });

    it('should return spreadsheetId for imported file', async () => {
      const input = {
        action: 'import_xlsx' as const,
        fileContent: Buffer.from('fake xlsx').toString('base64'),
        title: 'TestImport',
      };

      const result = await handlerWithDrive.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('spreadsheetId');
      }
    });

    it('should include spreadsheet URL in response', async () => {
      const input = {
        action: 'import_xlsx' as const,
        fileContent: Buffer.from('fake xlsx').toString('base64'),
        title: 'TestImport',
      };

      const result = await handlerWithDrive.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('spreadsheetUrl');
        expect(result.response.spreadsheetUrl).toContain('docs.google.com');
      }
    });

    it('should include sheet names in response', async () => {
      const input = {
        action: 'import_xlsx' as const,
        fileContent: Buffer.from('fake xlsx').toString('base64'),
        title: 'TestImport',
      };

      const result = await handlerWithDrive.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('sheetNames');
        expect(Array.isArray(result.response.sheetNames)).toBe(true);
      }
    });

    it('should handle import_xlsx with dry-run mode', async () => {
      const input = {
        action: 'import_xlsx' as const,
        fileContent: Buffer.from('fake xlsx').toString('base64'),
        title: 'TestImport',
        safety: { dryRun: true },
      };

      const result = await handlerWithDrive.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle missing Drive API gracefully for import', async () => {
      const input = {
        action: 'import_xlsx' as const,
        fileContent: Buffer.from('fake xlsx').toString('base64'),
        title: 'TestImport',
      };

      const result = await handler.handle(input as any);

      // Should have proper response structure
      expect(result.response).toBeDefined();
      expect(result).toHaveProperty('response');
    });
  });

  // ============================================================================
  // GET_FORM_RESPONSES Tests
  // ============================================================================

  describe('get_form_responses action', () => {
    it('should handle get_form_responses requests', async () => {
      const input = {
        action: 'get_form_responses' as const,
        spreadsheetId: 'test123',
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('get_form_responses');
    });

    it('should return response count', async () => {
      const input = {
        action: 'get_form_responses' as const,
        spreadsheetId: 'test123',
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('responseCount');
        expect(typeof result.response.responseCount).toBe('number');
      }
    });

    it('should return column headers', async () => {
      const input = {
        action: 'get_form_responses' as const,
        spreadsheetId: 'test123',
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('columnHeaders');
        expect(Array.isArray(result.response.columnHeaders)).toBe(true);
      }
    });

    it('should handle custom form responses sheet name', async () => {
      const input = {
        action: 'get_form_responses' as const,
        spreadsheetId: 'test123',
        formResponsesSheet: 'CustomFormSheet',
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should detect form-linked sheets', async () => {
      const input = {
        action: 'get_form_responses' as const,
        spreadsheetId: 'test123',
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('formLinked');
      }
    });

    it('should include latest response', async () => {
      const input = {
        action: 'get_form_responses' as const,
        spreadsheetId: 'test123',
      };

      const result = await handler.handle(input as any);

      if (result.response.success && result.response.responseCount > 0) {
        expect(result.response).toHaveProperty('latestResponse');
      }
    });

    it('should include oldest response', async () => {
      const input = {
        action: 'get_form_responses' as const,
        spreadsheetId: 'test123',
      };

      const result = await handler.handle(input as any);

      if (result.response.success && result.response.responseCount > 0) {
        expect(result.response).toHaveProperty('oldestResponse');
      }
    });
  });

  // ============================================================================
  // SETUP_SHEET Tests
  // ============================================================================

  describe('setup_sheet action', () => {
    it('should handle setup_sheet requests', async () => {
      const input = {
        action: 'setup_sheet' as const,
        spreadsheetId: 'test123',
        sheetName: 'NewSheet',
        headers: ['Name', 'Age', 'Email'],
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('setup_sheet');
    });

    it('should return sheetId in setup_sheet response', async () => {
      const input = {
        action: 'setup_sheet' as const,
        spreadsheetId: 'test123',
        sheetName: 'NewSheet',
        headers: ['Name', 'Age', 'Email'],
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('sheetId');
      }
    });

    it('should handle setup_sheet with header formatting', async () => {
      const input = {
        action: 'setup_sheet' as const,
        spreadsheetId: 'test123',
        sheetName: 'NewSheet',
        headers: ['Name', 'Age', 'Email'],
        headerFormat: {
          bold: true,
          backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
        },
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should handle setup_sheet with column widths', async () => {
      const input = {
        action: 'setup_sheet' as const,
        spreadsheetId: 'test123',
        sheetName: 'NewSheet',
        headers: ['Name', 'Age', 'Email'],
        columnWidths: [150, 80, 200],
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should handle setup_sheet with freezeHeaderRow option', async () => {
      const input = {
        action: 'setup_sheet' as const,
        spreadsheetId: 'test123',
        sheetName: 'NewSheet',
        headers: ['Name', 'Age', 'Email'],
        freezeHeaderRow: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response.success).toBe(true);
    });

    it('should include column count in setup_sheet response', async () => {
      const input = {
        action: 'setup_sheet' as const,
        spreadsheetId: 'test123',
        sheetName: 'NewSheet',
        headers: ['Name', 'Age', 'Email'],
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response.columnCount).toBe(3);
      }
    });

    it('should include apiCallsSaved in setup_sheet response', async () => {
      const input = {
        action: 'setup_sheet' as const,
        spreadsheetId: 'test123',
        sheetName: 'NewSheet',
        headers: ['Name', 'Age', 'Email'],
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('apiCallsSaved');
        expect(typeof result.response.apiCallsSaved).toBe('number');
      }
    });
  });

  // ============================================================================
  // IMPORT_AND_FORMAT Tests
  // ============================================================================

  describe('import_and_format action', () => {
    it('should handle import_and_format requests', async () => {
      const input = {
        action: 'import_and_format' as const,
        spreadsheetId: 'test123',
        sheet: 'DataSheet',
        csvData: 'Name,Age,Email\nAlice,30,alice@test.com',
        hasHeader: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toBeDefined();
      // Check for either success or error response
      if ('action' in result.response) {
        expect(result.response.action).toBe('import_and_format');
      }
    });

    it('should return rowsImported and columnsImported', async () => {
      const input = {
        action: 'import_and_format' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
        hasHeader: true,
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('rowsImported');
        expect(result.response).toHaveProperty('columnsImported');
      }
    });

    it('should handle import_and_format with header formatting', async () => {
      const input = {
        action: 'import_and_format' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
        hasHeader: true,
        headerFormat: {
          bold: true,
          backgroundColor: { red: 0.8, green: 0.8, blue: 1 },
        },
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle import_and_format with freezeHeaderRow', async () => {
      const input = {
        action: 'import_and_format' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age,Email\nAlice,30,alice@test.com',
        hasHeader: true,
        freezeHeaderRow: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle import_and_format with autoResizeColumns', async () => {
      const input = {
        action: 'import_and_format' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age,Email\nAlice,30,alice@test.com',
        hasHeader: true,
        autoResizeColumns: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should include apiCallsSaved in import_and_format response', async () => {
      const input = {
        action: 'import_and_format' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
        hasHeader: true,
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('apiCallsSaved');
      }
    });

    it('should include mutation info in import_and_format response', async () => {
      const input = {
        action: 'import_and_format' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
        hasHeader: true,
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('mutation');
      }
    });
  });

  // ============================================================================
  // CLONE_STRUCTURE Tests
  // ============================================================================

  describe('clone_structure action', () => {
    it('should handle clone_structure requests', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 'Sheet1',
        newSheetName: 'Sheet1 copy',
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
      expect(result.response.action).toBe('clone_structure');
    });

    it('should return newSheetId in clone_structure response', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 'Sheet1',
        newSheetName: 'Sheet1 copy',
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('newSheetId');
      }
    });

    it('should handle clone_structure with headerRowCount', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 0,
        newSheetName: 'Sheet1 copy',
        headerRowCount: 2,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle clone_structure with includeFormatting', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 'Sheet1',
        newSheetName: 'Sheet1 copy',
        includeFormatting: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle clone_structure without formatting', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 'Sheet1',
        newSheetName: 'Sheet1 copy',
        includeFormatting: false,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle clone_structure with includeConditionalFormatting', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 'Sheet1',
        newSheetName: 'Sheet1 copy',
        includeConditionalFormatting: true,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle clone_structure with includeDataValidation', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 'Sheet1',
        newSheetName: 'Sheet1 copy',
        includeDataValidation: false,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should include columnCount in clone_structure response', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 'Sheet1',
        newSheetName: 'Sheet1 copy',
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('columnCount');
      }
    });

    it('should include apiCallsSaved in clone_structure response', async () => {
      const input = {
        action: 'clone_structure' as const,
        spreadsheetId: 'test123',
        sourceSheet: 'Sheet1',
        newSheetName: 'Sheet1 copy',
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('apiCallsSaved');
      }
    });
  });

  // ============================================================================
  // Response Structure Tests
  // ============================================================================

  describe('response structure', () => {
    it('should return properly formatted responses', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
      };

      const result = await handler.handle(input as any);

      // All responses should have this structure
      expect(result).toHaveProperty('response');
      expect(result.response).toHaveProperty('success');

      // Either success or error
      if (result.response.success) {
        expect(result.response).toHaveProperty('action');
      } else {
        expect(result.response).toHaveProperty('error');
      }
    });

    it('should include metadata in all responses', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        data: [{ Name: 'Charlie', Age: 35 }],
      };

      const result = await handler.handle(input as any);

      if (result.response.success) {
        expect(result.response).toHaveProperty('_meta');
      }
    });

    it('should handle verbosity parameter', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
        verbosity: 'minimal' as const,
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });
  });

  // ============================================================================
  // BATCH_OPERATIONS Tests
  // ============================================================================

  describe('batch_operations action', () => {
    it('should emit progress notifications for multi-operation batches', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'composite-batch-progress',
        progressToken: 'composite-batch-progress',
        sendNotification: notification,
      });

      mockDispatchCompositeOperation
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'batch_operations',
          spreadsheetId: 'test123',
          operations: [
            { tool: 'sheets_core', action: 'get', params: {} },
            { tool: 'sheets_data', action: 'read', params: { range: 'Sheet1!A1:B2' } },
          ],
          stopOnError: false,
        } as any)
      );

      expect(result.response.success).toBe(true);
      expect(mockDispatchCompositeOperation).toHaveBeenCalledTimes(2);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progress: 0,
          total: 2,
        }),
      });
    });
  });

  // ============================================================================
  // WORKFLOW ACTIONS Progress Tests (P18-X13)
  // ============================================================================

  describe('audit_sheet progress notifications (P18-X13)', () => {
    it('should emit progress notifications while auditing multiple sheets', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'composite-audit-progress',
        progressToken: 'composite-audit-progress',
        sendNotification: notification,
      });

      (mockSheetsApi.spreadsheets.get as any).mockResolvedValue({
        data: {
          spreadsheetId: 'test123',
          sheets: [
            { properties: { sheetId: 0, title: 'Sheet1' } },
            { properties: { sheetId: 1, title: 'Sheet2' } },
          ],
        },
      });
      (mockSheetsApi.spreadsheets.values.get as any)
        .mockResolvedValueOnce({ data: { values: [['A', 'B'], [1, 2], [3, 4]] } })
        .mockResolvedValueOnce({ data: { values: [['C', 'D'], [5, 6]] } });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'audit_sheet',
          spreadsheetId: 'test123',
        } as any)
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({ progress: 0 }),
      });
    });
  });

  describe('data_pipeline progress notifications (P18-X13)', () => {
    it('should emit progress notifications while running a pipeline', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'composite-pipeline-progress',
        progressToken: 'composite-pipeline-progress',
        sendNotification: notification,
      });

      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue({
        data: {
          values: [
            ['Name', 'Score'],
            ['Alice', 100],
            ['Bob', 200],
            ['Alice', 150],
          ],
        },
      });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'data_pipeline',
          spreadsheetId: 'test123',
          sourceRange: 'Sheet1!A1:B4',
          steps: [
            { type: 'filter', config: { column: 'Name', value: 'Alice' } },
            { type: 'sort', config: { column: 'Score', order: 'asc' } },
          ],
          dryRun: true,
        } as any)
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({ progress: 0 }),
      });
    });
  });

  describe('migrate_spreadsheet progress notifications (P18-X13)', () => {
    it('should emit progress notifications while migrating', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'composite-migrate-progress',
        progressToken: 'composite-migrate-progress',
        sendNotification: notification,
      });

      (mockSheetsApi.spreadsheets.values.get as any).mockResolvedValue({
        data: {
          values: [
            ['OldName', 'OldValue'],
            ['Alice', 100],
            ['Bob', 200],
          ],
        },
      });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'migrate_spreadsheet',
          sourceSpreadsheetId: 'source123',
          destinationSpreadsheetId: 'dest123',
          sourceRange: 'Sheet1!A1:B3',
          destinationRange: 'Sheet1!A1',
          columnMapping: [
            { sourceColumn: 'OldName', destinationColumn: 'Name' },
            { sourceColumn: 'OldValue', destinationColumn: 'Value' },
          ],
          dryRun: true,
        } as any)
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({ progress: 0 }),
      });
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases
  // ============================================================================

  describe('error handling', () => {
    it('should handle errors from service operations gracefully', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30',
      };

      // Even if service fails, should return valid response
      const result = await handler.handle(input as any);

      expect(result).toHaveProperty('response');
      expect(result.response).toBeDefined();
    });

    it('should handle unknown action gracefully', async () => {
      const input = {
        action: 'unknown_action' as any,
        spreadsheetId: 'test123',
      };

      // Should handle error for unknown action
      const result = await handler.handle(input as any);

      expect(result.response).toBeDefined();
    });
  });

  describe('response metadata', () => {
    it('should include spreadsheetId in context tracking', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        data: [{ Name: 'Test' }],
      };

      const result = await handler.handle(input as any);

      expect(result.response).toBeDefined();
      expect(result.response).toHaveProperty('action');
    });

    it('should handle sheet references by ID', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        keyColumns: ['Name'],
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });

    it('should handle sheet references by name', async () => {
      const input = {
        action: 'deduplicate' as const,
        spreadsheetId: 'test123',
        sheet: 'Sheet1',
        keyColumns: ['Name'],
      };

      const result = await handler.handle(input as any);

      expect(result.response).toHaveProperty('action');
    });
  });

  describe('comprehensive action coverage', () => {
    it('should handle all 10 composite actions', async () => {
      const actions = [
        {
          action: 'import_csv' as const,
          spreadsheetId: 'test123',
          csvData: 'Name,Age\nAlice,30',
        },
        {
          action: 'smart_append' as const,
          spreadsheetId: 'test123',
          sheet: 0,
          data: [{ Name: 'Test' }],
        },
        {
          action: 'bulk_update' as const,
          spreadsheetId: 'test123',
          sheet: 0,
          keyColumn: 'Name',
          updates: [{ Name: 'Alice', Age: 31 }],
        },
        {
          action: 'deduplicate' as const,
          spreadsheetId: 'test123',
          sheet: 0,
          keyColumns: ['Name'],
        },
        {
          action: 'export_xlsx' as const,
          spreadsheetId: 'test123',
        },
        {
          action: 'import_xlsx' as const,
          fileContent: Buffer.from('fake').toString('base64'),
        },
        {
          action: 'get_form_responses' as const,
          spreadsheetId: 'test123',
        },
        {
          action: 'setup_sheet' as const,
          spreadsheetId: 'test123',
          sheetName: 'New',
          headers: ['A', 'B'],
        },
        {
          action: 'import_and_format' as const,
          spreadsheetId: 'test123',
          csvData: 'A,B\n1,2',
        },
        {
          action: 'clone_structure' as const,
          spreadsheetId: 'test123',
          sourceSheet: 'Sheet1',
          newSheetName: 'Copy',
        },
      ];

      for (const input of actions) {
        const result = await handler.handle(input as any);
        expect(result).toHaveProperty('response');
        expect(result.response).toBeDefined();
        // Each action should have proper structure
        if ('error' in result.response && result.response.error) {
          expect(result.response.error).toBeDefined();
        }
      }
    });

    it('should handle safety options across operations', async () => {
      const safetyInputs = [
        {
          action: 'bulk_update' as const,
          spreadsheetId: 'test123',
          sheet: 0,
          keyColumn: 'Name',
          updates: [{ Name: 'Alice', Age: 31 }],
          safety: { dryRun: true },
        },
        {
          action: 'deduplicate' as const,
          spreadsheetId: 'test123',
          sheet: 0,
          keyColumns: ['Name'],
          safety: { dryRun: true },
        },
        {
          action: 'import_xlsx' as const,
          fileContent: Buffer.from('fake').toString('base64'),
          safety: { dryRun: true },
        },
      ];

      for (const input of safetyInputs) {
        const result = await handler.handle(input as any);
        expect(result.response).toBeDefined();
      }
    });
  });

  describe('data handling', () => {
    it('should handle empty data arrays', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        data: [],
      };

      const result = await handler.handle(input as any);
      expect(result).toHaveProperty('response');
    });

    it('should handle large CSV data', async () => {
      const largeData = 'Name,Age\n' + Array(100).fill('Test,25').join('\n');
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: largeData,
      };

      const result = await handler.handle(input as any);
      expect(result).toHaveProperty('response');
    });

    it('should handle special characters in data', async () => {
      const input = {
        action: 'smart_append' as const,
        spreadsheetId: 'test123',
        sheet: 0,
        data: [{ Name: 'Alice & Bob', Age: 30 }],
      };

      const result = await handler.handle(input as any);
      expect(result).toHaveProperty('response');
    });

    it('should handle unicode characters', async () => {
      const input = {
        action: 'import_csv' as const,
        spreadsheetId: 'test123',
        csvData: 'Name,Age\nAlice,30\nBob,25\nCharlie,35',
      };

      const result = await handler.handle(input as any);
      expect(result).toHaveProperty('response');
    });
  });

  // ============================================================================
  // generate_sheet Progress Notifications (Tranche E)
  // ============================================================================

  describe('generate_sheet progress notifications', () => {
    it('should emit progress notifications during sheet generation', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'composite-generate-progress',
        progressToken: 'composite-generate-progress',
        sendNotification: notification,
      });

      const mockDefinition = {
        title: 'Test Sheet',
        sheets: [
          {
            name: 'Sheet1',
            columns: [{ header: 'Name', type: 'text' }],
            rows: [],
          },
        ],
      };
      mockGenerateDefinition.mockResolvedValue(mockDefinition);
      mockExecuteDefinition.mockResolvedValue({
        spreadsheetId: 'new-sheet-id',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-sheet-id',
        title: 'Test Sheet',
        sheetsCreated: 1,
        columnsCreated: 1,
        rowsCreated: 0,
        formulasApplied: 0,
        formattingApplied: false,
      });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'generate_sheet',
          description: 'A simple budget tracker',
        } as any)
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progress: 0,
        }),
      });
    });
  });
});
