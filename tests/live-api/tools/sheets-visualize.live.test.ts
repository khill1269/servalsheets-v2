/**
 * Live API Tests for sheets_visualize Tool
 *
 * Tests chart and pivot table operations against the real Google Sheets API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet with unique ranges per test, no beforeEach clearing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_visualize Live API Tests', () => {
  let client: LiveApiClient;
  let manager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;
  let sheetId: number;
  let benchmarksSheetId: number;

  beforeAll(async () => {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error('Test credentials not available');
    }
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);

    testSpreadsheet = await manager.createTestSpreadsheet('visualize');

    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;

    // Find or create Benchmarks sheet
    const benchmarks = meta.data.sheets?.find((s) => s.properties?.title === 'Benchmarks');
    if (benchmarks) {
      benchmarksSheetId = benchmarks.properties!.sheetId!;
    } else {
      const addResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [{ addSheet: { properties: { title: 'Benchmarks' } } }],
        },
      });
      benchmarksSheetId = addResponse.data.replies![0].addSheet?.properties?.sheetId!;
    }

    // Pre-seed TestData sheet once
    await client.sheets.spreadsheets.values.update({
      spreadsheetId: testSpreadsheet.id,
      range: 'TestData!A1:D6',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['Month', 'Sales', 'Expenses', 'Profit'],
          ['Jan', 10000, 7000, 3000],
          ['Feb', 12000, 7500, 4500],
          ['Mar', 11000, 6800, 4200],
          ['Apr', 15000, 8000, 7000],
          ['May', 14000, 7200, 6800],
        ],
      },
    });

    // Pre-seed Benchmarks sheet for pivot tables
    await client.sheets.spreadsheets.values.update({
      spreadsheetId: testSpreadsheet.id,
      range: 'Benchmarks!A1:D10',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['Region', 'Product', 'Quarter', 'Revenue'],
          ['North', 'Widget A', 'Q1', 10000],
          ['North', 'Widget B', 'Q1', 15000],
          ['South', 'Widget A', 'Q1', 12000],
          ['South', 'Widget B', 'Q1', 8000],
          ['North', 'Widget A', 'Q2', 11000],
          ['North', 'Widget B', 'Q2', 16000],
          ['South', 'Widget A', 'Q2', 13000],
          ['South', 'Widget B', 'Q2', 9000],
        ],
      },
    });
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Chart Operations', () => {
    it('should create a basic column chart', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addChart: {
                chart: {
                  spec: {
                    title: 'Monthly Sales',
                    basicChart: {
                      chartType: 'COLUMN',
                      legendPosition: 'BOTTOM_LEGEND',
                      axis: [
                        { position: 'BOTTOM_AXIS', title: 'Month' },
                        { position: 'LEFT_AXIS', title: 'Amount' },
                      ],
                      domains: [
                        {
                          domain: {
                            sourceRange: {
                              sources: [
                                {
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
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
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
                                  startColumnIndex: 1,
                                  endColumnIndex: 2,
                                },
                              ],
                            },
                          },
                          targetAxis: 'LEFT_AXIS',
                        },
                      ],
                      headerCount: 1,
                    },
                  },
                  position: {
                    overlayPosition: {
                      anchorCell: { sheetId, rowIndex: 0, columnIndex: 5 },
                      widthPixels: 600,
                      heightPixels: 400,
                    },
                  },
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.data.replies![0].addChart?.chart?.chartId).toBeDefined();
    });

    it('should create a line chart', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addChart: {
                chart: {
                  spec: {
                    title: 'Sales Trend',
                    basicChart: {
                      chartType: 'LINE',
                      legendPosition: 'RIGHT_LEGEND',
                      domains: [
                        {
                          domain: {
                            sourceRange: {
                              sources: [
                                {
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
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
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
                                  startColumnIndex: 1,
                                  endColumnIndex: 2,
                                },
                              ],
                            },
                          },
                        },
                        {
                          series: {
                            sourceRange: {
                              sources: [
                                {
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
                                  startColumnIndex: 2,
                                  endColumnIndex: 3,
                                },
                              ],
                            },
                          },
                        },
                      ],
                      headerCount: 1,
                    },
                  },
                  position: {
                    overlayPosition: {
                      anchorCell: { sheetId, rowIndex: 10, columnIndex: 0 },
                      widthPixels: 600,
                      heightPixels: 400,
                    },
                  },
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should create a pie chart', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addChart: {
                chart: {
                  spec: {
                    title: 'Sales Distribution',
                    pieChart: {
                      legendPosition: 'RIGHT_LEGEND',
                      domain: {
                        sourceRange: {
                          sources: [
                            {
                              sheetId,
                              startRowIndex: 1,
                              endRowIndex: 6,
                              startColumnIndex: 0,
                              endColumnIndex: 1,
                            },
                          ],
                        },
                      },
                      series: {
                        sourceRange: {
                          sources: [
                            {
                              sheetId,
                              startRowIndex: 1,
                              endRowIndex: 6,
                              startColumnIndex: 1,
                              endColumnIndex: 2,
                            },
                          ],
                        },
                      },
                    },
                  },
                  position: {
                    overlayPosition: {
                      anchorCell: { sheetId, rowIndex: 0, columnIndex: 10 },
                      widthPixels: 400,
                      heightPixels: 400,
                    },
                  },
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should update chart title', async () => {
      const createResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addChart: {
                chart: {
                  spec: {
                    title: 'Original Title',
                    basicChart: {
                      chartType: 'BAR',
                      domains: [
                        {
                          domain: {
                            sourceRange: {
                              sources: [
                                {
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
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
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
                                  startColumnIndex: 1,
                                  endColumnIndex: 2,
                                },
                              ],
                            },
                          },
                        },
                      ],
                      headerCount: 1,
                    },
                  },
                  position: {
                    overlayPosition: {
                      anchorCell: { sheetId, rowIndex: 20, columnIndex: 5 },
                      widthPixels: 400,
                      heightPixels: 300,
                    },
                  },
                },
              },
            },
          ],
        },
      });

      const chartId = createResponse.data.replies![0].addChart?.chart?.chartId;
      expect(chartId).toBeDefined();

      const updateResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateChartSpec: {
                chartId,
                spec: {
                  title: 'Updated Title',
                  basicChart: {
                    chartType: 'BAR',
                    domains: [
                      {
                        domain: {
                          sourceRange: {
                            sources: [
                              {
                                sheetId,
                                startRowIndex: 0,
                                endRowIndex: 6,
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
                                sheetId,
                                startRowIndex: 0,
                                endRowIndex: 6,
                                startColumnIndex: 1,
                                endColumnIndex: 2,
                              },
                            ],
                          },
                        },
                      },
                    ],
                    headerCount: 1,
                  },
                },
              },
            },
          ],
        },
      });

      expect(updateResponse.status).toBe(200);
    });

    it('should delete a chart', async () => {
      const createResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addChart: {
                chart: {
                  spec: {
                    title: 'To Be Deleted',
                    basicChart: {
                      chartType: 'COLUMN',
                      domains: [
                        {
                          domain: {
                            sourceRange: {
                              sources: [
                                {
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
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
                                  sheetId,
                                  startRowIndex: 0,
                                  endRowIndex: 6,
                                  startColumnIndex: 1,
                                  endColumnIndex: 2,
                                },
                              ],
                            },
                          },
                        },
                      ],
                      headerCount: 1,
                    },
                  },
                  position: {
                    overlayPosition: {
                      anchorCell: { sheetId, rowIndex: 30, columnIndex: 5 },
                      widthPixels: 400,
                      heightPixels: 300,
                    },
                  },
                },
              },
            },
          ],
        },
      });

      const chartId = createResponse.data.replies![0].addChart?.chart?.chartId;

      const deleteResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [{ deleteEmbeddedObject: { objectId: chartId } }],
        },
      });

      expect(deleteResponse.status).toBe(200);

      const verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
      });

      const charts = verifyResponse.data.sheets![0].charts ?? [];
      const deletedChart = charts.find((c) => c.chartId === chartId);
      expect(deletedChart).toBeUndefined();
    });
  });

  describe('Pivot Table Operations', () => {
    it('should create a basic pivot table', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateCells: {
                rows: [
                  {
                    values: [
                      {
                        pivotTable: {
                          source: {
                            sheetId: benchmarksSheetId,
                            startRowIndex: 0,
                            endRowIndex: 9,
                            startColumnIndex: 0,
                            endColumnIndex: 4,
                          },
                          rows: [
                            { sourceColumnOffset: 0, showTotals: true, sortOrder: 'ASCENDING' },
                          ],
                          columns: [
                            { sourceColumnOffset: 2, showTotals: true, sortOrder: 'ASCENDING' },
                          ],
                          values: [{ sourceColumnOffset: 3, summarizeFunction: 'SUM' }],
                        },
                      },
                    ],
                  },
                ],
                start: { sheetId: benchmarksSheetId, rowIndex: 12, columnIndex: 0 },
                fields: 'pivotTable',
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should create pivot table with multiple values', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateCells: {
                rows: [
                  {
                    values: [
                      {
                        pivotTable: {
                          source: {
                            sheetId: benchmarksSheetId,
                            startRowIndex: 0,
                            endRowIndex: 9,
                            startColumnIndex: 0,
                            endColumnIndex: 4,
                          },
                          rows: [
                            { sourceColumnOffset: 1, showTotals: true, sortOrder: 'ASCENDING' },
                          ],
                          values: [
                            {
                              sourceColumnOffset: 3,
                              summarizeFunction: 'SUM',
                              name: 'Total Revenue',
                            },
                            {
                              sourceColumnOffset: 3,
                              summarizeFunction: 'AVERAGE',
                              name: 'Avg Revenue',
                            },
                            { sourceColumnOffset: 3, summarizeFunction: 'COUNTA', name: 'Count' },
                          ],
                        },
                      },
                    ],
                  },
                ],
                start: { sheetId: benchmarksSheetId, rowIndex: 20, columnIndex: 0 },
                fields: 'pivotTable',
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid chart configuration gracefully', async () => {
      await expect(
        client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addChart: {
                  chart: {
                    spec: {
                      title: 'Invalid Chart',
                      basicChart: {
                        chartType: 'COLUMN',
                        domains: [],
                        series: [],
                      },
                    },
                    position: {
                      overlayPosition: { anchorCell: { sheetId, rowIndex: 40, columnIndex: 0 } },
                    },
                  },
                },
              },
            ],
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should track chart creation latency', async () => {
      client.resetMetrics();

      await client.trackOperation('batchUpdate', 'POST', () =>
        client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addChart: {
                  chart: {
                    spec: {
                      title: 'Performance Test Chart',
                      basicChart: {
                        chartType: 'COLUMN',
                        domains: [
                          {
                            domain: {
                              sourceRange: {
                                sources: [
                                  {
                                    sheetId,
                                    startRowIndex: 0,
                                    endRowIndex: 6,
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
                                    sheetId,
                                    startRowIndex: 0,
                                    endRowIndex: 6,
                                    startColumnIndex: 1,
                                    endColumnIndex: 2,
                                  },
                                ],
                              },
                            },
                          },
                        ],
                        headerCount: 1,
                      },
                    },
                    position: {
                      overlayPosition: {
                        anchorCell: { sheetId, rowIndex: 50, columnIndex: 5 },
                        widthPixels: 400,
                        heightPixels: 300,
                      },
                    },
                  },
                },
              },
            ],
          },
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
      expect(stats.avgDuration).toBeGreaterThan(0);
    });
  });
});
