import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRequestContext } from '../../src/utils/request-context.js';
import {
  executeToolCallRuntime,
  type ToolCallRuntimeInput,
} from '../../src/mcp/registration/tool-call-runtime.js';

function createInput(overrides: Partial<ToolCallRuntimeInput> = {}): ToolCallRuntimeInput {
  return {
    tool: {
      name: 'sheets_data',
      outputSchema: z.object({}),
    },
    args: { request: { action: 'read', spreadsheetId: 'sheet-123' } },
    extra: undefined,
    handlerMap: { sheets_data: vi.fn() },
    googleClient: {} as never,
    requestAbortSignal: undefined,
    requestContext: createRequestContext({
      requestId: 'req-1',
      traceId: 'trace-1',
      principalId: 'user-1',
    }),
    requestId: 'req-1',
    traceId: 'trace-1',
    operationId: 'op-1',
    startTime: Date.now() - 5,
    timestamp: new Date().toISOString(),
    costTrackingTenantId: 'tenant-1',
    ...overrides,
  };
}

describe('executeToolCallRuntime', () => {
  it('short-circuits when preflight returns a response', async () => {
    const startKeepalive = vi.fn();
    const recordSuccessful = vi.fn();

    const result = await executeToolCallRuntime(createInput(), {
      resolvePreflight: vi.fn().mockResolvedValue({
        kind: 'response',
        response: {
          content: [],
          structuredContent: {
            response: {
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'auth required', retryable: true },
            },
          },
        },
      }),
      startKeepalive,
      recordSuccessful,
    });

    expect(startKeepalive).not.toHaveBeenCalled();
    expect(recordSuccessful).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      response: {
        success: false,
        error: { code: 'NOT_AUTHENTICATED' },
      },
    });
  });

  it('records successful execution and wraps the result', async () => {
    const keepalive = { stop: vi.fn() };
    const recordSuccessful = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn();

    const result = await executeToolCallRuntime(
      createInput(),
      {
        resolvePreflight: vi.fn().mockResolvedValue({
          kind: 'handler',
          handler,
        }),
        startKeepalive: vi.fn().mockReturnValue(keepalive),
        executeToolCall: vi.fn().mockResolvedValue({
          response: {
            success: true,
            values: [[1]],
          },
        }),
        recordSuccessful,
      }
    );

    expect(recordSuccessful).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sheets_data',
        action: 'read',
        principalId: 'user-1',
        costTrackingTenantId: 'tenant-1',
      })
    );
    expect(keepalive.stop).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      response: {
        success: true,
      },
    });
  });

  it('records failures and converts Google auth errors', async () => {
    const keepalive = { stop: vi.fn() };
    const error = new Error('token expired');
    const recordFailed = vi.fn().mockResolvedValue(undefined);

    const result = await executeToolCallRuntime(createInput(), {
      resolvePreflight: vi.fn().mockResolvedValue({
        kind: 'handler',
        handler: vi.fn(),
      }),
      startKeepalive: vi.fn().mockReturnValue(keepalive),
      executeToolCall: vi.fn().mockRejectedValue(error),
      buildErrorPayload: vi.fn().mockReturnValue({
        errorCode: 'TOKEN_EXPIRED',
        errorMessage: 'token expired',
        errorPayload: {
          code: 'TOKEN_EXPIRED',
          message: 'token expired',
          retryable: false,
        },
      }),
      recordFailed,
      isGoogleAuthError: vi.fn().mockReturnValue(true),
      convertGoogleAuthError: vi.fn().mockReturnValue({
        response: {
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'token expired',
            retryable: true,
          },
        },
      }),
    });

    expect(recordFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sheets_data',
        errorCode: 'TOKEN_EXPIRED',
      })
    );
    expect(keepalive.stop).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      response: {
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
        },
      },
    });
  });

  it('throws an abort error before entering request context when request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('cancelled');

    await expect(
      executeToolCallRuntime(
        createInput({
          requestAbortSignal: controller.signal,
        })
      )
    ).rejects.toMatchObject({
      name: 'AbortError',
      code: 'OPERATION_CANCELLED',
      message: 'cancelled',
    });
  });
});
