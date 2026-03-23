/**
 * Handler task-ID cleanup regression tests.
 *
 * Task IDs are owned by MCP `tasks/call` transport handlers. Ordinary handler
 * responses must not create bespoke tasks or attach ad hoc `taskId` fields.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SheetsBigQueryHandler } from '../../src/handlers/bigquery.js';
import { SheetsAppsScriptHandler } from '../../src/handlers/appsscript.js';
import { CompositeHandler } from '../../src/handlers/composite.js';
import { HistoryHandler } from '../../src/handlers/history.js';
import { FederationHandler } from '../../src/handlers/federation.js';
import type { HandlerContext } from '../../src/handlers/base.js';

const mockFederationClient = {
  callRemoteTool: vi.fn(),
  listRemoteTools: vi.fn(),
  isConnected: vi.fn(),
};

vi.mock('../../src/services/federated-mcp-client.js', () => ({
  getFederationClient: vi.fn(() => Promise.resolve(mockFederationClient)),
}));

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...actual,
    getFederationConfig: vi.fn(() => ({
      enabled: true,
      serversJson: JSON.stringify([{ name: 'test-server', url: 'http://localhost:3001' }]),
    })),
    getCircuitBreakerConfig: vi.fn(() => ({
      failureThreshold: 5,
      resetTimeout: 30000,
      halfOpenMaxAttempts: 3,
    })),
  };
});

vi.mock('../../src/config/federation-config.js', () => ({
  parseFederationServers: vi.fn(() => [{ name: 'test-server', url: 'http://localhost:3001' }]),
}));

function createMockTaskStore() {
  return {
    createTask: vi.fn().mockResolvedValue({
      taskId: 'mock-task-id-123',
      status: 'working',
    }),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    storeTaskResult: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue(null),
    getTaskResult: vi.fn().mockResolvedValue(null),
    listTasks: vi.fn().mockResolvedValue({ tasks: [], nextCursor: undefined }),
    cancelTask: vi.fn().mockResolvedValue(undefined),
    isTaskCancelled: vi.fn().mockResolvedValue(false),
    getCancellationReason: vi.fn().mockResolvedValue(null),
    getUnderlyingStore: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('handler task ID cleanup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bigquery handlers do not emit manual task IDs', async () => {
    const taskStore = createMockTaskStore();
    const mockSheetsApi = {
      spreadsheets: {
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              values: [
                ['id', 'name'],
                ['1', 'Alice'],
              ],
            },
          }),
          update: vi.fn().mockResolvedValue({ data: {} }),
        },
        batchUpdate: vi.fn().mockResolvedValue({
          data: {
            replies: [
              {
                addSheet: {
                  properties: {
                    sheetId: 999,
                    title: 'BigQuery Results',
                  },
                },
              },
            ],
          },
        }),
      },
    };
    const mockBigQueryApi = {
      tabledata: {
        insertAll: vi.fn().mockResolvedValue({
          data: { insertErrors: [] },
        }),
      },
      jobs: {
        query: vi.fn().mockResolvedValue({
          data: {
            rows: [{ f: [{ v: '1' }, { v: 'Alice' }] }],
            schema: {
              fields: [
                { name: 'id', type: 'INTEGER' },
                { name: 'name', type: 'STRING' },
              ],
            },
            totalRows: '1',
            jobComplete: true,
          },
        }),
      },
    };
    const context = {
      googleClient: {} as HandlerContext['googleClient'],
      taskStore: taskStore as unknown as HandlerContext['taskStore'],
    } as HandlerContext;
    const handler = new SheetsBigQueryHandler(
      context,
      mockSheetsApi as any,
      mockBigQueryApi as any
    );

    const exportResult = await handler.handle({
      request: {
        action: 'export_to_bigquery',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
        destination: {
          projectId: 'my-project',
          datasetId: 'my-dataset',
          tableId: 'my-table',
        },
      },
    });
    const importResult = await handler.handle({
      request: {
        action: 'import_from_bigquery',
        spreadsheetId: 'test-id',
        query: 'SELECT id, name FROM `my-project.my-dataset.my-table`',
        projectId: 'my-project',
        sheetName: 'BigQuery Results',
        startCell: 'A1',
      },
    });

    expect(exportResult.response.success).toBe(true);
    expect(importResult.response.success).toBe(true);
    expect(exportResult.response).not.toHaveProperty('taskId');
    expect(importResult.response).not.toHaveProperty('taskId');
    expect(taskStore.createTask).not.toHaveBeenCalled();
    expect(taskStore.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('appsscript run does not emit manual task IDs', async () => {
    const taskStore = createMockTaskStore();
    const context: HandlerContext = {
      googleClient: {
        oauth2: {
          credentials: {
            access_token: 'test-token',
            refresh_token: 'test-refresh',
            expiry_date: 1704067200000 + 3600000,
          },
          getAccessToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
        },
        getTokenStatus: vi.fn().mockReturnValue({
          hasAccessToken: true,
          hasRefreshToken: true,
          expiryDate: 1704067200000 + 3600000,
        }),
      } as any,
      taskStore: taskStore as unknown as HandlerContext['taskStore'],
    };
    const handler = new SheetsAppsScriptHandler(context);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          done: true,
          response: {
            '@type': 'type.googleapis.com/google.apps.script.v1.ExecutionResponse',
            result: 'Hello, World!',
          },
        })
      ),
    }) as any;

    const result = await handler.handle({
      request: {
        action: 'run',
        scriptId: 'script-abc-123',
        functionName: 'myFunction',
        devMode: true,
      },
    });

    expect(result.response.success).toBe(true);
    expect(result.response).not.toHaveProperty('taskId');
    expect(taskStore.createTask).not.toHaveBeenCalled();
    expect(taskStore.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('composite export_large_dataset does not emit manual task IDs', async () => {
    const taskStore = createMockTaskStore();
    const mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            sheets: [
              {
                properties: {
                  title: 'Sheet1',
                  gridProperties: { rowCount: 2 },
                },
              },
            ],
          },
        }),
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              values: [
                ['col1', 'col2'],
                ['a', 'b'],
              ],
            },
          }),
        },
      },
    };
    const handler = new CompositeHandler(
      {
        googleClient: {} as HandlerContext['googleClient'],
        taskStore: taskStore as unknown as HandlerContext['taskStore'],
      } as HandlerContext,
      mockSheetsApi as any
    );

    const result = await handler.handle({
      request: {
        action: 'export_large_dataset',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A:B',
        format: 'json',
      },
    });

    expect(result.response.success).toBe(true);
    expect(result.response).not.toHaveProperty('taskId');
    expect(taskStore.createTask).not.toHaveBeenCalled();
    expect(taskStore.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('history timeline does not emit manual task IDs', async () => {
    const taskStore = createMockTaskStore();
    const handler = new HistoryHandler({
      driveApi: {
        revisions: {
          list: vi.fn().mockResolvedValue({
            data: {
              revisions: [
                {
                  id: '1',
                  modifiedTime: '2024-01-01T00:00:00Z',
                  lastModifyingUser: { displayName: 'Alice' },
                },
              ],
            },
          }),
        },
      } as any,
      taskStore: taskStore as unknown as HandlerContext['taskStore'],
    });

    const result = await handler.handle({
      request: {
        action: 'timeline',
        spreadsheetId: 'test-id',
      },
    });

    expect(result.response.success).toBe(true);
    expect(result.response).not.toHaveProperty('taskId');
    expect(taskStore.createTask).not.toHaveBeenCalled();
    expect(taskStore.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('federation handlers do not emit manual task IDs', async () => {
    const taskStore = createMockTaskStore();
    mockFederationClient.isConnected.mockReturnValue(true);
    mockFederationClient.listRemoteTools.mockResolvedValue([
      { name: 'tool1', description: 'Test tool' },
    ]);
    const handler = new FederationHandler(taskStore as unknown as HandlerContext['taskStore']);

    const result = await handler.handle({
      request: {
        action: 'list_servers',
      },
    });

    expect(result.response.success).toBe(true);
    expect(result.response).not.toHaveProperty('taskId');
    expect(taskStore.createTask).not.toHaveBeenCalled();
    expect(taskStore.updateTaskStatus).not.toHaveBeenCalled();
  });
});
