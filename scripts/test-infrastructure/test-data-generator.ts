/**
 * Test Data Generator - Generate schema-compliant test data
 * Reads actual schemas and generates valid test arguments
 */

// Test spreadsheet ID (public Google Sheets example)
const TEST_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

export interface TestDataSpec {
  tool: string;
  action: string;
  args: any;
  description: string;
  requiresAuth: boolean;
}

/**
 * Generate test arguments for all tools and actions
 * Based on actual schema definitions in src/schemas/
 */
export function generateAllTestData(): Map<string, TestDataSpec> {
  const testData = new Map<string, TestDataSpec>();

  // Generate test data for each tool (22 tools)
  const generators = [
    ...generateAuthTestData(),
    ...generateSpreadsheetTestData(),
    ...generateSheetTestData(),
    ...generateValuesTestData(),
    ...generateCellsTestData(),
    ...generateFormatTestData(),
    ...generateDimensionsTestData(),
    ...generateVisualizeTestData(),
    ...generateCollaborateTestData(),
    ...generateAdvancedTestData(),
    ...generateTransactionTestData(),
    ...generateQualityTestData(),
    ...generateHistoryTestData(),
    ...generateConfirmTestData(),
    ...generateAnalyzeTestData(),
    ...generateFixTestData(),
    ...generateCompositeTestData(),
    ...generateSessionTestData(),
    // Tier 7 enterprise tools
    ...generateBigQueryTestData(),
    ...generateTemplatesTestData(),
    ...generateAppsScriptTestData(),
  ];

  for (const spec of generators) {
    testData.set(`${spec.tool}.${spec.action}`, spec);
  }

  return testData;
}

/**
 * sheets_auth test data
 */
function generateAuthTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_auth',
      action: 'status',
      args: { action: 'status' },
      description: 'Check authentication status',
      requiresAuth: false,
    },
    {
      tool: 'sheets_auth',
      action: 'login',
      args: { action: 'login' },
      description: 'Start OAuth flow',
      requiresAuth: false,
    },
    {
      tool: 'sheets_auth',
      action: 'callback',
      args: { action: 'callback', code: 'test-oauth-code' },
      description: 'Complete OAuth with code',
      requiresAuth: false,
    },
    {
      tool: 'sheets_auth',
      action: 'logout',
      args: { action: 'logout' },
      description: 'Clear authentication',
      requiresAuth: false,
    },
  ];
}

/**
 * sheets_core test data
 */
function generateSpreadsheetTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_core',
      action: 'get',
      args: { action: 'get', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Get spreadsheet metadata',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'create',
      args: { action: 'create', title: 'Test Spreadsheet' },
      description: 'Create new spreadsheet',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'copy',
      args: { action: 'copy', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Copy spreadsheet',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'update_properties',
      args: {
        action: 'update_properties',
        spreadsheetId: TEST_SPREADSHEET_ID,
        title: 'Updated Title',
      },
      description: 'Update spreadsheet properties',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'get_url',
      args: { action: 'get_url', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Get spreadsheet URL',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'batch_get',
      args: { action: 'batch_get', spreadsheetIds: [TEST_SPREADSHEET_ID] },
      description: 'Batch get spreadsheets',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'get_comprehensive',
      args: { action: 'get_comprehensive', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Get comprehensive spreadsheet info',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'list',
      args: { action: 'list', pageSize: 10 },
      description: 'List spreadsheets',
      requiresAuth: true,
    },
  ];
}

/**
 * sheets_core test data
 */
function generateSheetTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_core',
      action: 'add_sheet',
      args: {
        action: 'add_sheet',
        spreadsheetId: TEST_SPREADSHEET_ID,
        title: 'New Sheet',
      },
      description: 'Add new sheet',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'delete_sheet',
      args: {
        action: 'delete_sheet',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 999,
      },
      description: 'Delete sheet',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'duplicate_sheet',
      args: {
        action: 'duplicate_sheet',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        newTitle: 'Duplicated Sheet',
      },
      description: 'Duplicate sheet',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'update_sheet',
      args: {
        action: 'update_sheet',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        title: 'Updated Sheet',
      },
      description: 'Update sheet properties',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'copy_sheet_to',
      args: {
        action: 'copy_sheet_to',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        destinationSpreadsheetId: TEST_SPREADSHEET_ID,
      },
      description: 'Copy sheet to another spreadsheet',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'list_sheets',
      args: {
        action: 'list_sheets',
        spreadsheetId: TEST_SPREADSHEET_ID,
      },
      description: 'List sheets',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'get_sheet',
      args: {
        action: 'get_sheet',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
      },
      description: 'Get sheet properties',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'batch_delete_sheets',
      args: {
        action: 'batch_delete_sheets',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetIds: [998, 999],
      },
      description: 'Batch delete sheets',
      requiresAuth: true,
    },
    {
      tool: 'sheets_core',
      action: 'batch_update_sheets',
      args: {
        action: 'batch_update_sheets',
        spreadsheetId: TEST_SPREADSHEET_ID,
        updates: [
          { sheetId: 0, title: 'Updated Sheet 1' },
          { sheetId: 1, title: 'Updated Sheet 2' },
        ],
      },
      description: 'Batch update sheet properties',
      requiresAuth: true,
    },
  ];
}

/**
 * sheets_data test data
 */
function generateValuesTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_data',
      action: 'read',
      args: {
        action: 'read',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:D10',
      },
      description: 'Read cell values',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'write',
      args: {
        action: 'write',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:B2',
        values: [
          ['Header 1', 'Header 2'],
          ['Value 1', 'Value 2'],
        ],
      },
      description: 'Write cell values',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'append',
      args: {
        action: 'append',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A:B',
        values: [['New', 'Data']],
      },
      description: 'Append values',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'clear',
      args: {
        action: 'clear',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:B2',
      },
      description: 'Clear values',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'batch_read',
      args: {
        action: 'batch_read',
        spreadsheetId: TEST_SPREADSHEET_ID,
        ranges: ['Sheet1!A1:D10', 'Sheet1!F1:H10'],
      },
      description: 'Batch read values',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'batch_write',
      args: {
        action: 'batch_write',
        spreadsheetId: TEST_SPREADSHEET_ID,
        data: [
          { range: 'Sheet1!A1:B1', values: [['Header 1', 'Header 2']] },
          { range: 'Sheet1!A2:B2', values: [['Data 1', 'Data 2']] },
        ],
      },
      description: 'Batch write values',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'batch_clear',
      args: {
        action: 'batch_clear',
        spreadsheetId: TEST_SPREADSHEET_ID,
        ranges: ['Sheet1!A1:B2', 'Sheet1!C1:D2'],
      },
      description: 'Batch clear values',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'find_replace',
      args: {
        action: 'find_replace',
        spreadsheetId: TEST_SPREADSHEET_ID,
        find: 'search text',
      },
      description: 'Find values',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'find_replace',
      args: {
        action: 'find_replace',
        spreadsheetId: TEST_SPREADSHEET_ID,
        find: 'old text',
        replacement: 'new text',
      },
      description: 'Replace values',
      requiresAuth: true,
    },
  ];
}

// Add placeholder generators for remaining tools
function generateCellsTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_data',
      action: 'merge_cells',
      args: {
        action: 'merge_cells',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:B2',
        mergeType: 'MERGE_ALL',
      },
      description: 'Merge cells',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'unmerge_cells',
      args: {
        action: 'unmerge_cells',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:B2',
      },
      description: 'Unmerge cells',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'add_note',
      args: {
        action: 'add_note',
        spreadsheetId: TEST_SPREADSHEET_ID,
        cell: 'A1',
        note: 'This is a test note',
      },
      description: 'Add note to cell',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'get_note',
      args: {
        action: 'get_note',
        spreadsheetId: TEST_SPREADSHEET_ID,
        cell: 'A1',
      },
      description: 'Get note from cell',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'clear_note',
      args: {
        action: 'clear_note',
        spreadsheetId: TEST_SPREADSHEET_ID,
        cell: 'A1',
      },
      description: 'Clear note from cell',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'set_hyperlink',
      args: {
        action: 'set_hyperlink',
        spreadsheetId: TEST_SPREADSHEET_ID,
        cell: 'A1',
        url: 'https://example.com',
        displayText: 'Example Link',
      },
      description: 'Set cell hyperlink',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'clear_hyperlink',
      args: {
        action: 'clear_hyperlink',
        spreadsheetId: TEST_SPREADSHEET_ID,
        cell: 'A1',
      },
      description: 'Clear cell hyperlink',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'set_validation',
      args: {
        action: 'set_validation',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:A10',
        rule: {
          condition: { type: 'ONE_OF_LIST', values: ['Option1', 'Option2', 'Option3'] },
          showDropdown: true,
        },
      },
      description: 'Set data validation',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'clear_validation',
      args: {
        action: 'clear_validation',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:A10',
      },
      description: 'Clear data validation',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'get_merges',
      args: {
        action: 'get_merges',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
      },
      description: 'Get merged cells',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'cut_paste',
      args: {
        action: 'cut_paste',
        spreadsheetId: TEST_SPREADSHEET_ID,
        source: 'A1:B2',
        destination: 'C1',
      },
      description: 'Cut and paste cells',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'copy_paste',
      args: {
        action: 'copy_paste',
        spreadsheetId: TEST_SPREADSHEET_ID,
        source: 'A1:B2',
        destination: 'C1',
      },
      description: 'Copy and paste cells',
      requiresAuth: true,
    },
    {
      tool: 'sheets_data',
      action: 'find_replace',
      args: {
        action: 'find_replace',
        spreadsheetId: TEST_SPREADSHEET_ID,
        find: 'old',
        replace: 'new',
      },
      description: 'Find and replace text',
      requiresAuth: true,
    },
  ];
}

function generateFormatTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_format',
      action: 'set_format',
      args: {
        action: 'set_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:B2',
        format: { bold: true },
      },
      description: 'Set cell format',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'set_text_format',
      args: {
        action: 'set_text_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:B2',
        textFormat: { bold: true, fontSize: 12 },
      },
      description: 'Set text format',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'set_number_format',
      args: {
        action: 'set_number_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:A10',
        pattern: '#,##0.00',
      },
      description: 'Set number format',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'set_data_validation',
      args: {
        action: 'set_data_validation',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:A10',
        condition: { type: 'ONE_OF_LIST', values: ['Yes', 'No'] },
        showDropdown: true,
      },
      description: 'Set data validation dropdown',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'auto_fit',
      args: {
        action: 'auto_fit',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: 5,
      },
      description: 'Auto-fit column widths',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'rule_add_conditional_format',
      args: {
        action: 'rule_add_conditional_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        range: 'A1:D10',
        rule: {
          type: 'boolean',
          condition: { type: 'TEXT_CONTAINS', values: ['error'] },
          format: { backgroundColor: { red: 1, green: 0, blue: 0 } },
        },
      },
      description: 'Add conditional formatting rule',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'rule_update_conditional_format',
      args: {
        action: 'rule_update_conditional_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        ruleIndex: 0,
        rule: {
          type: 'boolean',
          condition: { type: 'TEXT_CONTAINS', values: ['warning'] },
          format: { backgroundColor: { red: 1, green: 1, blue: 0 } },
        },
      },
      description: 'Update conditional formatting rule',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'rule_delete_conditional_format',
      args: {
        action: 'rule_delete_conditional_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        ruleIndex: 0,
      },
      description: 'Delete conditional formatting rule',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'rule_list_conditional_formats',
      args: {
        action: 'rule_list_conditional_formats',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
      },
      description: 'List conditional formatting rules',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'get_format',
      args: {
        action: 'get_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:B2',
      },
      description: 'Get cell format',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'clear_format',
      args: {
        action: 'clear_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:B2',
      },
      description: 'Clear cell format',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'set_borders',
      args: {
        action: 'set_borders',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:D10',
        borders: { top: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } } },
      },
      description: 'Set cell borders',
      requiresAuth: true,
    },
    {
      tool: 'sheets_format',
      action: 'set_background_color',
      args: {
        action: 'set_background_color',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:B2',
        color: { red: 0.9, green: 0.9, blue: 0.9 },
      },
      description: 'Set background color',
      requiresAuth: true,
    },
  ];
}

// Generators for remaining tools
function generateDimensionsTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_dimensions',
      action: 'insert_rows',
      args: {
        action: 'insert_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 0,
        count: 1,
      },
      description: 'Insert rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'insert_columns',
      args: {
        action: 'insert_columns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 0,
        count: 1,
      },
      description: 'Insert columns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'delete_rows',
      args: {
        action: 'delete_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 0,
        endIndex: 1,
      },
      description: 'Delete rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'delete_columns',
      args: {
        action: 'delete_columns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 0,
        endIndex: 1,
      },
      description: 'Delete columns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'resize_rows',
      args: {
        action: 'resize_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 0,
        endIndex: 5,
        pixelSize: 30,
      },
      description: 'Resize rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'resize_columns',
      args: {
        action: 'resize_columns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 0,
        endIndex: 5,
        pixelSize: 100,
      },
      description: 'Resize columns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'freeze_rows',
      args: {
        action: 'freeze_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        count: 1,
      },
      description: 'Freeze header rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'freeze_columns',
      args: {
        action: 'freeze_columns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        count: 1,
      },
      description: 'Freeze columns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'move_rows',
      args: {
        action: 'move_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 5,
        endIndex: 6,
        destinationIndex: 0,
      },
      description: 'Move rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'move_columns',
      args: {
        action: 'move_columns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 2,
        endIndex: 3,
        destinationIndex: 0,
      },
      description: 'Move columns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'sort_range',
      args: {
        action: 'sort_range',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1:D10',
        sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }],
      },
      description: 'Sort range',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'filter_create_basic_filter',
      args: {
        action: 'filter_create_basic_filter',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        range: 'A1:D100',
      },
      description: 'Create basic filter',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'filter_update_filter_criteria',
      args: {
        action: 'filter_update_filter_criteria',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        columnIndex: 0,
        criteria: { condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'test' }] } },
      },
      description: 'Update filter criteria',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'filter_clear_basic_filter',
      args: {
        action: 'filter_clear_basic_filter',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
      },
      description: 'Clear basic filter',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'create_slicer',
      args: {
        action: 'create_slicer',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        range: 'A1:D100',
        columnIndex: 0,
        position: { anchorCell: 'F1' },
      },
      description: 'Create slicer',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'text_to_columns',
      args: {
        action: 'text_to_columns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        source: 'A1:A10',
        delimiter: ',',
        delimiterType: 'CUSTOM',
      },
      description: 'Split text to columns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'hide_rows',
      args: {
        action: 'hide_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 5,
        endIndex: 10,
      },
      description: 'Hide rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'unhide_rows',
      args: {
        action: 'unhide_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 5,
        endIndex: 10,
      },
      description: 'Unhide rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'hide_columns',
      args: {
        action: 'hide_columns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 2,
        endIndex: 4,
      },
      description: 'Hide columns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'unhide_columns',
      args: {
        action: 'unhide_columns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 2,
        endIndex: 4,
      },
      description: 'Unhide columns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'group_rows',
      args: {
        action: 'group_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 2,
        endIndex: 5,
      },
      description: 'Group rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'ungroup_rows',
      args: {
        action: 'ungroup_rows',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        startIndex: 2,
        endIndex: 5,
      },
      description: 'Ungroup rows',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'get_row_height',
      args: {
        action: 'get_row_height',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        rowIndex: 0,
      },
      description: 'Get row height',
      requiresAuth: true,
    },
    {
      tool: 'sheets_dimensions',
      action: 'get_column_width',
      args: {
        action: 'get_column_width',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        columnIndex: 0,
      },
      description: 'Get column width',
      requiresAuth: true,
    },
  ];
}

function generateVisualizeTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_visualize',
      action: 'chart_list',
      args: { action: 'chart_list', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List charts',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'chart_create',
      args: {
        action: 'chart_create',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        chartType: 'COLUMN',
        data: { sourceRange: { a1: 'Sheet1!A1:B10' } },
        position: { anchorCell: 'D1' },
      },
      description: 'Create a chart',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'chart_get',
      args: {
        action: 'chart_get',
        spreadsheetId: TEST_SPREADSHEET_ID,
        chartId: 12345,
      },
      description: 'Get chart details',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'chart_update',
      args: {
        action: 'chart_update',
        spreadsheetId: TEST_SPREADSHEET_ID,
        chartId: 12345,
        options: { title: 'Updated Chart' },
      },
      description: 'Update chart',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'chart_delete',
      args: {
        action: 'chart_delete',
        spreadsheetId: TEST_SPREADSHEET_ID,
        chartId: 12345,
      },
      description: 'Delete chart',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'chart_move',
      args: {
        action: 'chart_move',
        spreadsheetId: TEST_SPREADSHEET_ID,
        chartId: 12345,
        position: { anchorCell: 'F1' },
      },
      description: 'Move chart',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'chart_update_data_range',
      args: {
        action: 'chart_update_data_range',
        spreadsheetId: TEST_SPREADSHEET_ID,
        chartId: 12345,
        data: { sourceRange: { a1: 'Sheet1!A1:C20' } },
      },
      description: 'Update chart data range',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'pivot_create',
      args: {
        action: 'pivot_create',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sourceRange: 'Sheet1!A1:D100',
        destinationCell: 'F1',
        rows: [{ sourceColumnOffset: 0, sortOrder: 'ASCENDING' }],
        values: [{ sourceColumnOffset: 1, summarizeFunction: 'SUM' }],
      },
      description: 'Create pivot table',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'pivot_list',
      args: {
        action: 'pivot_list',
        spreadsheetId: TEST_SPREADSHEET_ID,
      },
      description: 'List pivot tables',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'pivot_update',
      args: {
        action: 'pivot_update',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        pivotTableId: 12345,
        values: [{ sourceColumnOffset: 2, summarizeFunction: 'AVERAGE' }],
      },
      description: 'Update pivot table',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'pivot_delete',
      args: {
        action: 'pivot_delete',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 0,
        pivotTableId: 12345,
      },
      description: 'Delete pivot table',
      requiresAuth: true,
    },
    {
      tool: 'sheets_visualize',
      action: 'sparkline_add',
      args: {
        action: 'sparkline_add',
        spreadsheetId: TEST_SPREADSHEET_ID,
        cell: 'E1',
        dataRange: 'A1:D1',
        type: 'LINE',
      },
      description: 'Add sparkline',
      requiresAuth: true,
    },
  ];
}

function generateCollaborateTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_collaborate',
      action: 'share_list',
      args: { action: 'share_list', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List sharing permissions',
      requiresAuth: true,
    },
  ];
}

function generateAdvancedTestData(): TestDataSpec[] {
  return [
    // Named ranges (5)
    {
      tool: 'sheets_advanced',
      action: 'add_named_range',
      args: {
        action: 'add_named_range',
        spreadsheetId: TEST_SPREADSHEET_ID,
        name: 'TestRange',
        range: 'A1:B10',
      },
      description: 'Add a named range',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'update_named_range',
      args: {
        action: 'update_named_range',
        spreadsheetId: TEST_SPREADSHEET_ID,
        namedRangeId: 'test-id',
        name: 'UpdatedRange',
      },
      description: 'Update a named range',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'delete_named_range',
      args: {
        action: 'delete_named_range',
        spreadsheetId: TEST_SPREADSHEET_ID,
        namedRangeId: 'test-id',
      },
      description: 'Delete a named range',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'list_named_ranges',
      args: { action: 'list_named_ranges', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List named ranges',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'get_named_range',
      args: { action: 'get_named_range', spreadsheetId: TEST_SPREADSHEET_ID, name: 'TestRange' },
      description: 'Get a named range by name',
      requiresAuth: true,
    },
    // Protected ranges (4)
    {
      tool: 'sheets_advanced',
      action: 'add_protected_range',
      args: { action: 'add_protected_range', spreadsheetId: TEST_SPREADSHEET_ID, range: 'A1:B10' },
      description: 'Add a protected range',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'update_protected_range',
      args: {
        action: 'update_protected_range',
        spreadsheetId: TEST_SPREADSHEET_ID,
        protectedRangeId: 12345,
      },
      description: 'Update a protected range',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'delete_protected_range',
      args: {
        action: 'delete_protected_range',
        spreadsheetId: TEST_SPREADSHEET_ID,
        protectedRangeId: 12345,
      },
      description: 'Delete a protected range',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'list_protected_ranges',
      args: { action: 'list_protected_ranges', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List protected ranges',
      requiresAuth: true,
    },
    // Metadata (3)
    {
      tool: 'sheets_advanced',
      action: 'set_metadata',
      args: {
        action: 'set_metadata',
        spreadsheetId: TEST_SPREADSHEET_ID,
        metadataKey: 'testKey',
        metadataValue: 'testValue',
      },
      description: 'Set developer metadata',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'get_metadata',
      args: { action: 'get_metadata', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Get developer metadata',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'delete_metadata',
      args: { action: 'delete_metadata', spreadsheetId: TEST_SPREADSHEET_ID, metadataId: 12345 },
      description: 'Delete developer metadata',
      requiresAuth: true,
    },
    // Banding (4)
    {
      tool: 'sheets_advanced',
      action: 'add_banding',
      args: { action: 'add_banding', spreadsheetId: TEST_SPREADSHEET_ID, range: 'A1:D10' },
      description: 'Add alternating colors',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'update_banding',
      args: { action: 'update_banding', spreadsheetId: TEST_SPREADSHEET_ID, bandedRangeId: 12345 },
      description: 'Update banding',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'delete_banding',
      args: { action: 'delete_banding', spreadsheetId: TEST_SPREADSHEET_ID, bandedRangeId: 12345 },
      description: 'Delete banding',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'list_banding',
      args: { action: 'list_banding', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List banding',
      requiresAuth: true,
    },
    // Tables (3)
    {
      tool: 'sheets_advanced',
      action: 'create_table',
      args: { action: 'create_table', spreadsheetId: TEST_SPREADSHEET_ID, range: 'A1:D10' },
      description: 'Create a table',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'delete_table',
      args: {
        action: 'delete_table',
        spreadsheetId: TEST_SPREADSHEET_ID,
        tableId: 'test-table-id',
      },
      description: 'Delete a table',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'list_tables',
      args: { action: 'list_tables', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List tables',
      requiresAuth: true,
    },
    // Smart Chips (4)
    {
      tool: 'sheets_advanced',
      action: 'add_person_chip',
      args: {
        action: 'add_person_chip',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1',
        email: 'test@example.com',
      },
      description: 'Add a person chip',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'add_drive_chip',
      args: {
        action: 'add_drive_chip',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1',
        fileId: 'test-file-id',
      },
      description: 'Add a drive chip',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'add_rich_link_chip',
      args: {
        action: 'add_rich_link_chip',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'A1',
        uri: 'https://example.com',
      },
      description: 'Add a rich link chip',
      requiresAuth: true,
    },
    {
      tool: 'sheets_advanced',
      action: 'list_chips',
      args: { action: 'list_chips', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List smart chips',
      requiresAuth: true,
    },
  ];
}

function generateTransactionTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_transaction',
      action: 'begin',
      args: { action: 'begin', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Begin a transaction',
      requiresAuth: true,
    },
    {
      tool: 'sheets_transaction',
      action: 'queue',
      args: {
        action: 'queue',
        transactionId: 'tx-123',
        operation: { tool: 'sheets_data', action: 'read', params: { range: 'A1:B10' } },
      },
      description: 'Queue an operation',
      requiresAuth: false,
    },
    {
      tool: 'sheets_transaction',
      action: 'commit',
      args: { action: 'commit', transactionId: 'tx-123' },
      description: 'Commit a transaction',
      requiresAuth: true,
    },
    {
      tool: 'sheets_transaction',
      action: 'rollback',
      args: { action: 'rollback', transactionId: 'tx-123' },
      description: 'Rollback a transaction',
      requiresAuth: true,
    },
    {
      tool: 'sheets_transaction',
      action: 'status',
      args: { action: 'status', transactionId: 'tx-123' },
      description: 'Get transaction status',
      requiresAuth: false,
    },
    {
      tool: 'sheets_transaction',
      action: 'list',
      args: { action: 'list' },
      description: 'List active transactions',
      requiresAuth: false,
    },
  ];
}

function generateQualityTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_quality',
      action: 'validate',
      args: { action: 'validate', spreadsheetId: TEST_SPREADSHEET_ID, dryRun: true },
      description: 'Validate spreadsheet data',
      requiresAuth: true,
    },
    {
      tool: 'sheets_quality',
      action: 'detect_conflicts',
      args: { action: 'detect_conflicts', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Detect data conflicts',
      requiresAuth: true,
    },
    {
      tool: 'sheets_quality',
      action: 'resolve_conflict',
      args: {
        action: 'resolve_conflict',
        spreadsheetId: TEST_SPREADSHEET_ID,
        conflictId: 'conflict-123',
        resolution: 'keep_newer',
      },
      description: 'Resolve a conflict',
      requiresAuth: true,
    },
    {
      tool: 'sheets_quality',
      action: 'analyze_impact',
      args: {
        action: 'analyze_impact',
        spreadsheetId: TEST_SPREADSHEET_ID,
        operation: {
          tool: 'sheets_data',
          action: 'write',
          params: { range: 'A1', values: [['test']] },
        },
      },
      description: 'Analyze operation impact',
      requiresAuth: true,
    },
  ];
}

function generateHistoryTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_history',
      action: 'list',
      args: { action: 'list', spreadsheetId: TEST_SPREADSHEET_ID, limit: 5 },
      description: 'List recent operations',
      requiresAuth: true,
    },
    {
      tool: 'sheets_history',
      action: 'undo',
      args: { action: 'undo', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Undo last operation',
      requiresAuth: true,
    },
    {
      tool: 'sheets_history',
      action: 'redo',
      args: { action: 'redo', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Redo undone operation',
      requiresAuth: true,
    },
    {
      tool: 'sheets_history',
      action: 'revert_to',
      args: { action: 'revert_to', spreadsheetId: TEST_SPREADSHEET_ID, snapshotId: 'snapshot-123' },
      description: 'Revert to snapshot',
      requiresAuth: true,
    },
    {
      tool: 'sheets_history',
      action: 'get_snapshot',
      args: {
        action: 'get_snapshot',
        spreadsheetId: TEST_SPREADSHEET_ID,
        snapshotId: 'snapshot-123',
      },
      description: 'Get snapshot details',
      requiresAuth: true,
    },
    {
      tool: 'sheets_history',
      action: 'create_snapshot',
      args: {
        action: 'create_snapshot',
        spreadsheetId: TEST_SPREADSHEET_ID,
        description: 'Manual checkpoint',
      },
      description: 'Create manual snapshot',
      requiresAuth: true,
    },
    {
      tool: 'sheets_history',
      action: 'compare',
      args: {
        action: 'compare',
        spreadsheetId: TEST_SPREADSHEET_ID,
        fromSnapshotId: 'snapshot-1',
        toSnapshotId: 'snapshot-2',
      },
      description: 'Compare snapshots',
      requiresAuth: true,
    },
  ];
}

function generateConfirmTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_confirm',
      action: 'request',
      args: {
        action: 'request',
        operation: {
          tool: 'sheets_data',
          action: 'clear',
          params: { spreadsheetId: TEST_SPREADSHEET_ID, range: 'Sheet1' },
        },
        reason: 'This will clear all data',
      },
      description: 'Request confirmation for operation',
      requiresAuth: false,
    },
    {
      tool: 'sheets_confirm',
      action: 'approve',
      args: { action: 'approve', confirmationId: 'conf-123' },
      description: 'Approve pending confirmation',
      requiresAuth: false,
    },
    {
      tool: 'sheets_confirm',
      action: 'deny',
      args: { action: 'deny', confirmationId: 'conf-123', reason: 'Not approved' },
      description: 'Deny pending confirmation',
      requiresAuth: false,
    },
    {
      tool: 'sheets_confirm',
      action: 'get_stats',
      args: { action: 'get_stats' },
      description: 'Get confirmation stats',
      requiresAuth: false,
    },
    {
      tool: 'sheets_confirm',
      action: 'wizard_start',
      args: {
        action: 'wizard_start',
        wizardType: 'create_spreadsheet',
        context: { title: 'New Spreadsheet' },
      },
      description: 'Start a guided wizard',
      requiresAuth: false,
    },
    {
      tool: 'sheets_confirm',
      action: 'wizard_step',
      args: {
        action: 'wizard_step',
        wizardId: 'wiz-123',
        stepId: 'step-1',
        response: { confirmed: true },
      },
      description: 'Complete a wizard step',
      requiresAuth: false,
    },
  ];
}

function generateAnalyzeTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_analyze',
      action: 'comprehensive',
      args: { action: 'comprehensive', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Run comprehensive analysis',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'analyze_data',
      args: { action: 'analyze_data', spreadsheetId: TEST_SPREADSHEET_ID, range: 'Sheet1!A1:D100' },
      description: 'Analyze data patterns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'suggest_visualization',
      args: {
        action: 'suggest_visualization',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:D100',
      },
      description: 'Suggest visualizations',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'detect_anomalies',
      args: {
        action: 'detect_anomalies',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:D100',
      },
      description: 'Detect anomalies',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'generate_formula',
      args: {
        action: 'generate_formula',
        spreadsheetId: TEST_SPREADSHEET_ID,
        description: 'Calculate the sum of column A',
      },
      description: 'Generate formula from description',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'explain_formula',
      args: { action: 'explain_formula', formula: '=SUMIF(A:A,">0",B:B)' },
      description: 'Explain a formula',
      requiresAuth: false,
    },
    {
      tool: 'sheets_analyze',
      action: 'summarize_data',
      args: {
        action: 'summarize_data',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:D100',
      },
      description: 'Summarize data',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'detect_patterns',
      args: {
        action: 'detect_patterns',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:D100',
      },
      description: 'Detect patterns',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'suggest_cleanup',
      args: { action: 'suggest_cleanup', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Suggest cleanup actions',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'compare_sheets',
      args: {
        action: 'compare_sheets',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sourceSheet: 'Sheet1',
        targetSheet: 'Sheet2',
      },
      description: 'Compare two sheets',
      requiresAuth: true,
    },
    {
      tool: 'sheets_analyze',
      action: 'validate_structure',
      args: { action: 'validate_structure', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Validate spreadsheet structure',
      requiresAuth: true,
    },
  ];
}

function generateFixTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_fix',
      action: 'fix',
      args: {
        action: 'fix',
        spreadsheetId: TEST_SPREADSHEET_ID,
        issues: [
          {
            type: 'NO_FROZEN_HEADERS',
            severity: 'low',
            description: 'Missing frozen header',
          },
        ],
        mode: 'preview',
      },
      description: 'Preview fixes',
      requiresAuth: true,
    },
  ];
}

function generateCompositeTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_composite',
      action: 'import_csv',
      args: {
        action: 'import_csv',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetName: 'Sheet1',
        csvData: 'Name,Value\nA,1',
        hasHeaders: true,
      },
      description: 'Import CSV data',
      requiresAuth: true,
    },
    {
      tool: 'sheets_composite',
      action: 'smart_append',
      args: {
        action: 'smart_append',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1',
        values: [['New', 'Row']],
      },
      description: 'Smart append data',
      requiresAuth: true,
    },
    {
      tool: 'sheets_composite',
      action: 'bulk_update',
      args: {
        action: 'bulk_update',
        spreadsheetId: TEST_SPREADSHEET_ID,
        updates: [
          { range: 'A1', values: [['Value1']] },
          { range: 'B1', values: [['Value2']] },
        ],
      },
      description: 'Bulk update multiple ranges',
      requiresAuth: true,
    },
    {
      tool: 'sheets_composite',
      action: 'deduplicate',
      args: {
        action: 'deduplicate',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A2:C100',
        keyColumns: ['A'],
      },
      description: 'Remove duplicate rows',
      requiresAuth: true,
    },
  ];
}

function generateSessionTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_session',
      action: 'get_active',
      args: { action: 'get_active' },
      description: 'Get active session context',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'set_active',
      args: { action: 'set_active', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Set active spreadsheet',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'clear',
      args: { action: 'clear' },
      description: 'Clear session context',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'set_pending',
      args: { action: 'set_pending', operationType: 'write', description: 'test operation' },
      description: 'Set pending operation',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'resolve',
      args: { action: 'resolve', reference: 'the spreadsheet' },
      description: 'Resolve natural language reference',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'record_operation',
      args: { action: 'record_operation', operation: { tool: 'sheets_data', action: 'read' } },
      description: 'Record an operation',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'get_last_operation',
      args: { action: 'get_last_operation' },
      description: 'Get last operation',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'get_recent_operations',
      args: { action: 'get_recent_operations', limit: 5 },
      description: 'Get recent operations',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'add_alias',
      args: { action: 'add_alias', alias: 'mysheet', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'Add a spreadsheet alias',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'remove_alias',
      args: { action: 'remove_alias', alias: 'mysheet' },
      description: 'Remove a spreadsheet alias',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'list_aliases',
      args: { action: 'list_aliases' },
      description: 'List all aliases',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'get_summary',
      args: { action: 'get_summary' },
      description: 'Get session summary',
      requiresAuth: false,
    },
    {
      tool: 'sheets_session',
      action: 'reset',
      args: { action: 'reset' },
      description: 'Reset session',
      requiresAuth: false,
    },
  ];
}

// Tier 7 Enterprise Tools

function generateBigQueryTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_bigquery',
      action: 'connect',
      args: {
        action: 'connect',
        spreadsheetId: TEST_SPREADSHEET_ID,
        projectId: 'test-project',
        datasetId: 'test_dataset',
        tableId: 'test_table',
      },
      description: 'Connect to BigQuery',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'connect_looker',
      args: {
        action: 'connect_looker',
        spreadsheetId: TEST_SPREADSHEET_ID,
        projectId: 'test-project',
        datasetId: 'test_dataset',
        tableId: 'test_table',
      },
      description: 'Connect via Looker',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'disconnect',
      args: { action: 'disconnect', spreadsheetId: TEST_SPREADSHEET_ID, dataSourceId: 'ds-123' },
      description: 'Disconnect from BigQuery',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'get_connection',
      args: {
        action: 'get_connection',
        spreadsheetId: TEST_SPREADSHEET_ID,
        dataSourceId: 'ds-123',
      },
      description: 'Get connection details',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'list_connections',
      args: { action: 'list_connections', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List all connections',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'query',
      args: {
        action: 'query',
        spreadsheetId: TEST_SPREADSHEET_ID,
        dataSourceId: 'ds-123',
        query: 'SELECT * FROM table LIMIT 10',
      },
      description: 'Execute BigQuery query',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'preview',
      args: {
        action: 'preview',
        spreadsheetId: TEST_SPREADSHEET_ID,
        dataSourceId: 'ds-123',
        query: 'SELECT * FROM table LIMIT 5',
      },
      description: 'Preview query results',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'refresh',
      args: { action: 'refresh', spreadsheetId: TEST_SPREADSHEET_ID, dataSourceId: 'ds-123' },
      description: 'Refresh data source',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'cancel_refresh',
      args: {
        action: 'cancel_refresh',
        spreadsheetId: TEST_SPREADSHEET_ID,
        dataSourceId: 'ds-123',
      },
      description: 'Cancel refresh operation',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'export_to_bigquery',
      args: {
        action: 'export_to_bigquery',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: 'Sheet1!A1:D10',
        projectId: 'test-project',
        datasetId: 'test_dataset',
        tableId: 'export_table',
      },
      description: 'Export data to BigQuery',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'import_from_bigquery',
      args: {
        action: 'import_from_bigquery',
        spreadsheetId: TEST_SPREADSHEET_ID,
        projectId: 'test-project',
        datasetId: 'test_dataset',
        tableId: 'test_table',
        sheetName: 'Imported',
      },
      description: 'Import data from BigQuery',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'create_extract',
      args: {
        action: 'create_extract',
        spreadsheetId: TEST_SPREADSHEET_ID,
        dataSourceId: 'ds-123',
        range: 'A1:D100',
      },
      description: 'Create data extract',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'update_extract',
      args: {
        action: 'update_extract',
        spreadsheetId: TEST_SPREADSHEET_ID,
        dataSourceId: 'ds-123',
      },
      description: 'Update data extract',
      requiresAuth: true,
    },
    {
      tool: 'sheets_bigquery',
      action: 'get_schema',
      args: { action: 'get_schema', spreadsheetId: TEST_SPREADSHEET_ID, dataSourceId: 'ds-123' },
      description: 'Get BigQuery schema',
      requiresAuth: true,
    },
  ];
}

function generateTemplatesTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_templates',
      action: 'list',
      args: { action: 'list' },
      description: 'List available templates',
      requiresAuth: false,
    },
    {
      tool: 'sheets_templates',
      action: 'get',
      args: { action: 'get', templateId: 'crm-basic' },
      description: 'Get template details',
      requiresAuth: false,
    },
    {
      tool: 'sheets_templates',
      action: 'create_from_template',
      args: { action: 'create_from_template', templateId: 'crm-basic', title: 'My CRM' },
      description: 'Create spreadsheet from template',
      requiresAuth: true,
    },
    {
      tool: 'sheets_templates',
      action: 'save_as_template',
      args: {
        action: 'save_as_template',
        spreadsheetId: TEST_SPREADSHEET_ID,
        name: 'My Template',
        description: 'Test template',
      },
      description: 'Save spreadsheet as template',
      requiresAuth: true,
    },
    {
      tool: 'sheets_templates',
      action: 'delete',
      args: { action: 'delete', templateId: 'test-template-id' },
      description: 'Delete a template',
      requiresAuth: true,
    },
    {
      tool: 'sheets_templates',
      action: 'update',
      args: { action: 'update', templateId: 'test-template-id', name: 'Updated Name' },
      description: 'Update template metadata',
      requiresAuth: true,
    },
    {
      tool: 'sheets_templates',
      action: 'duplicate',
      args: { action: 'duplicate', templateId: 'crm-basic', newName: 'CRM Copy' },
      description: 'Duplicate a template',
      requiresAuth: true,
    },
    {
      tool: 'sheets_templates',
      action: 'export',
      args: { action: 'export', templateId: 'crm-basic' },
      description: 'Export template definition',
      requiresAuth: false,
    },
  ];
}

function generateAppsScriptTestData(): TestDataSpec[] {
  return [
    {
      tool: 'sheets_appsscript',
      action: 'list_projects',
      args: { action: 'list_projects', spreadsheetId: TEST_SPREADSHEET_ID },
      description: 'List bound Apps Script projects',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'create_project',
      args: { action: 'create_project', spreadsheetId: TEST_SPREADSHEET_ID, title: 'Test Script' },
      description: 'Create bound script project',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'get_project',
      args: { action: 'get_project', scriptId: 'test-script-id' },
      description: 'Get script project details',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'update_content',
      args: {
        action: 'update_content',
        scriptId: 'test-script-id',
        files: [{ name: 'Code', type: 'SERVER_JS', source: 'function test() {}' }],
      },
      description: 'Update script content',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'get_content',
      args: { action: 'get_content', scriptId: 'test-script-id' },
      description: 'Get script content',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'run_function',
      args: { action: 'run_function', scriptId: 'test-script-id', functionName: 'myFunction' },
      description: 'Run a script function',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'list_functions',
      args: { action: 'list_functions', scriptId: 'test-script-id' },
      description: 'List script functions',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'create_trigger',
      args: {
        action: 'create_trigger',
        scriptId: 'test-script-id',
        functionName: 'onEdit',
        triggerType: 'ON_EDIT',
      },
      description: 'Create a trigger',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'list_triggers',
      args: { action: 'list_triggers', scriptId: 'test-script-id' },
      description: 'List script triggers',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'delete_trigger',
      args: { action: 'delete_trigger', scriptId: 'test-script-id', triggerId: 'trigger-123' },
      description: 'Delete a trigger',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'get_metrics',
      args: { action: 'get_metrics', scriptId: 'test-script-id' },
      description: 'Get script metrics',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'deploy',
      args: { action: 'deploy', scriptId: 'test-script-id', description: 'v1.0' },
      description: 'Deploy script version',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'list_deployments',
      args: { action: 'list_deployments', scriptId: 'test-script-id' },
      description: 'List deployments',
      requiresAuth: true,
    },
    {
      tool: 'sheets_appsscript',
      action: 'undeploy',
      args: { action: 'undeploy', scriptId: 'test-script-id', deploymentId: 'deploy-123' },
      description: 'Remove deployment',
      requiresAuth: true,
    },
  ];
}

/**
 * Get test arguments for a specific tool and action
 */
export function getTestArgs(tool: string, action: string): any {
  const testData = generateAllTestData();
  const key = `${tool}.${action}`;
  const spec = testData.get(key);

  if (spec) {
    return spec.args;
  }

  // Fallback: minimal valid args
  return { action };
}
