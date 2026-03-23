/**
 * ServalSheets - Test Input Factory Functions
 *
 * Factory functions for creating common test input objects with sensible defaults.
 * Reduces boilerplate and ensures consistency across tests.
 */

/**
 * Factory for sheets_data read input
 *
 * Usage:
 * ```typescript
 * const input = createValuesReadInput({ spreadsheetId: 'my-sheet' });
 * const result = await handler.handle(input);
 * ```
 */
export function createValuesReadInput(
  overrides: {
    spreadsheetId?: string;
    range?: { a1: string } | { sheetName: string };
    valueRenderOption?: string;
    dateTimeRenderOption?: string;
  } = {}
) {
  return {
    action: 'read' as const,
    spreadsheetId: overrides.spreadsheetId || 'test-sheet-id',
    range: overrides.range || { a1: 'Sheet1!A1:B2' },
    valueRenderOption: overrides.valueRenderOption,
    dateTimeRenderOption: overrides.dateTimeRenderOption,
  };
}

/**
 * Factory for sheets_data write input
 */
export function createValuesWriteInput(
  overrides: {
    spreadsheetId?: string;
    range?: { a1: string };
    values?: any[][];
    valueInputOption?: string;
  } = {}
) {
  return {
    action: 'write' as const,
    spreadsheetId: overrides.spreadsheetId || 'test-sheet-id',
    range: overrides.range || { a1: 'Sheet1!A1:B2' },
    values: overrides.values || [
      ['A', 'B'],
      ['1', '2'],
    ],
    valueInputOption: overrides.valueInputOption || 'USER_ENTERED',
  };
}

/**
 * Factory for sheets_core get input
 */
export function createSpreadsheetGetInput(
  overrides: {
    spreadsheetId?: string;
    includeGridData?: boolean;
  } = {}
) {
  return {
    action: 'get' as const,
    spreadsheetId: overrides.spreadsheetId || 'test-sheet-id',
    includeGridData: overrides.includeGridData,
  };
}

/**
 * Factory for sheets_core add_sheet input
 */
export function createSheetAddInput(
  overrides: {
    spreadsheetId?: string;
    title?: string;
    rowCount?: number;
    columnCount?: number;
  } = {}
) {
  return {
    action: 'add_sheet' as const,
    spreadsheetId: overrides.spreadsheetId || 'test-sheet-id',
    title: overrides.title || 'New Sheet',
    rowCount: overrides.rowCount,
    columnCount: overrides.columnCount,
  };
}

/**
 * Factory for sheets_format set_format input
 */
export function createFormatSetInput(
  overrides: {
    spreadsheetId?: string;
    range?: { a1: string };
    format?: any;
  } = {}
) {
  return {
    action: 'set_format' as const,
    spreadsheetId: overrides.spreadsheetId || 'test-sheet-id',
    range: overrides.range || { a1: 'Sheet1!A1:B2' },
    format: overrides.format || {
      backgroundColor: { red: 1, green: 0, blue: 0 },
    },
  };
}

/**
 * Factory for sheets_analyze comprehensive input
 */
export function createAnalyzeComprehensiveInput(
  overrides: {
    spreadsheetId?: string;
    range?: { a1: string };
    includeFormulas?: boolean;
    includeVisualizations?: boolean;
  } = {}
) {
  return {
    action: 'comprehensive' as const,
    spreadsheetId: overrides.spreadsheetId || 'test-sheet-id',
    range: overrides.range,
    includeFormulas: overrides.includeFormulas,
    includeVisualizations: overrides.includeVisualizations,
  };
}

/**
 * Factory for sheets_auth status input
 */
export function createAuthStatusInput() {
  return {
    action: 'status' as const,
  };
}

/**
 * Factory for sheets_auth login input
 */
export function createAuthLoginInput(
  overrides: {
    scopes?: string[];
  } = {}
) {
  return {
    action: 'login' as const,
    scopes: overrides.scopes,
  };
}

/**
 * Factory for mock Google Sheets API response
 */
export function createMockSheetsResponse(
  overrides: {
    values?: any[][];
    sheets?: any[];
  } = {}
) {
  return {
    data: {
      values: overrides.values || [
        ['A', 'B'],
        ['1', '2'],
      ],
      sheets: overrides.sheets || [
        {
          properties: {
            sheetId: 0,
            title: 'Sheet1',
          },
        },
      ],
    },
  };
}
