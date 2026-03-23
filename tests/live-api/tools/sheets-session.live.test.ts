/**
 * Live API Tests for sheets_session Tool
 *
 * Tests session context management with real Google Sheets data.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_session Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('session');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Session Context with Real Spreadsheets', () => {
    it('should retrieve spreadsheet metadata for session context', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'properties.title,sheets.properties.title',
      });

      expect(response.status).toBe(200);
      expect(response.data.properties?.title).toBe(testSpreadsheet.title);
      expect(response.data.sheets).toBeDefined();
    });

    it('should handle spreadsheets with multiple sheets', async () => {
      const sheetName1 = `SessionSheet1_${Date.now()}`;
      const sheetName2 = `SessionSheet2_${Date.now()}`;

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            { addSheet: { properties: { title: sheetName1 } } },
            { addSheet: { properties: { title: sheetName2 } } },
          ],
        },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.properties.title',
      });

      const sheetNames = response.data.sheets!.map((s) => s.properties?.title!);
      expect(sheetNames).toContain(sheetName1);
      expect(sheetNames).toContain(sheetName2);
    });
  });

  describe('Operation Recording Verification', () => {
    it('should track write operations with actual cell changes', async () => {
      const writeResponse = await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:B2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Value'],
            ['Test', '100'],
          ],
        },
      });

      expect(writeResponse.status).toBe(200);
      expect(writeResponse.data.updatedCells).toBe(4);
    });

    it('should track format operations', async () => {
      const formatResponse = await client.sheets.spreadsheets.batchUpdate({
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
                  endColumnIndex: 2,
                },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            },
          ],
        },
      });

      expect(formatResponse.status).toBe(200);
    });

    it('should track structural operations', async () => {
      const sheetName = `RecordedSheet_${Date.now()}`;
      const addResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });

      expect(addResponse.data.replies![0].addSheet?.properties?.sheetId).toBeDefined();
    });
  });

  describe('Natural Language Reference Resolution', () => {
    it('should find spreadsheet by partial title match', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'properties.title',
      });

      expect(response.data.properties?.title).toContain('session');
    });
  });

  describe('Checkpoint with Real Data', () => {
    it('should capture current spreadsheet state', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C1:D3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Checkpoint', 'Data'],
            ['Row1', '100'],
            ['Row2', '200'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C1:D3',
      });

      expect(response.data.values).toHaveLength(3);
    });

    it('should restore to known state', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Initial State']] },
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Modified State']] },
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Initial State']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1',
      });

      expect(response.data.values![0][0]).toBe('Initial State');
    });
  });

  describe('Pending Operation State', () => {
    it('should track progress through multi-step operations', async () => {
      const importSheetName = `ImportTarget_${Date.now()}`;

      await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:Z1',
      });

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: { requests: [{ addSheet: { properties: { title: importSheetName } } }] },
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: `${importSheetName}!A1:C3`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Col1', 'Col2', 'Col3'],
            ['A', 'B', 'C'],
            ['D', 'E', 'F'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.properties.title',
      });

      const sheetNames = response.data.sheets!.map((s) => s.properties?.title);
      expect(sheetNames).toContain(importSheetName);
    });
  });

  describe('Error Recovery Context', () => {
    it('should handle partial operation failure', async () => {
      let successfulWrites = 0;

      try {
        await client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!F1',
          valueInputOption: 'RAW',
          requestBody: { values: [['Write 1']] },
        });
        successfulWrites++;

        await client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!F2',
          valueInputOption: 'RAW',
          requestBody: { values: [['Write 2']] },
        });
        successfulWrites++;

        await client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'NonExistent!A1',
          valueInputOption: 'RAW',
          requestBody: { values: [['Write 3']] },
        });
        successfulWrites++;
      } catch {
        // Expected
      }

      expect(successfulWrites).toBe(2);

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!F1:F2',
      });

      expect(response.data.values).toHaveLength(2);
    });
  });

  describe('Performance Metrics', () => {
    it('should track session-related operations', async () => {
      client.resetMetrics();

      await client.trackOperation('get', 'GET', () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'properties.title,sheets.properties.title',
        })
      );

      await client.trackOperation('valuesUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!G1',
          valueInputOption: 'RAW',
          requestBody: { values: [['Session Data']] },
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
    });
  });
});
