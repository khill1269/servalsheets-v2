/**
 * Cross-Tool Workflow Integration Tests
 *
 * Tests complex workflows that span multiple tools.
 * Validates that tools can be composed together correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createMockSheetsApi,
  createMockDriveApi,
  type MockSpreadsheetData,
} from '../helpers/google-api-mocks.js';

// Import schemas for validation
import {
  SheetsCoreInputSchema,
  SheetsDataInputSchema,
  SheetsFormatInputSchema,
  SheetsDimensionsInputSchema,
  SheetsCollaborateInputSchema,
  SheetsVisualizeInputSchema,
  SheetsAdvancedInputSchema,
  SheetsHistoryInputSchema,
  SheetsTransactionInputSchema,
  SheetsAnalyzeInputSchema,
} from '../../src/schemas/index.js';

/**
 * Workflow: Create a new spreadsheet with formatted data
 *
 * Tools involved: sheets_core, sheets_data, sheets_format
 * Steps:
 * 1. Create spreadsheet
 * 2. Write data
 * 3. Format headers
 * 4. Add borders
 */
describe('Workflow: Create Formatted Spreadsheet', () => {
  const mockApi = createMockSheetsApi();
  let createdSpreadsheetId: string;

  it('Step 1: Create new spreadsheet', () => {
    const input = {
      request: {
        action: 'create' as const,
        title: 'Sales Report Q1 2024',
        sheets: [{ title: 'Data' }, { title: 'Summary' }],
      },
    };

    expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
    createdSpreadsheetId = 'new-spreadsheet-id';
  });

  it('Step 2: Write data to the new spreadsheet', () => {
    const input = {
      request: {
        action: 'write' as const,
        spreadsheetId: createdSpreadsheetId,
        range: { a1: 'Data!A1:E5' },
        values: [
          ['Product', 'Region', 'Q1 Sales', 'Q2 Sales', 'Total'],
          ['Widget A', 'North', 1000, 1200, '=C2+D2'],
          ['Widget B', 'South', 800, 900, '=C3+D3'],
          ['Widget C', 'East', 1500, 1600, '=C4+D4'],
          ['Widget D', 'West', 700, 850, '=C5+D5'],
        ],
        valueInputOption: 'USER_ENTERED',
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Format header row', () => {
    const input = {
      request: {
        action: 'set_format' as const,
        spreadsheetId: createdSpreadsheetId,
        range: { a1: 'Data!A1:E1' },
        format: {
          backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
          textFormat: {
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
          },
          horizontalAlignment: 'CENTER',
        },
      },
    };

    expect(SheetsFormatInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 4: Add borders to data range', () => {
    const input = {
      request: {
        action: 'set_borders' as const,
        spreadsheetId: createdSpreadsheetId,
        range: { a1: 'Data!A1:E5' },
        borders: {
          top: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
          bottom: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
          left: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
          right: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
          innerHorizontal: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
          innerVertical: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        },
      },
    };

    expect(SheetsFormatInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: Add chart to existing data
 *
 * Tools involved: sheets_data, sheets_visualize
 * Steps:
 * 1. Read data to determine range
 * 2. Create chart
 * 3. Move chart to optimal position
 */
describe('Workflow: Create Chart from Data', () => {
  const spreadsheetId = 'existing-spreadsheet';

  it('Step 1: Read existing data to determine range', () => {
    const input = {
      request: {
        action: 'read' as const,
        spreadsheetId,
        range: { a1: 'Sales!A1:D100' },
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 2: Create bar chart from data', () => {
    const input = {
      request: {
        action: 'chart_create' as const,
        spreadsheetId,
        sheetId: 0,
        chartType: 'BAR' as const,
        data: {
          sourceRange: { a1: 'Sales!A1:D10' },
        },
        position: {
          anchorCell: 'F1',
        },
        options: {
          title: 'Sales by Region',
          legend: { position: 'RIGHT' },
        },
      },
    };

    expect(SheetsVisualizeInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Resize chart for better visibility', () => {
    const input = {
      request: {
        action: 'chart_resize' as const,
        spreadsheetId,
        chartId: 12345,
        width: 600,
        height: 400,
      },
    };

    expect(SheetsVisualizeInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: Share and collaborate
 *
 * Tools involved: sheets_collaborate, sheets_advanced
 * Steps:
 * 1. Add named range for team reference
 * 2. Protect important data
 * 3. Share with team members
 */
describe('Workflow: Setup Collaboration', () => {
  const spreadsheetId = 'team-spreadsheet';

  it('Step 1: Create named range for easy reference', () => {
    const input = {
      request: {
        action: 'add_named_range' as const,
        spreadsheetId,
        name: 'BudgetData',
        range: { a1: 'Budget!A1:G50' },
      },
    };

    expect(SheetsAdvancedInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 2: Protect formula cells', () => {
    const input = {
      request: {
        action: 'add_protected_range' as const,
        spreadsheetId,
        range: { a1: 'Budget!G1:G50' },
        description: 'Calculated totals - do not edit',
        warningOnly: false,
      },
    };

    expect(SheetsAdvancedInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Share with team as editors', () => {
    const input = {
      request: {
        action: 'share_add' as const,
        spreadsheetId,
        type: 'user' as const,
        role: 'writer' as const,
        emailAddress: 'team-member@company.com',
        sendNotification: true,
        emailMessage: 'Please review the Q1 budget projections',
      },
    };

    expect(SheetsCollaborateInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 4: Share with managers as viewers', () => {
    const input = {
      request: {
        action: 'share_add' as const,
        spreadsheetId,
        type: 'user' as const,
        role: 'reader' as const,
        emailAddress: 'manager@company.com',
      },
    };

    expect(SheetsCollaborateInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: Transaction with rollback
 *
 * Tools involved: sheets_transaction, sheets_data, sheets_history
 * Steps:
 * 1. Begin transaction
 * 2. Perform multiple writes
 * 3. Commit or rollback based on validation
 */
describe('Workflow: Transactional Update', () => {
  const spreadsheetId = 'inventory-spreadsheet';

  it('Step 1: Begin transaction', () => {
    const input = {
      request: {
        action: 'begin' as const,
        spreadsheetId,
      },
    };

    expect(SheetsTransactionInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 2: Update inventory counts', () => {
    const input = {
      request: {
        action: 'write' as const,
        spreadsheetId,
        range: { a1: 'Inventory!B2:B5' },
        values: [[150], [200], [75], [300]],
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Update last modified timestamp', () => {
    const input = {
      request: {
        action: 'write' as const,
        spreadsheetId,
        range: { a1: 'Inventory!C2:C5' },
        values: [['=NOW()'], ['=NOW()'], ['=NOW()'], ['=NOW()']],
        valueInputOption: 'USER_ENTERED',
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 4: Commit transaction', () => {
    const input = {
      request: {
        action: 'commit' as const,
        spreadsheetId,
        transactionId: 'txn-123',
      },
    };

    expect(SheetsTransactionInputSchema.safeParse(input).success).toBe(true);
  });

  it('Alternative Step 4: Rollback on error', () => {
    const input = {
      request: {
        action: 'rollback' as const,
        spreadsheetId,
        transactionId: 'txn-123',
      },
    };

    expect(SheetsTransactionInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: Data analysis and reporting
 *
 * Tools involved: sheets_analyze, sheets_data, sheets_visualize
 * Steps:
 * 1. Analyze data for patterns
 * 2. Generate summary formulas
 * 3. Create visualizations
 */
describe('Workflow: Data Analysis', () => {
  const spreadsheetId = 'analytics-spreadsheet';

  it('Step 1: Analyze data for patterns', () => {
    const input = {
      request: {
        action: 'analyze_data' as const,
        spreadsheetId,
        range: { a1: 'RawData!A1:F1000' },
      },
    };

    expect(SheetsAnalyzeInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 2: Generate summary statistics', () => {
    const input = {
      request: {
        action: 'comprehensive' as const,
        spreadsheetId,
        includeFormulas: true,
        includeVisualizations: true,
      },
    };

    expect(SheetsAnalyzeInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Write summary to new sheet', () => {
    const input = {
      request: {
        action: 'write' as const,
        spreadsheetId,
        range: { a1: 'Summary!A1:B10' },
        values: [
          ['Metric', 'Value'],
          ['Total Records', '=COUNTA(RawData!A:A)-1'],
          ['Average Value', '=AVERAGE(RawData!C:C)'],
          ['Max Value', '=MAX(RawData!C:C)'],
          ['Min Value', '=MIN(RawData!C:C)'],
          ['Std Dev', '=STDEV(RawData!C:C)'],
        ],
        valueInputOption: 'USER_ENTERED',
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 4: Create summary chart', () => {
    const input = {
      request: {
        action: 'chart_create' as const,
        spreadsheetId,
        sheetId: 1, // Summary sheet
        chartType: 'PIE' as const,
        data: {
          sourceRange: { a1: 'Summary!A2:B6' },
        },
        position: { anchorCell: 'D1' },
        options: {
          title: 'Data Distribution',
        },
      },
    };

    expect(SheetsVisualizeInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: Template-based document creation
 *
 * Tools involved: sheets_core, sheets_data, sheets_format
 * Steps:
 * 1. Copy template spreadsheet
 * 2. Replace placeholder data
 * 3. Update formatting
 */
describe('Workflow: Template-Based Creation', () => {
  const templateId = 'template-spreadsheet';
  let newDocumentId: string;

  it('Step 1: Copy template to new document', () => {
    const input = {
      request: {
        action: 'copy' as const,
        spreadsheetId: templateId,
        newTitle: 'Invoice #12345',
      },
    };

    expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
    newDocumentId = 'new-invoice-id';
  });

  it('Step 2: Replace placeholder values', () => {
    const input = {
      request: {
        action: 'find_replace' as const,
        spreadsheetId: newDocumentId,
        find: '{{CUSTOMER_NAME}}',
        replacement: 'Acme Corporation',
        matchEntireCell: true,
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Replace date placeholder', () => {
    const input = {
      request: {
        action: 'find_replace' as const,
        spreadsheetId: newDocumentId,
        find: '{{DATE}}',
        replacement: new Date().toLocaleDateString(),
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 4: Write line items', () => {
    const input = {
      request: {
        action: 'write' as const,
        spreadsheetId: newDocumentId,
        range: { a1: 'Invoice!A10:D12' },
        values: [
          ['Widget Pro', 5, 99.99, '=B10*C10'],
          ['Support Package', 1, 299.99, '=B11*C11'],
          ['Shipping', 1, 15.0, '=B12*C12'],
        ],
        valueInputOption: 'USER_ENTERED',
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: Dimension management with data
 *
 * Tools involved: sheets_dimensions, sheets_data
 * Steps:
 * 1. Insert rows for new data
 * 2. Write data to new rows
 * 3. Resize columns to fit content
 */
describe('Workflow: Manage Dimensions and Data', () => {
  const spreadsheetId = 'data-spreadsheet';

  it('Step 1: Insert rows at specific position', () => {
    const input = {
      request: {
        action: 'insert' as const,
        dimension: 'ROWS' as const,
        spreadsheetId,
        sheetId: 0,
        startIndex: 5,
        count: 10,
      },
    };

    expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 2: Write data to inserted rows', () => {
    const newData = Array(10)
      .fill(null)
      .map((_, i) => [`Item ${i + 1}`, i * 100, `=B${6 + i}*1.1`]);

    const input = {
      request: {
        action: 'write' as const,
        spreadsheetId,
        range: { a1: 'Sheet1!A6:C15' },
        values: newData,
        valueInputOption: 'USER_ENTERED',
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Auto-resize columns to fit content', () => {
    const input = {
      request: {
        action: 'auto_resize' as const,
        spreadsheetId,
        sheetId: 0,
        startIndex: 0,
        endIndex: 3,
        dimension: 'COLUMNS' as const,
      },
    };

    expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 4: Hide helper column', () => {
    const input = {
      request: {
        action: 'hide' as const,
        dimension: 'COLUMNS' as const,
        spreadsheetId,
        sheetId: 0,
        startIndex: 10,
        endIndex: 11,
      },
    };

    expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: History and undo
 *
 * Tools involved: sheets_history, sheets_data
 * Steps:
 * 1. List recent operations
 * 2. Find operation to undo
 * 3. Revert operation
 */
describe('Workflow: History and Undo', () => {
  const spreadsheetId = 'tracked-spreadsheet';

  it('Step 1: List recent operations', () => {
    const input = {
      request: {
        action: 'list' as const,
        limit: 20,
      },
    };

    expect(SheetsHistoryInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 2: Get operation details', () => {
    // The 'get' action requires operationId
    const input = {
      request: {
        action: 'get' as const,
        operationId: 'op-123',
      },
    };

    expect(SheetsHistoryInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Revert to operation', () => {
    // Action is 'revert_to' and requires spreadsheetId and operationId
    const input = {
      request: {
        action: 'revert_to' as const,
        spreadsheetId,
        operationId: 'op-123',
      },
    };

    expect(SheetsHistoryInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: Batch operations for efficiency
 *
 * Tools involved: sheets_data
 * Steps:
 * 1. Batch read multiple ranges
 * 2. Process data
 * 3. Batch write results
 */
describe('Workflow: Batch Operations', () => {
  const spreadsheetId = 'batch-spreadsheet';

  it('Step 1: Batch read from multiple sheets', () => {
    const input = {
      request: {
        action: 'batch_read' as const,
        spreadsheetId,
        ranges: [{ a1: 'Sales!A1:D100' }, { a1: 'Inventory!A1:C50' }, { a1: 'Customers!A1:E200' }],
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 2: Batch write to multiple ranges', () => {
    const input = {
      request: {
        action: 'batch_write' as const,
        spreadsheetId,
        data: [
          {
            range: { a1: 'Summary!A1:B5' },
            values: [
              ['Metric', 'Value'],
              ['Total Sales', 50000],
              ['Total Inventory', 1500],
              ['Total Customers', 200],
              ['Last Updated', '=NOW()'],
            ],
          },
          {
            range: { a1: 'Dashboard!A1:A1' },
            values: [['Data refreshed']],
          },
        ],
        valueInputOption: 'USER_ENTERED',
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 3: Batch clear old data', () => {
    const input = {
      request: {
        action: 'batch_clear' as const,
        spreadsheetId,
        ranges: [{ a1: 'Temp!A1:Z10000' }, { a1: 'Cache!A1:Z10000' }],
      },
    };

    expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
  });
});

/**
 * Workflow: Complex conditional formatting
 *
 * Tools involved: sheets_format, sheets_data
 * Steps:
 * 1. Read data to determine thresholds
 * 2. Apply gradient formatting
 * 3. Add conditional rules
 */
describe('Workflow: Conditional Formatting', () => {
  const spreadsheetId = 'formatted-spreadsheet';

  it('Step 1: Apply gradient scale to data range', () => {
    const input = {
      request: {
        action: 'rule_add_conditional_format' as const,
        spreadsheetId,
        sheetId: 0,
        range: { a1: 'Data!C2:C100' },
        rule: {
          type: 'gradient' as const,
          minpoint: { type: 'MIN' as const, color: { red: 1, green: 0.8, blue: 0.8 } },
          midpoint: {
            type: 'PERCENTILE' as const,
            value: '50',
            color: { red: 1, green: 1, blue: 0.8 },
          },
          maxpoint: { type: 'MAX' as const, color: { red: 0.8, green: 1, blue: 0.8 } },
        },
      },
    };

    expect(SheetsFormatInputSchema.safeParse(input).success).toBe(true);
  });

  it('Step 2: Add boolean conditional rule for status', () => {
    const input = {
      request: {
        action: 'rule_add_conditional_format' as const,
        spreadsheetId,
        sheetId: 0,
        range: { a1: 'Data!D2:D100' },
        rule: {
          type: 'boolean' as const,
          condition: {
            type: 'TEXT_EQ',
            values: ['Complete'],
          },
          format: {
            backgroundColor: { red: 0.8, green: 1, blue: 0.8 },
            textFormat: { bold: true },
          },
        },
      },
    };

    expect(SheetsFormatInputSchema.safeParse(input).success).toBe(true);
  });
});
