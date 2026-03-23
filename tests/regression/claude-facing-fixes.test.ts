import { describe, expect, it } from 'vitest';
import {
  SheetsAppsScriptInputSchema,
  SheetsCoreInputSchema,
  SheetsDataInputSchema,
  SheetsFormatInputSchema,
  SheetsTransactionInputSchema,
  SheetsVisualizeInputSchema,
} from '../../src/schemas/index.js';

const TEST_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const TEST_SHEET_ID = 413752995;

describe('Claude-facing request normalization regressions', () => {
  it('normalizes chart_create compatibility payloads into the canonical shape', () => {
    const result = SheetsVisualizeInputSchema.safeParse({
      request: {
        action: 'chart_create',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        sourceRange: 'Sheet1!A1:B10',
        data: {
          chartType: 'line',
          title: 'Revenue',
          legendPosition: 'RIGHT_LEGEND',
        },
        position: { anchorCell: 'Sheet1!E2' },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.request.chartType).toBe('LINE');
    expect(result.data.request.data.sourceRange).toEqual({ a1: 'Sheet1!A1:B10' });
    expect(result.data.request.options).toMatchObject({
      title: 'Revenue',
      legendPosition: 'RIGHT_LEGEND',
    });
  });

  it('normalizes chart_move destination aliases to position + sheetId', () => {
    const result = SheetsVisualizeInputSchema.safeParse({
      request: {
        action: 'chart_move',
        spreadsheetId: TEST_SPREADSHEET_ID,
        chartId: 108,
        destinationSheetId: TEST_SHEET_ID,
        destinationCell: 'A11',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.request.position).toMatchObject({
      anchorCell: 'A11',
      sheetId: TEST_SHEET_ID,
    });
  });

  it('preserves sheetId when chart positions are provided as grid coordinates', () => {
    const result = SheetsVisualizeInputSchema.safeParse({
      request: {
        action: 'chart_move',
        spreadsheetId: TEST_SPREADSHEET_ID,
        chartId: 109,
        position: {
          anchorCell: {
            sheetId: TEST_SHEET_ID,
            rowIndex: 10,
            columnIndex: 0,
          },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.request.position).toMatchObject({
      anchorCell: 'A11',
      sheetId: TEST_SHEET_ID,
    });
  });

  it('normalizes add_note range alias without leaving the extra key behind', () => {
    const result = SheetsDataInputSchema.safeParse({
      request: {
        action: 'add_note',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: "'📊 Dashboard'!B2",
        note: 'Flag this cell',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.request).toMatchObject({
      action: 'add_note',
      cell: "'📊 Dashboard'!B2",
      note: 'Flag this cell',
    });
    expect('range' in result.data.request).toBe(false);
  });

  it('infers batch_format operation types and accepts set_borders alias', () => {
    const result = SheetsFormatInputSchema.safeParse({
      request: {
        action: 'batch_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        operations: [
          {
            range: 'Sheet1!A1:A5',
            textFormat: { bold: true },
          },
          {
            type: 'set_borders',
            range: 'Sheet1!A1:B5',
            top: true,
            bottom: true,
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.request.operations[0]?.type).toBe('text_format');
    expect(result.data.request.operations[1]?.type).toBe('borders');
  });

  it('rejects ambiguous batch_format operations without an explicit type', () => {
    const result = SheetsFormatInputSchema.safeParse({
      request: {
        action: 'batch_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        operations: [
          {
            range: 'Sheet1!A1:A5',
            color: { red: 1, green: 0, blue: 0 },
            format: { textFormat: { bold: true } },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues.some((issue) => issue.path.join('.') === 'request.operations.0.type')).toBe(
      true
    );
    expect(result.error.issues[0]?.message).toContain('ambiguous');
  });

  it('normalizes single-range Google-style conditional format payloads', () => {
    const result = SheetsFormatInputSchema.safeParse({
      request: {
        action: 'rule_add_conditional_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 10,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
        ],
        booleanRule: {
          condition: {
            type: 'NUMBER_GREATER',
            values: [{ userEnteredValue: '100' }],
          },
          format: {
            backgroundColor: { red: 1, green: 0.8, blue: 0.8 },
          },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.request.sheetId).toBe(0);
    expect(result.data.request.range).toEqual({
      grid: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 10,
        startColumnIndex: 1,
        endColumnIndex: 2,
      },
    });
    expect(result.data.request.rule).toMatchObject({
      type: 'boolean',
      condition: {
        type: 'NUMBER_GREATER',
        values: ['100'],
      },
    });
  });

  it('rejects multi-range Google-style conditional format payloads with a targeted message', () => {
    const result = SheetsFormatInputSchema.safeParse({
      request: {
        action: 'rule_add_conditional_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        ranges: [
          { sheetId: 0, startRowIndex: 1, endRowIndex: 10, startColumnIndex: 1, endColumnIndex: 2 },
          { sheetId: 0, startRowIndex: 1, endRowIndex: 10, startColumnIndex: 3, endColumnIndex: 4 },
        ],
        booleanRule: {
          condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '100' }] },
          format: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } },
        },
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.message).toContain('exactly one target range');
  });

  it('rejects frozen row/column updates on update_sheet with a fix hint', () => {
    const result = SheetsCoreInputSchema.safeParse({
      request: {
        action: 'update_sheet',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        frozenRowCount: 1,
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.message).toContain('sheets_dimensions');
    expect(result.error.issues[0]?.message).toContain('freeze');
  });

  it('does not default rightToLeft when update_sheet omits it', () => {
    const result = SheetsCoreInputSchema.safeParse({
      request: {
        action: 'update_sheet',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        title: 'Renamed',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.request.rightToLeft).toBeUndefined();
  });

  it('accepts flat transaction queue params and normalizes them into operation.params', () => {
    const result = SheetsTransactionInputSchema.safeParse({
      request: {
        action: 'queue',
        transactionId: 'tx_123',
        operation: {
          tool: 'sheets_data',
          action: 'write',
          range: 'Sheet1!A1:B2',
          values: [['A', 'B']],
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.request.operation).toEqual({
      tool: 'sheets_data',
      action: 'write',
      params: {
        range: 'Sheet1!A1:B2',
        values: [['A', 'B']],
      },
    });
  });

  it('rejects appsscript run payloads that incorrectly include files', () => {
    const result = SheetsAppsScriptInputSchema.safeParse({
      request: {
        action: 'run',
        scriptId: 'script-123',
        deploymentId: 'AKfycb-deployment',
        functionName: 'buildTracker',
        files: [{ name: 'Code.gs', type: 'SERVER_JS', source: 'function buildTracker() {}' }],
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues[0]?.message).toContain('update_content');
  });
});
