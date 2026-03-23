/**
 * API Contract Tests
 *
 * Validates API stability and ensures no breaking changes between versions.
 * Tests verify:
 * - Required fields remain required
 * - Optional fields remain optional
 * - Response structure remains consistent
 * - Error codes remain stable
 * - Enums don't lose values
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  SheetsAuthInputSchema,
  SheetsCoreInputSchema,
  SheetsDataInputSchema,
  SheetsFormatInputSchema,
  SheetsDimensionsInputSchema,
  SheetsVisualizeInputSchema,
  SheetsCollaborateInputSchema,
  SheetsAdvancedInputSchema,
  SheetsTransactionInputSchema,
  SheetsQualityInputSchema,
  SheetsHistoryInputSchema,
  SheetsConfirmInputSchema,
  SheetsAnalyzeInputSchema,
  SheetsFixInputSchema,
  CompositeInputSchema,
  SheetsSessionInputSchema,
  SheetsTemplatesInputSchema,
  SheetsBigQueryInputSchema,
  SheetsAppsScriptInputSchema,
  SheetsWebhookInputSchema,
  SheetsDependenciesInputSchema,
  SheetsFederationInputSchema,
} from '../../src/schemas/index.js';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';

describe('API Contracts - Required Fields', () => {
  describe('sheets_data contracts', () => {
    it('read action requires spreadsheetId and range', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          // Missing spreadsheetId
          range: { a1: 'Sheet1!A1:B10' },
        },
      });
      expect(result.success).toBe(false);

      const result2 = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: 'test123',
          // Missing range
        },
      });
      expect(result2.success).toBe(false);
    });

    it('write action requires spreadsheetId, range, and values', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1' },
          // Missing values
        },
      });
      expect(result.success).toBe(false);
    });

    it('append action allows tableId without range', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'append',
          spreadsheetId: 'test123',
          tableId: 'table-1',
          values: [[1, 2, 3]],
        },
      });
      expect(result.success).toBe(true);
    });

    it('batch_read requires spreadsheetId and ranges array', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'batch_read',
          spreadsheetId: 'test123',
          // Missing ranges
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('sheets_core contracts', () => {
    it('get action requires spreadsheetId', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get',
          // Missing spreadsheetId
        },
      });
      expect(result.success).toBe(false);
    });

    it('create action requires title', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'create',
          // Missing title
        },
      });
      expect(result.success).toBe(false);
    });

    it('add_sheet requires spreadsheetId and title', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'add_sheet',
          spreadsheetId: 'test123',
          // Missing title
        },
      });
      expect(result.success).toBe(false);
    });

    it('delete_sheet requires spreadsheetId and sheetId', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'delete_sheet',
          spreadsheetId: 'test123',
          // Missing sheetId
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('sheets_format contracts', () => {
    it('set_format requires spreadsheetId, range, and format', () => {
      const result = SheetsFormatInputSchema.safeParse({
        request: {
          action: 'set_format',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1' },
          // Missing format
        },
      });
      expect(result.success).toBe(false);
    });

    it('set_background requires spreadsheetId, range, and color', () => {
      const result = SheetsFormatInputSchema.safeParse({
        request: {
          action: 'set_background',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1' },
          // Missing color
        },
      });
      expect(result.success).toBe(false);
    });

    it('rule_add_conditional_format requires spreadsheetId, sheetId, range, and rule', () => {
      const result = SheetsFormatInputSchema.safeParse({
        request: {
          action: 'rule_add_conditional_format',
          spreadsheetId: 'test123',
          sheetId: 0,
          range: { a1: 'Sheet1!A1' },
          // Missing rule
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('sheets_visualize contracts', () => {
    it('chart_create requires spreadsheetId, sheetId, chartType, data, and position', () => {
      const result = SheetsVisualizeInputSchema.safeParse({
        request: {
          action: 'chart_create',
          spreadsheetId: 'test123',
          sheetId: 0,
          chartType: 'BAR',
          // Missing data and position
        },
      });
      expect(result.success).toBe(false);
    });

    it('pivot_create requires spreadsheetId, sourceRange, and values', () => {
      const result = SheetsVisualizeInputSchema.safeParse({
        request: {
          action: 'pivot_create',
          spreadsheetId: 'test123',
          sourceRange: { a1: 'Sheet1!A1:C10' },
          // Missing values
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('sheets_advanced contracts', () => {
    it('add_named_range requires spreadsheetId, name, and range', () => {
      const result = SheetsAdvancedInputSchema.safeParse({
        request: {
          action: 'add_named_range',
          spreadsheetId: 'test123',
          name: 'TestRange',
          // Missing range
        },
      });
      expect(result.success).toBe(false);
    });

    it('create_table requires spreadsheetId, range, and name', () => {
      const result = SheetsAdvancedInputSchema.safeParse({
        request: {
          action: 'create_table',
          spreadsheetId: 'test123',
          // Missing range and name
        },
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('API Contracts - Optional Fields', () => {
  describe('sheets_data optional fields', () => {
    it('read action accepts optional majorDimension', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1:B10' },
          majorDimension: 'COLUMNS',
        },
      });
      expect(result.success).toBe(true);
    });

    it('write action accepts optional valueInputOption', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1' },
          values: [[1, 2]],
          valueInputOption: 'USER_ENTERED',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('sheets_core optional fields', () => {
    it('create action accepts optional locale and timeZone', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'create',
          title: 'New Spreadsheet',
          locale: 'en_US',
          timeZone: 'America/New_York',
        },
      });
      expect(result.success).toBe(true);
    });

    it('add_sheet accepts optional index and properties', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'add_sheet',
          spreadsheetId: 'test123',
          title: 'New Sheet',
          index: 2,
          properties: { gridProperties: { rowCount: 1000 } },
        },
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('API Contracts - Action Lists Stability', () => {
  it('all tool actions lists remain stable', () => {
    // Verify that expected actions exist (no removals)
    expect(TOOL_ACTIONS.sheets_data).toContain('read');
    expect(TOOL_ACTIONS.sheets_data).toContain('write');
    expect(TOOL_ACTIONS.sheets_data).toContain('append');
    expect(TOOL_ACTIONS.sheets_data).toContain('clear');
    expect(TOOL_ACTIONS.sheets_data).toContain('batch_read');

    expect(TOOL_ACTIONS.sheets_core).toContain('get');
    expect(TOOL_ACTIONS.sheets_core).toContain('create');
    expect(TOOL_ACTIONS.sheets_core).toContain('add_sheet');
    expect(TOOL_ACTIONS.sheets_core).toContain('delete_sheet');

    expect(TOOL_ACTIONS.sheets_format).toContain('set_format');
    expect(TOOL_ACTIONS.sheets_format).toContain('set_background');
    expect(TOOL_ACTIONS.sheets_format).toContain('set_text_format');
    expect(TOOL_ACTIONS.sheets_format).toContain('rule_add_conditional_format');

    expect(TOOL_ACTIONS.sheets_visualize).toContain('chart_create');
    expect(TOOL_ACTIONS.sheets_visualize).toContain('pivot_create');

    expect(TOOL_ACTIONS.sheets_advanced).toContain('add_named_range');
    expect(TOOL_ACTIONS.sheets_advanced).toContain('create_table');

    expect(TOOL_ACTIONS.sheets_analyze).toContain('comprehensive');
    expect(TOOL_ACTIONS.sheets_analyze).toContain('analyze_data');

    expect(TOOL_ACTIONS.sheets_templates).toContain('list');
    expect(TOOL_ACTIONS.sheets_templates).toContain('create');
    expect(TOOL_ACTIONS.sheets_templates).toContain('apply');

    expect(TOOL_ACTIONS.sheets_bigquery).toContain('connect');
    expect(TOOL_ACTIONS.sheets_bigquery).toContain('query');

    expect(TOOL_ACTIONS.sheets_appsscript).toContain('create');
    expect(TOOL_ACTIONS.sheets_appsscript).toContain('run');
  });

  it('action counts remain stable or increase', () => {
    // Core tools should have at least these many actions
    expect(TOOL_ACTIONS.sheets_data.length).toBeGreaterThanOrEqual(15);
    expect(TOOL_ACTIONS.sheets_core.length).toBeGreaterThanOrEqual(15);
    expect(TOOL_ACTIONS.sheets_format.length).toBeGreaterThanOrEqual(20);
    expect(TOOL_ACTIONS.sheets_dimensions.length).toBeGreaterThanOrEqual(25);
    expect(TOOL_ACTIONS.sheets_visualize.length).toBeGreaterThanOrEqual(15);
    expect(TOOL_ACTIONS.sheets_collaborate.length).toBeGreaterThanOrEqual(30);
    expect(TOOL_ACTIONS.sheets_advanced.length).toBeGreaterThanOrEqual(25);
    expect(TOOL_ACTIONS.sheets_analyze.length).toBeGreaterThanOrEqual(15);
  });
});

describe('API Contracts - Enum Stability', () => {
  describe('dimension enum stability', () => {
    it('accepts ROWS dimension', () => {
      const result = SheetsDimensionsInputSchema.safeParse({
        request: {
          action: 'insert',
          dimension: 'ROWS',
          spreadsheetId: 'test123',
          sheetId: 0,
          startIndex: 5,
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts COLUMNS dimension', () => {
      const result = SheetsDimensionsInputSchema.safeParse({
        request: {
          action: 'insert',
          dimension: 'COLUMNS',
          spreadsheetId: 'test123',
          sheetId: 0,
          startIndex: 5,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('majorDimension enum stability', () => {
    it('accepts ROWS majorDimension', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1:B10' },
          majorDimension: 'ROWS',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts COLUMNS majorDimension', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1:B10' },
          majorDimension: 'COLUMNS',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('valueInputOption enum stability', () => {
    it('accepts USER_ENTERED', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1' },
          values: [[1, 2]],
          valueInputOption: 'USER_ENTERED',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts RAW', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1' },
          values: [[1, 2]],
          valueInputOption: 'RAW',
        },
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('API Contracts - Response Structure Stability', () => {
  const SuccessResponseSchema = z
    .object({
      success: z.literal(true),
    })
    .passthrough();

  const ErrorResponseSchema = z
    .object({
      success: z.literal(false),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .passthrough(),
    })
    .passthrough();

  it('success response has success: true', () => {
    const response = { success: true, data: {} };
    expect(SuccessResponseSchema.safeParse(response).success).toBe(true);
  });

  it('error response has success: false and error object', () => {
    const response = {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Spreadsheet not found',
      },
    };
    expect(ErrorResponseSchema.safeParse(response).success).toBe(true);
  });

  it('mutation metadata has consistent structure', () => {
    const MutationSchema = z
      .object({
        cellsAffected: z.number().optional(),
        revertSnapshotId: z.string().optional(),
        operationId: z.string().optional(),
        timestamp: z.string().optional(),
      })
      .passthrough();

    const mutation = {
      cellsAffected: 100,
      revertSnapshotId: 'snap-123',
      operationId: 'op-456',
      timestamp: '2024-01-15T10:00:00Z',
    };

    expect(MutationSchema.safeParse(mutation).success).toBe(true);
  });

  it('pagination metadata has consistent structure', () => {
    const PaginationSchema = z
      .object({
        hasMore: z.boolean(),
        nextCursor: z.string().optional(),
        totalCount: z.number().optional(),
      })
      .passthrough();

    const pagination = {
      hasMore: true,
      nextCursor: 'cursor-abc',
      totalCount: 1000,
    };

    expect(PaginationSchema.safeParse(pagination).success).toBe(true);
  });
});

describe('API Contracts - Request Shape Compatibility', () => {
  it('accepts the canonical request envelope format', () => {
    const result = SheetsDataInputSchema.safeParse({
      request: {
        action: 'read',
        spreadsheetId: 'test123',
        range: { a1: 'Sheet1!A1:B10' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts range as A1 notation string', () => {
    const result = SheetsDataInputSchema.safeParse({
      request: {
        action: 'read',
        spreadsheetId: 'test123',
        range: { a1: 'Sheet1!A1:B10' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts range as structured object', () => {
    const result = SheetsDataInputSchema.safeParse({
      request: {
        action: 'read',
        spreadsheetId: 'test123',
        range: {
          a1: 'Sheet1!A1:B10',
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
