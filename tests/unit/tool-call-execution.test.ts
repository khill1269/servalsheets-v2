import { describe, expect, it, vi } from 'vitest';
import { createRequestContext } from '../../src/utils/request-context.js';
import { executeTracedToolCall } from '../../src/mcp/registration/tool-call-execution.js';

function createSpan() {
  return {
    context: {
      traceId: 'trace-child',
      spanId: 'span-child',
      traceFlags: 1,
    },
    parentSpanId: 'span-parent',
    setAttributes: vi.fn(),
  };
}

describe('executeTracedToolCall', () => {
  it('returns a RATE_LIMITED response before invoking the handler', async () => {
    const handler = vi.fn();
    const result = await executeTracedToolCall(
      {
        tool: { name: 'sheets_core' },
        args: { request: { action: 'get', spreadsheetId: 'sheet-123' } },
        handler,
        requestContext: createRequestContext({ requestId: 'req-1', principalId: 'user-1' }),
        operationId: 'op-1',
        requestId: 'req-1',
      },
      {
        runInToolSpan: async (_toolName, fn) => fn(createSpan()),
        checkRateLimit: vi.fn().mockReturnValue({ allowed: false, retryAfterMs: 250 }),
      }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      response: {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          retryAfterMs: 250,
        },
      },
    });
  });

  it('returns a FORMULA_INJECTION_BLOCKED response before invoking the handler', async () => {
    const handler = vi.fn();
    const result = await executeTracedToolCall(
      {
        tool: { name: 'sheets_data' },
        args: { request: { action: 'write', spreadsheetId: 'sheet-123' } },
        handler,
        requestContext: createRequestContext({ requestId: 'req-2', principalId: 'user-2' }),
        operationId: 'op-2',
        requestId: 'req-2',
      },
      {
        runInToolSpan: async (_toolName, fn) => fn(createSpan()),
        checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
        normalizeArgs: vi.fn().mockReturnValue({
          request: { action: 'write', spreadsheetId: 'sheet-123' },
        }),
        detectMutationSafety: vi
          .fn()
          .mockReturnValue({ path: 'request.values[0][0]', preview: '=IMPORTDATA("x")' }),
      }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      response: {
        success: false,
        error: {
          code: 'FORMULA_INJECTION_BLOCKED',
        },
      },
    });
  });

  it('injects protocol metadata and restores request context after successful execution', async () => {
    const requestContext = createRequestContext({
      requestId: 'req-3',
      traceId: 'trace-root',
      spanId: 'span-root',
      parentSpanId: 'span-remote',
      principalId: 'user-3',
    });
    const handlerResult = {
      response: {
        success: true,
        values: [[1]],
      },
    };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    const lockWrapper = vi.fn(async (_args, fn: () => Promise<unknown>) => fn());
    const span = createSpan();

    const result = await executeTracedToolCall(
      {
        tool: { name: 'sheets_data' },
        args: { action: 'read', spreadsheetId: 'sheet-456' },
        handler,
        requestContext,
        operationId: 'op-3',
        requestId: 'req-3',
      },
      {
        runInToolSpan: async (_toolName, fn) => fn(span),
        checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
        normalizeArgs: vi.fn().mockReturnValue({
          request: { action: 'read', spreadsheetId: 'sheet-456' },
        }),
        detectMutationSafety: vi.fn().mockReturnValue(null),
        executeWithWriteLock: lockWrapper,
        logLegacyInvocation: vi.fn(),
      }
    );

    expect(lockWrapper).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { request: { action: 'read', spreadsheetId: 'sheet-456' } },
      undefined
    );
    expect(result).toBe(handlerResult);
    expect(handlerResult.response['_meta']).toMatchObject({
      protocolVersion: '2025-11-25',
    });
    expect(requestContext.traceId).toBe('trace-root');
    expect(requestContext.spanId).toBe('span-root');
    expect(requestContext.parentSpanId).toBe('span-remote');
    expect(span.setAttributes).toHaveBeenCalled();
  });

  it('adds a deprecation warning to protocol metadata for legacy invocation patterns', async () => {
    const handlerResult = {
      response: {
        success: true,
      },
    };

    await executeTracedToolCall(
      {
        tool: { name: 'sheets_data' },
        args: { action: 'read', spreadsheetId: 'sheet-789' },
        handler: vi.fn().mockResolvedValue(handlerResult),
        requestContext: createRequestContext({ requestId: 'req-4', principalId: 'user-4' }),
        operationId: 'op-4',
        requestId: 'req-4',
      },
      {
        runInToolSpan: async (_toolName, fn) => fn(createSpan()),
        checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
        normalizeArgs: vi.fn().mockReturnValue({
          request: { action: 'read', spreadsheetId: 'sheet-789' },
        }),
        detectMutationSafety: vi.fn().mockReturnValue(null),
        executeWithWriteLock: async (_args, fn) => fn(),
        logLegacyInvocation: vi.fn(),
      }
    );

    expect(handlerResult.response['_meta']).toMatchObject({
      protocolVersion: '2025-11-25',
      deprecationWarning: expect.any(String),
    });
  });
});
