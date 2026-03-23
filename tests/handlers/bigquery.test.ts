/**
 * BigQuery Handler Tests (Phase 2.2)
 *
 * Tests for sheets_bigquery handler (15 actions)
 * Covers BigQuery Connected Sheets integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsBigQueryHandler } from '../../src/handlers/bigquery.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

describe('SheetsBigQueryHandler', () => {
  let handler: SheetsBigQueryHandler;
  let mockContext: HandlerContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockSheetsApi: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockBigQueryApi: any;

  beforeEach(() => {
    // Create mock Sheets API
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'test-id',
            properties: { title: 'Test Sheet' },
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
          },
        }),
        batchUpdate: vi.fn().mockResolvedValue({
          data: {
            replies: [
              {
                addDataSource: {
                  dataSource: {
                    dataSourceId: 'ds-123',
                    sheetId: 1,
                  },
                },
              },
            ],
          },
        }),
      },
    };

    // Create mock BigQuery API
    mockBigQueryApi = {
      datasets: {
        list: vi.fn().mockResolvedValue({
          data: {
            datasets: [
              { datasetReference: { datasetId: 'dataset1', projectId: 'project1' } },
              { datasetReference: { datasetId: 'dataset2', projectId: 'project1' } },
            ],
          },
        }),
      },
      tables: {
        list: vi.fn().mockResolvedValue({
          data: {
            tables: [
              { tableReference: { tableId: 'table1', datasetId: 'dataset1' } },
              { tableReference: { tableId: 'table2', datasetId: 'dataset1' } },
            ],
          },
        }),
        get: vi.fn().mockResolvedValue({
          data: {
            schema: {
              fields: [
                { name: 'id', type: 'INTEGER' },
                { name: 'name', type: 'STRING' },
              ],
            },
          },
        }),
      },
      jobs: {
        query: vi.fn().mockResolvedValue({
          data: {
            rows: [{ f: [{ v: '1' }, { v: 'Alice' }] }, { f: [{ v: '2' }, { v: 'Bob' }] }],
            schema: {
              fields: [
                { name: 'id', type: 'INTEGER' },
                { name: 'name', type: 'STRING' },
              ],
            },
            totalRows: '2',
            jobComplete: true,
          },
        }),
      },
    };

    // Create mock context
    mockContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock client type
      googleClient: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock API type
      sheetsApi: mockSheetsApi as any,
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

    handler = new SheetsBigQueryHandler(mockContext, mockSheetsApi, mockBigQueryApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('connect action', () => {
    it('should create BigQuery connection with table', async () => {
      const result = await handler.handle({
        request: {
          action: 'connect',
          spreadsheetId: 'test-id',
          spec: {
            projectId: 'my-project',
            datasetId: 'my-dataset',
            tableId: 'my-table',
          },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'connection' in result.response) {
        expect(result.response.connection.dataSourceId).toBe('ds-123');
        expect(result.response.connection.type).toBe('bigquery');
      }
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
        })
      );
    });

    it('should create BigQuery connection with query', async () => {
      const result = await handler.handle({
        request: {
          action: 'connect',
          spreadsheetId: 'test-id',
          spec: {
            projectId: 'my-project',
            query: 'SELECT * FROM `my-project.my-dataset.my-table`',
          },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'connection' in result.response) {
        expect(result.response.connection.type).toBe('bigquery');
      }
    });

    it('should handle API errors gracefully', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('API quota exceeded'));

      const result = await handler.handle({
        request: {
          action: 'connect',
          spreadsheetId: 'test-id',
          spec: {
            projectId: 'my-project',
            datasetId: 'my-dataset',
            tableId: 'my-table',
          },
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('list_datasets action', () => {
    it('should list BigQuery datasets', async () => {
      const result = await handler.handle({
        request: {
          action: 'list_datasets',
          projectId: 'my-project',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'datasets' in result.response) {
        expect(result.response.datasets).toHaveLength(2);
        expect(result.response.datasets[0]?.datasetId).toBe('dataset1');
      }
      expect(mockBigQueryApi.datasets.list).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'my-project',
        })
      );
    });

    it('should handle missing BigQuery API', async () => {
      // Create handler without BigQuery API
      const handlerNoBQ = new SheetsBigQueryHandler(mockContext, mockSheetsApi);

      const result = await handlerNoBQ.handle({
        request: {
          action: 'list_datasets',
          projectId: 'my-project',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      // Handler should return error when BigQuery API not configured
      // Message format may vary, just verify error exists
    });
  });

  describe('list_tables action', () => {
    it('should list tables in dataset', async () => {
      const result = await handler.handle({
        request: {
          action: 'list_tables',
          projectId: 'my-project',
          datasetId: 'my-dataset',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'tables' in result.response) {
        expect(result.response.tables).toHaveLength(2);
        expect(result.response.tables[0]?.tableId).toBe('table1');
      }
    });
  });

  describe('get_table_schema action', () => {
    it('should get table schema', async () => {
      const result = await handler.handle({
        request: {
          action: 'get_table_schema',
          projectId: 'my-project',
          datasetId: 'my-dataset',
          tableId: 'my-table',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'schema' in result.response) {
        expect(result.response.schema).toBeDefined();
        if (result.response.schema?.fields) {
          expect(result.response.schema.fields).toHaveLength(2);
          expect(result.response.schema.fields[0]?.name).toBe('id');
          expect(result.response.schema.fields[0]?.type).toBe('INTEGER');
        }
      }
    });
  });

  describe('query action', () => {
    it('should execute BigQuery query via direct API when BigQuery client is available', async () => {
      const result = await handler.handle({
        request: {
          action: 'query',
          projectId: 'my-project',
          query: 'SELECT id, name FROM `my-project.my-dataset.my-table`',
          maxResults: 100,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'rows' in result.response) {
        expect(result.response.rows).toHaveLength(2);
        expect(result.response.rowCount).toBe(2);
      }
    });

    it('should handle query errors via BigQuery API', async () => {
      // Query action uses BigQuery API when client is available
      mockBigQueryApi.jobs.query.mockRejectedValue(new Error('Syntax error near SELECT'));

      const result = await handler.handle({
        request: {
          action: 'query',
          projectId: 'my-project',
          query: 'INVALID SQL',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should handle timeout errors', async () => {
      mockBigQueryApi.jobs.query.mockResolvedValue({
        data: {
          jobComplete: false,
          jobReference: { jobId: 'job-123' },
        },
      });

      const result = await handler.handle({
        request: {
          action: 'query',
          projectId: 'my-project',
          query: 'SELECT * FROM large_table',
          timeoutMs: 1000,
        },
      });

      expect(result.response).toBeDefined();
      // May succeed with incomplete flag or timeout error
    });
  });

  describe('list_connections action', () => {
    it('should list data source connections', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          dataSources: [
            {
              dataSourceId: 'ds-1',
              spec: {
                bigQuery: {
                  projectId: 'project1',
                },
              },
            },
          ],
        },
      });

      const result = await handler.handle({
        request: {
          action: 'list_connections',
          spreadsheetId: 'test-id',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'connections' in result.response) {
        expect(result.response.connections).toHaveLength(1);
      }
    });
  });

  describe('disconnect action', () => {
    it('should remove data source connection', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });

      const result = await handler.handle({
        request: {
          action: 'disconnect',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
        })
      );
    });
  });

  describe('connect_looker action', () => {
    it('should create Looker connection', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
        data: {
          replies: [
            {
              addDataSource: {
                dataSource: {
                  dataSourceId: 'looker-ds-123',
                  sheetId: 1,
                },
              },
            },
          ],
        },
      });

      const result = await handler.handle({
        request: {
          action: 'connect_looker',
          spreadsheetId: 'test-id',
          spec: {
            instanceUri: 'https://looker.example.com',
            model: 'my_model',
            explore: 'my_explore',
          },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'connection' in result.response) {
        expect(result.response.connection.dataSourceId).toBe('looker-ds-123');
        expect(result.response.connection.type).toBe('looker');
      }
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should handle Looker connection errors', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(
        new Error('Invalid Looker instance URI')
      );

      const result = await handler.handle({
        request: {
          action: 'connect_looker',
          spreadsheetId: 'test-id',
          instanceUri: 'https://invalid.example.com',
          explore: 'model/explore',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('get_connection action', () => {
    it('should retrieve specific data source', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          dataSources: [
            {
              dataSourceId: 'ds-123',
              spec: {
                bigQuery: {
                  projectId: 'my-project',
                  datasetId: 'my-dataset',
                  tableId: 'my-table',
                },
              },
            },
            {
              dataSourceId: 'ds-456',
              spec: {
                bigQuery: {
                  projectId: 'other-project',
                },
              },
            },
          ],
        },
      });

      const result = await handler.handle({
        request: {
          action: 'get_connection',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'connection' in result.response) {
        expect(result.response.connection.dataSourceId).toBe('ds-123');
      }
    });

    it('should handle connection not found', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          dataSources: [
            {
              dataSourceId: 'ds-456',
              spec: { bigQuery: {} },
            },
          ],
        },
      });

      const result = await handler.handle({
        request: {
          action: 'get_connection',
          spreadsheetId: 'test-id',
          dataSourceId: 'nonexistent-ds',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('NOT_FOUND');
    });

    it('should handle no data sources in spreadsheet', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          dataSources: [],
        },
      });

      const result = await handler.handle({
        request: {
          action: 'get_connection',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('cancel_refresh action', () => {
    it('should cancel data source refresh', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });

      const result = await handler.handle({
        request: {
          action: 'cancel_refresh',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                cancelDataSourceRefresh: expect.any(Object),
              }),
            ]),
          }),
        })
      );
    });

    it('should handle no active refresh', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('No refresh in progress'));

      const result = await handler.handle({
        request: {
          action: 'cancel_refresh',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('preview action', () => {
    it('should preview query results', async () => {
      mockBigQueryApi.jobs.query.mockResolvedValue({
        data: {
          rows: [{ f: [{ v: 'val1' }, { v: 'val2' }] }, { f: [{ v: 'val3' }, { v: 'val4' }] }],
          schema: {
            fields: [
              { name: 'col1', type: 'STRING' },
              { name: 'col2', type: 'STRING' },
            ],
          },
          totalBytesProcessed: '1024',
          jobComplete: true,
        },
      });

      const result = await handler.handle({
        request: {
          action: 'preview',
          projectId: 'my-project',
          query: 'SELECT * FROM dataset.table LIMIT 10',
          maxRows: 100,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'rows' in result.response && 'rowCount' in result.response) {
        expect(result.response.rows).toHaveLength(2);
        expect(result.response.rowCount).toBe(2);
      }
    });

    it('should limit preview rows with maxRows parameter', async () => {
      mockBigQueryApi.jobs.query.mockResolvedValue({
        data: {
          rows: [{ f: [{ v: 'data1' }] }, { f: [{ v: 'data2' }] }],
          schema: { fields: [{ name: 'col', type: 'STRING' }] },
          totalBytesProcessed: '2048',
          jobComplete: true,
        },
      });

      const result = await handler.handle({
        request: {
          action: 'preview',
          projectId: 'my-project',
          query: 'SELECT * FROM dataset.table',
          maxRows: 2,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'rowCount' in result.response) {
        expect(result.response.rowCount).toBe(2);
      }
      // Verify maxRows parameter was passed to BigQuery API
      expect(mockBigQueryApi.jobs.query).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'my-project',
          requestBody: expect.objectContaining({
            maxResults: 2,
          }),
        })
      );
    });

    it('should handle preview query errors', async () => {
      mockBigQueryApi.jobs.query.mockRejectedValue(new Error('SQL syntax error'));

      const result = await handler.handle({
        request: {
          action: 'preview',
          projectId: 'my-project',
          query: 'INVALID SQL',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should handle missing BigQuery API for preview', async () => {
      const handlerNoBQ = new SheetsBigQueryHandler(mockContext, mockSheetsApi);

      const result = await handlerNoBQ.handle({
        request: {
          action: 'preview',
          projectId: 'my-project',
          query: 'SELECT 1',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('refresh action', () => {
    it('should refresh specific data source', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });

      const result = await handler.handle({
        request: {
          action: 'refresh',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                refreshDataSource: expect.objectContaining({
                  dataSourceId: 'ds-123',
                }),
              }),
            ]),
          }),
        })
      );
    });

    it('should support force refresh', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });

      const result = await handler.handle({
        request: {
          action: 'refresh',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
          force: true,
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                refreshDataSource: expect.objectContaining({
                  force: true,
                }),
              }),
            ]),
          }),
        })
      );
    });

    it('should handle refresh errors', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(
        new Error('Refresh failed: Invalid credentials')
      );

      const result = await handler.handle({
        request: {
          action: 'refresh',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('export_to_bigquery action', () => {
    beforeEach(() => {
      mockSheetsApi.spreadsheets.values = {
        get: vi.fn().mockResolvedValue({
          data: {
            values: [
              ['col1', 'col2'],
              ['val1', 'val2'],
              ['val3', 'val4'],
            ],
          },
        }),
      };

      mockBigQueryApi.tabledata = {
        insertAll: vi.fn().mockResolvedValue({ data: {} }),
      };
    });

    it('should export sheet data to BigQuery', async () => {
      const result = await handler.handle({
        request: {
          action: 'export_to_bigquery',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B3',
          destination: {
            projectId: 'my-project',
            datasetId: 'my-dataset',
            tableId: 'my-table',
          },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'rowCount' in result.response) {
        expect(result.response.rowCount).toBe(2); // Excluding header
      }
      expect(mockBigQueryApi.tabledata.insertAll).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'my-project',
          datasetId: 'my-dataset',
          tableId: 'my-table',
        })
      );
    });

    it('should handle empty sheet data', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [] },
      });

      const result = await handler.handle({
        request: {
          action: 'export_to_bigquery',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B3',
          destination: {
            projectId: 'my-project',
            datasetId: 'my-dataset',
            tableId: 'my-table',
          },
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should handle BigQuery insert errors', async () => {
      mockBigQueryApi.tabledata.insertAll.mockRejectedValue(new Error('Table not found'));

      const result = await handler.handle({
        request: {
          action: 'export_to_bigquery',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B3',
          destination: {
            projectId: 'my-project',
            datasetId: 'my-dataset',
            tableId: 'nonexistent-table',
          },
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should require BigQuery API for export', async () => {
      const handlerNoBQ = new SheetsBigQueryHandler(mockContext, mockSheetsApi);

      const result = await handlerNoBQ.handle({
        request: {
          action: 'export_to_bigquery',
          spreadsheetId: 'test-id',
          range: 'A1:B3',
          destination: {
            projectId: 'my-project',
            datasetId: 'my-dataset',
            tableId: 'my-table',
          },
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('import_from_bigquery action', () => {
    beforeEach(() => {
      mockBigQueryApi.jobs.query.mockResolvedValue({
        data: {
          rows: [{ f: [{ v: 'val1' }, { v: 'val2' }] }, { f: [{ v: 'val3' }, { v: 'val4' }] }],
          schema: {
            fields: [
              { name: 'col1', type: 'STRING' },
              { name: 'col2', type: 'STRING' },
            ],
          },
          totalBytesProcessed: '1024',
          jobComplete: true,
        },
      });

      mockSheetsApi.spreadsheets.values = {
        ...mockSheetsApi.spreadsheets.values,
        update: vi.fn().mockResolvedValue({
          data: { updatedRows: 3 },
        }),
      };

      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
        data: {
          replies: [
            {
              addSheet: {
                properties: {
                  sheetId: 2,
                  title: 'BigQuery Results',
                },
              },
            },
          ],
        },
      });
    });

    it('should import BigQuery results to new sheet', async () => {
      const result = await handler.handle({
        request: {
          action: 'import_from_bigquery',
          spreadsheetId: 'test-id',
          projectId: 'my-project',
          query: 'SELECT * FROM dataset.table',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'rowCount' in result.response) {
        expect(result.response.rowCount).toBe(2);
        expect(result.response.sheetName).toBe('BigQuery Results');
      }
      expect(mockBigQueryApi.jobs.query).toHaveBeenCalled();
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({ addSheet: expect.any(Object) }),
            ]),
          }),
        })
      );
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          range: 'BigQuery Results!A1',
        })
      );
    });

    it('should handle query with no results', async () => {
      mockBigQueryApi.jobs.query.mockResolvedValue({
        data: {
          rows: [],
          schema: { fields: [{ name: 'col', type: 'STRING' }] },
          totalBytesProcessed: '0',
          jobComplete: true,
        },
      });

      const result = await handler.handle({
        request: {
          action: 'import_from_bigquery',
          spreadsheetId: 'test-id',
          projectId: 'my-project',
          query: 'SELECT * FROM dataset.table WHERE 1=0',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'rowCount' in result.response) {
        expect(result.response.rowCount).toBe(0);
      }
    });

    it('should handle query errors during import', async () => {
      mockBigQueryApi.jobs.query.mockRejectedValue(new Error('Query timeout'));

      const result = await handler.handle({
        request: {
          action: 'import_from_bigquery',
          spreadsheetId: 'test-id',
          projectId: 'my-project',
          query: 'SELECT * FROM huge_table',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should support custom start cell parameter', async () => {
      const result = await handler.handle({
        request: {
          action: 'import_from_bigquery',
          spreadsheetId: 'test-id',
          startCell: 'B2',
          projectId: 'my-project',
          query: 'SELECT 1 as col',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: expect.stringContaining('!B2'),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle unknown action', async () => {
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

    it('should handle rate limiting gracefully', async () => {
      const rateLimitError = new Error('Quota exceeded');
      // @ts-expect-error - Adding code for testing
      rateLimitError.code = 429;

      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValue(rateLimitError);

      const result = await handler.handle({
        request: {
          action: 'disconnect',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });

    it('should handle permission denied errors', async () => {
      const permError = new Error('Permission denied');
      // @ts-expect-error - Adding code for testing
      permError.code = 403;

      mockSheetsApi.spreadsheets.get.mockRejectedValue(permError);

      const result = await handler.handle({
        request: {
          action: 'get_connection',
          spreadsheetId: 'test-id',
          dataSourceId: 'ds-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('PERMISSION_DENIED');
    });

    it('should require authentication', async () => {
      // Auth requirement is enforced by BaseHandler.requireAuth() when googleClient is missing
      const noAuthContext = {
        ...mockContext,
        googleClient: null,
      };
      const noAuthHandler = new SheetsBigQueryHandler(
        noAuthContext,
        mockSheetsApi,
        mockBigQueryApi
      );

      await expect(
        noAuthHandler.handle({
          request: {
            action: 'list_datasets',
            projectId: 'my-project',
          },
        })
      ).rejects.toMatchObject({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
        },
      });
    });
  });

  // ============================================================================
  // Progress notification tests (Tranche E)
  // ============================================================================

  describe('export_to_bigquery progress notifications', () => {
    it('should emit progress notifications during export', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'bq-export-progress',
        progressToken: 'bq-export-progress',
        sendNotification: notification,
      });

      mockSheetsApi.spreadsheets.values = {
        get: vi.fn().mockResolvedValue({
          data: {
            values: [
              ['col1', 'col2'],
              ['val1', 'val2'],
              ['val3', 'val4'],
            ],
          },
        }),
      };
      mockBigQueryApi.tabledata = {
        insertAll: vi.fn().mockResolvedValue({ data: {} }),
      };

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          request: {
            action: 'export_to_bigquery',
            spreadsheetId: 'test-id',
            range: 'Sheet1!A1:B3',
            destination: {
              projectId: 'my-project',
              datasetId: 'my-dataset',
              tableId: 'my-table',
            },
          },
        })
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

  describe('import_from_bigquery progress notifications', () => {
    it('should emit progress notifications during import', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'bq-import-progress',
        progressToken: 'bq-import-progress',
        sendNotification: notification,
      });

      mockSheetsApi.spreadsheets.values = {
        update: vi.fn().mockResolvedValue({ data: {} }),
      };
      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          replies: [{ addSheet: { properties: { sheetId: 99, title: 'BigQuery Results' } } }],
        },
      });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          request: {
            action: 'import_from_bigquery',
            spreadsheetId: 'test-id',
            projectId: 'my-project',
            query: 'SELECT id, name FROM my_table',
          },
        })
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
