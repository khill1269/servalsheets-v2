/**
 * Tests for Enhanced Errors - Quick Win #2: Resource Linking
 */

import { describe, it, expect } from 'vitest';
import { enhanceError } from '../../src/utils/enhanced-errors.js';

describe('Enhanced Errors - Quick Win #2: Resource Linking', () => {
  it('should include resource links for SHEET_NOT_FOUND', () => {
    const error = enhanceError('SHEET_NOT_FOUND', 'Sheet not found', {
      spreadsheetId: 'test-id',
      sheetName: 'TestSheet',
    });

    expect(error.resources).toBeDefined();
    expect(error.resources).toHaveLength(2);
    expect(error.resources![0].uri).toBe('servalsheets://decisions/find-sheet');
    expect(error.resources![0].description).toContain('Decision tree');
    expect(error.resources![1].uri).toBe('servalsheets://reference/sheet-naming');
  });

  it('should include resource links for RANGE_NOT_FOUND', () => {
    const error = enhanceError('RANGE_NOT_FOUND', 'Range not found', {
      range: 'Sheet1!A1:B10',
    });

    expect(error.resources).toBeDefined();
    expect(error.resources).toHaveLength(2);
    expect(error.resources![0].uri).toBe('servalsheets://reference/a1-notation');
    expect(error.resources![0].description).toContain('A1 notation');
    expect(error.resources![1].uri).toBe('servalsheets://decisions/find-range');
  });

  it('should include resource links for AUTH_REQUIRED', () => {
    const error = enhanceError('AUTH_REQUIRED', 'Authentication required');

    expect(error.resources).toBeDefined();
    expect(error.resources).toHaveLength(2);
    expect(error.resources![0].uri).toBe('servalsheets://reference/authentication');
    expect(error.resources![1].uri).toBe('servalsheets://decisions/auth-flow');
  });

  it('should include resource links for PERMISSION_DENIED', () => {
    const error = enhanceError('PERMISSION_DENIED', 'Permission denied', {
      operation: 'write',
    });

    expect(error.resources).toBeDefined();
    expect(error.resources).toHaveLength(2);
    expect(error.resources![0].uri).toBe('servalsheets://decisions/request-access');
    expect(error.resources![1].uri).toBe('servalsheets://reference/permissions');
  });

  it('should include resource links for QUOTA_EXCEEDED', () => {
    const error = enhanceError('QUOTA_EXCEEDED', 'Quota exceeded');

    expect(error.resources).toBeDefined();
    expect(error.resources).toHaveLength(2);
    expect(error.resources![0].uri).toBe('servalsheets://reference/api-limits');
    expect(error.resources![1].uri).toBe('servalsheets://decisions/optimize-requests');
    expect(error.resources![1].description).toContain('reduce API calls');
  });

  it('should include resource link for RATE_LIMIT', () => {
    const error = enhanceError('RATE_LIMIT', 'Rate limit exceeded');

    expect(error.resources).toBeDefined();
    expect(error.resources).toHaveLength(1);
    expect(error.resources![0].uri).toBe('servalsheets://reference/rate-limiting');
  });

  it('should include resource link for INVALID_PARAMS', () => {
    const error = enhanceError('INVALID_PARAMS', 'Invalid parameters', {
      field: 'spreadsheetId',
    });

    expect(error.resources).toBeDefined();
    expect(error.resources![0].uri).toBe('servalsheets://decisions/parameter-validation');
  });

  it('should include resource link for OUT_OF_BOUNDS', () => {
    const error = enhanceError('OUT_OF_BOUNDS', 'Range exceeds sheet dimensions');

    expect(error.resources).toBeDefined();
    expect(error.resources![0].uri).toBe('servalsheets://reference/sheet-dimensions');
  });

  it('should not include resources for errors without resource mapping', () => {
    const error = enhanceError('UNKNOWN_ERROR', 'An unknown error occurred');

    expect(error.resources).toBeUndefined();
  });

  it('should include all error enhancement fields together', () => {
    const error = enhanceError('SHEET_NOT_FOUND', 'Sheet not found', {
      spreadsheetId: 'test-id',
      sheetName: 'TestSheet',
    });

    // Check all enhanced fields are present
    expect(error.code).toBe('SHEET_NOT_FOUND');
    expect(error.message).toBe('Sheet not found');
    expect(error.resolution).toBeDefined();
    expect(error.resolutionSteps).toBeDefined();
    expect(error.suggestedTools).toBeDefined();
    expect(error.fixableVia).toBeDefined();
    expect(error.resources).toBeDefined();

    // Verify resolution steps are actionable
    expect(error.resolutionSteps).toHaveLength(4);
    expect(error.resolutionSteps![0]).toContain('sheets_core');

    // Verify fixableVia is correct
    expect(error.fixableVia?.tool).toBe('sheets_core');
    expect(error.fixableVia?.action).toBe('list_sheets');

    // Verify resources are correct
    expect(error.resources).toHaveLength(2);
    expect(error.resources![0].uri).toContain('servalsheets://');
  });

  it('should have consistent URI format across all resources', () => {
    const errorCodes = [
      'SHEET_NOT_FOUND',
      'RANGE_NOT_FOUND',
      'AUTH_REQUIRED',
      'PERMISSION_DENIED',
      'QUOTA_EXCEEDED',
      'INVALID_PARAMS',
    ];

    for (const code of errorCodes) {
      const error = enhanceError(code, `Test error: ${code}`);

      if (error.resources) {
        for (const resource of error.resources) {
          // All URIs should start with servalsheets://
          expect(resource.uri).toMatch(/^servalsheets:\/\//);

          // URIs should follow pattern: servalsheets://category/resource-name
          expect(resource.uri).toMatch(/^servalsheets:\/\/(reference|decisions)\//);

          // Descriptions should be meaningful
          expect(resource.description.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('should provide different resources for different error types', () => {
    const authError = enhanceError('AUTH_REQUIRED', 'Auth required');
    const rangeError = enhanceError('RANGE_NOT_FOUND', 'Range not found');

    expect(authError.resources).toBeDefined();
    expect(rangeError.resources).toBeDefined();

    // Resources should be different for different error types
    const authUris = authError.resources!.map((r) => r.uri);
    const rangeUris = rangeError.resources!.map((r) => r.uri);

    expect(authUris).not.toEqual(rangeUris);
  });
});
