/**
 * ServalSheets v4 - Batch Compiler Tests
 *
 * Comprehensive error handling tests for mapGoogleError() and related functionality
 * Covers: Rate limits (429), Permission denied (403), Not found (404), Quota exceeded, Non-Error objects
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import {
  BatchCompiler,
  type ExecutionResult,
  type CompiledBatch,
} from '../../src/core/batch-compiler.js';
import type { RateLimiter } from '../../src/core/rate-limiter.js';
import type { DiffEngine, SpreadsheetState } from '../../src/core/diff-engine.js';
import type { PolicyEnforcer } from '../../src/core/policy-enforcer.js';
import type { SnapshotService } from '../../src/services/snapshot.js';

describe('BatchCompiler - Error Handling', () => {
  let compiler: BatchCompiler;
  let mockRateLimiter: RateLimiter;
  let mockDiffEngine: DiffEngine;
  let mockPolicyEnforcer: PolicyEnforcer;
  let mockSnapshotService: SnapshotService;
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    mockRateLimiter = {
      acquire: vi.fn().mockResolvedValue(undefined),
      throttle: vi.fn(),
      getStats: vi.fn(),
    } as any;

    mockDiffEngine = {
      captureState: vi.fn().mockResolvedValue({
        rowCount: 100,
        columnCount: 26,
        checksum: 'abc123',
      } as SpreadsheetState),
      diff: vi.fn().mockResolvedValue({
        tier: 'FULL',
        summary: {
          rowsChanged: 10,
          estimatedCellsChanged: 100,
        },
      }),
      getDefaultTier: vi.fn().mockReturnValue('METADATA'),
    } as any;

    mockPolicyEnforcer = {
      enforce: vi.fn().mockResolvedValue(undefined),
      getConfig: vi.fn(),
    } as any;

    mockSnapshotService = {
      create: vi.fn().mockResolvedValue('snap-123'),
      list: vi.fn(),
      restore: vi.fn(),
    } as any;

    mockSheetsApi = {
      spreadsheets: {
        batchUpdate: vi.fn(),
        get: vi.fn(),
        values: {
          get: vi.fn(),
        },
      },
    } as any;

    compiler = new BatchCompiler({
      rateLimiter: mockRateLimiter,
      diffEngine: mockDiffEngine,
      policyEnforcer: mockPolicyEnforcer,
      snapshotService: mockSnapshotService,
      sheetsApi: mockSheetsApi,
    });
  });

  describe('mapGoogleError() - Rate Limit Handling (429)', () => {
    it('should recognize 429 error code in message', async () => {
      const error = new Error('429: Rate limit exceeded');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RATE_LIMITED');
      expect(result.error?.retryable).toBe(true);
      expect(result.error?.retryAfterMs).toBe(60000);
    });

    it('should recognize "rate limit" in error message', async () => {
      const error = new Error('API rate limit exceeded for quota group default-57cd65a3f6bf05e1');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RATE_LIMITED');
      expect(result.error?.message).toContain('Rate limiter automatically throttled');
      expect(result.error?.suggestedFix).toBeDefined();
    });

    it('should throttle rate limiter for 60 seconds on rate limit error', async () => {
      const error = new Error('429 Too Many Requests');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      await compiler.execute(batch);

      expect(mockRateLimiter.throttle).toHaveBeenCalledWith(60000);
    });

    it('should return retry-able rate limit error', async () => {
      const error = new Error('rate limit exceeded');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryable).toBe(true);
      expect(result.error?.retryAfterMs).toBe(60000);
    });
  });

  describe('mapGoogleError() - Permission Denied Handling (403)', () => {
    it('should recognize 403 error code', async () => {
      const error = new Error('403: Forbidden - Permission denied');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');
      expect(result.error?.retryable).toBe(false);
    });

    it('should recognize "permission" in error message', async () => {
      const error = new Error('The caller does not have permission');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');
      expect(result.error?.message).toBe('Permission denied');
    });

    it('should provide helpful suggestion for permission errors', async () => {
      const error = new Error('403 permission');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.suggestedFix).toContain('edit access');
    });

    it('should mark permission errors as non-retryable', async () => {
      const error = new Error('You do not have permission to edit this spreadsheet');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryable).toBe(false);
    });
  });

  describe('mapGoogleError() - Not Found Handling (404)', () => {
    it('should recognize 404 error code', async () => {
      const error = new Error('404: Spreadsheet not found');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SPREADSHEET_NOT_FOUND');
      expect(result.error?.retryable).toBe(false);
    });

    it('should recognize "not found" in error message', async () => {
      const error = new Error('Spreadsheet not found with id abc123');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SPREADSHEET_NOT_FOUND');
      expect(result.error?.message).toBe('Spreadsheet not found');
    });

    it('should provide helpful suggestion for not found errors', async () => {
      const error = new Error('404 not found');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.suggestedFix).toContain('spreadsheet ID');
    });

    it('should mark not found errors as non-retryable', async () => {
      const error = new Error('Resource not found');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryable).toBe(false);
    });
  });

  describe('mapGoogleError() - Quota Exceeded Handling', () => {
    it('should recognize "quota" in error message', async () => {
      const error = new Error('Quota exceeded for quota group default-57cd65a3f6bf05e1');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('QUOTA_EXCEEDED');
      expect(result.error?.retryable).toBe(true);
    });

    it('should set long retry period for quota errors (1 hour)', async () => {
      const error = new Error('quota limit exceeded');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryAfterMs).toBe(3600000); // 1 hour
    });

    it('should provide helpful suggestion for quota errors', async () => {
      const error = new Error('API quota exceeded');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.suggestedFix).toContain('quota');
    });

    it('should mark quota errors as retryable', async () => {
      const error = new Error('quota');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryable).toBe(true);
    });
  });

  describe('mapGoogleError() - Non-Error Object Handling', () => {
    it('should handle string errors gracefully', async () => {
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce('String error message');

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.message).toBe('String error message');
      expect(result.error?.retryable).toBe(false);
    });

    it('should handle null/undefined errors gracefully', async () => {
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(null);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.message).toBe('null');
      expect(result.error?.retryable).toBe(false);
    });

    it('should handle object without message property', async () => {
      const batch = createMockBatch();
      const errorObj = { code: 'CUSTOM_ERROR', statusCode: 500 };

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(errorObj);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.message).toBeDefined();
      expect(result.error?.retryable).toBe(false);
    });

    it('should handle plain object errors', async () => {
      const batch = createMockBatch();
      const errorObj = { message: 'Some error occurred' };

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(errorObj);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.retryable).toBe(false);
    });

    it('should handle number errors', async () => {
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(500);

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.message).toBe('500');
    });

    it('should handle empty string errors', async () => {
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce('');

      const result = await compiler.execute(batch);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('Error Classification Correctness', () => {
    it('should correctly classify mutually exclusive error types', async () => {
      const errorCases = [
        { error: new Error('429 rate limited'), expectedCode: 'RATE_LIMITED' },
        { error: new Error('403 permission denied'), expectedCode: 'PERMISSION_DENIED' },
        { error: new Error('404 not found'), expectedCode: 'SPREADSHEET_NOT_FOUND' },
        { error: new Error('quota exceeded'), expectedCode: 'QUOTA_EXCEEDED' },
      ];

      for (const { error, expectedCode } of errorCases) {
        const batch = createMockBatch();
        (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

        const result = await compiler.execute(batch);

        expect(result.error?.code).toBe(expectedCode, `Failed to classify: ${error.message}`);
      }
    });

    it('should use first matching error pattern for ambiguous messages', async () => {
      // If a message contains multiple patterns, 429 should be checked first
      const error = new Error('429 rate limit and quota issue');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.code).toBe('RATE_LIMITED');
    });

    it('should preserve original error message for unknown errors', async () => {
      const customMessage = 'Custom application error';
      const error = new Error(customMessage);
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.message).toBe(customMessage);
    });
  });

  describe('Retry Logic for Retryable Errors', () => {
    it('should mark rate limit errors as retryable', async () => {
      const error = new Error('429 rate limit');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryable).toBe(true);
    });

    it('should mark permission errors as non-retryable', async () => {
      const error = new Error('403 permission');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryable).toBe(false);
    });

    it('should mark not found errors as non-retryable', async () => {
      const error = new Error('404 not found');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryable).toBe(false);
    });

    it('should mark quota errors as retryable', async () => {
      const error = new Error('quota exceeded');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryable).toBe(true);
    });

    it('should provide retryAfterMs for rate limit errors', async () => {
      const error = new Error('429');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryAfterMs).toBe(60000);
    });

    it('should provide retryAfterMs for quota errors', async () => {
      const error = new Error('quota');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryAfterMs).toBe(3600000);
    });

    it('should not provide retryAfterMs for non-retryable errors', async () => {
      const error = new Error('403 permission');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error?.retryAfterMs).toBeUndefined();
    });
  });

  describe('Error Handling in executeWithSafety', () => {
    it('should handle errors in executeWithSafety method', async () => {
      const operation = vi.fn().mockRejectedValueOnce(new Error('429 rate limit'));

      const result = await compiler.executeWithSafety({
        spreadsheetId: 'test-sheet-id',
        operation,
        safety: { dryRun: false },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RATE_LIMITED');
    });

    it('should preserve snapshot ID on error in executeWithSafety', async () => {
      mockSnapshotService.create = vi.fn().mockResolvedValueOnce('snap-456');
      const operation = vi.fn().mockRejectedValueOnce(new Error('403 permission'));

      const result = await compiler.executeWithSafety({
        spreadsheetId: 'test-sheet-id',
        operation,
        highRisk: true,
      });

      expect(result.snapshotId).toBe('snap-456');
      expect(result.success).toBe(false);
    });
  });

  describe('Error Handling in execute', () => {
    it('should preserve snapshot ID even on error', async () => {
      mockSnapshotService.create = vi.fn().mockResolvedValueOnce('snap-789');
      const error = new Error('404 not found');
      const batch = createMockBatch('test-id', true); // highRisk=true

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.snapshotId).toBe('snap-789');
      expect(result.success).toBe(false);
    });

    it('should return empty responses on error', async () => {
      const error = new Error('429 rate limit');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.responses).toEqual([]);
    });

    it('should include error details in result', async () => {
      const error = new Error('403 permission denied');
      const batch = createMockBatch();

      (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(error);

      const result = await compiler.execute(batch);

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBeDefined();
      expect(result.error?.message).toBeDefined();
      expect(result.error?.retryable).toBeDefined();
    });
  });

  describe('Error Pattern Matching Edge Cases', () => {
    it('should handle case-insensitive pattern matching for "not found"', async () => {
      const errorVariations = [
        'Resource NOT FOUND',
        'resource not found',
        'Resource Not Found',
        '404 NOT FOUND',
      ];

      for (const errorMsg of errorVariations) {
        const batch = createMockBatch();
        (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(new Error(errorMsg));

        const result = await compiler.execute(batch);

        expect(result.error?.code).toBe('SPREADSHEET_NOT_FOUND');
      }
    });

    it('should handle various rate limit error messages', async () => {
      const errorVariations = [
        'HTTP 429 Too Many Requests',
        'rate limit exceeded',
        '429',
        'Rate limit',
        'API rate limit exceeded',
      ];

      for (const errorMsg of errorVariations) {
        const batch = createMockBatch();
        (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(new Error(errorMsg));

        const result = await compiler.execute(batch);

        expect(result.error?.code).toBe('RATE_LIMITED');
      }
    });

    it('should handle various permission error messages', async () => {
      const errorVariations = [
        'HTTP 403 Forbidden',
        'permission',
        'Permission denied',
        '403',
        'You do not have permission',
      ];

      for (const errorMsg of errorVariations) {
        const batch = createMockBatch();
        (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(new Error(errorMsg));

        const result = await compiler.execute(batch);

        expect(result.error?.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should handle quota error message variations', async () => {
      const errorVariations = [
        'quota',
        'Quota exceeded',
        'Daily quota exceeded',
        'API quota limit reached',
      ];

      for (const errorMsg of errorVariations) {
        const batch = createMockBatch();
        (mockSheetsApi.spreadsheets.batchUpdate as any).mockRejectedValueOnce(new Error(errorMsg));

        const result = await compiler.execute(batch);

        expect(result.error?.code).toBe('QUOTA_EXCEEDED');
      }
    });
  });
});

// ============================================================
// Test Helpers
// ============================================================

function createMockBatch(spreadsheetId = 'test-spreadsheet-id', highRisk = false): CompiledBatch {
  return {
    spreadsheetId,
    requests: [
      {
        updateCells: {
          rows: [
            {
              values: [{ userEnteredValue: { stringValue: 'test' } }],
            },
          ],
          fields: 'userEnteredValue',
          range: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
        },
      } as sheets_v4.Schema$Request,
    ],
    estimatedCells: 100,
    destructive: false,
    highRisk,
    requestCount: 1,
  };
}
