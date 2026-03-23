/**
 * ServalSheets - Verbosity Parameter Tests (LLM Optimization)
 */

import { describe, it, expect } from 'vitest';
import { SheetsCoreInputSchema } from '../src/schemas/core.js';

describe('Verbosity Parameter (LLM Optimization)', () => {
  describe('SheetsCoreInputSchema', () => {
    it('should accept verbosity: minimal', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get',
          spreadsheetId: 'abc123',
          verbosity: 'minimal',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.request.verbosity).toBe('minimal');
      }
    });

    it('should accept verbosity: standard', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get',
          spreadsheetId: 'abc123',
          verbosity: 'standard',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.request.verbosity).toBe('standard');
      }
    });

    it('should accept verbosity: detailed', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get',
          spreadsheetId: 'abc123',
          verbosity: 'detailed',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.request.verbosity).toBe('detailed');
      }
    });

    it('should default to standard when verbosity omitted', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get',
          spreadsheetId: 'abc123',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.request.verbosity).toBe('standard');
      }
    });

    it('should reject invalid verbosity values', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get',
          spreadsheetId: 'abc123',
          verbosity: 'invalid',
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
