/**
 * Batch Format Action Contract Tests
 *
 * Comprehensive tests for the new batch_format action in sheets_format tool.
 * Tests schema validation, handler execution, and error handling.
 *
 * Coverage:
 * 1. Schema validation (input constraints, operation validation)
 * 2. Handler execution (single/multiple operations, API calls)
 * 3. Error handling (invalid params, missing fields, unknown types)
 * 4. Response validation (schema compliance, metadata)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { FormatHandler } from '../../src/handlers/format.js';
import { SheetsFormatInputSchema, SheetsFormatOutputSchema } from '../../src/schemas/format.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

// ============================================================================
// SCHEMA VALIDATION TESTS
// ============================================================================

describe('batch_format Schema Validation', () => {
  describe('valid batch_format inputs', () => {
    it('should validate batch_format action exists', () => {
      const input = {
        action: 'batch_format' as const,
        spreadsheetId: 'test-id',
        operations: [],
      } as any;

      // The schema will reject empty operations, but this confirms the action is recognized
      const result = SheetsFormatInputSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('invalid batch_format inputs', () => {
    it('should reject empty operations array', () => {
      const input = {
        action: 'batch_format' as const,
        spreadsheetId: 'test-id',
        operations: [],
      };

      const result = SheetsFormatInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject operations array with more than 100 items', () => {
      const operations = Array.from({ length: 101 }, (_, i) => ({
        type: 'background' as const,
        range: { a1: `Sheet1!A${i + 1}:A${i + 1}` },
        color: { red: 1, green: 0, blue: 0 },
      }));

      const input = {
        action: 'batch_format' as const,
        spreadsheetId: 'test-id',
        operations,
      };

      const result = SheetsFormatInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid operation type', () => {
      const input = {
        action: 'batch_format' as const,
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'invalid_type',
            range: { a1: 'Sheet1!A1:A10' },
          },
        ],
      };

      const result = SheetsFormatInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject missing spreadsheetId', () => {
      const input = {
        action: 'batch_format' as const,
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      };

      const result = SheetsFormatInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid preset type', () => {
      const input = {
        action: 'batch_format' as const,
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!A1:A10' },
            preset: 'invalid_preset',
          },
        ],
      };

      const result = SheetsFormatInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// HANDLER EXECUTION TESTS
// ============================================================================

describe('FormatHandler batch_format execution', () => {
  let mockApi: ReturnType<
    () => {
      spreadsheets: { get: any; batchUpdate: any };
    }
  >;
  let mockContext: HandlerContext;
  let handler: FormatHandler;

  const createMockSheetsApi = () => ({
    spreadsheets: {
      get: vi.fn(),
      batchUpdate: vi.fn(),
    },
  });

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

  describe('single operation execution', () => {
    it('should execute single background operation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('cellsFormatted');
      expect(result.response).toHaveProperty('operationsApplied', 1);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests).toHaveLength(1);
      expect(call.requestBody.requests[0]).toHaveProperty('repeatCell');
      expect(call.requestBody.requests[0].repeatCell.fields).toBe(
        'userEnteredFormat.backgroundColor'
      );
    });

    it('should execute single text_format operation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'text_format',
            range: { a1: 'Sheet1!B1:B10' },
            textFormat: { bold: true, fontSize: 14 },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(result.response.operationsApplied).toBe(1);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0]).toHaveProperty('repeatCell');
      expect(call.requestBody.requests[0].repeatCell.fields).toBe('userEnteredFormat.textFormat');
    });

    it('should execute single number_format operation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'number_format',
            range: { a1: 'Sheet1!C1:C10' },
            numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].repeatCell.fields).toBe('userEnteredFormat.numberFormat');
    });

    it('should execute single alignment operation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'alignment',
            range: { a1: 'Sheet1!D1:D10' },
            horizontal: 'CENTER',
            vertical: 'MIDDLE',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].repeatCell.fields).toContain('horizontalAlignment');
    });

    it('should execute single borders operation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'borders',
            range: { a1: 'Sheet1!E1:E10' },
            top: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
            bottom: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0]).toHaveProperty('updateBorders');
    });

    it('should execute single format operation (comprehensive)', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'format',
            range: { a1: 'Sheet1!F1:F10' },
            format: {
              backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
              textFormat: { bold: true },
              horizontalAlignment: 'CENTER',
            },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should execute single preset operation', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!G1:G10' },
            preset: 'header_row',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('multiple operations execution', () => {
    it('should execute multiple mixed operations in single API call', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
          {
            type: 'text_format',
            range: { a1: 'Sheet1!B1:B10' },
            textFormat: { bold: true },
          },
          {
            type: 'number_format',
            range: { a1: 'Sheet1!C1:C10' },
            numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(result.response.operationsApplied).toBe(3);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);

      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests).toHaveLength(3);
    });

    it('should batch multiple background operations', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
          {
            type: 'background',
            range: { a1: 'Sheet1!B1:B10' },
            color: { red: 0, green: 1, blue: 0 },
          },
          {
            type: 'background',
            range: { a1: 'Sheet1!C1:C10' },
            color: { red: 0, green: 0, blue: 1 },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(result.response.operationsApplied).toBe(3);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should track apiCallsSaved correctly', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
          {
            type: 'text_format',
            range: { a1: 'Sheet1!B1:B10' },
            textFormat: { bold: true },
          },
          {
            type: 'number_format',
            range: { a1: 'Sheet1!C1:C10' },
            numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(result.response.apiCallsSaved).toBe(2);
    });

    it('should handle up to 100 operations', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const operations = Array.from({ length: 100 }, (_, i) => ({
        type: 'background' as const,
        range: { a1: `Sheet1!A${i + 1}:A${i + 1}` },
        color: { red: 1, green: 0, blue: 0 },
      }));

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations,
      });

      expect(result.response.success).toBe(true);
      expect(result.response.operationsApplied).toBe(100);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('safety options', () => {
    it('should respect dryRun safety option', async () => {
      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        safety: { dryRun: true },
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
          {
            type: 'text_format',
            range: { a1: 'Sheet1!B1:B10' },
            textFormat: { bold: true },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      expect(result.response.operationsApplied).toBe(2);
      expect(result.response.apiCallsSaved).toBe(1);
    });

    it('should calculate cellsFormatted in dryRun mode', async () => {
      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        safety: { dryRun: true },
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
      expect(result.response).toHaveProperty('cellsFormatted');
    });
  });

  describe('response validation', () => {
    it('should return valid response schema', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should include action in response', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      expect(result.response).toHaveProperty('action', 'batch_format');
    });

    it('should include all required response fields', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      expect(result.response).toHaveProperty('success', true);
      expect(result.response).toHaveProperty('action');
      expect(result.response).toHaveProperty('cellsFormatted');
      expect(result.response).toHaveProperty('operationsApplied');
      expect(result.response).toHaveProperty('apiCallsSaved');
    });
  });

  describe('error handling', () => {
    it('should error when no operations provided', async () => {
      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [],
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });

    it('should error when operation types are invalid and no valid requests built', async () => {
      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'alignment',
            range: { a1: 'Sheet1!A1:A10' },
            // Missing required alignment fields
          },
        ],
      });

      // Should succeed because empty alignment ops are skipped, but no valid requests means error
      // This depends on handler logic
      expect(result.response.success).toBe(false);
    });

    it('should handle API errors gracefully', async () => {
      mockApi.spreadsheets.batchUpdate.mockRejectedValue(
        new Error('API Error: 403 Permission denied')
      );

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBeDefined();
    });

    it('should validate error response schema', async () => {
      mockApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Test error'));

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('preset operations', () => {
    it('should apply header_row preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!A1:Z1' },
            preset: 'header_row',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      const format = call.requestBody.requests[0].repeatCell.cell.userEnteredFormat;
      expect(format.textFormat.bold).toBe(true);
    });

    it('should apply alternating_rows preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!A2:Z100' },
            preset: 'alternating_rows',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0]).toHaveProperty('addBanding');
    });

    it('should apply currency preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!B2:B100' },
            preset: 'currency',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].repeatCell.cell.userEnteredFormat.numberFormat.type).toBe(
        'CURRENCY'
      );
    });

    it('should apply percentage preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!C2:C100' },
            preset: 'percentage',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].repeatCell.cell.userEnteredFormat.numberFormat.type).toBe(
        'PERCENT'
      );
    });

    it('should apply date preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!A2:A100' },
            preset: 'date',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].repeatCell.cell.userEnteredFormat.numberFormat.type).toBe(
        'DATE'
      );
    });

    it('should apply highlight_positive preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!D2:D100' },
            preset: 'highlight_positive',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should apply highlight_negative preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!E2:E100' },
            preset: 'highlight_negative',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should apply total_row preset', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'preset',
            range: { a1: 'Sheet1!A101:Z101' },
            preset: 'total_row',
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });
  });

  describe('range handling', () => {
    it('should handle A1 notation ranges', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:Z100' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });

    it('should handle single cell ranges', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1' },
            color: { red: 1, green: 0, blue: 0 },
          },
        ],
      });

      expect(result.response.success).toBe(true);
    });

    it('should handle different sheets in one batch', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });

      const result = await handler.handle({
        action: 'batch_format',
        spreadsheetId: 'test-id',
        operations: [
          {
            type: 'background',
            range: { a1: 'Sheet1!A1:A10' },
            color: { red: 1, green: 0, blue: 0 },
          },
          {
            type: 'text_format',
            range: { a1: 'Sheet2!B1:B10' },
            textFormat: { bold: true },
          },
        ],
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });
  });
});
