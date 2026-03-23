import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Handlers } from '../../src/handlers/index.js';
import { resetEnvForTest } from '../../src/config/env.js';
import { registerServalSheetsTools } from '../../src/mcp/registration/tool-handlers.js';
import { idempotencyManager } from '../../src/services/idempotency-manager.js';
import { resetSessionContext } from '../../src/services/session-context.js';
import type { GoogleApiClient } from '../../src/services/google-api.js';

const auditLogSheetMocks = vi.hoisted(() => ({
  appendAuditLogRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/audit-log-sheet.js', () => ({
  appendAuditLogRow: auditLogSheetMocks.appendAuditLogRow,
}));

function createMockHandlers(overrides?: {
  coreHandle?: ReturnType<typeof vi.fn>;
}): Handlers {
  const makeHandler = (handle?: ReturnType<typeof vi.fn>) => ({
    handle: handle ?? vi.fn(async () => ({ response: { success: true } })),
  });

  return {
    core: makeHandler(overrides?.coreHandle),
    data: makeHandler(),
    format: makeHandler(),
    dimensions: makeHandler(),
    visualize: makeHandler(),
    collaborate: makeHandler(),
    advanced: makeHandler(),
    transaction: makeHandler(),
    quality: makeHandler(),
    history: makeHandler(),
    confirm: makeHandler(),
    analyze: makeHandler(),
    fix: makeHandler(),
    composite: makeHandler(),
    session: makeHandler(),
    templates: makeHandler(),
    bigquery: makeHandler(),
    appsscript: makeHandler(),
    webhooks: makeHandler(),
    dependencies: makeHandler(),
    federation: makeHandler(),
    compute: makeHandler(),
    agent: makeHandler(),
    connectors: makeHandler(),
  } as unknown as Handlers;
}

async function registerTools(
  handlers: Handlers,
  googleClient: GoogleApiClient
): Promise<
  Record<
    string,
    {
      cb?: (
        args: Record<string, unknown>,
        extra?: {
          requestId?: string | number;
          requestInfo?: { headers?: Record<string, string> };
        }
      ) => Promise<unknown>;
    }
  >
> {
  const registeredTools: Record<
    string,
    {
      cb?: (
        args: Record<string, unknown>,
        extra?: {
          requestId?: string | number;
          requestInfo?: { headers?: Record<string, string> };
        }
      ) => Promise<unknown>;
    }
  > = {};

  const server = {
    server: {
      setRequestHandler: vi.fn(),
    },
    experimental: {
      tasks: {
        registerToolTask: vi.fn((name: string) => {
          registeredTools[name] = {};
        }),
      },
    },
    registerTool: vi.fn(
      (
        name: string,
        _config: Record<string, unknown>,
        cb: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            requestInfo?: { headers?: Record<string, string> };
          }
        ) => Promise<unknown>
      ) => {
        registeredTools[name] = { cb };
      }
    ),
  } as unknown as McpServer;

  await registerServalSheetsTools(server, handlers, { googleClient });
  return registeredTools;
}

function createGoogleClient(): GoogleApiClient {
  return {
    authType: 'service_account',
    sheets: { mock: 'sheets-api' },
  } as unknown as GoogleApiClient;
}

describe('tool action log sheet wiring', () => {
  afterEach(() => {
    resetSessionContext();
    resetEnvForTest();
    idempotencyManager.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    auditLogSheetMocks.appendAuditLogRow.mockReset();
    auditLogSheetMocks.appendAuditLogRow.mockResolvedValue(undefined);
  });

  it('appends successful mutation calls to the configured audit sheet', async () => {
    vi.stubEnv('ENABLE_ACTION_LOG_SHEET', 'true');
    vi.stubEnv('ACTION_LOG_SPREADSHEET_ID', 'audit-sheet-id');
    vi.stubEnv('ACTION_LOG_SHEET_NAME', '_tool_audit');
    resetEnvForTest();

    const coreHandle = vi.fn(async () => ({
      response: {
        success: true,
        spreadsheetId: 'sheet-123',
      },
    }));

    const registeredTools = await registerTools(
      createMockHandlers({ coreHandle }),
      createGoogleClient()
    );

    const result = (await registeredTools['sheets_core']?.cb?.(
      {
        request: {
          action: 'update_properties',
          spreadsheetId: 'sheet-123',
          title: 'Updated audit title',
        },
      },
      {
        requestId: 'req-1',
        requestInfo: {
          headers: {
            'x-user-id': 'audit-user',
          },
        },
      }
    )) as { structuredContent?: { response?: { success?: boolean } } };

    expect(result.structuredContent?.response?.success).toBe(true);
    expect(auditLogSheetMocks.appendAuditLogRow).toHaveBeenCalledWith(
      { mock: 'sheets-api' },
      'audit-sheet-id',
      '_tool_audit',
      expect.objectContaining({
        tool: 'sheets_core',
        action: 'update_properties',
        spreadsheetId: 'sheet-123',
        userId: 'audit-user',
        success: true,
        durationMs: expect.any(Number),
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      })
    );
  });

  it('skips audit sheet appends for non-mutating actions', async () => {
    vi.stubEnv('ENABLE_ACTION_LOG_SHEET', 'true');
    vi.stubEnv('ACTION_LOG_SPREADSHEET_ID', 'audit-sheet-id');
    resetEnvForTest();

    const registeredTools = await registerTools(createMockHandlers(), createGoogleClient());

    await registeredTools['sheets_core']?.cb?.(
      {
        request: {
          action: 'get',
          spreadsheetId: 'sheet-123',
        },
      },
      {
        requestId: 'req-2',
      }
    );

    expect(auditLogSheetMocks.appendAuditLogRow).not.toHaveBeenCalled();
  });

  it('uses the created spreadsheet id when the mutation response returns a new id', async () => {
    vi.stubEnv('ENABLE_ACTION_LOG_SHEET', 'true');
    vi.stubEnv('ACTION_LOG_SPREADSHEET_ID', 'audit-sheet-id');
    resetEnvForTest();

    const coreHandle = vi.fn(async () => ({
      response: {
        success: true,
        newSpreadsheetId: 'created-sheet-123',
      },
    }));

    const registeredTools = await registerTools(
      createMockHandlers({ coreHandle }),
      createGoogleClient()
    );

    await registeredTools['sheets_core']?.cb?.(
      {
        request: {
          action: 'create',
          title: 'Audit Test Sheet',
        },
      },
      {
        requestId: 'req-create',
        requestInfo: {
          headers: {
            'x-user-id': 'creator-user',
          },
        },
      }
    );

    expect(auditLogSheetMocks.appendAuditLogRow).toHaveBeenCalledWith(
      { mock: 'sheets-api' },
      'audit-sheet-id',
      '_audit_log',
      expect.objectContaining({
        action: 'create',
        spreadsheetId: 'created-sheet-123',
        userId: 'creator-user',
        success: true,
      })
    );
  });

  it('skips audit sheet appends when the feature flag is disabled', async () => {
    vi.stubEnv('ENABLE_ACTION_LOG_SHEET', 'false');
    vi.stubEnv('ACTION_LOG_SPREADSHEET_ID', 'audit-sheet-id');
    resetEnvForTest();

    const registeredTools = await registerTools(createMockHandlers(), createGoogleClient());

    await registeredTools['sheets_core']?.cb?.(
      {
        request: {
          action: 'update_properties',
          spreadsheetId: 'sheet-123',
          title: 'Disabled audit title',
        },
      },
      {
        requestId: 'req-3',
      }
    );

    expect(auditLogSheetMocks.appendAuditLogRow).not.toHaveBeenCalled();
  });

  it('records failed mutation attempts in the audit sheet', async () => {
    vi.stubEnv('ENABLE_ACTION_LOG_SHEET', 'true');
    vi.stubEnv('ACTION_LOG_SPREADSHEET_ID', 'audit-sheet-id');
    resetEnvForTest();

    const coreHandle = vi.fn(async () => {
      throw new Error('write failed');
    });

    const registeredTools = await registerTools(
      createMockHandlers({ coreHandle }),
      createGoogleClient()
    );

    const result = (await registeredTools['sheets_core']?.cb?.(
      {
        request: {
          action: 'update_properties',
          spreadsheetId: 'sheet-456',
          title: 'Failure case',
        },
      },
      {
        requestId: 'req-4',
        requestInfo: {
          headers: {
            'x-user-id': 'failing-user',
          },
        },
      }
    )) as { structuredContent?: { response?: { success?: boolean } } };

    expect(result.structuredContent?.response?.success).toBe(false);
    expect(auditLogSheetMocks.appendAuditLogRow).toHaveBeenCalledWith(
      { mock: 'sheets-api' },
      'audit-sheet-id',
      '_audit_log',
      expect.objectContaining({
        action: 'update_properties',
        spreadsheetId: 'sheet-456',
        userId: 'failing-user',
        success: false,
      })
    );
  });

  it('keeps tool execution successful when the audit sheet append fails', async () => {
    vi.stubEnv('ENABLE_ACTION_LOG_SHEET', 'true');
    vi.stubEnv('ACTION_LOG_SPREADSHEET_ID', 'audit-sheet-id');
    resetEnvForTest();

    auditLogSheetMocks.appendAuditLogRow.mockRejectedValueOnce(new Error('append offline'));

    const registeredTools = await registerTools(createMockHandlers(), createGoogleClient());

    const result = (await registeredTools['sheets_core']?.cb?.(
      {
        request: {
          action: 'update_properties',
          spreadsheetId: 'sheet-789',
          title: 'Append failure should not break tool',
        },
      },
      {
        requestId: 'req-5',
      }
    )) as { structuredContent?: { response?: { success?: boolean } } };

    expect(result.structuredContent?.response?.success).toBe(true);
    expect(auditLogSheetMocks.appendAuditLogRow).toHaveBeenCalledTimes(1);
  });
});
