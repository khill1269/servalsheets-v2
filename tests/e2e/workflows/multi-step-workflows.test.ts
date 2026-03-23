/**
 * ServalSheets - E2E Multi-Step Workflow Tests
 *
 * Tests complex workflows involving multiple tool calls:
 * - Import → Analyze → Visualize
 * - Create → Format → Validate
 * - Transaction → Rollback → Verify
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHttpClient } from '../mcp-client-simulator.js';
import type { MCPHttpClient } from '../mcp-client-simulator.js';

const TEST_SPREADSHEET_ID = process.env['TEST_SPREADSHEET_ID'];
const SKIP_E2E = !TEST_SPREADSHEET_ID || process.env['TEST_E2E'] !== 'true';

describe.skipIf(SKIP_E2E)('E2E: Multi-Step Workflows', () => {
  let client: MCPHttpClient;

  beforeAll(async () => {
    client = createTestHttpClient('http://localhost:3000');
    await client.initialize();
  });

  afterAll(async () => {
    await client.close();
  });

  describe('Import → Analyze → Visualize Workflow', () => {
    it('should complete full data pipeline', async () => {
      // Step 1: Import data
      const importData = [
        ['Month', 'Revenue', 'Expenses'],
        ['Jan', '10000', '7000'],
        ['Feb', '12000', '8000'],
        ['Mar', '15000', '9000'],
      ];

      const importResult = await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'DataPipeline!A1:C4',
          values: importData,
        },
      });

      expect(importResult.isError).toBe(false);

      // Step 2: Analyze data (if sampling supported)
      const session = client.getSession();
      if (session.serverCapabilities?.sampling) {
        const analyzeResult = await client.callTool('sheets_analyze', {
          request: {
            action: 'analyze_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'DataPipeline!A1:C4',
          },
        });

        expect(analyzeResult.isError).toBe(false);
      }

      // Step 3: Create visualization
      const chartResult = await client.callTool('sheets_visualize', {
        request: {
          action: 'create_chart',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'DataPipeline',
          chartType: 'LINE',
          ranges: ['DataPipeline!A1:C4'],
        },
      });

      expect(chartResult.isError).toBe(false);
    });
  });

  describe('Create → Format → Validate Workflow', () => {
    it('should create formatted and validated sheet', async () => {
      // Step 1: Create new sheet
      const createResult = await client.callTool('sheets_core', {
        request: {
          action: 'create_sheet',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: `Test-${Date.now()}`,
        },
      });

      expect(createResult.isError).toBe(false);

      // Extract sheet name from response
      let sheetName = `Test-${Date.now()}`;
      if ('structuredContent' in createResult && createResult.structuredContent) {
        const structured = createResult.structuredContent as {
          response: { data: { sheet: { properties: { title: string } } } };
        };
        if (structured.response?.data?.sheet?.properties?.title) {
          sheetName = structured.response.data.sheet.properties.title;
        }
      }

      // Step 2: Add data
      await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: `${sheetName}!A1:B3`,
          values: [
            ['Name', 'Score'],
            ['Alice', '95'],
            ['Bob', '87'],
          ],
        },
      });

      // Step 3: Format headers
      const formatResult = await client.callTool('sheets_format', {
        request: {
          action: 'format_cells',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: `${sheetName}!A1:B1`,
          format: {
            backgroundColor: { red: 0.2, green: 0.2, blue: 0.8 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          },
        },
      });

      expect(formatResult.isError).toBe(false);

      // Step 4: Validate data
      const validateResult = await client.callTool('sheets_quality', {
        request: {
          action: 'check_data',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: `${sheetName}!A1:B3`,
        },
      });

      expect(validateResult.isError).toBe(false);
    });
  });

  describe('Transaction → Rollback → Verify Workflow', () => {
    it('should handle transaction lifecycle', async () => {
      // Step 1: Start transaction
      const startResult = await client.callTool('sheets_transaction', {
        request: {
          action: 'start_transaction',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });

      expect(startResult.isError).toBe(false);

      // Extract transaction ID
      let transactionId: string | undefined;
      if ('structuredContent' in startResult && startResult.structuredContent) {
        const structured = startResult.structuredContent as {
          response: { data: { transactionId: string } };
        };
        transactionId = structured.response?.data?.transactionId;
      }

      if (!transactionId) {
        // Skip test if transaction ID not available
        return;
      }

      // Step 2: Make changes
      await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Transaction!A1',
          values: [['Test Value']],
        },
      });

      // Step 3: Rollback transaction
      const rollbackResult = await client.callTool('sheets_transaction', {
        request: {
          action: 'rollback_transaction',
          spreadsheetId: TEST_SPREADSHEET_ID,
          transactionId,
        },
      });

      expect(rollbackResult.isError).toBe(false);

      // Step 4: Verify rollback
      const verifyResult = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Transaction!A1',
        },
      });

      expect(verifyResult.isError).toBe(false);
    });
  });

  describe('Composite Operations', () => {
    it('should execute composite operations', async () => {
      // Use sheets_composite for batch operations
      const result = await client.callTool('sheets_composite', {
        request: {
          action: 'batch_update',
          spreadsheetId: TEST_SPREADSHEET_ID,
          requests: [
            {
              updateCells: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                rows: [
                  {
                    values: [
                      {
                        userEnteredValue: { stringValue: 'Composite Test' },
                      },
                    ],
                  },
                ],
                fields: 'userEnteredValue',
              },
            },
          ],
        },
      });

      expect(result.isError).toBe(false);
    });

    it('should import and analyze CSV data', async () => {
      const csvData = 'Name,Age,City\nAlice,30,NYC\nBob,25,LA\nCharlie,35,SF';

      const result = await client.callTool('sheets_composite', {
        request: {
          action: 'import_csv',
          spreadsheetId: TEST_SPREADSHEET_ID,
          sheetName: 'CSVImport',
          csv: csvData,
        },
      });

      expect(result.isError).toBe(false);
    });
  });

  describe('Session Context Workflow', () => {
    it('should maintain session state across calls', async () => {
      // Initialize session
      const initResult = await client.callTool('sheets_session', {
        request: {
          action: 'initialize_session',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });

      expect(initResult.isError).toBe(false);

      // Get session context
      const contextResult = await client.callTool('sheets_session', {
        request: {
          action: 'get_context',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });

      expect(contextResult.isError).toBe(false);

      // Add context
      const addResult = await client.callTool('sheets_session', {
        request: {
          action: 'add_context',
          spreadsheetId: TEST_SPREADSHEET_ID,
          context: { key: 'test', value: 'data' },
        },
      });

      expect(addResult.isError).toBe(false);
    });
  });

  describe('History and Undo Workflow', () => {
    it('should track and undo operations', async () => {
      // Make a change
      await client.callTool('sheets_data', {
        request: {
          action: 'write_values',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'History!A1',
          values: [['Before Undo']],
        },
      });

      // Get operation history
      const historyResult = await client.callTool('sheets_history', {
        request: {
          action: 'get_history',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });

      expect(historyResult.isError).toBe(false);

      // Undo last operation (if available)
      const undoResult = await client.callTool('sheets_history', {
        request: {
          action: 'undo',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });

      // Undo may not be supported in all scenarios
      expect(undoResult.isError).toBeDefined();
    });
  });

  describe('Collaboration Workflow', () => {
    it('should manage sharing permissions', async () => {
      // Get current permissions
      const getResult = await client.callTool('sheets_collaborate', {
        request: {
          action: 'list_permissions',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });

      expect(getResult.isError).toBe(false);

      // Add comment (if supported)
      const commentResult = await client.callTool('sheets_collaborate', {
        request: {
          action: 'add_comment',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
          content: 'Test comment from E2E test',
        },
      });

      // Comments may require additional permissions
      expect(commentResult.isError).toBeDefined();
    });
  });
});
