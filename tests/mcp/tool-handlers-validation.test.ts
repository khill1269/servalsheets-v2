import { describe, expect, it, vi } from 'vitest';
import type { Handlers } from '../../src/handlers/index.js';
import {
  buildToolResponse,
  createToolHandlerMap,
  normalizeToolArgs,
} from '../../src/mcp/registration/tool-handlers.js';

function createMockHandlers(): Handlers {
  const makeHandler = () => ({ handle: vi.fn(async () => ({ response: { success: true } })) });

  return {
    core: makeHandler(),
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
  } as unknown as Handlers;
}

describe('tool-handlers validation enhancements', () => {
  it('includes valid actions for invalid action values', async () => {
    const handlers = createMockHandlers();
    const handlerMap = createToolHandlerMap(handlers);

    let thrown: unknown;
    try {
      await handlerMap.sheets_core({
        action: 'not_a_real_action',
        spreadsheetId: 'test-spreadsheet-id',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain('Valid actions:');
    expect(message).toContain('update_sheet');
    expect(handlers.core.handle).not.toHaveBeenCalled();
  });

  it('rejects invalid actions even when wrapped under request', async () => {
    const handlers = createMockHandlers();
    const handlerMap = createToolHandlerMap(handlers);

    let thrown: unknown;
    try {
      await handlerMap.sheets_core({
        request: {
          action: 'not_a_real_action',
          spreadsheetId: 'test-spreadsheet-id',
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain('Valid actions:');
    expect(handlers.core.handle).not.toHaveBeenCalled();
  });

  it('adds rename_sheet hint pointing to update_sheet', async () => {
    const handlers = createMockHandlers();
    const handlerMap = createToolHandlerMap(handlers);

    let thrown: unknown;
    try {
      await handlerMap.sheets_core({
        action: 'rename_sheet',
        spreadsheetId: 'test-spreadsheet-id',
        sheetId: 0,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain('update_sheet');
    expect(message).toContain('title');
  });
});

describe('normalizeToolArgs legacy compatibility', () => {
  it('flattens root-level legacy params wrapper', () => {
    const normalized = normalizeToolArgs({
      action: 'get',
      params: {
        spreadsheetId: 'sheet-123',
      },
    });

    expect(normalized).toEqual({
      request: {
        action: 'get',
        spreadsheetId: 'sheet-123',
      },
    });
  });

  it('flattens nested request.params wrapper', () => {
    const normalized = normalizeToolArgs({
      request: {
        action: 'get',
        params: {
          spreadsheetId: 'sheet-456',
        },
      },
    });

    expect(normalized).toEqual({
      request: {
        action: 'get',
        spreadsheetId: 'sheet-456',
      },
    });
  });
});

describe('buildToolResponse non-fatal classification', () => {
  it('sets isError=true for VALIDATION_ERROR (SEP-1303 compliance)', () => {
    const result = buildToolResponse({
      response: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid action',
          retryable: false,
        },
      },
    });

    // SEP-1303: input validation errors MUST be returned as Tool Execution Errors (isError: true)
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).response.success).toBe(false);
  });

  it('keeps internal failures as MCP errors', () => {
    const result = buildToolResponse({
      response: {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unexpected failure',
          retryable: false,
        },
      },
    });

    expect(result.isError).toBe(true);
  });

  it('adds standardized truncation metadata when payload exceeds token budget', () => {
    const previousBudget = process.env['MCP_MAX_RESPONSE_BYTES'];
    process.env['MCP_MAX_RESPONSE_BYTES'] = '512';

    try {
      const result = buildToolResponse({
        response: {
          success: true,
          payload: 'x'.repeat(6000),
        },
      });

      const response = (result.structuredContent as any).response;
      const meta = response._meta;
      expect(response.success).toBe(true);
      expect(response.resourceUri).toBeDefined();
      expect(meta).toMatchObject({
        truncated: true,
        originalSizeBytes: expect.any(Number),
        deliveredSizeBytes: expect.any(Number),
        retrievalUri: expect.any(String),
        continuationHint: expect.any(String),
      });
      expect(meta.retrievalUri).toBe(response.resourceUri);
      expect(meta.continuationHint).toContain('resources/read');
    } finally {
      if (previousBudget === undefined) {
        delete process.env['MCP_MAX_RESPONSE_BYTES'];
      } else {
        process.env['MCP_MAX_RESPONSE_BYTES'] = previousBudget;
      }
    }
  });
});

describe('buildToolResponse error-code compatibility metadata', () => {
  it('adds canonical metadata when handler returns a legacy alias code', () => {
    const result = buildToolResponse({
      response: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid field',
          retryable: false,
        },
      },
    });

    const meta = (result.structuredContent as any)._meta;
    expect(meta.errorCode).toBe('VALIDATION_ERROR');
    expect(meta.errorCodeCanonical).toBe('INVALID_REQUEST');
    expect(meta.errorCodeFamily).toBe('validation');
    expect(meta.errorCodeIsAlias).toBe(true);
  });

  it('falls back to UNKNOWN_ERROR canonical metadata for unknown codes', () => {
    const result = buildToolResponse({
      response: {
        success: false,
        error: {
          code: 'CUSTOM_RUNTIME_ERROR',
          message: 'Unknown custom code',
          retryable: false,
        },
      },
    });

    const meta = (result.structuredContent as any)._meta;
    expect(meta.errorCode).toBe('CUSTOM_RUNTIME_ERROR');
    expect(meta.errorCodeCanonical).toBe('UNKNOWN_ERROR');
    expect(meta.errorCodeFamily).toBe('unknown');
    expect(meta.errorCodeIsAlias).toBeUndefined();
  });
});

describe('buildToolResponse pagination metadata standardization', () => {
  it('adds standardized _meta.pagination from top-level pagination fields', () => {
    const result = buildToolResponse({
      response: {
        success: true,
        values: [['a']],
        hasMore: true,
        nextCursor: 'cursor-abc',
        totalRows: 125,
        pageSize: 50,
      },
    });

    const response = (result.structuredContent as any).response;
    expect(response._meta.pagination).toMatchObject({
      hasMore: true,
      nextCursor: 'cursor-abc',
      totalCount: 125,
      limit: 50,
    });
    expect(response.pagination).toMatchObject({
      hasMore: true,
      nextCursor: 'cursor-abc',
      totalCount: 125,
      limit: 50,
    });
  });

  it('normalizes token-based pagination fields', () => {
    const result = buildToolResponse({
      response: {
        success: true,
        nextPageToken: 'token-next',
      },
    });

    expect((result.structuredContent as any).response._meta.pagination).toMatchObject({
      hasMore: true,
      nextCursor: 'token-next',
    });
  });

  it('preserves explicit _meta.pagination values when already provided', () => {
    const result = buildToolResponse({
      response: {
        success: true,
        hasMore: true,
        nextCursor: 'derived-cursor',
        totalRows: 100,
        _meta: {
          pagination: {
            hasMore: false,
            totalCount: 999,
          },
        },
      },
    });

    expect((result.structuredContent as any).response._meta.pagination).toMatchObject({
      hasMore: false,
      nextCursor: 'derived-cursor',
      totalCount: 999,
    });
  });
});

describe('buildToolResponse collection metadata standardization', () => {
  it('adds standardized _meta.collection for list-like responses', () => {
    const result = buildToolResponse({
      response: {
        success: true,
        permissions: [{ id: '1' }, { id: '2' }],
        hasMore: true,
        nextCursor: 'cursor-next',
        totalCount: 42,
      },
    });

    expect((result.structuredContent as any).response._meta.collection).toMatchObject({
      itemsField: 'permissions',
      count: 2,
      totalCount: 42,
      hasMore: true,
      nextCursor: 'cursor-next',
    });
  });

  it('preserves explicit _meta.collection values when already provided', () => {
    const result = buildToolResponse({
      response: {
        success: true,
        items: [{ id: 'a' }],
        _meta: {
          collection: {
            itemsField: 'custom_items',
            count: 999,
          },
        },
      },
    });

    expect((result.structuredContent as any).response._meta.collection).toMatchObject({
      itemsField: 'custom_items',
      count: 999,
    });
  });
});
