/**
 * Input Sanitization Security Tests
 *
 * Verifies that malicious inputs (injection attempts in spreadsheet IDs,
 * sheet names, etc.) are properly rejected by Zod validation.
 */

import { describe, it, expect } from 'vitest';
import {
  SheetsDataInputSchema,
  SheetsCoreInputSchema,
  SheetsFormatInputSchema,
} from '../../src/schemas/index.js';

describe('Input Sanitization', () => {
  describe('Spreadsheet ID validation', () => {
    it('should reject spreadsheet IDs with path traversal', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: '../../../etc/passwd',
          range: 'Sheet1!A1:B10',
        },
      });
      // SpreadsheetIdSchema regex /^[a-zA-Z0-9-_]+$/ rejects dots and slashes
      expect(result.success).toBe(false);
    });

    it('should reject extremely long spreadsheet IDs', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: 'a'.repeat(10000),
          range: 'Sheet1!A1:B10',
        },
      });
      // SpreadsheetIdSchema has .max(100), so 10K chars must be rejected
      expect(result.success).toBe(false);
    });
  });

  describe('Sheet name injection', () => {
    it('should accept normal sheet names', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get_sheet',
          spreadsheetId: 'abc123',
          sheetName: 'Sheet1',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should handle sheet names with special characters', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get_sheet',
          spreadsheetId: 'abc123',
          sheetName: 'Sheet\'s "Data" <script>alert(1)</script>',
        },
      });
      // Schema accepts strings — XSS doesn't apply to server-side processing
      expect(result.success).toBe(true);
    });
  });

  describe('Action enum validation', () => {
    it('should reject invalid action names via enum validation or transform error', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'nonexistent_action_xyz',
          spreadsheetId: 'abc123',
        },
      });
      expect(result.success).toBe(false);
    });

    it('should not trigger prototype pollution with __proto__', () => {
      // __proto__ should NOT match DEPRECATED_ACTIONS via Object.hasOwn
      // It should fail at the enum validation level instead
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: '__proto__',
          spreadsheetId: 'abc123',
        },
      });
      // Should fail validation (not a valid enum member), not trigger prototype access
      expect(result.success).toBe(false);
    });

    it('should not trigger prototype pollution with constructor', () => {
      // 'constructor' should NOT match DEPRECATED_ACTIONS via Object.hasOwn
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'constructor',
          spreadsheetId: 'abc123',
        },
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty action', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: '',
          spreadsheetId: 'abc123',
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Range format validation', () => {
    it('should accept valid A1 notation', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: 'abc123',
          range: 'Sheet1!A1:Z100',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should accept sheet names with spaces in ranges', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: 'abc123',
          range: "'My Sheet'!A1:B10",
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Format injection prevention', () => {
    it('should accept valid format objects', () => {
      const result = SheetsFormatInputSchema.safeParse({
        request: {
          action: 'set_format',
          spreadsheetId: 'abc123',
          range: 'Sheet1!A1:A10',
          format: {
            bold: true,
          },
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
