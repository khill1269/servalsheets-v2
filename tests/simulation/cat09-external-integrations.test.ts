/**
 * ServalSheets - Category 9 External Integrations Tests (Simulation)
 *
 * Tests for BigQuery, Apps Script, Federation, Connectors, and Webhooks
 * Note: These are integration tests verifying action dispatch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsBigQueryHandler } from '../../src/handlers/bigquery.js';
import { SheetsAppsScriptHandler } from '../../src/handlers/appsscript.js';
import { FederationHandler } from '../../src/handlers/federation.js';
import { ConnectorsHandler } from '../../src/handlers/connectors.js';
import { WebhookHandler } from '../../src/handlers/webhooks.js';
import type { HandlerContext } from '../../src/handlers/base.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock APIs
// ─────────────────────────────────────────────────────────────────────────────

const createMockBigQueryApi = () => ({
  datasets: {
    list: vi.fn().mockResolvedValue({
      data: { datasets: [{ datasetReference: { datasetId: 'dataset1' } }] },
    }),
    get: vi.fn().mockResolvedValue({ data: { datasetReference: { datasetId: 'dataset1' } } }),
  },
  tables: {
    list: vi.fn().mockResolvedValue({
      data: { tables: [{ tableReference: { tableId: 'table1', datasetId: 'dataset1' } }] },
    }),
    get: vi.fn().mockResolvedValue({
      data: {
        tableReference: { tableId: 'table1', datasetId: 'dataset1' },
        schema: { fields: [{ name: 'id', type: 'INTEGER' }] },
      },
    }),
  },
  jobs: {
    query: vi.fn().mockResolvedValue({
      data: { jobReference: { jobId: 'job1' }, rows: [{ f: [{ v: '100' }] }] },
    }),
  },
});

const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-sheet-id',
        properties: { title: 'Test Sheet' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      },
    }),
    batchUpdate: vi.fn().mockResolvedValue({ data: { replies: [] } }),
    values: {
      update: vi.fn().mockResolvedValue({ data: { updatedRows: 1 } }),
      append: vi.fn().mockResolvedValue({ data: { updates: {} } }),
    },
  },
});

const createMockAppsScriptApi = () => ({
  projects: {
    create: vi.fn().mockResolvedValue({
      data: { scriptId: 'script-123', parentId: 'test-sheet-id' },
    }),
    get: vi.fn().mockResolvedValue({
      data: { scriptId: 'script-123', title: 'My Script' },
    }),
    getContent: vi.fn().mockResolvedValue({
      data: { scriptId: 'script-123', files: [{ name: 'Code', type: 'SERVER_JS', source: 'function test() {}' }] },
    }),
    updateContent: vi.fn().mockResolvedValue({
      data: { scriptId: 'script-123', files: [{ name: 'Code' }] },
    }),
    run: vi.fn().mockResolvedValue({
      data: { execution: { status: 'OK', result: [true] } },
    }),
  },
});

const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {} as any,
  rangeResolver: { resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:B2' }) } as any,
  auth: { scopes: ['https://www.googleapis.com/auth/bigquery'] } as any,
  samplingServer: undefined,
  snapshotService: {} as any,
  sessionContext: {} as any,
  confirmDestructiveAction: vi.fn().mockResolvedValue(undefined),
  createSnapshotIfNeeded: vi.fn().mockResolvedValue({ snapshotId: 'snap-123' }),
  sendProgress: vi.fn(),
  cachedApi: {} as any,
});

// ─────────────────────────────────────────────────────────────────────────────
// Category 9: External Integrations
// ─────────────────────────────────────────────────────────────────────────────

describe('Category 9: External Integrations', () => {
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockContext();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('9.1-9.3 BigQuery Integration', () => {
    let handler: SheetsBigQueryHandler;
    let mockBigQueryApi: ReturnType<typeof createMockBigQueryApi>;
    let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;

    beforeEach(() => {
      mockBigQueryApi = createMockBigQueryApi();
      mockSheetsApi = createMockSheetsApi();
      handler = new SheetsBigQueryHandler(
        mockContext,
        mockSheetsApi as unknown as any,
        mockBigQueryApi as unknown as any
      );
    });

    it('9.1 BigQuery list_datasets dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'list_datasets',
          projectId: 'test-project',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.2 BigQuery list_tables dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'list_tables',
          projectId: 'test-project',
          datasetId: 'dataset1',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.2b BigQuery query dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'query',
          projectId: 'test-project',
          query: 'SELECT 1',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.3 BigQuery export_to_bigquery dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'export_to_bigquery',
          spreadsheetId: 'test-sheet-id',
          projectId: 'test-project',
          datasetId: 'dataset1',
          destinationTableId: 'table1',
          sheetName: 'Sheet1',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe('9.4-9.6 Apps Script Integration', () => {
    let handler: SheetsAppsScriptHandler;
    let mockAppsScriptApi: ReturnType<typeof createMockAppsScriptApi>;
    let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;

    beforeEach(() => {
      mockAppsScriptApi = createMockAppsScriptApi();
      mockSheetsApi = createMockSheetsApi();
      handler = new SheetsAppsScriptHandler(
        mockContext,
        mockSheetsApi as unknown as any,
        mockAppsScriptApi as unknown as any
      );
    });

    it('9.4 Apps Script create dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'create',
          title: 'My Script',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.4b Apps Script get_content dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'get_content',
          scriptId: 'script-123',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.5 Apps Script run with devMode guard dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'run',
          scriptId: 'script-123',
          functionName: 'test',
          devMode: true,
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.6 Apps Script trigger_create dispatches', async () => {
      mockAppsScriptApi.projects.create.mockResolvedValue({
        data: { scriptId: 'script-123', parentId: 'test-sheet-id' },
      });
      const result = await handler.handle({
        request: {
          action: 'create_trigger',
          scriptId: 'script-123',
          triggerType: 'ON_EDIT',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe('9.7 Federation Integration', () => {
    let handler: FederationHandler;
    let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;

    beforeEach(() => {
      mockSheetsApi = createMockSheetsApi();
      handler = new FederationHandler(mockContext);
    });

    it('9.7 Federation list_servers dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'list_servers',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.7b Federation call_remote dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'remote-server',
          toolName: 'some_tool',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.7c Federation validate_connection dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'validate_connection',
          serverName: 'remote-server',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe('9.8 Connector Integration', () => {
    let handler: ConnectorsHandler;

    beforeEach(() => {
      handler = new ConnectorsHandler(mockContext);
    });

    it('9.8 Connectors list_connectors dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'list_connectors',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.8b Connectors query throws when not configured', async () => {
      // Connector must be configured first via configure action
      let threw = false;
      try {
        await handler.handle({
          request: {
            action: 'query',
            connectorId: 'finnhub',
            endpoint: '/quote',
            params: { symbol: 'AAPL' },
          },
        });
      } catch (err: any) {
        threw = true;
        expect(err.message || err.code).toMatch(/configured|not configured/i);
      }
      expect(threw).toBe(true);
    });

    it('9.8c Connectors status dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'status',
          connectorId: 'finnhub',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.10 Connector error on invalid connector', async () => {
      // Invalid connector ID should throw NotFoundError
      let threw = false;
      try {
        await handler.handle({
          request: {
            action: 'status',
            connectorId: 'not-a-real-connector',
          },
        });
      } catch (err: any) {
        threw = true;
        expect(err.message || err.code).toMatch(/connector|not found|NOT_FOUND/i);
      }
      expect(threw).toBe(true);
    });
  });

  describe('9.9 Webhook Integration (Redis check)', () => {
    let handler: WebhookHandler;

    beforeEach(() => {
      handler = new WebhookHandler(mockContext);
    });

    it('9.9 Webhook register dispatches when Redis available', async () => {
      const result = await handler.handle({
        request: {
          action: 'register',
          spreadsheetId: 'test-sheet-id',
          webhookUrl: 'https://example.com/webhook',
          eventTypes: ['sheet.update'],
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      // If Redis is not available, handler returns error with graceful message
    });

    it('9.9b Webhook list dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('9.9c Webhook watch_changes dispatches', async () => {
      const result = await handler.handle({
        request: {
          action: 'watch_changes',
          spreadsheetId: 'test-sheet-id',
          webhookUrl: 'https://example.com/webhook',
        },
      });
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe('9.x Cross-integration error handling', () => {
    it('should throw when connectorId is empty', async () => {
      const handler = new ConnectorsHandler(mockContext);
      let threw = false;
      try {
        await handler.handle({
          request: {
            action: 'query',
            connectorId: '', // empty
            endpoint: '/quote',
          },
        });
      } catch (err: any) {
        threw = true;
        expect(err.message || err.code).toMatch(/connector|not found/i);
      }
      expect(threw).toBe(true);
    });

    it('should handle API unavailability gracefully', async () => {
      const mockSheetsApi = createMockSheetsApi();
      mockSheetsApi.spreadsheets.get.mockRejectedValue(new Error('API unavailable'));

      const handler = new SheetsBigQueryHandler(
        mockContext,
        mockSheetsApi as unknown as any,
        createMockBigQueryApi() as unknown as any
      );

      const result = await handler.handle({
        request: {
          action: 'list_datasets',
          projectId: 'test-project',
        },
      });

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });
});
