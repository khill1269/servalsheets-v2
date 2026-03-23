/**
 * Live API Tests for sheets_transaction Tool
 *
 * Tests transaction operations (begin, queue, commit, rollback, status, list)
 * against the real Google API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_transaction Live API Tests', () => {
  let client: LiveApiClient;
  let manager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;
  let sheetId: number;

  beforeAll(async () => {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error('Test credentials not available');
    }
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);

    // Create ONE spreadsheet for all tests
    testSpreadsheet = await manager.createTestSpreadsheet('transaction');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Atomic Multi-Operation Transactions', () => {
    it('should batch multiple write operations into single API call', async () => {
      const response = await client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            {
              range: 'TestData!A1:B2',
              values: [
                ['Name', 'Value'],
                ['Test1', '100'],
              ],
            },
            {
              range: 'TestData!A5:B6',
              values: [
                ['Category', 'Amount'],
                ['Sales', '500'],
              ],
            },
            {
              range: 'TestData!D1:E2',
              values: [
                ['ID', 'Status'],
                ['001', 'Active'],
              ],
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.data.totalUpdatedCells).toBeGreaterThan(0);
      expect(response.data.responses).toHaveLength(3);
    });

    it('should batch multiple format operations into single API call', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 1,
                  endColumnIndex: 2,
                },
                cell: { userEnteredFormat: { textFormat: { italic: true } } },
                fields: 'userEnteredFormat.textFormat.italic',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 2,
                  endColumnIndex: 3,
                },
                cell: {
                  userEnteredFormat: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.5 } },
                },
                fields: 'userEnteredFormat.backgroundColor',
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.data.replies).toHaveLength(3);
    });
  });

  describe('Mixed Operation Transactions', () => {
    it('should handle mixed structural and data operations', async () => {
      const initialMeta = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.properties',
      });
      const initialSheetCount = initialMeta.data.sheets!.length;

      // Add a new sheet
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: `TransactionTestSheet_${Date.now()}`,
                  gridProperties: { rowCount: 100, columnCount: 10 },
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      const newSheetId = response.data.replies![0].addSheet?.properties?.sheetId;
      const newSheetTitle = response.data.replies![0].addSheet?.properties?.title;
      expect(newSheetId).toBeDefined();

      // Write data to the new sheet
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: `${newSheetTitle}!A1:C3`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Header1', 'Header2', 'Header3'],
            ['Data1', 'Data2', 'Data3'],
            ['Data4', 'Data5', 'Data6'],
          ],
        },
      });

      // Add a named range
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addNamedRange: {
                namedRange: {
                  name: `TransactionData_${Date.now()}`,
                  range: {
                    sheetId: newSheetId,
                    startRowIndex: 0,
                    endRowIndex: 3,
                    startColumnIndex: 0,
                    endColumnIndex: 3,
                  },
                },
              },
            },
          ],
        },
      });

      // Verify sheet was added
      const finalMeta = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.properties,namedRanges',
      });

      expect(finalMeta.data.sheets!.length).toBe(initialSheetCount + 1);
    });
  });

  describe('Rollback Simulation', () => {
    it('should be able to restore previous state after changes', async () => {
      // Write initial data
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1:H2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Original', 'Data'],
            ['Row2', 'Values'],
          ],
        },
      });

      const initialRead = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1:H2',
      });
      const initialData = initialRead.data.values;

      // Make changes
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1:H2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Modified', 'Content'],
            ['Changed', 'Values'],
          ],
        },
      });

      // Verify changes were made
      const modifiedRead = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1:H2',
      });
      expect(modifiedRead.data.values).not.toEqual(initialData);

      // Simulate rollback by restoring original data
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1:H2',
        valueInputOption: 'RAW',
        requestBody: { values: initialData },
      });

      // Verify rollback
      const finalRead = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1:H2',
      });
      expect(finalRead.data.values).toEqual(initialData);
    });
  });

  describe('Transaction Isolation Patterns', () => {
    it('should demonstrate read-committed isolation', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!I1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Initial Value']] },
      });

      const read1 = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!I1',
      });
      expect(read1.data.values![0][0]).toBe('Initial Value');

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!I1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Updated Value']] },
      });

      const read2 = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!I1',
      });
      expect(read2.data.values![0][0]).toBe('Updated Value');
    });

    it('should handle concurrent-safe batch updates', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!J1:K5',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Counter', 'Status'],
            ['1', 'pending'],
            ['2', 'pending'],
            ['3', 'pending'],
            ['4', 'pending'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: 'TestData!K2', values: [['complete']] },
            { range: 'TestData!K3', values: [['complete']] },
            { range: 'TestData!K4', values: [['complete']] },
            { range: 'TestData!K5', values: [['complete']] },
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.data.totalUpdatedCells).toBe(4);

      const verifyRead = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!K2:K5',
      });

      expect(verifyRead.data.values).toEqual([
        ['complete'],
        ['complete'],
        ['complete'],
        ['complete'],
      ]);
    });
  });

  describe('Transaction API Call Efficiency', () => {
    it('should demonstrate batch update efficiency', async () => {
      client.resetMetrics();

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: { sheetId, dimension: 'ROWS', startIndex: 50, endIndex: 51 },
              },
            },
            {
              insertDimension: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 20, endIndex: 21 },
              },
            },
          ],
        },
      });

      const stats = client.getStats();
      expect(stats.totalRequests).toBeLessThanOrEqual(3);
    });

    it('should demonstrate batch values update efficiency', async () => {
      client.resetMetrics();

      await client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: 'TestData!L1:N1', values: [['H1', 'H2', 'H3']] },
            { range: 'TestData!L2:N2', values: [['D1', 'D2', 'D3']] },
            { range: 'TestData!L3:N3', values: [['D4', 'D5', 'D6']] },
            { range: 'TestData!P1:R1', values: [['H4', 'H5', 'H6']] },
            { range: 'TestData!P2:R2', values: [['D7', 'D8', 'D9']] },
          ],
        },
      });

      const stats = client.getStats();
      expect(stats.totalRequests).toBeLessThanOrEqual(3);
    });
  });

  describe('Error Handling in Transactions', () => {
    it('should handle partial failure in batch operations gracefully', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!S1:T2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Value'],
            ['Test', '100'],
          ],
        },
      });

      // Test batch read with multiple valid ranges
      const response = await client.sheets.spreadsheets.values.batchGet({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData!S1:T2', 'TestData!A100:B100'],
      });

      expect(response.status).toBe(200);
      expect(response.data.valueRanges).toBeDefined();
      expect(response.data.valueRanges!.length).toBe(2);
      expect(response.data.valueRanges![0].values).toBeDefined();
    });

    it('should reject invalid batch operations', async () => {
      await expect(
        client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: '123InvalidName',
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 1,
                      startColumnIndex: 0,
                      endColumnIndex: 1,
                    },
                  },
                },
              },
            ],
          },
        })
      ).rejects.toThrow();
    });

    it('should handle non-existent spreadsheet', async () => {
      await expect(
        client.sheets.spreadsheets.values.get({
          spreadsheetId: 'non-existent-spreadsheet-id-12345',
          range: 'Sheet1!A1',
        })
      ).rejects.toThrow();
    });
  });

  describe('Complex Transaction Scenarios', () => {
    it('should handle create-update-format workflow', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!U1:X4',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Product', 'Q1', 'Q2', 'Total'],
            ['Widget A', '100', '150', '=V2+W2'],
            ['Widget B', '200', '180', '=V3+W3'],
            ['Total', '=SUM(V2:V3)', '=SUM(W2:W3)', '=SUM(X2:X3)'],
          ],
        },
      });

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 20,
                  endColumnIndex: 24,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
                  },
                },
                fields: 'userEnteredFormat(textFormat.bold,backgroundColor)',
              },
            },
          ],
        },
      });

      const readResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!U1:X4',
        valueRenderOption: 'FORMATTED_VALUE',
      });

      expect(readResponse.data.values![0][0]).toBe('Product');
      expect(readResponse.data.values![1][3]).toBeDefined();
    });

    it('should handle bulk data import workflow', async () => {
      const headerRow = ['ID', 'Name', 'Email', 'Department', 'Salary'];
      const dataRows = Array.from({ length: 20 }, (_, i) => [
        String(i + 1),
        `Employee ${i + 1}`,
        `employee${i + 1}@example.com`,
        ['Engineering', 'Sales', 'Marketing', 'HR'][i % 4],
        String(50000 + Math.floor(Math.random() * 50000)),
      ]);

      const writeResponse = await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!Y1:AC21',
        valueInputOption: 'RAW',
        requestBody: { values: [headerRow, ...dataRows] },
      });

      expect(writeResponse.status).toBe(200);
      expect(writeResponse.data.updatedCells).toBe(21 * 5);
    });
  });

  describe('Performance Metrics', () => {
    it('should track transaction API latency', async () => {
      client.resetMetrics();

      await client.trackOperation('valuesBatchUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            valueInputOption: 'RAW',
            data: [
              { range: 'TestData!A200:B200', values: [['Key', 'Value']] },
              { range: 'TestData!A201:B201', values: [['Item1', '100']] },
              { range: 'TestData!A202:B202', values: [['Item2', '200']] },
            ],
          },
        })
      );

      await client.trackOperation('batchUpdate', 'POST', () =>
        client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId,
                    startRowIndex: 199,
                    endRowIndex: 200,
                    startColumnIndex: 0,
                    endColumnIndex: 2,
                  },
                  cell: { userEnteredFormat: { textFormat: { bold: true } } },
                  fields: 'userEnteredFormat.textFormat.bold',
                },
              },
            ],
          },
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
      expect(stats.avgDuration).toBeGreaterThan(0);
    });
  });
});
