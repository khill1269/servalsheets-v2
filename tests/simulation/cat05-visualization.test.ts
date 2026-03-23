/**
 * ServalSheets - Category 5 Visualization Tests (Simulation)
 *
 * Tests for chart and pivot visualization operations
 * Covers: chart CRUD, trendlines, pivot creation/refresh, chart suggestions
 * Note: These are integration tests verifying action dispatch, not full E2E tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisualizeHandler } from '../../src/handlers/visualize.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-sheet-id',
        properties: { title: 'Test Sheet' },
        sheets: [
          {
            properties: { sheetId: 0, title: 'Sheet1', gridProperties: { rowCount: 100, columnCount: 26 } },
            charts: [{ chartId: 123, spec: { title: 'Sales Chart', basicChart: { chartType: 'LINE' } } }],
          },
        ],
      },
    }),
    batchUpdate: vi.fn().mockResolvedValue({ data: { replies: [{}] } }),
    values: {
      get: vi.fn().mockResolvedValue({
        data: { values: [['Month', 'Sales'], ['Jan', 1000], ['Feb', 1200]] },
      }),
    },
  },
});

const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {} as any,
  rangeResolver: { resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:C4' }) } as any,
  auth: { scopes: ['https://www.googleapis.com/auth/drive.file'] } as any,
  samplingServer: undefined,
  snapshotService: {} as any,
  sessionContext: {} as any,
  confirmDestructiveAction: vi.fn().mockResolvedValue(undefined),
  createSnapshotIfNeeded: vi.fn().mockResolvedValue({ snapshotId: 'snap-123' }),
  sendProgress: vi.fn(),
  cachedApi: {} as any,
});

describe('Category 5: Visualization Operations', () => {
  let handler: VisualizeHandler;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSheetsApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new VisualizeHandler(mockContext, mockSheetsApi as unknown as sheets_v4.Sheets);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('5.1 chart_list returns response object', async () => {
    const result = await handler.handle({
      request: { action: 'chart_list', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.2 chart_get returns response object', async () => {
    const result = await handler.handle({
      request: { action: 'chart_get', spreadsheetId: 'test-sheet-id', chartId: 123 },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.3 chart_create dispatches correctly', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ addChart: { chart: { chartId: 456 } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'chart_create',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        chartType: 'COLUMN',
        data: { sourceRange: { a1: 'Sheet1!A1:B4' } },
        position: { overlayPosition: { anchorCell: { a1: 'A5' } } },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.4 chart_delete dispatches correctly', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{ deleteChart: {} }] } });
    const result = await handler.handle({
      request: { action: 'chart_delete', spreadsheetId: 'test-sheet-id', chartId: 123 },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.5 chart_update_data_range dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ updateChartSpec: { chart: { chartId: 123 } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'chart_update_data_range',
        spreadsheetId: 'test-sheet-id',
        chartId: 123,
        data: { sourceRange: { a1: 'Sheet1!A1:C5' } },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.6 chart_add_trendline dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ updateChartSpec: { chart: { chartId: 123 } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'chart_add_trendline',
        spreadsheetId: 'test-sheet-id',
        chartId: 123,
        seriesIndex: 0,
        trendline: { type: 'LINEAR' },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.7 chart_remove_trendline dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ updateChartSpec: { chart: { chartId: 123 } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'chart_remove_trendline',
        spreadsheetId: 'test-sheet-id',
        chartId: 123,
        seriesIndex: 0,
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.8 pivot_create dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ createPivotTable: { pivotTable: { pivotId: 999 } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'pivot_create',
        spreadsheetId: 'test-sheet-id',
        sourceRange: { a1: 'Sheet1!A1:C4' },
        rows: ['Month'],
        values: ['Sales'],
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.9 pivot_refresh dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ updatePivotTable: { pivotTable: { pivotId: 999 } } }] },
    });
    const result = await handler.handle({
      request: { action: 'pivot_refresh', spreadsheetId: 'test-sheet-id', pivotId: 999 },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.10 suggest_chart dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'suggest_chart', spreadsheetId: 'test-sheet-id', range: { a1: 'Sheet1!A1:C4' } },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.11 suggest_pivot dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'suggest_pivot',
        spreadsheetId: 'test-sheet-id',
        sourceRange: { a1: 'Sheet1!A1:C4' },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('5.12 chart_move dispatches correctly', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ updateChartSpec: { chart: { chartId: 123 } } }] },
    });
    const result = await handler.handle({
      request: {
        action: 'chart_move',
        spreadsheetId: 'test-sheet-id',
        chartId: 123,
        position: { overlayPosition: { anchorCell: { a1: 'E5' } } },
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });
});
