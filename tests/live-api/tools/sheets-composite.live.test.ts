/**
 * Live API Tests for sheets_composite Tool
 *
 * Tests composite/bulk operations against the real Google API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

// Helper to add delay between tests to avoid quota limits
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!runLiveTests)('sheets_composite Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('composite');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('CSV Import Operations', () => {
    it('should import CSV data with headers', async () => {
      const csvData =
        'Name,Email,Department\nAlice,alice@example.com,Engineering\nBob,bob@example.com,Sales';
      const rows = csvData.split('\n').map((row) => row.split(','));

      const response = await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1',
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });

      expect(response.status).toBe(200);
      expect(response.data.updatedRows).toBe(3);
    });

    it('should handle different delimiters', async () => {
      const tsvData = 'Name\tEmail\tDepartment\nAlice\talice@example.com\tEngineering';
      const rows = tsvData.split('\n').map((row) => row.split('\t'));

      const response = await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1',
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });

      expect(response.status).toBe(200);
    });

    it('should import to new sheet', async () => {
      const sheetName = `CSVImport_${Date.now()}`;
      const addResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });

      const newSheetId = addResponse.data.replies![0].addSheet?.properties?.sheetId;
      expect(newSheetId).toBeDefined();

      const csvData = [
        ['ID', 'Product', 'Price'],
        ['1', 'Widget', '10.99'],
        ['2', 'Gadget', '24.99'],
      ];
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: csvData },
      });

      const readResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: `${sheetName}!A1:C3`,
      });

      expect(readResponse.data.values).toHaveLength(3);
    });
  });

  describe('Smart Append Operations', () => {
    it('should append data matching existing headers', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!I1:K2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Department', 'Salary'],
            ['Alice', 'Engineering', '80000'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.append({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!I:K',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [['Bob', 'Sales', '75000']] },
      });

      expect(response.status).toBe(200);
      expect(response.data.updates?.updatedRows).toBe(1);
    });
  });

  describe('Bulk Update Operations', () => {
    it('should update rows by matching key column', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!M1:O4',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['ID', 'Name', 'Status'],
            ['001', 'Alice', 'pending'],
            ['002', 'Bob', 'pending'],
            ['003', 'Carol', 'pending'],
          ],
        },
      });

      await client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: 'TestData!O2', values: [['complete']] },
            { range: 'TestData!O4', values: [['complete']] },
          ],
        },
      });

      const readResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!M1:O4',
      });

      expect(readResponse.data.values![1][2]).toBe('complete');
      expect(readResponse.data.values![2][2]).toBe('pending');
      expect(readResponse.data.values![3][2]).toBe('complete');
    });
  });

  describe('Deduplication Operations', () => {
    it('should detect duplicate rows', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!Q1:R6',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['ID', 'Value'],
            ['A001', '100'],
            ['A002', '200'],
            ['A001', '150'],
            ['A003', '300'],
            ['A002', '250'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!Q2:Q6',
      });

      const ids = response.data.values!.flat();
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      expect(duplicates).toContain('A001');
      expect(duplicates).toContain('A002');
    });
  });

  describe('Export Operations', () => {
    it('should export spreadsheet as downloadable file', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!S1:U3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Department', 'Salary'],
            ['Alice', 'Engineering', '80000'],
            ['Bob', 'Sales', '75000'],
          ],
        },
      });

      const response = await client.drive.files.export(
        {
          fileId: testSpreadsheet.id,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        {
          responseType: 'arraybuffer',
        }
      );

      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
    });
  });

  describe('Sheet Setup Operations', () => {
    it('should create sheet with headers and formatting', async () => {
      const sheetName = `SetupTest_${Date.now()}`;
      const addResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: sheetName, gridProperties: { rowCount: 100, columnCount: 5 } },
              },
            },
          ],
        },
      });

      const newSheetId = addResponse.data.replies![0].addSheet?.properties?.sheetId!;

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: `${sheetName}!A1:E1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['ID', 'Name', 'Email', 'Department', 'Start Date']] },
      });

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: newSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 5,
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
            {
              updateSheetProperties: {
                properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        },
      });

      const metaResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets(properties)',
      });

      const setupSheet = metaResponse.data.sheets!.find((s) => s.properties?.title === sheetName);
      expect(setupSheet?.properties?.gridProperties?.frozenRowCount).toBe(1);
    });
  });

  describe('Clone Structure Operations', () => {
    it('should copy sheet structure without data', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!W1:Z5',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Email', 'Department', 'Salary'],
            ['Alice', 'alice@example.com', 'Engineering', '80000'],
            ['Bob', 'bob@example.com', 'Sales', '75000'],
            ['Carol', 'carol@example.com', 'Marketing', '70000'],
            ['Dave', 'dave@example.com', 'Engineering', '85000'],
          ],
        },
      });

      const clonedName = `ClonedStructure_${Date.now()}`;
      const duplicateResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [{ duplicateSheet: { sourceSheetId: sheetId, newSheetName: clonedName } }],
        },
      });

      expect(duplicateResponse.data.replies![0].duplicateSheet?.properties?.sheetId).toBeDefined();

      await client.sheets.spreadsheets.values.clear({
        spreadsheetId: testSpreadsheet.id,
        range: `${clonedName}!A2:Z100`,
      });

      const headerResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: `${clonedName}!W1:Z1`,
      });

      expect(headerResponse.data.values![0]).toEqual(['Name', 'Email', 'Department', 'Salary']);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty CSV data', async () => {
      const response = await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!Y1',
        valueInputOption: 'RAW',
        requestBody: { values: [] },
      });

      expect(response.status).toBe(200);
    });

    it('should handle non-existent sheet', async () => {
      await expect(
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'NonExistentSheet!A1',
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should track composite operation latency', async () => {
      client.resetMetrics();

      await client.trackOperation('valuesUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!W1:Y3',
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              ['Name', 'Email', 'Department'],
              ['Alice', 'alice@example.com', 'Engineering'],
              ['Bob', 'bob@example.com', 'Sales'],
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
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 22,
                    endColumnIndex: 25,
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
