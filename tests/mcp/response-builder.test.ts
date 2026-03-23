/**
 * ServalSheets - Response Builder Tests
 *
 * Tests for Phase 4 response optimization utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  createLazyResponse,
  buildSuccessResponse,
  buildErrorResponse,
  createStreamingResponse,
  fastSerialize,
  estimateResponseSize,
  buildFromTemplate,
  ResponseBuilder,
} from '../../src/mcp/response-builder.js';

describe('Lazy Response', () => {
  it('should create lazy response without serialization', () => {
    const data = { success: true, action: 'read', values: [[1, 2, 3]] };
    const lazy = createLazyResponse(data);

    // Should not have serialized yet
    expect(lazy.isError()).toBe(false);
    expect(lazy.estimatedSize()).toBeGreaterThan(0);
  });

  it('should serialize on toResult()', () => {
    const data = { success: true, action: 'read', values: [[1, 2, 3]] };
    const lazy = createLazyResponse(data);

    const result = lazy.toResult();
    expect(result.content).toBeDefined();
    expect(result.structuredContent).toBeDefined();
    expect(result.isError).toBeUndefined();
  });

  it('should cache serialization result', () => {
    const data = { success: true, action: 'read' };
    const lazy = createLazyResponse(data);

    const result1 = lazy.toResult();
    const result2 = lazy.toResult();

    expect(result1).toBe(result2); // Same object reference
  });

  it('should detect error responses', () => {
    const errorData = {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Not found' },
    };
    const lazy = createLazyResponse(errorData);

    expect(lazy.isError()).toBe(true);
    expect(lazy.toResult().isError).toBe(true);
  });

  it('should wrap response if needed', () => {
    const data = { success: true, action: 'read' };
    const lazy = createLazyResponse(data);

    const structured = lazy.getStructuredContent();
    expect(structured['response']).toBeDefined();
  });
});

describe('Success Response Builder', () => {
  it('should build success response', () => {
    const result = buildSuccessResponse('read', {
      values: [[1, 2]],
      range: 'A1:B1',
    });

    expect(result.content).toHaveLength(1);
    expect(result.structuredContent).toBeDefined();
    expect(result.isError).toBeUndefined();

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response['success']).toBe(true);
    expect(response['action']).toBe('read');
  });

  it('should truncate large values arrays', () => {
    const largeValues = Array.from({ length: 200 }, (_, i) =>
      Array.from({ length: 10 }, (_, j) => `${i},${j}`)
    );

    const result = buildSuccessResponse(
      'read',
      { values: largeValues, range: 'A1:J200' },
      { maxInlineCells: 500, truncationRows: 50 }
    );

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response['truncated']).toBe(true);
    expect(response['totalRows']).toBe(200);
    expect(response['displayedRows']).toBe(50);
  });

  it('should include resource URI for truncated data', () => {
    const largeValues = Array.from({ length: 200 }, () => [1, 2, 3, 4, 5]);

    const result = buildSuccessResponse(
      'read',
      { values: largeValues, range: 'Sheet1!A1:E200' },
      {
        maxInlineCells: 100,
        spreadsheetId: 'spreadsheet123',
        range: 'Sheet1!A1:E200',
      }
    );

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response['resourceUri']).toContain('sheets:///spreadsheet123');
  });
});

describe('Error Response Builder', () => {
  it('should build error response', () => {
    const result = buildErrorResponse('NOT_FOUND', 'Spreadsheet not found');

    expect(result.isError).toBe(true);

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response['success']).toBe(false);
    expect(response['error']).toBeDefined();
  });

  it('should include details when provided', () => {
    const result = buildErrorResponse('VALIDATION_ERROR', 'Invalid range', {
      field: 'range',
      value: 'invalid',
    });

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    const error = response['error'] as Record<string, unknown>;
    expect(error['details']).toEqual({ field: 'range', value: 'invalid' });
  });

  it('should set retryable flag for rate limit errors', () => {
    const result = buildErrorResponse('RATE_LIMIT', 'Too many requests');

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    const error = response['error'] as Record<string, unknown>;
    expect(error['code']).toBe('RATE_LIMITED');
    expect(error['retryable']).toBe(true);
  });

  it('should set non-retryable for validation errors', () => {
    const result = buildErrorResponse('VALIDATION_ERROR', 'Invalid input');

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    const error = response['error'] as Record<string, unknown>;
    expect(error['retryable']).toBe(false);
  });
});

describe('Streaming Response', () => {
  it('should create streaming response with chunks', () => {
    const values = Array.from({ length: 100 }, (_, i) => [i, i * 2]);
    const streaming = createStreamingResponse('read', values, { chunkSize: 30 });

    expect(streaming.totalChunks()).toBe(4); // 100 rows / 30 = 4 chunks
    expect(streaming.currentChunk()).toBe(0);
    expect(streaming.hasMore()).toBe(true);
  });

  it('should return chunks sequentially', () => {
    const values = Array.from({ length: 50 }, (_, i) => [i]);
    const streaming = createStreamingResponse('read', values, { chunkSize: 20 });

    const chunk1 = streaming.nextChunk();
    expect(streaming.currentChunk()).toBe(1);

    const response1 = (chunk1.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response1['streaming']).toBeDefined();

    const streamingInfo = response1['streaming'] as Record<string, unknown>;
    expect(streamingInfo['chunkIndex']).toBe(0);
    expect(streamingInfo['isFirst']).toBe(true);
    expect(streamingInfo['isLast']).toBe(false);
  });

  it('should mark last chunk correctly', () => {
    const values = Array.from({ length: 25 }, (_, i) => [i]);
    const streaming = createStreamingResponse('read', values, { chunkSize: 20 });

    streaming.nextChunk(); // First chunk
    const lastChunk = streaming.nextChunk();

    const response = (lastChunk.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    const streamingInfo = response['streaming'] as Record<string, unknown>;
    expect(streamingInfo['isLast']).toBe(true);
    expect(streaming.hasMore()).toBe(false);
  });

  it('should include metadata in first chunk', () => {
    const values = [
      [1, 2],
      [3, 4],
    ];
    const streaming = createStreamingResponse('read', values, {
      chunkSize: 10,
      metadata: { range: 'A1:B2', spreadsheetId: 'ss123' },
    });

    const chunk = streaming.nextChunk();
    const response = (chunk.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response['range']).toBe('A1:B2');
    expect(response['spreadsheetId']).toBe('ss123');
  });
});

describe('Fast Serialization', () => {
  it('should serialize objects', () => {
    const data = { name: 'test', value: 123 };
    const result = fastSerialize(data);
    expect(JSON.parse(result)).toEqual(data);
  });

  it('should skip null values', () => {
    const data = { name: 'test', empty: null, value: 123 };
    const result = fastSerialize(data);
    const parsed = JSON.parse(result);
    expect(parsed['empty']).toBeUndefined();
    expect(parsed['name']).toBe('test');
  });

  it('should skip undefined values', () => {
    const data = { name: 'test', empty: undefined, value: 123 };
    const result = fastSerialize(data);
    const parsed = JSON.parse(result);
    expect('empty' in parsed).toBe(false);
  });

  it('should handle arrays', () => {
    const data = {
      values: [
        [1, 2],
        [3, 4],
      ],
    };
    const result = fastSerialize(data);
    expect(JSON.parse(result)).toEqual(data);
  });
});

describe('Response Size Estimation', () => {
  it('should estimate small response size', () => {
    const data = { name: 'test', value: 123 };
    const estimated = estimateResponseSize(data);
    const actual = JSON.stringify(data).length;

    // Should be within 50% of actual
    expect(estimated).toBeGreaterThan(actual * 0.5);
    expect(estimated).toBeLessThan(actual * 1.5);
  });

  it('should estimate array response size', () => {
    const data = {
      values: Array.from({ length: 10 }, () => ['cell1', 'cell2', 123]),
    };
    const estimated = estimateResponseSize(data);
    const actual = JSON.stringify(data).length;

    // Should be within 100% for arrays (rougher estimate)
    expect(estimated).toBeGreaterThan(actual * 0.3);
    expect(estimated).toBeLessThan(actual * 2);
  });
});

describe('Response Templates', () => {
  it('should build read success from template', () => {
    const result = buildFromTemplate('readSuccess', [[1, 2, 3]], 'A1:C1');

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response['success']).toBe(true);
    expect(response['action']).toBe('read');
    expect(response['values']).toEqual([[1, 2, 3]]);
    expect(response['range']).toBe('A1:C1');
  });

  it('should build write success from template', () => {
    const result = buildFromTemplate('writeSuccess', 10, 5, 2, 'A1:B5');

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response['success']).toBe(true);
    expect(response['action']).toBe('write');
    expect(response['updatedCells']).toBe(10);
  });

  it('should build not found error from template', () => {
    const result = buildFromTemplate('notFound', 'spreadsheet', 'ss123');

    expect(result.isError).toBe(true);
    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    expect(response['success']).toBe(false);
  });

  it('should build rate limited error from template', () => {
    const result = buildFromTemplate('rateLimited', 60000);

    const response = (result.structuredContent as Record<string, unknown>)['response'] as Record<
      string,
      unknown
    >;
    const error = response['error'] as Record<string, unknown>;
    expect(error['code']).toBe('RATE_LIMITED');
    expect(error['retryable']).toBe(true);
    expect(error['retryAfterMs']).toBe(60000);
  });
});

describe('ResponseBuilder Export', () => {
  it('should export all utilities', () => {
    expect(ResponseBuilder.createLazyResponse).toBeDefined();
    expect(ResponseBuilder.buildSuccessResponse).toBeDefined();
    expect(ResponseBuilder.buildErrorResponse).toBeDefined();
    expect(ResponseBuilder.createStreamingResponse).toBeDefined();
    expect(ResponseBuilder.fastSerialize).toBeDefined();
    expect(ResponseBuilder.estimateResponseSize).toBeDefined();
    expect(ResponseBuilder.buildFromTemplate).toBeDefined();
    expect(ResponseBuilder.RESPONSE_TEMPLATES).toBeDefined();
  });

  it('should export constants', () => {
    expect(ResponseBuilder.LARGE_RESPONSE_THRESHOLD).toBe(10000);
    expect(ResponseBuilder.STREAMING_THRESHOLD).toBe(50000);
    expect(ResponseBuilder.MAX_INLINE_CELLS).toBe(1000);
    expect(ResponseBuilder.TRUNCATION_ROWS).toBe(100);
  });
});
