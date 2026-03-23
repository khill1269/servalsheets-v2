/**
 * Tests for extraction helper functions
 */

import { describe, it, expect } from 'vitest';
import {
  extractAction,
  extractSpreadsheetId,
  extractSheetId,
  isSuccessResult,
  extractCellsAffected,
  extractSnapshotId,
  extractErrorMessage,
  extractErrorCode,
} from '../../src/mcp/registration/extraction-helpers.js';

describe('Extraction Helpers', () => {
  describe('extractAction', () => {
    it('extracts action from discriminated union pattern', () => {
      const args = {
        request: {
          action: 'read',
          params: {},
        },
      };
      expect(extractAction(args)).toBe('read');
    });

    it('extracts action from flattened pattern', () => {
      const args = {
        action: 'write',
      };
      expect(extractAction(args)).toBe('write');
    });

    it('returns "unknown" when action not found', () => {
      expect(extractAction({})).toBe('unknown');
      expect(extractAction({ request: {} })).toBe('unknown');
    });

    it('returns "unknown" for non-string action', () => {
      expect(extractAction({ action: 123 })).toBe('unknown');
      expect(extractAction({ request: { action: null } })).toBe('unknown');
    });
  });

  describe('extractSpreadsheetId', () => {
    it('extracts spreadsheetId from discriminated union pattern', () => {
      const args = {
        request: {
          action: 'read',
          params: {
            spreadsheetId: '1abc',
          },
        },
      };
      expect(extractSpreadsheetId(args)).toBe('1abc');
    });

    it('extracts spreadsheetId from flattened pattern', () => {
      const args = {
        spreadsheetId: '2def',
      };
      expect(extractSpreadsheetId(args)).toBe('2def');
    });

    it('returns undefined when spreadsheetId not found', () => {
      expect(extractSpreadsheetId({})).toBeUndefined();
      expect(extractSpreadsheetId({ request: {} })).toBeUndefined();
      expect(extractSpreadsheetId({ request: { params: {} } })).toBeUndefined();
    });

    it('returns undefined for non-string spreadsheetId', () => {
      expect(extractSpreadsheetId({ spreadsheetId: 123 })).toBeUndefined();
      expect(extractSpreadsheetId({ spreadsheetId: null })).toBeUndefined();
    });
  });

  describe('extractSheetId', () => {
    it('extracts sheetId from discriminated union pattern', () => {
      const args = {
        request: {
          action: 'read',
          params: {
            sheetId: 123,
          },
        },
      };
      expect(extractSheetId(args)).toBe(123);
    });

    it('extracts sheetId from flattened pattern', () => {
      const args = {
        sheetId: 456,
      };
      expect(extractSheetId(args)).toBe(456);
    });

    it('handles sheetId of 0 correctly', () => {
      const args = {
        request: {
          action: 'read',
          params: {
            sheetId: 0,
          },
        },
      };
      expect(extractSheetId(args)).toBe(0);
    });

    it('returns undefined when sheetId not found', () => {
      expect(extractSheetId({})).toBeUndefined();
      expect(extractSheetId({ request: {} })).toBeUndefined();
      expect(extractSheetId({ request: { params: {} } })).toBeUndefined();
    });

    it('returns undefined for non-number sheetId', () => {
      expect(extractSheetId({ sheetId: '123' })).toBeUndefined();
      expect(extractSheetId({ sheetId: null })).toBeUndefined();
    });
  });

  describe('isSuccessResult', () => {
    it('returns true for result.response.success = true', () => {
      const result = {
        response: {
          success: true,
          data: {},
        },
      };
      expect(isSuccessResult(result)).toBe(true);
    });

    it('returns true for result.success = true', () => {
      const result = {
        success: true,
        data: {},
      };
      expect(isSuccessResult(result)).toBe(true);
    });

    it('returns false for result.response.success = false', () => {
      const result = {
        response: {
          success: false,
          error: {},
        },
      };
      expect(isSuccessResult(result)).toBe(false);
    });

    it('returns false for result.success = false', () => {
      const result = {
        success: false,
        error: {},
      };
      expect(isSuccessResult(result)).toBe(false);
    });

    it('returns false for empty object', () => {
      expect(isSuccessResult({})).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isSuccessResult(null)).toBe(false);
      expect(isSuccessResult(undefined)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isSuccessResult('success')).toBe(false);
      expect(isSuccessResult(true)).toBe(false);
      expect(isSuccessResult(123)).toBe(false);
    });
  });

  describe('extractCellsAffected', () => {
    it('extracts cellsAffected from result.response', () => {
      const result = {
        response: {
          success: true,
          cellsAffected: 100,
        },
      };
      expect(extractCellsAffected(result)).toBe(100);
    });

    it('extracts cellsAffected from result directly', () => {
      const result = {
        success: true,
        cellsAffected: 50,
      };
      expect(extractCellsAffected(result)).toBe(50);
    });

    it('extracts updatedCells as fallback', () => {
      const result = {
        response: {
          success: true,
          updatedCells: 25,
        },
      };
      expect(extractCellsAffected(result)).toBe(25);
    });

    it('extracts from mutation object', () => {
      const result = {
        response: {
          success: true,
          mutation: {
            cellsAffected: 10,
          },
        },
      };
      expect(extractCellsAffected(result)).toBe(10);
    });

    it('handles cellsAffected of 0 correctly', () => {
      const result = {
        response: {
          success: true,
          cellsAffected: 0,
        },
      };
      expect(extractCellsAffected(result)).toBe(0);
    });

    it('returns undefined when not found', () => {
      expect(extractCellsAffected({})).toBeUndefined();
      expect(extractCellsAffected({ response: {} })).toBeUndefined();
      expect(extractCellsAffected(null)).toBeUndefined();
    });

    it('returns undefined for non-number value', () => {
      const result = {
        response: {
          cellsAffected: '100',
        },
      };
      expect(extractCellsAffected(result)).toBeUndefined();
    });
  });

  describe('extractSnapshotId', () => {
    it('extracts snapshotId from result.response.mutation', () => {
      const result = {
        response: {
          success: true,
          mutation: {
            revertSnapshotId: 'snap-123',
          },
        },
      };
      expect(extractSnapshotId(result)).toBe('snap-123');
    });

    it('extracts snapshotId from result.mutation', () => {
      const result = {
        success: true,
        mutation: {
          revertSnapshotId: 'snap-456',
        },
      };
      expect(extractSnapshotId(result)).toBe('snap-456');
    });

    it('returns undefined when not found', () => {
      expect(extractSnapshotId({})).toBeUndefined();
      expect(extractSnapshotId({ response: {} })).toBeUndefined();
      expect(extractSnapshotId({ mutation: {} })).toBeUndefined();
      expect(extractSnapshotId(null)).toBeUndefined();
    });

    it('returns undefined for non-string value', () => {
      const result = {
        mutation: {
          revertSnapshotId: 123,
        },
      };
      expect(extractSnapshotId(result)).toBeUndefined();
    });
  });

  describe('extractErrorMessage', () => {
    it('extracts error message from result.response.error', () => {
      const result = {
        response: {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Spreadsheet not found',
          },
        },
      };
      expect(extractErrorMessage(result)).toBe('Spreadsheet not found');
    });

    it('returns undefined when no error', () => {
      const result = {
        response: {
          success: true,
        },
      };
      expect(extractErrorMessage(result)).toBeUndefined();
    });

    it('returns undefined for empty objects', () => {
      expect(extractErrorMessage({})).toBeUndefined();
      expect(extractErrorMessage({ response: {} })).toBeUndefined();
      expect(extractErrorMessage(null)).toBeUndefined();
    });

    it('returns undefined for non-string message', () => {
      const result = {
        response: {
          error: {
            message: 123,
          },
        },
      };
      expect(extractErrorMessage(result)).toBeUndefined();
    });
  });

  describe('extractErrorCode', () => {
    it('extracts error code from result.response.error', () => {
      const result = {
        response: {
          success: false,
          error: {
            code: 'SHEET_NOT_FOUND',
            message: 'Sheet not found',
          },
        },
      };
      expect(extractErrorCode(result)).toBe('SHEET_NOT_FOUND');
    });

    it('returns undefined when no error', () => {
      const result = {
        response: {
          success: true,
        },
      };
      expect(extractErrorCode(result)).toBeUndefined();
    });

    it('returns undefined for empty objects', () => {
      expect(extractErrorCode({})).toBeUndefined();
      expect(extractErrorCode({ response: {} })).toBeUndefined();
      expect(extractErrorCode(null)).toBeUndefined();
    });

    it('returns undefined for non-string code', () => {
      const result = {
        response: {
          error: {
            code: 404,
          },
        },
      };
      expect(extractErrorCode(result)).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('handles deeply nested objects', () => {
      const args = {
        request: {
          action: 'read',
          params: {
            spreadsheetId: 'deep-nested',
            sheetId: 99,
            other: {
              nested: {
                deeply: true,
              },
            },
          },
        },
      };
      expect(extractAction(args)).toBe('read');
      expect(extractSpreadsheetId(args)).toBe('deep-nested');
      expect(extractSheetId(args)).toBe(99);
    });

    it('handles mixed patterns in same object', () => {
      const args = {
        action: 'top-level',
        request: {
          action: 'nested',
        },
      };
      // Should prefer nested (discriminated union)
      expect(extractAction(args)).toBe('nested');
    });

    it('handles empty strings as valid values', () => {
      expect(extractAction({ action: '' })).toBe('');
      expect(extractSpreadsheetId({ spreadsheetId: '' })).toBe('');
      expect(extractErrorMessage({ response: { error: { message: '' } } })).toBe('');
    });
  });
});
