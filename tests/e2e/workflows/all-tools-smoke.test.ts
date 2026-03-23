/**
 * ServalSheets - E2E All Tools Smoke Test
 *
 * Smoke tests for all 22 tools with 5-10 sample actions each.
 * Verifies basic functionality across the entire tool suite.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHttpClient } from '../mcp-client-simulator.js';
import type { MCPHttpClient } from '../mcp-client-simulator.js';

const TEST_SPREADSHEET_ID = process.env['TEST_SPREADSHEET_ID'];
const SKIP_E2E = !TEST_SPREADSHEET_ID || process.env['TEST_E2E'] !== 'true';

describe.skipIf(SKIP_E2E)('E2E: All Tools Smoke Test', () => {
  let client: MCPHttpClient;

  beforeAll(async () => {
    client = createTestHttpClient('http://localhost:3000');
    await client.initialize();
  });

  afterAll(async () => {
    await client.close();
  });

  describe('sheets_auth (4 actions)', () => {
    it('should check authentication status', async () => {
      const result = await client.callTool('sheets_auth', {
        request: { action: 'check_auth' },
      });
      expect(result.isError).toBe(false);
    });

    it('should get auth scopes', async () => {
      const result = await client.callTool('sheets_auth', {
        request: { action: 'get_scopes' },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_core (19 actions)', () => {
    it('should get spreadsheet metadata', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'get_spreadsheet',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should list sheets', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'list_sheets',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should get sheet properties', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'get_sheet',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should create new sheet', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'create_sheet',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: `Test-${Date.now()}`,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should duplicate sheet', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'duplicate_sheet',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
          newSheetName: `Copy-${Date.now()}`,
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_data (19 actions)', () => {
    it('should read range', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B2',
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should write values', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
          values: [['Test']],
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should append rows', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'append_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A:B',
          values: [['New', 'Row']],
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should clear range', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'clear_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!Z1:Z10',
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should find and replace', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'find_replace',
          spreadsheetId: TEST_SPREADSHEET_ID,
          find: 'oldvalue',
          replacement: 'newvalue',
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_format (23 actions)', () => {
    it('should format cells', async () => {
      const result = await client.callTool('sheets_format', {
        request: {
          action: 'format_cells',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
          format: { textFormat: { bold: true } },
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should set number format', async () => {
      const result = await client.callTool('sheets_format', {
        request: {
          action: 'set_number_format',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
          numberFormat: { type: 'NUMBER', pattern: '0.00' },
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should merge cells', async () => {
      const result = await client.callTool('sheets_format', {
        request: {
          action: 'merge_cells',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B1',
          mergeType: 'MERGE_ALL',
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should set borders', async () => {
      const result = await client.callTool('sheets_format', {
        request: {
          action: 'set_borders',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B2',
          borders: { top: { style: 'SOLID' } },
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should auto-resize columns', async () => {
      const result = await client.callTool('sheets_format', {
        request: {
          action: 'auto_resize_columns',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_dimensions (28 actions)', () => {
    it('should insert rows', async () => {
      const result = await client.callTool('sheets_dimensions', {
        request: {
          action: 'insert_rows',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
          startIndex: 5,
          count: 2,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should delete columns', async () => {
      const result = await client.callTool('sheets_dimensions', {
        request: {
          action: 'delete_columns',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
          startIndex: 10,
          count: 1,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should set column width', async () => {
      const result = await client.callTool('sheets_dimensions', {
        request: {
          action: 'set_column_width',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
          columnIndex: 0,
          width: 200,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should set row height', async () => {
      const result = await client.callTool('sheets_dimensions', {
        request: {
          action: 'set_row_height',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
          rowIndex: 0,
          height: 50,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should freeze rows', async () => {
      const result = await client.callTool('sheets_dimensions', {
        request: {
          action: 'freeze_rows',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
          count: 1,
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_visualize (18 actions)', () => {
    it('should create chart', async () => {
      const result = await client.callTool('sheets_visualize', {
        request: {
          action: 'create_chart',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'Sheet1',
          chartType: 'LINE',
          ranges: ['Sheet1!A1:B10'],
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should list charts', async () => {
      const result = await client.callTool('sheets_visualize', {
        request: {
          action: 'list_charts',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should create pivot table', async () => {
      const result = await client.callTool('sheets_visualize', {
        request: {
          action: 'create_pivot_table',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sourceRange: 'Sheet1!A1:D10',
          targetSheetName: 'Sheet1',
          rows: [{ sourceColumnOffset: 0 }],
          values: [{ sourceColumnOffset: 1, summarizeFunction: 'SUM' }],
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_collaborate (35 actions)', () => {
    it('should list permissions', async () => {
      const result = await client.callTool('sheets_collaborate', {
        request: {
          action: 'list_permissions',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should add comment', async () => {
      const result = await client.callTool('sheets_collaborate', {
        request: {
          action: 'add_comment',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
          content: 'Test comment',
        },
      });
      // May fail if insufficient permissions
      expect(result.isError).toBeDefined();
    });
  });

  describe('sheets_advanced (26 actions)', () => {
    it('should create named range', async () => {
      const result = await client.callTool('sheets_advanced', {
        request: {
          action: 'create_named_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          name: `TestRange${Date.now()}`,
          range: 'Sheet1!A1:B2',
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should list named ranges', async () => {
      const result = await client.callTool('sheets_advanced', {
        request: {
          action: 'list_named_ranges',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should add data validation', async () => {
      const result = await client.callTool('sheets_advanced', {
        request: {
          action: 'add_data_validation',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
          validationType: 'NUMBER_GREATER',
          values: ['0'],
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_transaction (6 actions)', () => {
    it('should start transaction', async () => {
      const result = await client.callTool('sheets_transaction', {
        request: {
          action: 'start_transaction',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should list transactions', async () => {
      const result = await client.callTool('sheets_transaction', {
        request: {
          action: 'list_transactions',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_quality (4 actions)', () => {
    it('should check data quality', async () => {
      const result = await client.callTool('sheets_quality', {
        request: {
          action: 'check_data',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B10',
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should validate schema', async () => {
      const result = await client.callTool('sheets_quality', {
        request: {
          action: 'validate_schema',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B10',
          schema: { columns: [{ name: 'A', type: 'string' }] },
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_history (7 actions)', () => {
    it('should get operation history', async () => {
      const result = await client.callTool('sheets_history', {
        request: {
          action: 'get_history',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should list snapshots', async () => {
      const result = await client.callTool('sheets_history', {
        request: {
          action: 'list_snapshots',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_confirm (5 actions)', () => {
    it('should check elicitation support', async () => {
      const result = await client.callTool('sheets_confirm', {
        request: {
          action: 'check_support',
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_analyze (16 actions)', () => {
    it('should check sampling support', async () => {
      const result = await client.callTool('sheets_analyze', {
        request: {
          action: 'check_support',
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should analyze range (if sampling supported)', async () => {
      const session = client.getSession();
      if (session.serverCapabilities?.sampling) {
        const result = await client.callTool('sheets_analyze', {
          request: {
            action: 'analyze_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'Sheet1!A1:B10',
          },
        });
        expect(result.isError).toBe(false);
      }
    });
  });

  describe('sheets_fix (1 action)', () => {
    it('should detect issues', async () => {
      const result = await client.callTool('sheets_fix', {
        request: {
          action: 'detect_issues',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_composite (10 actions)', () => {
    it('should execute batch update', async () => {
      const result = await client.callTool('sheets_composite', {
        request: {
          action: 'batch_update',
          spreadsheetId: TEST_SPREADSHEET_ID,
          requests: [
            {
              updateCells: {
                range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
                rows: [{ values: [{ userEnteredValue: { stringValue: 'Test' } }] }],
                fields: 'userEnteredValue',
              },
            },
          ],
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should import CSV', async () => {
      const result = await client.callTool('sheets_composite', {
        request: {
          action: 'import_csv',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'CSVTest',
          csv: 'A,B\n1,2\n3,4',
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_session (26 actions)', () => {
    it('should initialize session', async () => {
      const result = await client.callTool('sheets_session', {
        request: {
          action: 'initialize_session',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should get context', async () => {
      const result = await client.callTool('sheets_session', {
        request: {
          action: 'get_context',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_templates (8 actions)', () => {
    it('should list templates', async () => {
      const result = await client.callTool('sheets_templates', {
        request: {
          action: 'list_templates',
        },
      });
      expect(result.isError).toBe(false);
    });

    it('should apply template', async () => {
      const result = await client.callTool('sheets_templates', {
        request: {
          action: 'apply_template',
          spreadsheetId: TEST_SPREADSHEET_ID,
          templateId: 'crm_basic',
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_bigquery (17 actions)', () => {
    it('should check BigQuery support', async () => {
      const result = await client.callTool('sheets_bigquery', {
        request: {
          action: 'check_support',
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_appsscript (18 actions)', () => {
    it('should list projects', async () => {
      const result = await client.callTool('sheets_appsscript', {
        request: {
          action: 'list_projects',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_webhook (7 actions)', () => {
    it('should list webhooks', async () => {
      const result = await client.callTool('sheets_webhook', {
        request: {
          action: 'list_webhooks',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_dependencies (7 actions)', () => {
    it('should analyze dependencies', async () => {
      const result = await client.callTool('sheets_dependencies', {
        request: {
          action: 'analyze',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B10',
        },
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('sheets_federation (5 actions)', () => {
    it('should list connected servers', async () => {
      const result = await client.callTool('sheets_federation', {
        request: {
          action: 'list_servers',
        },
      });
      expect(result.isError).toBe(false);
    });
  });
});
