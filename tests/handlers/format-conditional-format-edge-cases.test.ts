/**
 * ServalSheets - Format Handler Edge Case Tests
 *
 * Tests for edge cases in conditional formatting operations.
 * These tests validate input handling that was previously untested.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FormatHandler } from '../../src/handlers/format.js';
import type { HandlerContext } from '../../src/handlers/base.js';

// Mock Google Sheets API
const createMockSheetsApi = (): unknown => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        namedRanges: [],
      },
    }),
    batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
    values: {
      get: vi.fn(),
      update: vi.fn(),
      clear: vi.fn(),
    },
  },
});

// Mock handler context
const createMockContext = (): HandlerContext => ({
  batchCompiler: {
    compile: vi.fn(),
    execute: vi.fn(),
    executeAll: vi.fn(),
  } as unknown,
  rangeResolver: {
    resolve: vi.fn().mockResolvedValue({
      a1Notation: 'Sheet1!A1:B2',
      sheetId: 0,
      sheetName: 'Sheet1',
      gridRange: {
        sheetId: 0,
        startRowIndex: 0,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: 2,
      },
      resolution: {
        method: 'a1_direct',
        confidence: 1.0,
        path: '',
      },
    }),
  } as unknown,
  googleClient: {
    sheets: vi.fn(),
    isAuthenticated: () => true,
    hasValidToken: () => true,
  } as unknown,
});

describe('FormatHandler Edge Cases', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;
  let handler: FormatHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new FormatHandler(mockContext, mockApi as unknown);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('add_conditional_format_rule action', () => {
    it('should handle string range instead of object', async () => {
      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: 'Sheet1!A1:A100' as unknown, // String instead of { a1: "..." }
        rulePreset: 'highlight_blanks',
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should return validation error for undefined range', async () => {
      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: undefined as unknown,
        rulePreset: 'highlight_blanks',
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
      expect(result.response.error?.message).toContain('Range is required');
    });

    it('should return validation error for null range', async () => {
      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: null as unknown,
        rulePreset: 'highlight_blanks',
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should handle object range with a1 property', async () => {
      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!A1:A100' },
        rulePreset: 'highlight_duplicates',
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should handle grid range object', async () => {
      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: {
          grid: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 100,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
        },
        rulePreset: 'color_scale_green_red',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('rule_add_conditional_format action', () => {
    it('should return validation error for undefined range', async () => {
      const result = await handler.handle({
        action: 'rule_add_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: undefined as unknown,
        rule: {
          type: 'boolean',
          condition: { type: 'BLANK' },
          format: { backgroundColor: { red: 1, green: 0, blue: 0 } },
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should handle string range', async () => {
      const result = await handler.handle({
        action: 'rule_add_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: 'A1:D10' as unknown,
        rule: {
          type: 'boolean',
          condition: { type: 'BLANK' },
          format: { backgroundColor: { red: 1, green: 1, blue: 0 } },
        },
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('set_data_validation action', () => {
    it('should return validation error for undefined range', async () => {
      const result = await handler.handle({
        action: 'set_data_validation',
        spreadsheetId: 'test-id',
        range: undefined as unknown,
        condition: { type: 'ONE_OF_LIST', values: ['A', 'B', 'C'] },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should handle string range', async () => {
      const result = await handler.handle({
        action: 'set_data_validation',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A10' as unknown,
        condition: { type: 'ONE_OF_LIST', values: ['Option A', 'Option B'] },
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('clear_data_validation action', () => {
    it('should return validation error for undefined range', async () => {
      const result = await handler.handle({
        action: 'clear_data_validation',
        spreadsheetId: 'test-id',
        range: undefined as unknown,
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });
  });

  describe('Preset rule types', () => {
    const presets = [
      'highlight_duplicates',
      'highlight_blanks',
      'highlight_errors',
      'color_scale_green_red',
      'color_scale_blue_red',
      'data_bars',
      'top_10_percent',
      'bottom_10_percent',
      'above_average',
      'below_average',
    ];

    presets.forEach((preset) => {
      it(`should handle ${preset} preset with string range`, async () => {
        const result = await handler.handle({
          action: 'add_conditional_format_rule',
          spreadsheetId: 'test-id',
          sheetId: 0,
          range: 'A1:A100' as unknown,
          rulePreset: preset as unknown,
        });

        expect(result.response.success).toBe(true);
      });
    });

    it('should return error for unknown preset', async () => {
      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'A1:A100' },
        rulePreset: 'unknown_preset' as unknown,
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.message).toContain('unknown_preset');
    });
  });
});
