/**
 * ServalSheets - Base Handler Tests
 *
 * Comprehensive tests for the BaseHandler abstract class.
 * Tests core functionality: response formatting, error handling, column conversions,
 * scope validation, request deduplication, and utility methods.
 *
 * Since BaseHandler is abstract, we use a concrete test implementation to verify all methods.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BaseHandler,
  type HandlerContext,
  type HandlerError,
  unwrapRequest,
} from '../../src/handlers/base.js';
import type { Intent } from '../../src/core/intent.js';
import type { BatchCompiler } from '../../src/core/batch-compiler.js';
import type { RangeResolver } from '../../src/core/range-resolver.js';
import type { ErrorDetail, ResponseMeta } from '../../src/schemas/shared.js';
import type { sheets_v4 } from 'googleapis';
import { getTracer, initTracer } from '../../src/utils/tracing.js';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

// Test implementation of BaseHandler
class TestHandler extends BaseHandler<any, any> {
  async handle(input: any): Promise<any> {
    return { success: true, action: 'test' };
  }

  protected createIntents(input: any): Intent[] {
    return [];
  }

  // Expose protected methods for testing
  public testSuccess<A extends string, T extends Record<string, unknown>>(
    action: A,
    data: T,
    mutation?: any,
    dryRun?: boolean,
    meta?: ResponseMeta
  ) {
    return this.success(action, data, mutation, dryRun, meta);
  }

  public testError(error: ErrorDetail): HandlerError {
    return this.error(error);
  }

  public testMapError(err: unknown): HandlerError {
    return this.mapError(err);
  }

  public testColumnToLetter(index: number): string {
    return this.columnToLetter(index);
  }

  public testLetterToColumn(letter: string): number {
    return this.letterToColumn(letter);
  }

  public testTrackSpreadsheetId(id?: string): void {
    return this.trackSpreadsheetId(id);
  }

  public testExtractCellsAffected(data: Record<string, unknown>): number | undefined {
    // Access private method via reflection for testing
    return (this as any).extractCellsAffected(data);
  }

  public testGenerateMeta(
    action: string,
    input: Record<string, unknown>,
    result?: Record<string, unknown>,
    options?: any
  ): ResponseMeta {
    return this.generateMeta(action, input, result, options);
  }

  public testRequireAuth(): void {
    return this.requireAuth();
  }

  public testSetVerbosity(verbosity: 'minimal' | 'standard' | 'detailed'): void {
    return this.setVerbosity(verbosity);
  }

  public testApplyVerbosityFilter<T extends { success: boolean; _meta?: unknown }>(
    response: T,
    verbosity: 'minimal' | 'standard' | 'detailed' = 'standard'
  ): T {
    return this.applyVerbosityFilter(response, verbosity);
  }

  public testNotFoundError(
    resourceType: string,
    identifier: string | number,
    details?: Record<string, unknown>
  ): HandlerError {
    return this.notFoundError(resourceType, identifier, details);
  }

  public testInvalidError(
    what: string,
    why: string,
    details?: Record<string, unknown>
  ): HandlerError {
    return this.invalidError(what, why, details);
  }

  public async testInstrumentedApiCall<T>(
    method: string,
    apiCall: () => Promise<T>,
    context?: { spreadsheetId?: string; action?: string; range?: string; sheetName?: string }
  ): Promise<T> {
    return this.instrumentedApiCall(method, apiCall, context);
  }

  public async testGetSheetId(
    spreadsheetId: string,
    sheetName?: string,
    sheetsApi?: sheets_v4.Sheets
  ): Promise<number> {
    return this.getSheetId(spreadsheetId, sheetName, sheetsApi);
  }
}

// Mock factory functions
function createMockContext(): HandlerContext {
  return {
    batchCompiler: {} as BatchCompiler,
    rangeResolver: {} as RangeResolver,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('BaseHandler', () => {
  let handler: TestHandler;
  let context: HandlerContext;

  beforeEach(() => {
    context = createMockContext();
    handler = new TestHandler('test-tool', context);
  });

  afterEach(() => {
    vi.clearAllMocks();
    initTracer({ enabled: false, logSpans: false });
  });

  describe('success() - Response Formatting', () => {
    it('should create a success response with action and data', () => {
      const data = { value: 42, name: 'test' };
      const result = handler.testSuccess('read', data);

      expect(result.success).toBe(true);
      expect(result.action).toBe('read');
      expect(result.value).toBe(42);
      expect(result.name).toBe('test');
    });

    it('should spread data fields directly into response (flat structure)', () => {
      const data = {
        spreadsheetId: 'sheet-123',
        range: 'A1:B10',
        values: [
          [1, 2],
          [3, 4],
        ],
      };
      const result = handler.testSuccess('get', data);

      expect(result.spreadsheetId).toBe('sheet-123');
      expect(result.range).toBe('A1:B10');
      expect(result.values).toEqual([
        [1, 2],
        [3, 4],
      ]);
      // Data should NOT be nested under 'data' field
      expect((result as any).data).toBeUndefined();
    });

    it('should include mutation summary when provided', () => {
      const data = { updatedCells: 10 };
      const mutation = { cellsAffected: 10, reversible: true };
      const result = handler.testSuccess('write', data, mutation);

      expect(result.mutation).toEqual(mutation);
    });

    it('should include dryRun flag when provided', () => {
      const data = {};
      const result = handler.testSuccess('write', data, undefined, true);

      expect(result.dryRun).toBe(true);
    });

    it('should include custom metadata when provided', () => {
      const data = {};
      const meta: ResponseMeta = {
        costEstimate: { apiCalls: 1, tokens: 100 },
      };
      const result = handler.testSuccess('test', data, undefined, false, meta);

      expect(result._meta).toEqual(meta);
    });

    it('should auto-generate metadata for standard verbosity', () => {
      handler.testSetVerbosity('standard');
      const data = { updatedCells: 5 };
      const result = handler.testSuccess('write', data);

      // Should have auto-generated metadata
      expect(result._meta?.costEstimate).toBeDefined();
    });

    it('should NOT include metadata for minimal verbosity', () => {
      handler.testSetVerbosity('minimal');
      const data = { updatedCells: 5 };
      const result = handler.testSuccess('write', data);

      expect(result._meta).toBeUndefined();
    });

    it('should extract cells affected from data fields', () => {
      handler.testSetVerbosity('standard');

      const result = handler.testSuccess('write', { updatedCells: 15 });
      expect(result._meta?.costEstimate).toBeDefined();
    });

    it('should omit undefined optional fields from response', () => {
      const data = { value: 1 };
      const result = handler.testSuccess('test', data);

      expect(result.mutation).toBeUndefined();
      expect(result.dryRun).toBeUndefined();
    });
  });

  describe('error() - Error Response Formatting', () => {
    it('should create an error response with proper structure', () => {
      const errorDetail: ErrorDetail = {
        code: 'INVALID_RANGE',
        message: 'Range is invalid',
        retryable: false,
      };
      const result = handler.testError(errorDetail);

      expect(result.success).toBe(false);
      expect(result.error).toEqual(errorDetail);
    });

    it('should preserve error details and metadata', () => {
      const errorDetail: ErrorDetail = {
        code: 'RATE_LIMIT',
        message: 'Too many requests',
        retryable: true,
        retryAfterMs: 5000,
        resolution: 'Wait and retry',
        resolutionSteps: ['Wait 5 seconds', 'Retry operation'],
      };
      const result = handler.testError(errorDetail);

      expect(result.error.code).toBe('RATE_LIMIT');
      expect(result.error.retryAfterMs).toBe(5000);
      expect(result.error.resolutionSteps).toHaveLength(2);
    });

    it('should support error details object with nested information', () => {
      const errorDetail: ErrorDetail = {
        code: 'VALIDATION_ERROR',
        message: 'Invalid field',
        retryable: false,
        details: {
          field: 'range',
          value: 'invalid',
          expectedFormat: 'A1 notation',
        },
      };
      const result = handler.testError(errorDetail);

      expect(result.error.details).toEqual({
        field: 'range',
        value: 'invalid',
        expectedFormat: 'A1 notation',
      });
    });
  });

  describe('mapError() - Error Mapping and Enrichment', () => {
    it('should map generic Error with code property', () => {
      const error = new Error('Test error') as any;
      error.code = 'CUSTOM_ERROR';
      error.message = 'Custom error message';

      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('CUSTOM_ERROR');
    });

    it('should detect and handle Zod validation errors', () => {
      const error = new Error('Validation failed') as any;
      error.issues = [
        {
          code: 'invalid_type',
          path: ['range'],
          message: 'Expected string',
          expected: 'string',
          received: 'number',
        },
      ];

      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('VALIDATION_ERROR');
    });

    it('should map rate limit errors', () => {
      const error = new Error('429 Too Many Requests - Rate limit exceeded');

      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('RATE_LIMITED');
      expect(result.error.retryable).toBe(true);
    });

    it('should map permission denied errors', () => {
      const error = new Error('403 Forbidden - Permission denied');

      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('PERMISSION_DENIED');
    });

    it('should map not found errors', () => {
      const error = new Error('404 Not Found - Requested entity was not found');

      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('SPREADSHEET_NOT_FOUND');
    });

    it('should map circular reference errors', () => {
      const error = new Error('Formula Error: circular dependency detected in formula');

      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('INVALID_REQUEST');
    });

    it('should map HTTP/2 connection errors', () => {
      const error = new Error('ERR_HTTP2_STREAM_CANCEL: The stream was reset by the server');

      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('CONNECTION_ERROR');
      expect(result.error.retryable).toBe(true);
    });

    it('should map unknown errors to UNKNOWN_ERROR', () => {
      const error = new Error('Some unexpected error occurred');

      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
      expect(result.error.code).toMatch(/INTERNAL_ERROR|UNKNOWN_ERROR/);
    });

    it('should map non-Error objects to UNKNOWN_ERROR', () => {
      const result = handler.testMapError('just a string error');

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('UNKNOWN_ERROR');
      expect(result.error.message).toBe('just a string error');
    });

    it('should track spreadsheet ID in error details', () => {
      handler.testTrackSpreadsheetId('sheet-123');
      const error = new Error('404 Not Found');

      const result = handler.testMapError(error);

      expect(result.error.code).toBe('SPREADSHEET_NOT_FOUND');
      expect(result.error.details?.['resourceId']).toBe('sheet-123');
    });
  });

  describe('Column Conversion Methods', () => {
    describe('columnToLetter()', () => {
      it('should convert 0-based column indices to letters', () => {
        expect(handler.testColumnToLetter(0)).toBe('A');
        expect(handler.testColumnToLetter(1)).toBe('B');
        expect(handler.testColumnToLetter(25)).toBe('Z');
      });

      it('should handle multi-letter columns', () => {
        expect(handler.testColumnToLetter(26)).toBe('AA');
        expect(handler.testColumnToLetter(27)).toBe('AB');
        expect(handler.testColumnToLetter(51)).toBe('AZ');
        expect(handler.testColumnToLetter(52)).toBe('BA');
      });

      it('should handle large column indices', () => {
        expect(handler.testColumnToLetter(701)).toBe('ZZ');
        expect(handler.testColumnToLetter(702)).toBe('AAA');
      });

      it('should memoize results for performance', () => {
        const letter1 = handler.testColumnToLetter(5);
        const letter2 = handler.testColumnToLetter(5);

        expect(letter1).toBe('F');
        expect(letter2).toBe('F');
        // Memoization should return same result
        expect(letter1).toBe(letter2);
      });
    });

    describe('letterToColumn()', () => {
      it('should convert single letters to column indices', () => {
        expect(handler.testLetterToColumn('A')).toBe(0);
        expect(handler.testLetterToColumn('B')).toBe(1);
        expect(handler.testLetterToColumn('Z')).toBe(25);
      });

      it('should convert multi-letter columns to indices', () => {
        expect(handler.testLetterToColumn('AA')).toBe(26);
        expect(handler.testLetterToColumn('AB')).toBe(27);
        expect(handler.testLetterToColumn('AZ')).toBe(51);
        expect(handler.testLetterToColumn('BA')).toBe(52);
      });

      it('should handle large letter sequences', () => {
        expect(handler.testLetterToColumn('ZZ')).toBe(701);
        expect(handler.testLetterToColumn('AAA')).toBe(702);
      });

      it('should memoize results for performance', () => {
        const col1 = handler.testLetterToColumn('ABC');
        const col2 = handler.testLetterToColumn('ABC');

        expect(col1).toBe(col2);
      });
    });

    it('should round-trip between letters and indices', () => {
      const indices = [0, 1, 25, 26, 51, 100, 701, 702];

      for (const index of indices) {
        const letter = handler.testColumnToLetter(index);
        const converted = handler.testLetterToColumn(letter);
        expect(converted).toBe(index);
      }
    });
  });

  describe('Error Creation Helpers', () => {
    describe('notFoundError()', () => {
      it('should create NOT_FOUND error with resource type and identifier', () => {
        const result = handler.testNotFoundError('Sheet', 'Sheet1');

        expect(result.success).toBe(false);
        expect(result.error.code).toBe('SHEET_NOT_FOUND');
        expect(result.error.message).toContain('Sheet1');
      });

      it('should support numeric identifiers', () => {
        const result = handler.testNotFoundError('Chart', 123);

        expect(result.error.code).toBe('SHEET_NOT_FOUND');
        expect(result.error.message).toContain('123');
      });

      it('should include custom details when provided', () => {
        const details = { suggestions: ['Check sheet name', 'Use list_sheets'] };
        const result = handler.testNotFoundError('Sheet', 'Missing', details);

        expect(result.error.details).toEqual(details);
      });
    });

    describe('invalidError()', () => {
      it('should create INVALID_REQUEST error with context', () => {
        const result = handler.testInvalidError('range', 'Must be A1 notation');

        expect(result.success).toBe(false);
        expect(result.error.code).toBe('INVALID_REQUEST');
        expect(result.error.message).toContain('range');
        expect(result.error.message).toContain('A1 notation');
      });

      it('should include custom details', () => {
        const details = { received: 'invalid!range', expected: 'Sheet1!A1:B10' };
        const result = handler.testInvalidError('range', 'bad format', details);

        expect(result.error.details).toEqual(details);
      });
    });
  });

  describe('Metadata Generation', () => {
    it('should generate metadata with cost estimate for standard verbosity', () => {
      handler.testSetVerbosity('standard');
      const meta = handler.testGenerateMeta('read', {}, { values: [[1, 2, 3]] });

      expect(meta.costEstimate).toBeDefined();
    });

    it('should generate detailed metadata when requested', () => {
      handler.testSetVerbosity('detailed');
      const meta = handler.testGenerateMeta(
        'write',
        {},
        { updatedCells: 10 },
        { cellsAffected: 10 }
      );

      expect(meta).not.toBeNull();
      expect(meta.costEstimate).toBeDefined();
    });

    it('should handle metadata generation with options', () => {
      handler.testSetVerbosity('standard');
      const meta = handler.testGenerateMeta(
        'test',
        {},
        {},
        {
          cellsAffected: 100,
          apiCallsMade: 5,
          duration: 1000,
        }
      );

      expect(meta).not.toBeNull();
      expect(meta.costEstimate).toBeDefined();
    });
  });

  describe('Extract Cells Affected', () => {
    it('should extract updatedCells field', () => {
      const cells = handler.testExtractCellsAffected({ updatedCells: 42 });
      expect(cells).toBe(42);
    });

    it('should extract cellsAffected field', () => {
      const cells = handler.testExtractCellsAffected({ cellsAffected: 15 });
      expect(cells).toBe(15);
    });

    it('should extract cellsFormatted field', () => {
      const cells = handler.testExtractCellsAffected({ cellsFormatted: 20 });
      expect(cells).toBe(20);
    });

    it('should infer from values array dimensions', () => {
      const data = {
        values: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      };
      const cells = handler.testExtractCellsAffected(data);
      expect(cells).toBe(6);
    });

    it('should handle mixed row lengths in values array', () => {
      const data = {
        values: [[1, 2], [3, 4, 5], [6]],
      };
      const cells = handler.testExtractCellsAffected(data);
      expect(cells).toBe(6);
    });

    it('should return undefined when no cells info available', () => {
      const cells = handler.testExtractCellsAffected({});
      expect(cells).toBeUndefined();
    });

    it('should return undefined for empty values array', () => {
      const cells = handler.testExtractCellsAffected({ values: [] });
      expect(cells).toBe(0);
    });
  });

  describe('requireAuth()', () => {
    it('should not throw when googleClient is available', () => {
      context.googleClient = {} as any;
      handler = new TestHandler('test', context);

      expect(() => {
        handler.testRequireAuth();
      }).not.toThrow();
    });

    it('should throw error when googleClient is missing', () => {
      context.googleClient = null;
      handler = new TestHandler('test', context);

      expect(() => {
        handler.testRequireAuth();
      }).toThrow();
    });

    it('should throw error with clear auth instructions', () => {
      context.googleClient = undefined;
      handler = new TestHandler('test', context);

      let thrownError: any = null;
      try {
        handler.testRequireAuth();
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError.error?.message || thrownError.message).toContain(
        'Authentication required'
      );
    });
  });

  describe('Verbosity Level Control', () => {
    it('should set verbosity to minimal', () => {
      handler.testSetVerbosity('minimal');
      const data = {};
      const result = handler.testSuccess('test', data);

      expect(result._meta).toBeUndefined();
    });

    it('should set verbosity to standard (default)', () => {
      handler.testSetVerbosity('standard');
      const data = { value: 1 };
      const result = handler.testSuccess('test', data);

      expect(result._meta?.costEstimate).toBeDefined();
    });

    it('should set verbosity to detailed', () => {
      handler.testSetVerbosity('detailed');
      const data = { value: 1 };
      const result = handler.testSuccess('test', data);

      expect(result._meta?.costEstimate).toBeDefined();
    });
  });

  describe('applyVerbosityFilter()', () => {
    it('should remove _meta for minimal verbosity', () => {
      const response = {
        success: true,
        value: 1,
        _meta: { costEstimate: { tokens: 100 } },
      } as any;

      const filtered = handler.testApplyVerbosityFilter(response, 'minimal');

      expect(filtered._meta).toBeUndefined();
      expect(filtered.value).toBe(1);
    });

    it('should not filter for standard verbosity', () => {
      const response = {
        success: true,
        value: 1,
        _meta: { costEstimate: { tokens: 100 } },
      } as any;

      const filtered = handler.testApplyVerbosityFilter(response, 'standard');

      expect(filtered._meta).toEqual({ costEstimate: { tokens: 100 } });
      expect(filtered.value).toBe(1);
    });

    it('should truncate large arrays for minimal verbosity', () => {
      const response = {
        success: true,
        items: [1, 2, 3, 4, 5],
        _meta: { costEstimate: { tokens: 100 } },
      } as any;

      const filtered = handler.testApplyVerbosityFilter(response, 'minimal');

      expect(filtered.items).toHaveLength(3);
      expect(filtered.itemsTruncated).toBe(2);
    });

    it('should preserve essential arrays even in minimal mode', () => {
      const response = {
        success: true,
        values: [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
        ],
        _meta: { costEstimate: { tokens: 100 } },
      } as any;

      const filtered = handler.testApplyVerbosityFilter(response, 'minimal');

      // 'values' is in preserved arrays list, so shouldn't be truncated
      expect(filtered.values).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
        [7, 8],
      ]);
    });

    it('should remove verbose fields for minimal verbosity', () => {
      const response = {
        success: true,
        value: 1,
        suggestions: ['suggestion 1'],
        nextSteps: ['step 1'],
        warnings: ['warning 1'],
        _meta: { costEstimate: { tokens: 100 } },
      } as any;

      const filtered = handler.testApplyVerbosityFilter(response, 'minimal');

      expect(filtered.suggestions).toBeUndefined();
      expect(filtered.nextSteps).toBeUndefined();
      expect(filtered.warnings).toBeUndefined();
      expect(filtered.value).toBe(1);
    });

    it('should not filter error responses', () => {
      const response = {
        success: false,
        error: { code: 'ERROR', message: 'Test' },
        _meta: { costEstimate: { tokens: 100 } },
      } as any;

      const filtered = handler.testApplyVerbosityFilter(response, 'minimal');

      expect(filtered._meta).toEqual({ costEstimate: { tokens: 100 } });
    });
  });

  describe('Track Spreadsheet ID', () => {
    it('should track spreadsheet ID for error messages', () => {
      handler.testTrackSpreadsheetId('sheet-abc-123');
      const error = new Error('404 Not Found');

      const result = handler.testMapError(error);

      expect(result.error.details?.['resourceId']).toBe('sheet-abc-123');
    });

    it('should clear spreadsheet ID when set to undefined', () => {
      handler.testTrackSpreadsheetId('sheet-123');
      handler.testTrackSpreadsheetId(undefined);

      const error = new Error('Test error');
      const result = handler.testMapError(error);

      expect(result.success).toBe(false);
    });
  });

  describe('unwrapRequest() - Helper Function', () => {
    it('should extract request from envelope', () => {
      const envelope = { request: { spreadsheetId: 'sheet-123' } };
      const unwrapped = unwrapRequest(envelope);

      expect(unwrapped).toEqual({ spreadsheetId: 'sheet-123' });
    });

    it('should return direct input when no envelope', () => {
      const input = { spreadsheetId: 'sheet-123' };
      const unwrapped = unwrapRequest(input);

      expect(unwrapped).toEqual(input);
    });

    it('should handle legacy format transparently', () => {
      const legacy = { request: { action: 'read', range: 'A1:B10' } };
      const unwrapped = unwrapRequest(legacy);

      expect(unwrapped).toEqual({ action: 'read', range: 'A1:B10' });
    });

    it('should return input if request field is not an object', () => {
      const input = { request: 'invalid', other: 'field' } as any;
      const unwrapped = unwrapRequest(input);

      expect(unwrapped).toEqual(input);
    });

    it('should handle null/undefined gracefully', () => {
      const unwrapped1 = unwrapRequest({} as any);
      const unwrapped2 = unwrapRequest(null as any);

      expect(unwrapped1).toEqual({});
      expect(typeof unwrapped2).toBe('object');
    });
  });

  describe('Complex Integration Scenarios', () => {
    it('should handle full success response with all optional fields', () => {
      handler.testSetVerbosity('detailed');
      const data = {
        spreadsheetId: 'sheet-123',
        updatedCells: 25,
        values: [
          [1, 2],
          [3, 4],
        ],
      };
      const mutation = {
        cellsAffected: 25,
        reversible: true,
        revertSnapshotId: 'snap-456',
      };
      const meta: ResponseMeta = {
        costEstimate: { apiCalls: 2, tokens: 200 },
      };

      const result = handler.testSuccess('write', data, mutation, false, meta);

      expect(result.success).toBe(true);
      expect(result.action).toBe('write');
      expect(result.spreadsheetId).toBe('sheet-123');
      expect(result.mutation).toEqual(mutation);
      expect(result.dryRun).toBe(false);
      expect(result._meta).toEqual(meta);
    });

    it('should map and enrich errors with all contextual information', () => {
      handler.testTrackSpreadsheetId('sheet-xyz');
      const googleError = new Error('403 Forbidden - Permission denied') as any;
      googleError.code = 403;

      const result = handler.testMapError(googleError);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.retryable).toBe(false);
    });

    it('should handle response with cells affected extraction', () => {
      handler.testSetVerbosity('standard');
      const data = {
        range: 'Sheet1!A1:C5',
        updatedCells: 15,
        values: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
          [10, 11, 12],
          [13, 14, 15],
        ],
      };

      const result = handler.testSuccess('write', data);

      expect(result.success).toBe(true);
      expect(result.range).toBe('Sheet1!A1:C5');
      expect(result.updatedCells).toBe(15);
      expect(result._meta?.costEstimate).toBeDefined();
    });
  });

  describe('Tracing Instrumentation', () => {
    it('should attach spreadsheet/action/range attributes and record exceptions', async () => {
      initTracer({ enabled: true, logSpans: false });
      const tracer = getTracer();
      tracer.clearSpans();

      const apiError = new Error('Tracing test failure');
      await expect(
        handler.testInstrumentedApiCall(
          'spreadsheets.values.get',
          async () => {
            throw apiError;
          },
          {
            spreadsheetId: 'sheet-trace-1',
            action: 'read_range',
            range: 'Sheet1!A1:B2',
          }
        )
      ).rejects.toThrow('Tracing test failure');

      const spans = tracer.getSpans().filter((s) => s.name === 'api.spreadsheets.values.get');
      expect(spans.length).toBeGreaterThan(0);
      const latestSpan = spans[spans.length - 1]!;

      expect(latestSpan.attributes['spreadsheet.id']).toBe('sheet-trace-1');
      expect(latestSpan.attributes['spreadsheetId']).toBe('sheet-trace-1');
      expect(latestSpan.attributes['action']).toBe('read_range');
      expect(latestSpan.attributes['range']).toBe('Sheet1!A1:B2');
      expect(latestSpan.status).toBe('error');
      expect(latestSpan.events.some((event) => event.name === 'exception')).toBe(true);
    });

    it('should wire shared getSheetId API path through instrumented spans', async () => {
      initTracer({ enabled: true, logSpans: false });
      const tracer = getTracer();
      tracer.clearSpans();

      const spreadsheetId = `sheet-trace-1704067200000`;
      const mockSheetsApi = {
        spreadsheets: {
          get: vi.fn().mockResolvedValue({
            data: {
              sheets: [{ properties: { sheetId: 123, title: 'Sheet1' } }],
            },
          }),
        },
      };

      const sheetId = await handler.testGetSheetId(spreadsheetId, 'Sheet1', mockSheetsApi);
      expect(sheetId).toBe(123);

      const resolveSpan = tracer
        .getSpans()
        .find(
          (span) =>
            span.name === 'api.spreadsheets.get' &&
            span.attributes['action'] === 'resolve_sheet_id' &&
            span.attributes['spreadsheetId'] === spreadsheetId
        );

      expect(resolveSpan).toBeDefined();
    });

    it('should use request-scoped metadata cache when handler context lacks one', async () => {
      const metadataCache = {
        getSheetId: vi.fn().mockResolvedValue(456),
        getOrFetch: vi.fn(),
      };
      const mockSheetsApi = {
        spreadsheets: {
          get: vi.fn(),
        },
      };

      const requestContext = createRequestContext({
        metadataCache: metadataCache as any,
      });

      const sheetId = await runWithRequestContext(requestContext, () =>
        handler.testGetSheetId('sheet-cached', 'CachedSheet', mockSheetsApi as any)
      );

      expect(sheetId).toBe(456);
      expect(metadataCache.getSheetId).toHaveBeenCalledWith('sheet-cached', 'CachedSheet');
      expect(mockSheetsApi.spreadsheets.get).not.toHaveBeenCalled();
    });
  });
});
