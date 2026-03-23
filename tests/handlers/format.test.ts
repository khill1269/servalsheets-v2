/**
 * ServalSheets - Format Handler Tests
 *
 * Tests for cell formatting operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FormatHandler } from '../../src/handlers/format.js';
import { SheetsFormatOutputSchema } from '../../src/schemas/format.js';
import type { HandlerContext } from '../../src/handlers/base.js';

// Mock Google Sheets API
const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn(),
    batchUpdate: vi.fn(),
    values: {
      update: vi.fn(),
      get: vi.fn(),
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
  } as any,
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
  } as any,
  googleClient: {
    sheets: vi.fn(),
  } as any,
});

describe('FormatHandler', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;
  let handler: FormatHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new FormatHandler(mockContext, mockApi as any);

    // Mock sheet metadata for getSheetId
    mockApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('set_format action', () => {
    it('should apply comprehensive cell formatting', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'set_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        format: {
          backgroundColor: { red: 1, green: 0, blue: 0 },
          textFormat: { bold: true },
        },
      });

      expect(result).toHaveProperty('response');
      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'set_format');
      expect(result.response).toHaveProperty('cellsFormatted');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should respect dryRun safety option', async () => {
      const result = await handler.handle({
        action: 'set_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        format: { backgroundColor: { red: 1, green: 0, blue: 0 } },
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });

    it('should handle multiple format properties', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'set_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        format: {
          backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
          textFormat: { bold: true, italic: true, fontSize: 12 },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        },
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].repeatCell.fields).toContain('backgroundColor');
      expect(call.requestBody.requests[0].repeatCell.fields).toContain('textFormat');
    });

    it('should report exact cellsFormatted count for A1:E1', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });
      mockContext.rangeResolver.resolve = vi.fn().mockResolvedValue({
        a1Notation: 'Sheet1!A1:E1',
        sheetId: 0,
        sheetName: 'Sheet1',
        gridRange: {
          sheetId: 0,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
        resolution: {
          method: 'a1_direct',
          confidence: 1.0,
          path: '',
        },
      });

      const result = await handler.handle({
        action: 'set_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:E1' },
        format: {
          backgroundColor: { red: 0.2, green: 0.4, blue: 0.6 },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.cellsFormatted).toBe(5);
      }
    });
  });

  describe('set_background action', () => {
    it('should set background color', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'set_background',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        color: { red: 1, green: 1, blue: 0 },
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('cellsFormatted');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].repeatCell.fields).toBe(
        'userEnteredFormat.backgroundColor'
      );
    });
  });

  describe('set_text_format action', () => {
    it('should set text formatting', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'set_text_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        textFormat: {
          bold: true,
          italic: false,
          fontSize: 14,
          fontFamily: 'Arial',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(
        call.requestBody.requests[0].repeatCell.cell.userEnteredFormat.textFormat
      ).toMatchObject({
        bold: true,
        italic: false,
        fontSize: 14,
      });
    });
  });

  describe('set_number_format action', () => {
    it('should set number format', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'set_number_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        numberFormat: {
          type: 'CURRENCY',
          pattern: '$#,##0.00',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(
        call.requestBody.requests[0].repeatCell.cell.userEnteredFormat.numberFormat
      ).toMatchObject({
        type: 'CURRENCY',
        pattern: '$#,##0.00',
      });
    });
  });

  describe('set_alignment action', () => {
    it('should set horizontal and vertical alignment', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        horizontal: 'CENTER',
        vertical: 'MIDDLE',
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should set wrap strategy', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        wrapStrategy: 'WRAP',
      });

      expect(result.response.success).toBe(true);
    });

    it('should error when no alignment properties specified', async () => {
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });
  });

  describe('set_borders action', () => {
    it('should set cell borders', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const borderStyle = {
        style: 'SOLID' as const,
        color: { red: 0, green: 0, blue: 0 },
      };

      const result = await handler.handle({
        action: 'set_borders',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        top: borderStyle,
        bottom: borderStyle,
        left: borderStyle,
        right: borderStyle,
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0]).toHaveProperty('updateBorders');
    });

    it('should set inner borders', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const borderStyle = {
        style: 'DOTTED' as const,
        color: { red: 0.5, green: 0.5, blue: 0.5 },
      };

      const result = await handler.handle({
        action: 'set_borders',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:C5' },
        innerHorizontal: borderStyle,
        innerVertical: borderStyle,
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('clear_format action', () => {
    it('should clear all formatting', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'clear_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].repeatCell.fields).toBe('userEnteredFormat');
    });

    it('should respect dryRun for destructive operation', async () => {
      const result = await handler.handle({
        action: 'clear_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('apply_preset action', () => {
    it('should apply header_row preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'apply_preset',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:Z1' },
        preset: 'header_row',
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      const request = call.requestBody.requests[0].repeatCell;
      expect(request.cell.userEnteredFormat.textFormat.bold).toBe(true);
    });

    it('should apply alternating_rows preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'apply_preset',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A2:Z100' },
        preset: 'alternating_rows',
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0]).toHaveProperty('addBanding');
    });

    it('should apply currency preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'apply_preset',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!B2:B100' },
        preset: 'currency',
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      const format = call.requestBody.requests[0].repeatCell.cell.userEnteredFormat.numberFormat;
      expect(format.type).toBe('CURRENCY');
    });

    it('should apply percentage preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'apply_preset',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!C2:C100' },
        preset: 'percentage',
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      const format = call.requestBody.requests[0].repeatCell.cell.userEnteredFormat.numberFormat;
      expect(format.type).toBe('PERCENT');
    });

    it('should apply date preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'apply_preset',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A2:A100' },
        preset: 'date',
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      const format = call.requestBody.requests[0].repeatCell.cell.userEnteredFormat.numberFormat;
      expect(format.type).toBe('DATE');
    });

    it('should apply conditional formatting presets', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'apply_preset',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!D2:D100' },
        preset: 'highlight_positive',
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0]).toHaveProperty('addConditionalFormatRule');
    });
  });

  describe('auto_fit action', () => {
    it('should auto-fit both rows and columns', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'auto_fit',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:C10' },
        dimension: 'BOTH',
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests).toHaveLength(2); // One for rows, one for columns
    });

    it('should auto-fit only rows', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'auto_fit',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:C10' },
        dimension: 'ROWS',
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests).toHaveLength(1);
      expect(call.requestBody.requests[0].autoResizeDimensions.dimensions.dimension).toBe('ROWS');
    });

    it('should auto-fit only columns', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'auto_fit',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:C10' },
        dimension: 'COLUMNS',
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].autoResizeDimensions.dimensions.dimension).toBe(
        'COLUMNS'
      );
    });
  });

  describe('error handling', () => {
    it('should handle API errors', async () => {
      mockApi.spreadsheets.batchUpdate.mockRejectedValue(
        new Error('API Error: 403 Permission denied')
      );

      const result = await handler.handle({
        action: 'set_background',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        color: { red: 1, green: 0, blue: 0 },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBeDefined();
    });

    it('should handle sheet not found', async () => {
      mockApi.spreadsheets.get.mockResolvedValue({
        data: { sheets: [] },
      });

      const result = await handler.handle({
        action: 'set_background',
        spreadsheetId: 'test-id',
        range: { a1: 'NonExistent!A1:B2' },
        color: { red: 1, green: 0, blue: 0 },
      });

      expect(result.response.success).toBe(false);
    });

    it('should validate schema compliance for errors', async () => {
      mockApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Test error'));

      const result = await handler.handle({
        action: 'set_background',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:B2' },
        color: { red: 1, green: 0, blue: 0 },
      });

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('range resolution', () => {
    it('should resolve semantic ranges', async () => {
      mockContext.rangeResolver.resolve = vi.fn().mockResolvedValue({
        a1Notation: 'Sheet1!A1:Z1',
        sheetId: 0,
      });
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'set_background',
        spreadsheetId: 'test-id',
        range: { sheetName: 'Sheet1', range: 'A1:Z1' },
        color: { red: 1, green: 0, blue: 0 },
      });

      expect(result.response.success).toBe(true);
      expect(mockContext.rangeResolver.resolve).toHaveBeenCalled();
    });
  });

  // ============================================================
  // suggest_format action
  // ============================================================

  describe('suggest_format action', () => {
    beforeEach(() => {
      // suggest_format fetches grid data (includeGridData:true) before checking sampling support.
      // Override the global mock (which only returns sheet properties) with rowData.
      mockApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            {
              properties: { sheetId: 0, title: 'Sheet1' },
              data: [
                {
                  rowData: [
                    {
                      values: [
                        { formattedValue: 'Name' },
                        { formattedValue: 'Revenue' },
                        { formattedValue: 'Cost' },
                        { formattedValue: 'Margin' },
                      ],
                    },
                    {
                      values: [
                        { formattedValue: 'Acme' },
                        { effectiveValue: { numberValue: 50000 } },
                        { effectiveValue: { numberValue: 30000 } },
                        { effectiveValue: { numberValue: 0.4 } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    });

    it('should return rule-based suggestions when server context is not available (graceful degradation)', async () => {
      // ISSUE-170: handler now degrades to rule-based suggestions instead of FEATURE_UNAVAILABLE
      // when MCP Sampling and LLM fallback are both unavailable
      const result = await handler.handle({
        action: 'suggest_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:D10' },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(Array.isArray((result.response as { suggestions?: unknown }).suggestions)).toBe(true);
      }

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  // ============================================================
  // batch_format action
  // ============================================================

  describe('batch_format action', () => {
    it('should apply multiple format operations in a single API call', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          { type: 'background', range: 'Sheet1!A1:D1', color: { red: 0.2, green: 0.4, blue: 0.8 } },
          { type: 'text_format', range: 'Sheet1!A1:D1', textFormat: { bold: true, fontSize: 12 } },
        ],
      } as any);

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'batch_format');
      if (result.response.success) {
        expect(result.response.operationsApplied).toBeGreaterThan(0);
      }
      // Only 1 API call for all operations
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should apply number_format operation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'number_format',
            range: 'Sheet1!B2:B20',
            numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0.00' },
          },
        ],
      } as any);

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should apply alignment operation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'alignment',
            range: 'Sheet1!A1:D1',
            horizontal: 'CENTER',
          },
        ],
      } as any);

      expect(result.response.success).toBe(true);
    });

    it('should return error when operations array is empty', async () => {
      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [],
      } as any);

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should respect dryRun for batch_format', async () => {
      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          { type: 'background', range: 'Sheet1!A1:D1', color: { red: 1, green: 0, blue: 0 } },
        ],
        safety: { dryRun: true },
      } as any);

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operationsApplied).toBe(1);
      }
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // sparkline_add action
  // ============================================================

  describe('sparkline_add action', () => {
    it('should add a line sparkline formula to target cell', async () => {
      mockApi.spreadsheets.values.update.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'sparkline_add',
        spreadsheetId: 'test-id',
        targetCell: 'Sheet1!E1',
        dataRange: { a1: 'Sheet1!A1:D1' },
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'sparkline_add');
      if (result.response.success) {
        expect(result.response.formula).toMatch(/^=SPARKLINE\(/i);
        expect(result.response.cell).toBe('Sheet1!E1');
      }
      expect(mockApi.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          range: 'Sheet1!E1',
          valueInputOption: 'USER_ENTERED',
        })
      );

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should add a bar sparkline with color config', async () => {
      mockApi.spreadsheets.values.update.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'sparkline_add',
        spreadsheetId: 'test-id',
        targetCell: 'Sheet1!F2',
        dataRange: { a1: 'Sheet1!A2:E2' },
        config: {
          type: 'BAR',
          color: { red: 0.2, green: 0.6, blue: 0.8 },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        // BAR type should be in the formula options
        expect(result.response.formula).toMatch(/charttype.*bar/i);
      }
    });

    it('should respect dryRun for sparkline_add', async () => {
      const result = await handler.handle({
        action: 'sparkline_add',
        spreadsheetId: 'test-id',
        targetCell: 'Sheet1!E1',
        dataRange: { a1: 'Sheet1!A1:D1' },
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.formula).toBeDefined();
      }
      expect(mockApi.spreadsheets.values.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // sparkline_get action
  // ============================================================

  describe('sparkline_get action', () => {
    it('should get sparkline formula from a cell', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['=SPARKLINE(A1:D1)']] },
      });

      const result = await handler.handle({
        action: 'sparkline_get',
        spreadsheetId: 'test-id',
        cell: 'Sheet1!E1',
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'sparkline_get');
      if (result.response.success) {
        expect(result.response.cell).toBe('Sheet1!E1');
        expect(result.response.formula).toBe('=SPARKLINE(A1:D1)');
      }

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return NOT_FOUND when cell has no sparkline', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [['some regular text']] },
      });

      const result = await handler.handle({
        action: 'sparkline_get',
        spreadsheetId: 'test-id',
        cell: 'Sheet1!A1',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return NOT_FOUND when cell is empty', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValue({
        data: { values: [] },
      });

      const result = await handler.handle({
        action: 'sparkline_get',
        spreadsheetId: 'test-id',
        cell: 'Sheet1!A1',
      });

      expect(result.response.success).toBe(false);
    });
  });

  // ============================================================
  // sparkline_clear action
  // ============================================================

  describe('sparkline_clear action', () => {
    it('should clear sparkline from a cell', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'sparkline_clear',
        spreadsheetId: 'test-id',
        cell: 'Sheet1!E1',
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'sparkline_clear');
      if (result.response.success) {
        expect(result.response.cell).toBe('Sheet1!E1');
      }
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          requestBody: {
            requests: [
              {
                updateCells: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 4,
                    endColumnIndex: 5,
                  },
                  fields: 'userEnteredValue',
                },
              },
            ],
          },
        })
      );

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should respect dryRun for sparkline_clear', async () => {
      const result = await handler.handle({
        action: 'sparkline_clear',
        spreadsheetId: 'test-id',
        cell: 'Sheet1!E1',
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // rule_add_conditional_format action
  // ============================================================

  describe('rule_add_conditional_format action', () => {
    it('should add a boolean conditional format rule', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'rule_add_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!A1:A100' },
        rule: {
          type: 'boolean',
          condition: { type: 'NUMBER_GREATER', values: ['100'] },
          format: { backgroundColor: { red: 0.8, green: 1, blue: 0.8 } },
        },
        index: 0,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'rule_add_conditional_format');
      if (result.response.success) {
        expect(result.response.ruleIndex).toBe(0);
      }
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: [
              expect.objectContaining({
                addConditionalFormatRule: expect.objectContaining({ index: 0 }),
              }),
            ],
          }),
        })
      );

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should accept condition values already shaped as Google API objects', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'rule_add_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!A1:A100' },
        rule: {
          type: 'boolean',
          condition: {
            type: 'NUMBER_GREATER',
            values: [{ userEnteredValue: '100' }] as unknown as string[],
          },
          format: { backgroundColor: { red: 0.8, green: 1, blue: 0.8 } },
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: [
              expect.objectContaining({
                addConditionalFormatRule: expect.objectContaining({
                  rule: expect.objectContaining({
                    booleanRule: expect.objectContaining({
                      condition: expect.objectContaining({
                        values: [{ userEnteredValue: '100' }],
                      }),
                    }),
                  }),
                }),
              }),
            ],
          }),
        })
      );
    });

    it('should respect dryRun for rule_add_conditional_format', async () => {
      // dryRun calls spreadsheets.get to count existing rules
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [{ properties: { sheetId: 0 }, conditionalFormats: [] }],
        },
      });

      const result = await handler.handle({
        action: 'rule_add_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!A1:A100' },
        rule: {
          type: 'boolean',
          condition: { type: 'BLANK' },
          format: { backgroundColor: { red: 1, green: 1, blue: 0.8 } },
        },
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // rule_update_conditional_format action
  // ============================================================

  describe('rule_update_conditional_format action', () => {
    it('should update a conditional format rule', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { sheetId: 0 },
              conditionalFormats: [
                {
                  ranges: [{ sheetId: 0, startRowIndex: 0, endRowIndex: 100 }],
                  booleanRule: {
                    condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '50' }] },
                    format: { backgroundColor: { red: 0.8, green: 1, blue: 0.8 } },
                  },
                },
              ],
            },
          ],
        },
      });
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'rule_update_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        ruleIndex: 0,
        rule: {
          type: 'boolean',
          condition: { type: 'NUMBER_GREATER', values: ['200'] },
          format: { backgroundColor: { red: 1, green: 0.9, blue: 0.9 } },
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'rule_update_conditional_format');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return error when rule at index does not exist', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [{ properties: { sheetId: 0 }, conditionalFormats: [] }],
        },
      });

      const result = await handler.handle({
        action: 'rule_update_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        ruleIndex: 99,
        rule: {
          type: 'boolean',
          condition: { type: 'BLANK' },
          format: { backgroundColor: { red: 1, green: 1, blue: 0.8 } },
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('RANGE_NOT_FOUND');
      }
    });

    it('should respect dryRun for rule_update_conditional_format', async () => {
      const result = await handler.handle({
        action: 'rule_update_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        ruleIndex: 0,
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // rule_delete_conditional_format action
  // ============================================================

  describe('rule_delete_conditional_format action', () => {
    it('should delete a conditional format rule by index', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'rule_delete_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        ruleIndex: 0,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'rule_delete_conditional_format');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: [{ deleteConditionalFormatRule: { sheetId: 0, index: 0 } }],
          }),
        })
      );

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should respect dryRun for rule_delete_conditional_format', async () => {
      const result = await handler.handle({
        action: 'rule_delete_conditional_format',
        spreadsheetId: 'test-id',
        sheetId: 0,
        ruleIndex: 0,
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // rule_list_conditional_formats action
  // ============================================================

  describe('rule_list_conditional_formats action', () => {
    it('should list all conditional format rules for a sheet', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: { sheetId: 0 },
              conditionalFormats: [
                {
                  ranges: [{ sheetId: 0, startRowIndex: 0, endRowIndex: 100 }],
                  booleanRule: {
                    condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '100' }] },
                    format: { backgroundColor: { red: 0.8, green: 1, blue: 0.8 } },
                  },
                },
                {
                  ranges: [{ sheetId: 0, startRowIndex: 0, endRowIndex: 100 }],
                  gradientRule: {
                    minpoint: { type: 'MIN', color: { red: 0.8, green: 1, blue: 0.8 } },
                    maxpoint: { type: 'MAX', color: { red: 1, green: 0.8, blue: 0.8 } },
                  },
                },
              ],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'rule_list_conditional_formats',
        spreadsheetId: 'test-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'rule_list_conditional_formats');
      if (result.response.success) {
        expect(result.response.rules).toHaveLength(2);
        expect(result.response.totalCount).toBe(2);
        expect(result.response.rules?.[0].type).toBe('boolean');
        expect(result.response.rules?.[1].type).toBe('gradient');
      }

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return empty list when no rules exist', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [{ properties: { sheetId: 0 }, conditionalFormats: [] }],
        },
      });

      const result = await handler.handle({
        action: 'rule_list_conditional_formats',
        spreadsheetId: 'test-id',
        sheetId: 0,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.totalCount).toBe(0);
      }
    });
  });

  // ============================================================
  // set_data_validation action
  // ============================================================

  describe('set_data_validation action', () => {
    it('should set ONE_OF_LIST data validation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'set_data_validation',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:A100' },
        condition: { type: 'ONE_OF_LIST', values: ['Yes', 'No', 'Maybe'] },
        showDropdown: true,
        strict: true,
        inputMessage: 'Select a value from the list',
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'set_data_validation');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: [
              expect.objectContaining({
                setDataValidation: expect.objectContaining({
                  rule: expect.objectContaining({
                    condition: expect.objectContaining({ type: 'ONE_OF_LIST' }),
                    strict: true,
                    showCustomUi: true,
                    inputMessage: 'Select a value from the list',
                  }),
                }),
              }),
            ],
          }),
        })
      );

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should set NUMBER_BETWEEN validation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'set_data_validation',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!B1:B50' },
        condition: { type: 'NUMBER_BETWEEN', values: ['1', '100'] },
        strict: false,
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].setDataValidation.rule.condition.type).toBe(
        'NUMBER_BETWEEN'
      );
    });
  });

  // ============================================================
  // clear_data_validation action
  // ============================================================

  describe('clear_data_validation action', () => {
    it('should clear data validation from a range', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'clear_data_validation',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:A100' },
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'clear_data_validation');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: [
              expect.objectContaining({
                setDataValidation: expect.objectContaining({
                  range: expect.any(Object),
                  // No rule = clears validation
                }),
              }),
            ],
          }),
        })
      );

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should respect dryRun for clear_data_validation', async () => {
      const result = await handler.handle({
        action: 'clear_data_validation',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:A100' },
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // list_data_validations action
  // ============================================================

  describe('list_data_validations action', () => {
    it('should list data validations in a range', async () => {
      // Single call: sheet metadata (size check) + grid data with validations combined
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                gridProperties: { rowCount: 100, columnCount: 10 },
              },
              data: [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: [
                    {
                      values: [
                        {
                          dataValidation: {
                            condition: {
                              type: 'ONE_OF_LIST',
                              values: [{ userEnteredValue: 'Yes' }, { userEnteredValue: 'No' }],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'list_data_validations',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!A1:J100' },
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'list_data_validations');
      if (result.response.success) {
        expect(result.response.totalCount).toBe(1);
        expect(result.response.validations?.[0].condition.type).toBe('ONE_OF_LIST');
      }

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should require range parameter for large sheets', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'list_data_validations',
        spreadsheetId: 'test-id',
        sheetId: 0,
        // No range - triggers the size check error
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should return SHEET_NOT_FOUND when sheetId does not exist', async () => {
      mockApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          sheets: [
            { properties: { sheetId: 1, gridProperties: { rowCount: 100, columnCount: 10 } } },
          ],
        },
      });

      const result = await handler.handle({
        action: 'list_data_validations',
        spreadsheetId: 'test-id',
        sheetId: 999,
        range: { a1: 'Sheet1!A1:J10' },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('SHEET_NOT_FOUND');
      }
    });
  });

  // ============================================================
  // add_conditional_format_rule action (preset shortcuts)
  // ============================================================

  describe('add_conditional_format_rule action', () => {
    it('should add highlight_duplicates rule', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!A1:A100' },
        rulePreset: 'highlight_duplicates',
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'add_conditional_format_rule');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: [
              expect.objectContaining({
                addConditionalFormatRule: expect.objectContaining({ index: 0 }),
              }),
            ],
          }),
        })
      );

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should add highlight_blanks rule', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!A1:D100' },
        rulePreset: 'highlight_blanks',
      });

      expect(result.response.success).toBe(true);
    });

    it('should add color_scale_green_red gradient rule', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!B1:B50' },
        rulePreset: 'color_scale_green_red',
      });

      expect(result.response.success).toBe(true);
      // Gradient rules use gradientRule not booleanRule
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].addConditionalFormatRule.rule.gradientRule).toBeDefined();
    });

    it('should add top_10_percent rule', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'add_conditional_format_rule',
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: { a1: 'Sheet1!A1:A100' },
        rulePreset: 'top_10_percent',
      });

      expect(result.response.success).toBe(true);
    });
  });
});
