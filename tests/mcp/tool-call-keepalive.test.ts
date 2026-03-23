import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Handlers } from '../../src/handlers/index.js';
import { registerServalSheetsTools } from '../../src/mcp/registration/tool-handlers.js';
import { resetSessionContext } from '../../src/services/session-context.js';
import type { GoogleApiClient } from '../../src/services/google-api.js';
import { resetEnvForTest } from '../../src/config/env.js';
import { idempotencyManager } from '../../src/services/idempotency-manager.js';
import { createRequestContext, runWithRequestContext } from '../../src/utils/request-context.js';

function createMockHandlers(overrides?: {
  coreHandle?: ReturnType<typeof vi.fn>;
  advancedHandle?: ReturnType<typeof vi.fn>;
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
    advanced: makeHandler(overrides?.advancedHandle),
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
  } as unknown as Handlers;
}

describe('legacy tool-call keepalive registration path', () => {
  afterEach(() => {
    resetSessionContext();
    resetEnvForTest();
    idempotencyManager.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('emits a keepalive progress notification for auth-exempt tool calls', async () => {
    const registeredTools: Record<
      string,
      {
        title?: string;
        description?: string;
        inputSchema?: unknown;
        outputSchema?: unknown;
        annotations?: unknown;
        execution?: unknown;
        cb?: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            sendNotification?: (notification: unknown) => Promise<void>;
            progressToken?: string | number;
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
          registerToolTask: vi.fn((name: string, config: Record<string, unknown>) => {
            registeredTools[name] = { ...config };
          }),
        },
      },
      registerTool: vi.fn(
        (
          name: string,
          config: Record<string, unknown>,
          cb: (
            args: Record<string, unknown>,
            extra?: {
              requestId?: string | number;
              sendNotification?: (notification: unknown) => Promise<void>;
              progressToken?: string | number;
            }
          ) => Promise<unknown>
        ) => {
          registeredTools[name] = { ...config, cb };
        }
      ),
      _registeredTools: registeredTools,
    } as unknown as McpServer;

    await registerServalSheetsTools(server, null);

    const runSessionTool = registeredTools['sheets_session']?.cb;
    expect(runSessionTool).toBeTypeOf('function');

    const sendNotification = vi.fn().mockResolvedValue(undefined);

    const result = await runSessionTool!(
      { request: { action: 'get_active' } },
      {
        requestId: 'legacy-keepalive-request',
        progressToken: 'legacy-keepalive-token',
        sendNotification,
      }
    );

    await vi.waitFor(() => {
      expect(sendNotification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'legacy-keepalive-token',
          progress: 1,
          total: undefined,
        },
      });
    });

    expect(result).toMatchObject({
      structuredContent: {
        response: {
          success: true,
        },
      },
    });
  });

  it('returns auth guidance instead of NOT_IMPLEMENTED for protected tools before authentication', async () => {
    const registeredTools: Record<
      string,
      {
        cb?: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            sendNotification?: (notification: unknown) => Promise<void>;
            progressToken?: string | number;
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
              sendNotification?: (notification: unknown) => Promise<void>;
              progressToken?: string | number;
            }
          ) => Promise<unknown>
        ) => {
          registeredTools[name] = { cb };
        }
      ),
      _registeredTools: registeredTools,
    } as unknown as McpServer;

    await registerServalSheetsTools(server, null);

    const runCoreTool = registeredTools['sheets_core']?.cb;
    expect(runCoreTool).toBeTypeOf('function');

    const result = (await runCoreTool!(
      {
        request: {
          action: 'get',
          spreadsheetId: 'spreadsheet-123',
        },
      },
      {
        requestId: 'legacy-auth-request',
      }
    )) as {
      structuredContent?: {
        response?: {
          success?: boolean;
          error?: {
            code?: string;
            suggestedNextStep?: { tool?: string; action?: string };
          };
        };
      };
    };

    expect(result.structuredContent?.response?.success).toBe(false);
    expect(result.structuredContent?.response?.error?.code).toBe('NOT_CONFIGURED');
    expect(result.structuredContent?.response?.error?.suggestedNextStep).toMatchObject({
      tool: 'sheets_auth',
      action: 'status',
    });
  });

  it('normalizes expired-token auth failures on the legacy tool path', async () => {
    const registeredTools: Record<
      string,
      {
        cb?: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            sendNotification?: (notification: unknown) => Promise<void>;
            progressToken?: string | number;
          }
        ) => Promise<unknown>;
      }
    > = {};

    const googleClient = {
      authType: 'oauth',
      getTokenStatus: vi.fn().mockReturnValue({
        hasAccessToken: true,
        hasRefreshToken: false,
        expiryDate: Date.now() - 60_000,
      }),
      validateToken: vi
        .fn()
        .mockResolvedValue({ valid: false, error: 'Token has been expired or revoked' }),
    } as unknown as GoogleApiClient;

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
              sendNotification?: (notification: unknown) => Promise<void>;
              progressToken?: string | number;
            }
          ) => Promise<unknown>
        ) => {
          registeredTools[name] = { cb };
        }
      ),
      _registeredTools: registeredTools,
    } as unknown as McpServer;

    await registerServalSheetsTools(server, null, { googleClient });

    const runCoreTool = registeredTools['sheets_core']?.cb;
    expect(runCoreTool).toBeTypeOf('function');

    const result = (await runCoreTool!(
      {
        request: {
          action: 'get',
          spreadsheetId: 'spreadsheet-123',
        },
      },
      {
        requestId: 'legacy-expired-token-request',
      }
    )) as {
      structuredContent?: {
        response?: {
          success?: boolean;
          error?: {
            code?: string;
            suggestedNextStep?: { tool?: string; action?: string };
          };
        };
      };
    };

    expect(result.structuredContent?.response?.success).toBe(false);
    expect(result.structuredContent?.response?.error?.code).toBe('TOKEN_EXPIRED');
    expect(result.structuredContent?.response?.error?.suggestedNextStep).toMatchObject({
      tool: 'sheets_auth',
      action: 'login',
    });
  });

  it('applies the shared request queue to legacy tool execution', async () => {
    vi.stubEnv('MAX_CONCURRENT_REQUESTS', '1');
    resetEnvForTest();

    const registeredTools: Record<
      string,
      {
        cb?: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            sendNotification?: (notification: unknown) => Promise<void>;
            progressToken?: string | number;
          }
        ) => Promise<unknown>;
      }
    > = {};

    let resolveFirstCall: (() => void) | undefined;
    const firstCallCompleted = new Promise<void>((resolve) => {
      resolveFirstCall = resolve;
    });

    const coreHandle = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstCallCompleted;
        return { response: { success: true, request: 'first' } };
      })
      .mockImplementationOnce(async () => ({ response: { success: true, request: 'second' } }));

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
              sendNotification?: (notification: unknown) => Promise<void>;
              progressToken?: string | number;
            }
          ) => Promise<unknown>
        ) => {
          registeredTools[name] = { cb };
        }
      ),
      _registeredTools: registeredTools,
    } as unknown as McpServer;

    const googleClient = {
      authType: 'service_account',
    } as unknown as GoogleApiClient;

    await registerServalSheetsTools(server, createMockHandlers({ coreHandle }), { googleClient });

    const runCoreTool = registeredTools['sheets_core']?.cb;
    expect(runCoreTool).toBeTypeOf('function');

    const firstCall = runCoreTool!(
      {
        request: {
          action: 'get',
          spreadsheetId: 'spreadsheet-123',
        },
      },
      { requestId: 'legacy-queue-1' }
    );

    await vi.waitFor(() => {
      expect(coreHandle).toHaveBeenCalledTimes(1);
    });

    const secondCall = runCoreTool!(
      {
        request: {
          action: 'get',
          spreadsheetId: 'spreadsheet-456',
        },
      },
      { requestId: 'legacy-queue-2' }
    );

    expect(coreHandle).toHaveBeenCalledTimes(1);

    resolveFirstCall?.();

    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);

    expect(coreHandle).toHaveBeenCalledTimes(2);
    expect(firstResult).toMatchObject({
      structuredContent: { response: { success: true, request: 'first' } },
    });
    expect(secondResult).toMatchObject({
      structuredContent: { response: { success: true, request: 'second' } },
    });
  });

  it('refuses new legacy tool calls after runtime disposal', async () => {
    const registeredTools: Record<
      string,
      {
        cb?: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            sendNotification?: (notification: unknown) => Promise<void>;
            progressToken?: string | number;
          }
        ) => Promise<unknown>;
      }
    > = {};

    const coreHandle = vi.fn(async () => ({ response: { success: true } }));
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
              sendNotification?: (notification: unknown) => Promise<void>;
              progressToken?: string | number;
            }
          ) => Promise<unknown>
        ) => {
          registeredTools[name] = { cb };
        }
      ),
      _registeredTools: registeredTools,
    } as unknown as McpServer;

    const googleClient = {
      authType: 'service_account',
    } as unknown as GoogleApiClient;

    const registration = await registerServalSheetsTools(
      server,
      createMockHandlers({ coreHandle }),
      { googleClient }
    );

    const runCoreTool = registeredTools['sheets_core']?.cb;
    expect(runCoreTool).toBeTypeOf('function');

    registration.dispose();

    const result = (await runCoreTool!(
      {
        request: {
          action: 'get',
          spreadsheetId: 'spreadsheet-789',
        },
      },
      { requestId: 'legacy-disposed-request' }
    )) as {
      structuredContent?: {
        response?: {
          success?: boolean;
          error?: {
            code?: string;
            message?: string;
          };
        };
      };
    };

    expect(coreHandle).not.toHaveBeenCalled();
    expect(result.structuredContent?.response?.success).toBe(false);
    expect(result.structuredContent?.response?.error).toMatchObject({
      code: 'OPERATION_CANCELLED',
      message: 'MCP session closed',
    });
  });

  it('honors client idempotency keys on the legacy tool path', async () => {
    const registeredTools: Record<
      string,
      {
        cb?: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            sendNotification?: (notification: unknown) => Promise<void>;
            progressToken?: string | number;
            requestInfo?: {
              headers?: Record<string, string | string[] | undefined>;
            };
          }
        ) => Promise<unknown>;
      }
    > = {};

    const advancedHandle = vi
      .fn()
      .mockResolvedValue({ response: { success: true, request: 'first-execution' } });

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
              sendNotification?: (notification: unknown) => Promise<void>;
              progressToken?: string | number;
              requestInfo?: {
                headers?: Record<string, string | string[] | undefined>;
              };
            }
          ) => Promise<unknown>
        ) => {
          registeredTools[name] = { cb };
        }
      ),
      _registeredTools: registeredTools,
    } as unknown as McpServer;

    const googleClient = {
      authType: 'service_account',
    } as unknown as GoogleApiClient;

    await registerServalSheetsTools(server, createMockHandlers({ advancedHandle }), {
      googleClient,
    });

    const runAdvancedTool = registeredTools['sheets_advanced']?.cb;
    expect(runAdvancedTool).toBeTypeOf('function');

    const args = {
      request: {
        action: 'add_named_range',
        spreadsheetId: 'spreadsheet-123',
        name: 'RevenueRange',
        range: { a1: 'Sheet1!A1:B10' },
      },
    };
    const extra = {
      requestInfo: {
        headers: {
          'x-idempotency-key': 'legacy-idempotency-1234',
        },
      },
    };

    const firstResult = await runAdvancedTool!(args, {
      ...extra,
      requestId: 'legacy-idempotency-1',
    });
    const secondResult = await runAdvancedTool!(args, {
      ...extra,
      requestId: 'legacy-idempotency-2',
    });

    expect(advancedHandle).toHaveBeenCalledTimes(1);
    expect(firstResult).toMatchObject({
      structuredContent: { response: { success: true, request: 'first-execution' } },
    });
    expect(secondResult).toMatchObject({
      structuredContent: { response: { success: true, request: 'first-execution' } },
    });
  });

  it('reads trace metadata from SDK requestInfo headers on the legacy tool path', async () => {
    const registeredTools: Record<
      string,
      {
        cb?: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            requestInfo?: {
              headers?: Record<string, string | string[] | undefined>;
            };
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
              requestInfo?: {
                headers?: Record<string, string | string[] | undefined>;
              };
            }
          ) => Promise<unknown>
        ) => {
          registeredTools[name] = { cb };
        }
      ),
      _registeredTools: registeredTools,
    } as unknown as McpServer;

    await registerServalSheetsTools(server, null);

    const runSessionTool = registeredTools['sheets_session']?.cb;
    expect(runSessionTool).toBeTypeOf('function');

    const result = (await runSessionTool!(
      { request: { action: 'get_active' } },
      {
        requestId: 'legacy-trace-request',
        requestInfo: {
          headers: {
            'x-trace-id': '0123456789abcdef0123456789abcdef',
            'x-span-id': '0123456789abcdef',
          },
        },
      }
    )) as {
      structuredContent?: {
        _meta?: {
          requestId?: string;
          traceId?: string;
          spanId?: string;
        };
      };
    };

    expect(result.structuredContent?._meta).toMatchObject({
      requestId: 'legacy-trace-request',
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
    });
  });

  it('inherits idempotency context from an ambient request scope on the legacy tool path', async () => {
    const registeredTools: Record<
      string,
      {
        cb?: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            sendNotification?: (notification: unknown) => Promise<void>;
            progressToken?: string | number;
          }
        ) => Promise<unknown>;
      }
    > = {};

    const advancedHandle = vi
      .fn()
      .mockResolvedValue({ response: { success: true, request: 'ambient-execution' } });

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
              sendNotification?: (notification: unknown) => Promise<void>;
              progressToken?: string | number;
            }
          ) => Promise<unknown>
        ) => {
          registeredTools[name] = { cb };
        }
      ),
      _registeredTools: registeredTools,
    } as unknown as McpServer;

    const googleClient = {
      authType: 'service_account',
    } as unknown as GoogleApiClient;

    await registerServalSheetsTools(server, createMockHandlers({ advancedHandle }), {
      googleClient,
    });

    const runAdvancedTool = registeredTools['sheets_advanced']?.cb;
    expect(runAdvancedTool).toBeTypeOf('function');

    const args = {
      request: {
        action: 'add_named_range',
        spreadsheetId: 'spreadsheet-ambient',
        name: 'AmbientRange',
        range: { a1: 'Sheet1!C1:D10' },
      },
    };

    const firstResult = await runWithRequestContext(
      createRequestContext({ idempotencyKey: 'ambient-idempotency-1234' }),
      () => runAdvancedTool!(args, { requestId: 'ambient-idempotency-1' })
    );
    const secondResult = await runWithRequestContext(
      createRequestContext({ idempotencyKey: 'ambient-idempotency-1234' }),
      () => runAdvancedTool!(args, { requestId: 'ambient-idempotency-2' })
    );

    expect(advancedHandle).toHaveBeenCalledTimes(1);
    expect(firstResult).toMatchObject({
      structuredContent: { response: { success: true, request: 'ambient-execution' } },
    });
    expect(secondResult).toMatchObject({
      structuredContent: { response: { success: true, request: 'ambient-execution' } },
    });
  });
});
