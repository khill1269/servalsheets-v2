import { describe, expect, it } from 'vitest';
import {
  getResponseRecord,
  injectStandardCollectionMeta,
  injectStandardPaginationMeta,
  normalizeStructuredContent,
  sanitizeErrorPayload,
} from '../../src/mcp/registration/tool-response-normalization.js';

describe('tool response normalization', () => {
  it('wraps success payloads into the MCP response envelope', () => {
    const normalized = normalizeStructuredContent({
      success: true,
      action: 'read',
      values: [[1]],
    });

    expect(normalized).toMatchObject({
      response: {
        success: true,
        action: 'read',
      },
    });
  });

  it('sanitizes stack traces and local file paths from error details', () => {
    const normalized = normalizeStructuredContent({
      response: {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'boom',
          stackTrace: 'stack',
          details: {
            stack: 'trace',
            file: '/Users/test/project/node_modules/pkg/index.js',
            safe: 'keep me',
          },
        },
      },
    });

    sanitizeErrorPayload(normalized);

    const response = getResponseRecord(normalized);
    expect(response?.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      details: {
        file: '[REDACTED_PATH]',
        safe: 'keep me',
      },
    });
    const error = response?.error as Record<string, unknown>;
    expect(error['stackTrace']).toBeUndefined();
    expect((error['details'] as Record<string, unknown>)['stack']).toBeUndefined();
  });

  it('injects standardized pagination metadata from token-based fields', () => {
    const response = {
      success: true,
      items: [{ id: 1 }, { id: 2 }],
      nextPageToken: 'cursor-1',
      totalRows: 10,
    };

    injectStandardPaginationMeta(response);

    expect(response._meta).toMatchObject({
      pagination: {
        hasMore: true,
        nextCursor: 'cursor-1',
        totalCount: 10,
        count: 2,
      },
    });
    expect(response.pagination).toMatchObject({
      hasMore: true,
      nextCursor: 'cursor-1',
    });
  });

  it('injects standardized collection metadata using pagination context when available', () => {
    const response = {
      success: true,
      sheets: [{ title: 'Sheet1' }, { title: 'Sheet2' }],
      _meta: {
        pagination: {
          hasMore: false,
          totalCount: 5,
          limit: 2,
        },
      },
    };

    injectStandardCollectionMeta(response);

    expect(response._meta).toMatchObject({
      collection: {
        itemsField: 'sheets',
        count: 2,
        totalCount: 5,
        hasMore: false,
        limit: 2,
      },
    });
  });
});
