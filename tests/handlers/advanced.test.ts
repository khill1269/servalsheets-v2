/**
 * ServalSheets v4 - Advanced Handler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdvancedHandler } from '../../src/handlers/advanced.js';
import { SheetsAdvancedOutputSchema } from '../../src/schemas/advanced.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn(),
    batchUpdate: vi.fn(),
    values: {
      get: vi.fn(),
    },
    developerMetadata: {
      search: vi.fn(),
    },
  },
});

const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {} as any,
  rangeResolver: {
    resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:B2' }),
  } as any,
  auth: {
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  } as any,
});

describe('AdvancedHandler', () => {
  let handler: AdvancedHandler;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;

  beforeEach(() => {
    mockSheetsApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new AdvancedHandler(mockContext, mockSheetsApi as unknown as sheets_v4.Sheets);

    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 100, columnCount: 26 },
            },
          },
        ],
        namedRanges: [],
      },
    });
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [] } });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ============================================================
  // Named Ranges
  // ============================================================

  it('adds a named range', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: {
        replies: [
          {
            addNamedRange: {
              namedRange: { namedRangeId: 'nr1', name: 'Range1', range: { sheetId: 0 } },
            },
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'add_named_range',
      spreadsheetId: 'sheet-id',
      name: 'Range1',
      range: { a1: 'Sheet1!A1:B2' },
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.namedRange?.name).toBe('Range1');
    }
  });

  it('updates a named range', async () => {
    const result = await handler.handle({
      action: 'update_named_range',
      spreadsheetId: 'sheet-id',
      namedRangeId: 'nr1',
      name: 'UpdatedRange',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('deletes a named range', async () => {
    const result = await handler.handle({
      action: 'delete_named_range',
      spreadsheetId: 'sheet-id',
      namedRangeId: 'nr1',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('lists named ranges', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        namedRanges: [
          { namedRangeId: 'nr1', name: 'MyRange', range: { sheetId: 0 } },
          { namedRangeId: 'nr2', name: 'OtherRange', range: { sheetId: 0 } },
        ],
      },
    });

    const result = await handler.handle({
      action: 'list_named_ranges',
      spreadsheetId: 'sheet-id',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.namedRanges?.length).toBe(2);
      expect(result.response.namedRanges?.[0].name).toBe('MyRange');
    }
  });

  it('gets a named range by name', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        namedRanges: [{ namedRangeId: 'nr1', name: 'MyRange', range: { sheetId: 0 } }],
      },
    });

    const result = await handler.handle({
      action: 'get_named_range',
      spreadsheetId: 'sheet-id',
      name: 'MyRange',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.namedRange?.name).toBe('MyRange');
      expect(result.response.namedRange?.namedRangeId).toBe('nr1');
    }
  });

  it('returns not-found error when named range does not exist', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: { namedRanges: [] },
    });

    const result = await handler.handle({
      action: 'get_named_range',
      spreadsheetId: 'sheet-id',
      name: 'NonExistent',
    });

    expect(result.response.success).toBe(false);
  });

  // ============================================================
  // Protected Ranges
  // ============================================================

  it('adds a protected range', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: {
        replies: [
          {
            addProtectedRange: {
              protectedRange: {
                protectedRangeId: 42,
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 2,
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
                warningOnly: false,
                requestingUserCanEdit: true,
              },
            },
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'add_protected_range',
      spreadsheetId: 'sheet-id',
      range: { a1: 'Sheet1!A1:B2' },
      description: 'Protected header row',
      warningOnly: false,
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.protectedRange?.protectedRangeId).toBe(42);
      expect(result.response.protectedRange?.warningOnly).toBe(false);
    }
  });

  it('updates a protected range', async () => {
    const result = await handler.handle({
      action: 'update_protected_range',
      spreadsheetId: 'sheet-id',
      protectedRangeId: 42,
      description: 'Updated description',
      warningOnly: true,
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('deletes a protected range', async () => {
    const result = await handler.handle({
      action: 'delete_protected_range',
      spreadsheetId: 'sheet-id',
      protectedRangeId: 42,
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('lists protected ranges', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Sheet1' },
            protectedRanges: [
              {
                protectedRangeId: 1,
                range: { sheetId: 0 },
                warningOnly: false,
                requestingUserCanEdit: true,
              },
              {
                protectedRangeId: 2,
                range: { sheetId: 0 },
                warningOnly: true,
                requestingUserCanEdit: false,
              },
            ],
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'list_protected_ranges',
      spreadsheetId: 'sheet-id',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.protectedRanges?.length).toBe(2);
    }
  });

  // ============================================================
  // Metadata
  // ============================================================

  it('sets developer metadata', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: {
        replies: [
          {
            createDeveloperMetadata: {
              developerMetadata: { metadataId: 101 },
            },
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'set_metadata',
      spreadsheetId: 'sheet-id',
      metadataKey: 'my_key',
      metadataValue: 'my_value',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('gets developer metadata', async () => {
    mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue({
      data: {
        matchedDeveloperMetadata: [
          {
            developerMetadata: {
              metadataId: 101,
              metadataKey: 'my_key',
              metadataValue: 'my_value',
            },
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'get_metadata',
      spreadsheetId: 'sheet-id',
      metadataKey: 'my_key',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.metadataList?.length).toBe(1);
      expect(result.response.metadataList?.[0].metadataKey).toBe('my_key');
    }
  });

  it('deletes developer metadata', async () => {
    const result = await handler.handle({
      action: 'delete_metadata',
      spreadsheetId: 'sheet-id',
      metadataId: 101,
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  // ============================================================
  // Banding
  // ============================================================

  it('adds banding to a range', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: {
        replies: [
          {
            addBanding: {
              bandedRange: { bandedRangeId: 5, range: { sheetId: 0 } },
            },
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'add_banding',
      spreadsheetId: 'sheet-id',
      range: { a1: 'Sheet1!A1:D10' },
      rowProperties: {
        headerColor: { red: 0.2, green: 0.4, blue: 0.8 },
        firstBandColor: { red: 1, green: 1, blue: 1 },
        secondBandColor: { red: 0.9, green: 0.9, blue: 0.9 },
      },
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
  });

  it('rejects banding without row or column properties', async () => {
    const result = await handler.handle({
      action: 'add_banding',
      spreadsheetId: 'sheet-id',
      range: { a1: 'Sheet1!A1:D10' },
    });

    expect(result.response.success).toBe(false);
  });

  it('updates banding', async () => {
    const result = await handler.handle({
      action: 'update_banding',
      spreadsheetId: 'sheet-id',
      bandedRangeId: 5,
      rowProperties: {
        firstBandColor: { red: 0.8, green: 0.9, blue: 1 },
        secondBandColor: { red: 1, green: 1, blue: 1 },
      },
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('deletes banding', async () => {
    const result = await handler.handle({
      action: 'delete_banding',
      spreadsheetId: 'sheet-id',
      bandedRangeId: 5,
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('lists banding', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0 },
            bandedRanges: [
              {
                bandedRangeId: 5,
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 10,
                  startColumnIndex: 0,
                  endColumnIndex: 4,
                },
              },
              {
                bandedRangeId: 6,
                range: {
                  sheetId: 0,
                  startRowIndex: 12,
                  endRowIndex: 20,
                  startColumnIndex: 0,
                  endColumnIndex: 4,
                },
              },
            ],
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'list_banding',
      spreadsheetId: 'sheet-id',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.bandedRanges?.length).toBe(2);
    }
  });

  // ============================================================
  // Tables
  // ============================================================

  it('creates a table', async () => {
    // Mock header row for table creation
    mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
      data: {
        values: [['Header1', 'Header2']],
      },
    });

    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: {
        replies: [
          {
            addTable: {
              table: {
                tableId: 'table-1',
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 3,
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
              },
            },
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'create_table',
      spreadsheetId: 'sheet-id',
      range: { a1: 'Sheet1!A1:B2' },
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.table).toBeDefined();
      expect(result.response.table?.tableId).toBe('table-1');
    }
  });

  it('rejects create_table when the range overlaps a basic filter', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 100, columnCount: 26 },
            },
            basicFilter: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 10,
                startColumnIndex: 0,
                endColumnIndex: 2,
              },
            },
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'create_table',
      spreadsheetId: 'sheet-id',
      range: { a1: 'Sheet1!A1:B5' },
    });

    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.error.code).toBe('FAILED_PRECONDITION');
      expect(result.response.error.message).toContain('basic filter');
    }
    expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('rejects create_table when the range overlaps existing banding', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 100, columnCount: 26 },
            },
            bandedRanges: [
              {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 8,
                  startColumnIndex: 0,
                  endColumnIndex: 3,
                },
              },
            ],
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'create_table',
      spreadsheetId: 'sheet-id',
      range: { a1: 'Sheet1!A1:B5' },
    });

    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.error.code).toBe('FAILED_PRECONDITION');
      expect(result.response.error.message).toContain('banded range');
    }
    expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('deletes a table', async () => {
    const result = await handler.handle({
      action: 'delete_table',
      spreadsheetId: 'sheet-id',
      tableId: 'table-1',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('lists tables', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0 },
            tables: [
              {
                tableId: 'table-1',
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 10,
                  startColumnIndex: 0,
                  endColumnIndex: 3,
                },
                columnProperties: [{ columnIndex: 0 }, { columnIndex: 1 }, { columnIndex: 2 }],
              },
              {
                tableId: 'table-2',
                range: {
                  sheetId: 0,
                  startRowIndex: 15,
                  endRowIndex: 25,
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
                columnProperties: [{ columnIndex: 0 }, { columnIndex: 1 }],
              },
            ],
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'list_tables',
      spreadsheetId: 'sheet-id',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.tables?.length).toBe(2);
      expect(result.response.tables?.[0].tableId).toBe('table-1');
    }
  });

  it('updates a table range', async () => {
    const result = await handler.handle({
      action: 'update_table',
      spreadsheetId: 'sheet-id',
      tableId: 'table-1',
      range: { a1: 'Sheet1!A1:C15' },
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('updates a table without range (no-op path)', async () => {
    // update_table with no range specified results in no batchUpdate call
    const result = await handler.handle({
      action: 'update_table',
      spreadsheetId: 'sheet-id',
      tableId: 'table-1',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
  });

  it('renames a table column', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Sheet1' },
            tables: [
              {
                tableId: 'table-1',
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 10,
                  startColumnIndex: 0,
                  endColumnIndex: 3,
                },
                columnProperties: [
                  { columnIndex: 0, columnName: 'OldName' },
                  { columnIndex: 1, columnName: 'Col2' },
                  { columnIndex: 2, columnName: 'Col3' },
                ],
              },
            ],
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'rename_table_column',
      spreadsheetId: 'sheet-id',
      tableId: 'table-1',
      columnIndex: 0,
      newName: 'NewName',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  it('returns error when renaming column of non-existent table', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: { sheets: [{ properties: { sheetId: 0 }, tables: [] }] },
    });

    const result = await handler.handle({
      action: 'rename_table_column',
      spreadsheetId: 'sheet-id',
      tableId: 'nonexistent-table',
      columnIndex: 0,
      newName: 'NewName',
    });

    expect(result.response.success).toBe(false);
  });

  it('sets table column properties', async () => {
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Sheet1' },
            tables: [
              {
                tableId: 'table-1',
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 10,
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
                columnProperties: [
                  { columnIndex: 0, columnName: 'Name' },
                  { columnIndex: 1, columnName: 'Amount' },
                ],
              },
            ],
          },
        ],
      },
    });

    const result = await handler.handle({
      action: 'set_table_column_properties',
      spreadsheetId: 'sheet-id',
      tableId: 'table-1',
      columnIndex: 1,
      columnType: 'NUMBER',
    });

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
    expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
  });

  // ============================================================
  // Named Functions
  // ============================================================

  it.each([
    {
      action: 'create_named_function',
      input: {
        action: 'create_named_function',
        spreadsheetId: 'sheet-id',
        functionName: 'PROFIT_MARGIN',
        functionBody: 'LAMBDA(revenue,cost,(revenue-cost)/revenue)',
      },
    },
    {
      action: 'list_named_functions',
      input: {
        action: 'list_named_functions',
        spreadsheetId: 'sheet-id',
      },
    },
    {
      action: 'get_named_function',
      input: {
        action: 'get_named_function',
        spreadsheetId: 'sheet-id',
        functionName: 'PROFIT_MARGIN',
      },
    },
    {
      action: 'update_named_function',
      input: {
        action: 'update_named_function',
        spreadsheetId: 'sheet-id',
        functionName: 'PROFIT_MARGIN',
        functionBody: 'LAMBDA(revenue,cost,(revenue-cost)/revenue)',
      },
    },
    {
      action: 'delete_named_function',
      input: {
        action: 'delete_named_function',
        spreadsheetId: 'sheet-id',
        functionName: 'PROFIT_MARGIN',
      },
    },
  ] as const)('$action returns FEATURE_UNAVAILABLE compatibility response', async ({ input }) => {
    const result = await handler.handle(input as any);

    const parsed = SheetsAdvancedOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.error.code).toBe('FEATURE_UNAVAILABLE');
      expect(result.response.error.message).toContain('compatibility');
    }
    expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  // ============================================================
  // Smart Chips
  // ============================================================

  describe('smart chips', () => {
    it('adds a person chip', async () => {
      const result = await handler.handle({
        action: 'add_person_chip',
        spreadsheetId: 'sheet-id',
        range: { a1: 'Sheet1!A1' },
        email: 'alice@example.com',
        displayFormat: 'SHORT',
      });

      const parsed = SheetsAdvancedOutputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.chip?.type).toBe('person');
        expect(result.response.chip?.email).toBe('alice@example.com');
      }
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('adds a drive chip', async () => {
      const result = await handler.handle({
        action: 'add_drive_chip',
        spreadsheetId: 'sheet-id',
        range: { a1: 'Sheet1!B1' },
        fileId: 'abcdef1234567890',
      });

      const parsed = SheetsAdvancedOutputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.chip?.type).toBe('drive');
        expect(result.response.chip?.fileId).toBe('abcdef1234567890');
      }
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('adds a rich link chip', async () => {
      // Per Google API docs: Only Drive links can be written as rich link chips
      const result = await handler.handle({
        action: 'add_rich_link_chip',
        spreadsheetId: 'sheet-id',
        range: { a1: 'Sheet1!C1' },
        uri: 'https://drive.google.com/file/d/ABC123/view',
      });

      const parsed = SheetsAdvancedOutputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.chip?.type).toBe('rich_link');
        expect(result.response.chip?.uri).toBe('https://drive.google.com/file/d/ABC123/view');
      }
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('rejects non-Drive URIs for rich link chips', async () => {
      // Per Google API docs: Only Drive links can be written as rich link chips
      const result = await handler.handle({
        action: 'add_rich_link_chip',
        spreadsheetId: 'sheet-id',
        range: { a1: 'Sheet1!C1' },
        uri: 'https://example.com/docs',
      });

      const parsed = SheetsAdvancedOutputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        // Error message should indicate Drive-only restriction
        const errorMsg = JSON.stringify(result.response);
        expect(errorMsg).toContain('Google Drive');
      }
    });

    it('lists chips in a range', async () => {
      // validateGridDataSize calls spreadsheets.get first, then list_chips calls it again
      const sizeCheckResponse = {
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: { rowCount: 100, columnCount: 26 },
              },
            },
          ],
        },
      };
      const chipDataResponse = {
        data: {
          sheets: [
            {
              properties: { sheetId: 0, title: 'Sheet1' },
              data: [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: [
                    {
                      values: [
                        {
                          userEnteredValue: { stringValue: '@alice@example.com' },
                          formattedValue: 'Alice',
                          chipRuns: [
                            {
                              chip: {
                                personProperties: {
                                  email: 'alice@example.com',
                                },
                              },
                            },
                          ],
                        },
                        {
                          userEnteredValue: { stringValue: 'File' },
                          formattedValue: 'File',
                          chipRuns: [
                            {
                              chip: {
                                richLinkProperties: {
                                  uri: 'https://drive.google.com/file/d/FILE123/view',
                                },
                              },
                            },
                          ],
                        },
                        {
                          userEnteredValue: { stringValue: 'Example' },
                          formattedValue: 'Example',
                          chipRuns: [
                            {
                              chip: {
                                richLinkProperties: {
                                  uri: 'https://example.com',
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get
        .mockResolvedValueOnce(sizeCheckResponse)
        .mockResolvedValueOnce(chipDataResponse);

      const result = await handler.handle({
        action: 'list_chips',
        spreadsheetId: 'sheet-id',
        range: 'Sheet1!A1:Z100',
        chipType: 'all',
      });

      const parsed = SheetsAdvancedOutputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.chips?.length).toBe(3);
      }
    });

    it('emits progress notifications when scanning chips across multiple sheets', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'advanced-chips-progress',
        progressToken: 'advanced-chips-progress',
        sendNotification: notification,
      });

      const sizeCheckResponse = {
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                gridProperties: { rowCount: 100, columnCount: 26 },
              },
            },
            {
              properties: {
                sheetId: 1,
                title: 'Sheet2',
                gridProperties: { rowCount: 100, columnCount: 26 },
              },
            },
          ],
        },
      };
      const chipDataResponse = {
        data: {
          sheets: [
            {
              properties: { sheetId: 0, title: 'Sheet1' },
              data: [{ startRow: 0, startColumn: 0, rowData: [{ values: [] }] }],
            },
            {
              properties: { sheetId: 1, title: 'Sheet2' },
              data: [{ startRow: 0, startColumn: 0, rowData: [{ values: [] }] }],
            },
          ],
        },
      };

      mockSheetsApi.spreadsheets.get
        .mockResolvedValueOnce(sizeCheckResponse)
        .mockResolvedValueOnce(chipDataResponse);

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'list_chips',
          spreadsheetId: 'sheet-id',
          range: 'Sheet1!A1:Z100',
          chipType: 'all',
        })
      );

      expect(result.response.success).toBe(true);
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
});
