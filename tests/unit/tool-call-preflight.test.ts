import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetHistoryService } from '../../src/services/history-service.js';
import {
  resolveToolCallPreflight,
  type ToolCallPreflightInput,
} from '../../src/mcp/registration/tool-call-preflight.js';

function createInput(
  overrides: Partial<ToolCallPreflightInput> = {}
): ToolCallPreflightInput {
  return {
    tool: { name: 'sheets_core' },
    args: { request: { action: 'get', spreadsheetId: 'spreadsheet-123' } },
    handlerMap: {
      sheets_core: vi.fn(),
    },
    googleClient: {} as never,
    operationId: 'op-123',
    timestamp: new Date().toISOString(),
    startTime: Date.now() - 5,
    requestId: 'req-123',
    ...overrides,
  };
}

describe('resolveToolCallPreflight', () => {
  afterEach(() => {
    resetHistoryService();
    vi.restoreAllMocks();
  });

  it('returns the resolved handler when auth passes', async () => {
    const handler = vi.fn();
    const result = await resolveToolCallPreflight(createInput({ handlerMap: { sheets_core: handler } }), {
      authCheck: vi.fn().mockResolvedValue({ authenticated: true }),
    });

    expect(result).toEqual({
      kind: 'handler',
      handler,
    });
  });

  it('returns the default auth guidance when a protected tool is unauthenticated', async () => {
    const result = await resolveToolCallPreflight(createInput(), {
      authCheck: vi.fn().mockResolvedValue({ authenticated: false }),
    });

    expect(result.kind).toBe('response');
    if (result.kind !== 'response') {
      throw new Error('Expected response result');
    }

    expect(result.response.structuredContent).toMatchObject({
      response: {
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          suggestedNextStep: {
            tool: 'sheets_auth',
            action: 'status',
          },
        },
      },
    });
  });

  it('uses pre-init handling for auth-exempt tools before authentication', async () => {
    const result = await resolveToolCallPreflight(
      createInput({
        tool: { name: 'sheets_session' },
        args: { request: { action: 'get_active' } },
        handlerMap: null,
        googleClient: null,
      }),
      {
        handlePreInit: vi.fn().mockResolvedValue({
          response: {
            success: true,
            action: 'get_active',
          },
        }),
      }
    );

    expect(result.kind).toBe('response');
    if (result.kind !== 'response') {
      throw new Error('Expected response result');
    }

    expect(result.response.structuredContent).toMatchObject({
      response: {
        success: true,
        action: 'get_active',
      },
    });
  });

  it('returns authentication-required when no handler map exists for protected tools', async () => {
    const result = await resolveToolCallPreflight(
      createInput({
        handlerMap: null,
        googleClient: null,
      }),
      {
        authCheck: vi.fn().mockResolvedValue({ authenticated: true }),
      }
    );

    expect(result.kind).toBe('response');
    if (result.kind !== 'response') {
      throw new Error('Expected response result');
    }

    expect(result.response.structuredContent).toMatchObject({
      response: {
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
        },
      },
    });
  });

  it('returns not-implemented when the tool handler is missing', async () => {
    const result = await resolveToolCallPreflight(
      createInput({
        handlerMap: {},
      }),
      {
        authCheck: vi.fn().mockResolvedValue({ authenticated: true }),
      }
    );

    expect(result.kind).toBe('response');
    if (result.kind !== 'response') {
      throw new Error('Expected response result');
    }

    expect(result.response.structuredContent).toMatchObject({
      response: {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
        },
      },
    });
  });
});
