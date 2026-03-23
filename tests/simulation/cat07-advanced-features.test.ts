/**
 * ServalSheets - Category 7 Advanced Features Tests (Simulation)
 *
 * Tests for advanced sheet configuration and management
 * Note: These are integration tests verifying action dispatch, not full E2E tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdvancedHandler } from '../../src/handlers/advanced.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-sheet-id',
        properties: { title: 'Test Sheet' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: 100, columnCount: 26 } } }],
        namedRanges: [{ namedRangeId: 'nr-1', name: 'SalesRange' }],
        protectedRanges: [],
        banding: [],
      },
    }),
    batchUpdate: vi.fn().mockResolvedValue({ data: { replies: [{}] } }),
  },
});

const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {} as any,
  rangeResolver: { resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:B10' }) } as any,
  auth: { scopes: ['https://www.googleapis.com/auth/drive.file'] } as any,
  samplingServer: undefined,
  snapshotService: {} as any,
  sessionContext: {} as any,
  confirmDestructiveAction: vi.fn().mockResolvedValue(undefined),
  createSnapshotIfNeeded: vi.fn().mockResolvedValue({ snapshotId: 'snap-123' }),
  sendProgress: vi.fn(),
  cachedApi: {} as any,
});

describe('Category 7: Advanced Features', () => {
  let handler: AdvancedHandler;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSheetsApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new AdvancedHandler(mockContext, mockSheetsApi as unknown as sheets_v4.Sheets);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('7.1 add_named_range dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ addNamedRange: { namedRange: { namedRangeId: 'nr-new' } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'add_named_range',
        spreadsheetId: 'test-sheet-id',
        name: 'RevenueRange',
        range: { a1: 'Sheet1!A1:B5' },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.2 list_named_ranges dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'list_named_ranges', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.3 get_named_range dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'get_named_range', spreadsheetId: 'test-sheet-id', name: 'SalesRange' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.4 update_named_range dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ updateNamedRange: { namedRange: { namedRangeId: 'nr-1' } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'update_named_range',
        spreadsheetId: 'test-sheet-id',
        namedRangeId: 'nr-1',
        name: 'UpdatedRange',
        range: { a1: 'Sheet1!A1:C10' },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.5 delete_named_range dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ deleteNamedRange: {} }] },
    });
    const result = await handler.handle({
      request: {
        action: 'delete_named_range',
        spreadsheetId: 'test-sheet-id',
        namedRangeId: 'nr-1',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.6 add_protected_range dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ addProtectedRange: { protectedRange: { protectedRangeId: 'pr-1' } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'add_protected_range',
        spreadsheetId: 'test-sheet-id',
        range: { a1: 'Sheet1!A1:B5' },
        warningOnly: true,
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.7 list_protected_ranges dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'list_protected_ranges', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.8 set_metadata dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ createDeveloperMetadata: { developerMetadata: { metadataId: 'm1' } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'set_metadata',
        spreadsheetId: 'test-sheet-id',
        metadataKey: 'dataSource',
        metadataValue: 'api',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.9 get_metadata dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'get_metadata', spreadsheetId: 'test-sheet-id', metadataKey: 'dataSource' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.10 add_banding dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ addBanding: { banding: { bandedRangeId: 'b1' } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'add_banding',
        spreadsheetId: 'test-sheet-id',
        range: { a1: 'Sheet1!A1:C10' },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.11 list_banding dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'list_banding', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.12 create_table dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ createTable: { table: { tableId: 't1' } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'create_table',
        spreadsheetId: 'test-sheet-id',
        range: { a1: 'Sheet1!A1:C10' },
        tableProperties: { displayName: 'SalesData' },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.13 update_table dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ updateTable: { table: { tableId: 't1' } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'update_table',
        spreadsheetId: 'test-sheet-id',
        tableId: 't1',
        tableProperties: { displayName: 'UpdatedSales' },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.14 list_tables dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'list_tables', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.15 add_person_chip dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ updateCells: {} }] },
    });
    const result = await handler.handle({
      request: {
        action: 'add_person_chip',
        spreadsheetId: 'test-sheet-id',
        cell: { a1: 'A1' },
        email: 'user@example.com',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.16 list_chips dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'list_chips', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.17 create_named_function dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'create_named_function',
        spreadsheetId: 'test-sheet-id',
        functionName: 'CALCULATE_PROFIT',
        functionBody: '=revenue - cost',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.18 list_named_functions dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'list_named_functions', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.19 delete_named_function dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'delete_named_function',
        spreadsheetId: 'test-sheet-id',
        functionName: 'CALCULATE_PROFIT',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('7.20 create_template dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'create_template',
        spreadsheetId: 'test-sheet-id',
        name: 'Budget Template',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });
});
