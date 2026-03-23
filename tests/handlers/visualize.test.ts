/**
 * ServalSheets - Visualize Handler Tests
 *
 * Tests for chart and pivot table operations.
 * Covers 18 actions: chart operations (create, suggest, update, delete, list, get,
 * move, resize, update_data_range, add_trendline, remove_trendline) and pivot operations
 * (create, suggest, update, delete, list, get, refresh)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisualizeHandler } from '../../src/handlers/visualize.js';
import { SheetsVisualizeOutputSchema } from '../../src/schemas/visualize.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

// Mock Google Sheets API
const createMockSheetsApi = () => ({
  spreadsheets: {
    values: {
      get: vi.fn().mockResolvedValue({
        data: {
          values: [
            ['Month', 'Sales', 'Expenses', 'Profit'],
            ['Jan', 1000, 400, 600],
            ['Feb', 1200, 450, 750],
            ['Mar', 1100, 420, 680],
          ],
        },
      }),
    },
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet-id',
        properties: { title: 'Test Spreadsheet' },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 1000, columnCount: 26 },
            },
            charts: [
              {
                chartId: 123,
                position: {
                  overlayPosition: {
                    anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 0 },
                    offsetXPixels: 10,
                    offsetYPixels: 20,
                    widthPixels: 600,
                    heightPixels: 400,
                  },
                },
                spec: {
                  title: 'Sales Chart',
                  basicChart: {
                    chartType: 'LINE',
                    domains: [
                      {
                        domain: {
                          sourceRange: {
                            sources: [
                              {
                                sheetId: 0,
                                startRowIndex: 0,
                                endRowIndex: 10,
                                startColumnIndex: 0,
                                endColumnIndex: 1,
                              },
                            ],
                          },
                        },
                      },
                    ],
                    series: [
                      {
                        series: {
                          sourceRange: {
                            sources: [
                              {
                                sheetId: 0,
                                startRowIndex: 0,
                                endRowIndex: 10,
                                startColumnIndex: 1,
                                endColumnIndex: 2,
                              },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
            data: [
              {
                rowData: [
                  {
                    values: [
                      {
                        pivotTable: {
                          source: {
                            sheetId: 0,
                            startRowIndex: 0,
                            endRowIndex: 10,
                            startColumnIndex: 0,
                            endColumnIndex: 5,
                          },
                          rows: [
                            {
                              sourceColumnOffset: 0,
                              showTotals: true,
                              sortOrder: 'ASCENDING',
                            },
                          ],
                          columns: [],
                          values: [
                            {
                              sourceColumnOffset: 2,
                              summarizeFunction: 'SUM',
                            },
                          ],
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
    }),
    batchUpdate: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet-id',
        replies: [{ addChart: { chart: { chartId: 456 } } }],
      },
    }),
  },
});

// Create mock context
const createMockContext = (overrides?: Partial<HandlerContext>): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {
    compile: vi.fn(),
    execute: vi.fn(),
    executeAll: vi.fn(),
  } as any,
  rangeResolver: {
    resolve: vi.fn().mockResolvedValue({
      a1Notation: 'Sheet1!A1:B10',
      sheetId: 0,
      sheetName: 'Sheet1',
    }),
  } as any,
  sheetsApi: createMockSheetsApi() as unknown as sheets_v4.Sheets,
  driveApi: undefined,
  sessionId: 'test-session',
  requestId: 'test-request',
  server: {
    createMessage: vi.fn().mockResolvedValue({
      model: 'claude-3-sonnet',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            suggestions: [
              { chartType: 'LINE', confidence: 90, explanation: 'Time series data' },
              { chartType: 'BAR', confidence: 70, explanation: 'Categorical comparison' },
            ],
          }),
        },
      ],
    }),
    getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
  } as any,
  elicitationServer: undefined,
  snapshotService: undefined,
  ...overrides,
});

describe('VisualizeHandler', () => {
  let handler: VisualizeHandler;
  let mockContext: HandlerContext;
  let mockApi: ReturnType<typeof createMockSheetsApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new VisualizeHandler(mockContext, mockApi as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // ====================================================================
  // CHART CREATE TESTS (Multiple Chart Types)
  // ====================================================================

  describe('chart_create', () => {
    it('should create a LINE chart', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'LINE',
        data: {
          sourceRange: { a1: 'Sheet1!A1:B10' },
          categories: 0,
          series: [{ column: 1 }],
        },
        position: { anchorCell: 'D1', width: 600, height: 400 },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.chartId).toBe(456);
      const parseResult = SheetsVisualizeOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should create a BAR chart', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'BAR',
        data: {
          sourceRange: { a1: 'Sheet1!A1:C10' },
          categories: 0,
          series: [{ column: 1 }, { column: 2 }],
        },
        position: { anchorCell: 'E1' },
      });

      expect(result.response.success).toBe(true);
    });

    it('respects position.sheetId when anchorCell omits the sheet prefix', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'LINE',
        data: {
          sourceRange: { a1: 'Sheet1!A1:B10' },
          categories: 0,
          series: [{ column: 1 }],
        },
        position: { anchorCell: 'E2', sheetId: 88964099 },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: [
              expect.objectContaining({
                addChart: expect.objectContaining({
                  chart: expect.objectContaining({
                    position: expect.objectContaining({
                      overlayPosition: expect.objectContaining({
                        anchorCell: expect.objectContaining({
                          sheetId: 88964099,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            ],
          }),
        })
      );
    });

    it('should create a COLUMN chart', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'COLUMN',
        data: {
          sourceRange: { a1: 'Sheet1!A1:D10' },
          categories: 0,
          series: [{ column: 1 }, { column: 2 }, { column: 3 }],
        },
        position: { anchorCell: 'A15' },
      });

      expect(result.response.success).toBe(true);
    });

    it('should create a PIE chart', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'PIE',
        data: {
          sourceRange: { a1: 'Sheet1!A1:B10' },
          categories: 0,
          series: [{ column: 1 }],
        },
        position: { anchorCell: 'F1' },
        options: { title: 'Distribution Chart', is3D: true },
      });

      expect(result.response.success).toBe(true);
    });

    it('should create a DOUGHNUT chart', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'DOUGHNUT',
        data: {
          sourceRange: { a1: 'Sheet1!A1:B10' },
          categories: 0,
          series: [{ column: 1 }],
        },
        position: { anchorCell: 'G1' },
        options: { pieHole: 0.4 },
      });

      expect(result.response.success).toBe(true);
    });

    it('should create an AREA chart', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'AREA',
        data: {
          sourceRange: { a1: 'Sheet1!A1:C10' },
          categories: 0,
          series: [{ column: 1 }, { column: 2 }],
        },
        position: { anchorCell: 'H1' },
        options: { stacked: true },
      });

      expect(result.response.success).toBe(true);
    });

    it('should create a SCATTER chart', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'SCATTER',
        data: {
          sourceRange: { a1: 'Sheet1!A1:C10' },
          categories: 0,
          series: [{ column: 1 }, { column: 2 }],
        },
        position: { anchorCell: 'I1' },
      });

      expect(result.response.success).toBe(true);
    });

    it('should create a HISTOGRAM chart', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'HISTOGRAM',
        data: {
          sourceRange: { a1: 'Sheet1!A1:B10' },
          categories: 0,
          series: [{ column: 1 }],
        },
        position: { anchorCell: 'J1' },
      });

      expect(result.response.success).toBe(true);
    });

    it('should create a chart with title and legend options', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'COLUMN',
        data: {
          sourceRange: { a1: 'Sheet1!A1:D10' },
          categories: 0,
          series: [{ column: 1 }, { column: 2 }, { column: 3 }],
        },
        position: { anchorCell: 'D1' },
        options: {
          title: 'Quarterly Performance',
          legendPosition: 'TOP',
        },
      });

      expect(result.response.success).toBe(true);
    });
  });

  // ====================================================================
  // CHART UPDATE TESTS
  // ====================================================================

  describe('chart_update', () => {
    it('should update chart title', async () => {
      const result = await handler.handle({
        action: 'chart_update',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        options: { title: 'Updated Title' },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should update chart type', async () => {
      const result = await handler.handle({
        action: 'chart_update',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        chartType: 'COLUMN',
      });

      expect(result.response.success).toBe(true);
    });

    it('should update chart position', async () => {
      const result = await handler.handle({
        action: 'chart_update',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        position: { anchorCell: 'F1', width: 800, height: 500 },
      });

      expect(result.response.success).toBe(true);
    });

    it('should update multiple chart properties at once', async () => {
      const result = await handler.handle({
        action: 'chart_update',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        chartType: 'BAR',
        options: { title: 'Sales by Region' },
        position: { anchorCell: 'E5' },
      });

      expect(result.response.success).toBe(true);
    });

    it('should return error when chart not found on update', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { sheetId: 0, title: 'Sheet1' },
              charts: [], // No charts
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'chart_update',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 999,
        options: { title: 'New Title' },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('RANGE_NOT_FOUND');
    });

    it('should handle update with no changes', async () => {
      const result = await handler.handle({
        action: 'chart_update',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
      });

      expect(result.response.success).toBe(true);
    });
  });

  // ====================================================================
  // CHART MOVE AND RESIZE TESTS
  // ====================================================================

  describe('chart_move', () => {
    it('should move a chart to a new position', async () => {
      const result = await handler.handle({
        action: 'chart_move',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        position: { anchorCell: 'L1', offsetX: 50, offsetY: 100 },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should move chart with offset pixels', async () => {
      const result = await handler.handle({
        action: 'chart_move',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        position: { anchorCell: 'M1', offsetX: 100, offsetY: 200 },
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('chart_resize', () => {
    it('should resize a chart', async () => {
      const result = await handler.handle({
        action: 'chart_resize',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        width: 800,
        height: 600,
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should resize with minimum dimensions', async () => {
      const result = await handler.handle({
        action: 'chart_resize',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        width: 300,
        height: 200,
      });

      expect(result.response.success).toBe(true);
    });
  });

  // ====================================================================
  // CHART DATA RANGE UPDATE TESTS
  // ====================================================================

  describe('chart_update_data_range', () => {
    it('should update chart data range', async () => {
      const result = await handler.handle({
        action: 'chart_update_data_range',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        data: {
          sourceRange: { a1: 'Sheet1!A1:D20' },
          categories: 0,
          series: [{ column: 1 }, { column: 2 }, { column: 3 }],
        },
      });

      expect(result.response.success).toBe(true);
    });

    it('should update data range with dry run', async () => {
      const result = await handler.handle({
        action: 'chart_update_data_range',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        data: {
          sourceRange: { a1: 'Sheet1!A1:E30' },
          categories: 0,
          series: [{ column: 1 }, { column: 2 }],
        },
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
    });
  });

  // ====================================================================
  // CHART TRENDLINE TESTS
  // ====================================================================

  describe('chart_add_trendline', () => {
    it('should add linear trendline to LINE chart', async () => {
      const result = await handler.handle({
        action: 'chart_add_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 0,
        trendline: {
          type: 'LINEAR',
          label: 'Trend',
          showRSquared: true,
          showEquation: true,
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should add polynomial trendline with degree', async () => {
      const result = await handler.handle({
        action: 'chart_add_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 0,
        trendline: {
          type: 'POLYNOMIAL',
          label: 'Polynomial Fit',
          showRSquared: true,
          polynomialDegree: 3,
        },
      });

      expect(result.response.success).toBe(true);
    });

    it('should add exponential trendline', async () => {
      const result = await handler.handle({
        action: 'chart_add_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 0,
        trendline: {
          type: 'EXPONENTIAL',
          label: 'Exponential',
          showRSquared: false,
        },
      });

      expect(result.response.success).toBe(true);
    });

    it('should add trendline with custom color', async () => {
      const result = await handler.handle({
        action: 'chart_add_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 0,
        trendline: {
          type: 'LINEAR',
          color: { red: 1, green: 0, blue: 0, alpha: 1 },
        },
      });

      expect(result.response.success).toBe(true);
    });

    it('should error when adding trendline to unsupported chart type', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              charts: [
                {
                  chartId: 123,
                  spec: {
                    pieChart: { domain: {}, series: {} }, // PIE is not compatible
                  },
                },
              ],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'chart_add_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 0,
        trendline: {
          type: 'LINEAR',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should surface FEATURE_UNAVAILABLE when the Sheets API rejects trendline updates', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              charts: [
                {
                  chartId: 123,
                  spec: {
                    basicChart: {
                      chartType: 'LINE',
                      legendPosition: 'BOTTOM_LEGEND',
                      axis: [],
                      domains: [{ domain: {} }],
                      series: [{ series: {} }],
                    },
                  },
                },
              ],
            },
          ],
        },
      });
      mockApi.spreadsheets.batchUpdate.mockRejectedValueOnce(
        new Error('Unknown name "trendline" at requests[0].updateChartSpec')
      );

      const result = await handler.handle({
        action: 'chart_add_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 0,
        trendline: {
          type: 'LINEAR',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('FEATURE_UNAVAILABLE');
    });

    it('should error when series index out of range', async () => {
      const result = await handler.handle({
        action: 'chart_add_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 99, // Out of range
        trendline: {
          type: 'LINEAR',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });
  });

  describe('chart_remove_trendline', () => {
    it('should remove trendline from series', async () => {
      // Mock a chart with trendline
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              charts: [
                {
                  chartId: 123,
                  spec: {
                    basicChart: {
                      chartType: 'LINE',
                      series: [
                        {
                          trendline: {
                            type: 'LINEAR',
                            label: 'Trend',
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'chart_remove_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 0,
      });

      expect(result.response.success).toBe(true);
    });

    it('should error when removing trendline that does not exist', async () => {
      // Mock a chart without trendline
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              charts: [
                {
                  chartId: 123,
                  spec: {
                    basicChart: {
                      chartType: 'LINE',
                      series: [
                        {
                          // No trendline
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'chart_remove_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 0,
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('NOT_FOUND');
    });

    it('should error with invalid series index on remove', async () => {
      const result = await handler.handle({
        action: 'chart_remove_trendline',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        seriesIndex: 99,
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });
  });

  // ====================================================================
  // CHART LIST AND GET TESTS
  // ====================================================================

  describe('chart_list', () => {
    it('should list all charts in a spreadsheet', async () => {
      const result = await handler.handle({
        action: 'chart_list',
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);
      expect(result.response.charts).toBeDefined();
      expect(Array.isArray(result.response.charts)).toBe(true);
    });

    it('should list charts filtered by sheet ID', async () => {
      const result = await handler.handle({
        action: 'chart_list',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
    });

    it('should return empty list when no charts exist', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { sheetId: 0, title: 'Sheet1' },
              charts: [],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'chart_list',
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);
      expect(result.response.charts?.length).toBe(0);
    });
  });

  describe('chart_get', () => {
    it('should get a specific chart by ID', async () => {
      const result = await handler.handle({
        action: 'chart_get',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
      });

      expect(result.response.success).toBe(true);
      expect(result.response.charts).toBeDefined();
      expect(result.response.charts?.[0]?.chartId).toBe(123);
    });

    it('should return error when chart not found', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { sheetId: 0 },
              charts: [],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'chart_get',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 999,
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('SHEET_NOT_FOUND');
    });
  });

  // ====================================================================
  // CHART DELETE TEST
  // ====================================================================

  describe('chart_delete', () => {
    it('should delete a chart', async () => {
      const result = await handler.handle({
        action: 'chart_delete',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should delete with dry run mode', async () => {
      const result = await handler.handle({
        action: 'chart_delete',
        spreadsheetId: 'test-spreadsheet-id',
        chartId: 123,
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
      // Should not call batchUpdate in dry run
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ====================================================================
  // CHART SUGGEST TESTS
  // ====================================================================

  describe('suggest_chart', () => {
    it('should suggest chart types for data range', async () => {
      const result = await handler.handle({
        action: 'suggest_chart',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:D100' },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.suggestions).toBeDefined();
    });

    it('should suggest charts with max suggestions limit', async () => {
      const result = await handler.handle({
        action: 'suggest_chart',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:D100' },
        maxSuggestions: 5,
      });

      expect(result.response.success).toBe(true);
    });

    it('should error when range is missing', async () => {
      const result = await handler.handle({
        action: 'suggest_chart',
        spreadsheetId: 'test-spreadsheet-id',
      } as any);

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should error when range has no data', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { values: [] },
      });

      const result = await handler.handle({
        action: 'suggest_chart',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:D100' },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('falls back to heuristic suggestions when AI support is unavailable', async () => {
      vi.stubEnv('LLM_API_KEY', '');
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.stubEnv('GOOGLE_API_KEY', '');

      handler = new VisualizeHandler(
        createMockContext({ server: undefined }),
        mockApi as unknown as sheets_v4.Sheets
      );

      const result = await handler.handle({
        action: 'suggest_chart',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:D100' },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.suggestions?.length).toBeGreaterThan(0);
        expect(result.response.suggestions?.[0]?.type).toBe('chart');
      }
    });

    it('falls back to heuristic suggestions when AI suggestion generation fails', async () => {
      mockContext = createMockContext({
        server: {
          createMessage: vi.fn().mockRejectedValue(new Error('Sampling temporarily unavailable')),
          getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
        } as any,
      });
      handler = new VisualizeHandler(mockContext, mockApi as any);

      const result = await handler.handle({
        action: 'suggest_chart',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:D100' },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.suggestions?.length).toBeGreaterThan(0);
      }
    });
  });

  // ====================================================================
  // PIVOT CREATE TESTS
  // ====================================================================

  describe('pivot_create', () => {
    it('should create a basic pivot table', async () => {
      const result = await handler.handle({
        action: 'pivot_create',
        spreadsheetId: 'test-spreadsheet-id',
        sourceRange: { a1: 'Sheet1!A1:E100' },
        rows: [{ sourceColumnOffset: 0 }],
        values: [{ sourceColumnOffset: 2, summarizeFunction: 'SUM' }],
      });

      expect(result.response.success).toBe(true);
      expect(result.response.pivotTable).toBeDefined();
    });

    it('should create pivot with multiple row and column groups', async () => {
      const result = await handler.handle({
        action: 'pivot_create',
        spreadsheetId: 'test-spreadsheet-id',
        sourceRange: { a1: 'Sheet1!A1:F50' },
        rows: [
          { sourceColumnOffset: 0, showTotals: true, sortOrder: 'ASCENDING' },
          { sourceColumnOffset: 1, showTotals: true },
        ],
        columns: [{ sourceColumnOffset: 2, showTotals: true }],
        values: [
          { sourceColumnOffset: 3, summarizeFunction: 'SUM', name: 'Total Sales' },
          { sourceColumnOffset: 4, summarizeFunction: 'AVERAGE', name: 'Avg Cost' },
        ],
      });

      expect(result.response.success).toBe(true);
    });

    it('should create pivot with filters', async () => {
      const result = await handler.handle({
        action: 'pivot_create',
        spreadsheetId: 'test-spreadsheet-id',
        sourceRange: { a1: 'Sheet1!A1:F100' },
        rows: [{ sourceColumnOffset: 0 }],
        values: [{ sourceColumnOffset: 3, summarizeFunction: 'SUM' }],
        filters: [
          {
            sourceColumnOffset: 1,
            filterCriteria: {
              visibleValues: ['Q1', 'Q2', 'Q3'],
            },
          },
        ],
      });

      expect(result.response.success).toBe(true);
    });

    it('should create pivot at specific destination', async () => {
      const result = await handler.handle({
        action: 'pivot_create',
        spreadsheetId: 'test-spreadsheet-id',
        sourceRange: { a1: 'Sheet1!A1:E100' },
        rows: [{ sourceColumnOffset: 0 }],
        values: [{ sourceColumnOffset: 2, summarizeFunction: 'SUM' }],
        destinationCell: 'H1',
      });

      expect(result.response.success).toBe(true);
    });

    it('should create pivot on specific sheet', async () => {
      const result = await handler.handle({
        action: 'pivot_create',
        spreadsheetId: 'test-spreadsheet-id',
        sourceRange: { a1: 'Sheet1!A1:E100' },
        rows: [{ sourceColumnOffset: 0 }],
        values: [{ sourceColumnOffset: 2, summarizeFunction: 'SUM' }],
        destinationSheetId: 1,
      });

      expect(result.response.success).toBe(true);
    });

    it('should create pivot with histogram grouping', async () => {
      const result = await handler.handle({
        action: 'pivot_create',
        spreadsheetId: 'test-spreadsheet-id',
        sourceRange: { a1: 'Sheet1!A1:E100' },
        rows: [
          {
            sourceColumnOffset: 0,
            groupRule: {
              histogramRule: { interval: 10, start: 0, end: 100 },
            },
          },
        ],
        values: [{ sourceColumnOffset: 2, summarizeFunction: 'SUM' }],
      });

      expect(result.response.success).toBe(true);
    });
  });

  // ====================================================================
  // PIVOT UPDATE TESTS
  // ====================================================================

  describe('pivot_update', () => {
    it('should update pivot table configuration', async () => {
      const result = await handler.handle({
        action: 'pivot_update',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        rows: [{ sourceColumnOffset: 1 }],
        columns: [{ sourceColumnOffset: 2 }],
        values: [{ sourceColumnOffset: 3, summarizeFunction: 'AVERAGE' }],
      });

      expect(result.response.success).toBe(true);
    });

    it('should update pivot with dry run', async () => {
      const result = await handler.handle({
        action: 'pivot_update',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        rows: [{ sourceColumnOffset: 0 }],
        values: [{ sourceColumnOffset: 2, summarizeFunction: 'SUM' }],
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
    });

    it('should error when pivot not found on update', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { sheetId: 0 },
              data: [{ rowData: [{ values: [] }] }],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'pivot_update',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        rows: [{ sourceColumnOffset: 0 }],
        values: [{ sourceColumnOffset: 2, summarizeFunction: 'SUM' }],
      });

      expect(result.response.success).toBe(false);
    });
  });

  // ====================================================================
  // PIVOT DELETE TESTS
  // ====================================================================

  describe('pivot_delete', () => {
    it('should delete a pivot table', async () => {
      const result = await handler.handle({
        action: 'pivot_delete',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should delete pivot with dry run', async () => {
      const result = await handler.handle({
        action: 'pivot_delete',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
      // Should not call batchUpdate in dry run
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ====================================================================
  // PIVOT LIST AND GET TESTS
  // ====================================================================

  describe('pivot_list', () => {
    it('should list all pivot tables in spreadsheet', async () => {
      const result = await handler.handle({
        action: 'pivot_list',
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);
      expect(result.response.pivotTables).toBeDefined();
    });

    it('should return empty list when no pivots exist', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { sheetId: 0, title: 'Sheet1' },
              data: [{ rowData: [{ values: [] }] }],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'pivot_list',
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);
      expect(result.response.pivotTables?.length).toBe(0);
    });
  });

  describe('pivot_get', () => {
    it('should get a specific pivot table', async () => {
      const result = await handler.handle({
        action: 'pivot_get',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
      expect(result.response.pivotTable).toBeDefined();
    });

    it('should successfully get a pivot table by sheet ID', async () => {
      // The default mock has pivot data already
      const result = await handler.handle({
        action: 'pivot_get',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
      expect(result.response.pivotTable).toBeDefined();
    });
  });

  // ====================================================================
  // PIVOT REFRESH TESTS
  // ====================================================================

  describe('pivot_refresh', () => {
    it('should refresh a pivot table', async () => {
      const result = await handler.handle({
        action: 'pivot_refresh',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
      // Pivot tables auto-refresh; no API call needed
      expect(result.response.message).toContain('automatically');
    });

    it('should handle pivot refresh with validateGridDataSize check', async () => {
      const result = await handler.handle({
        action: 'pivot_refresh',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
    });
  });

  // ====================================================================
  // PIVOT SUGGEST TESTS
  // ====================================================================

  describe('suggest_pivot', () => {
    it('should suggest pivot table configurations', async () => {
      const result = await handler.handle({
        action: 'suggest_pivot',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:F100' },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.suggestions).toBeDefined();
    });

    it('should suggest pivots with max suggestions limit', async () => {
      const result = await handler.handle({
        action: 'suggest_pivot',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:F100' },
        maxSuggestions: 3,
      });

      expect(result.response.success).toBe(true);
    });

    it('should error when range is missing', async () => {
      const result = await handler.handle({
        action: 'suggest_pivot',
        spreadsheetId: 'test-spreadsheet-id',
      } as any);

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should error when range has no data', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { values: [] },
      });

      const result = await handler.handle({
        action: 'suggest_pivot',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:F100' },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('falls back to heuristic suggestions when AI support is unavailable', async () => {
      mockContext = createMockContext({ server: undefined });
      handler = new VisualizeHandler(mockContext, mockApi as any);

      const result = await handler.handle({
        action: 'suggest_pivot',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:F100' },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.suggestions?.length).toBeGreaterThan(0);
      expect(result.response.suggestions?.[0]?.type).toBe('pivot');
    });

    it('falls back to heuristic suggestions when AI returns invalid JSON', async () => {
      mockContext = createMockContext({
        server: {
          createMessage: vi.fn().mockResolvedValue({
            model: 'claude-3-sonnet',
            role: 'assistant',
            content: [{ type: 'text', text: 'not valid json' }],
          }),
          getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
        } as any,
      });
      handler = new VisualizeHandler(mockContext, mockApi as any);

      const result = await handler.handle({
        action: 'suggest_pivot',
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:F100' },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.suggestions?.length).toBeGreaterThan(0);
      expect(result.response.suggestions?.[0]?.type).toBe('pivot');
    });
  });

  // ====================================================================
  // OUTPUT VALIDATION TESTS
  // ====================================================================

  describe('output schema validation', () => {
    it('should produce valid output for chart_create', async () => {
      const result = await handler.handle({
        action: 'chart_create',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
        chartType: 'LINE',
        data: {
          sourceRange: { a1: 'Sheet1!A1:B10' },
          categories: 0,
          series: [{ column: 1 }],
        },
        position: { anchorCell: 'D1' },
      });

      const parseResult = SheetsVisualizeOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should produce valid output for pivot_create', async () => {
      const result = await handler.handle({
        action: 'pivot_create',
        spreadsheetId: 'test-spreadsheet-id',
        sourceRange: { a1: 'Sheet1!A1:E100' },
        rows: [{ sourceColumnOffset: 0 }],
        values: [{ sourceColumnOffset: 2, summarizeFunction: 'SUM' }],
      });

      const parseResult = SheetsVisualizeOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });
});
