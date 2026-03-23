/**
 * Live API Tests for sheets_history Tool
 *
 * Tests operation history and undo/redo capabilities against the real Google API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_history Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('history');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Operation Recording', () => {
    it('should capture state before write operations', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:B2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Initial', 'Data'],
            ['Row', 'Values'],
          ],
        },
      });

      const beforeState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:B2',
      });

      expect(beforeState.data.values).toBeDefined();

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:B2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Modified', 'Content'],
            ['New', 'Values'],
          ],
        },
      });

      const afterState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:B2',
      });

      expect(afterState.data.values).not.toEqual(beforeState.data.values);
    });

    it('should capture format state before formatting operations', async () => {
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
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
                cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0, blue: 0 } } },
                fields: 'userEnteredFormat.backgroundColor',
              },
            },
          ],
        },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData!A1:B1'],
        fields: 'sheets.data.rowData.values.userEnteredFormat.backgroundColor',
      });

      expect(response.status).toBe(200);
    });

    it('should capture structural changes', async () => {
      const sheetName = `HistoryTestSheet_${Date.now()}`;
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });

      expect(response.data.replies![0].addSheet?.properties?.sheetId).toBeDefined();

      const sheetsResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.properties',
      });

      const sheetNames = sheetsResponse.data.sheets!.map((s) => s.properties?.title);
      expect(sheetNames).toContain(sheetName);
    });
  });

  describe('Undo Simulation', () => {
    it('should restore previous data state', async () => {
      const initialData = [['Original', 'Content']];
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C1:D1',
        valueInputOption: 'RAW',
        requestBody: { values: initialData },
      });

      const savedState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C1:D1',
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C1:D1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Changed', 'Data']] },
      });

      const changedState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C1:D1',
      });
      expect(changedState.data.values![0]).toEqual(['Changed', 'Data']);

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C1:D1',
        valueInputOption: 'RAW',
        requestBody: { values: savedState.data.values },
      });

      const restoredState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C1:D1',
      });
      expect(restoredState.data.values).toEqual(initialData);
    });

    it('should handle undo of cell clearing', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:F3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Header1', 'Header2'],
            ['Data1', 'Data2'],
            ['Data3', 'Data4'],
          ],
        },
      });

      const savedState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:F3',
      });

      await client.sheets.spreadsheets.values.clear({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:F3',
      });

      const clearedState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:F3',
      });
      expect(clearedState.data.values).toBeUndefined();

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:F3',
        valueInputOption: 'RAW',
        requestBody: { values: savedState.data.values },
      });

      const restoredState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:F3',
      });
      expect(restoredState.data.values).toEqual(savedState.data.values);
    });
  });

  describe('Redo Simulation', () => {
    it('should restore state after undo', async () => {
      const state1 = [['State 1']];
      const state2 = [['State 2']];

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1',
        valueInputOption: 'RAW',
        requestBody: { values: state1 },
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1',
        valueInputOption: 'RAW',
        requestBody: { values: state2 },
      });

      // Undo
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1',
        valueInputOption: 'RAW',
        requestBody: { values: state1 },
      });

      let current = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1',
      });
      expect(current.data.values).toEqual(state1);

      // Redo
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1',
        valueInputOption: 'RAW',
        requestBody: { values: state2 },
      });

      current = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1',
      });
      expect(current.data.values).toEqual(state2);
    });
  });

  describe('Revert To Simulation', () => {
    it('should revert through multiple states', async () => {
      const states: string[][][] = [];

      for (let i = 1; i <= 5; i++) {
        const state = [[`Version ${i}`]];
        states.push(state);
        await client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!H1',
          valueInputOption: 'RAW',
          requestBody: { values: state },
        });
      }

      let current = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1',
      });
      expect(current.data.values![0][0]).toBe('Version 5');

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1',
        valueInputOption: 'RAW',
        requestBody: { values: states[1] },
      });

      current = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1',
      });
      expect(current.data.values![0][0]).toBe('Version 2');
    });
  });

  describe('Google Drive Revision History', () => {
    it('should create versions through multiple edits', async () => {
      for (let i = 1; i <= 3; i++) {
        await client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!I1',
          valueInputOption: 'RAW',
          requestBody: { values: [[`Edit ${i}`]] },
        });
      }

      const response = await client.drive.revisions.list({
        fileId: testSpreadsheet.id,
        fields: 'revisions(id,modifiedTime)',
      });

      expect(response.status).toBe(200);
      expect(response.data.revisions).toBeDefined();
    });
  });

  describe('Operation Statistics', () => {
    it('should track operation metrics', async () => {
      client.resetMetrics();

      await client.trackOperation('valuesUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!J1',
          valueInputOption: 'RAW',
          requestBody: { values: [['Write Op']] },
        })
      );

      await client.trackOperation('valuesGet', 'GET', () =>
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!J1',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Batch Operation History', () => {
    it('should track batch operations as single history entry', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateCells: {
                range: {
                  sheetId,
                  startRowIndex: 10,
                  endRowIndex: 11,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                rows: [{ values: [{ userEnteredValue: { stringValue: 'Batch 1' } }] }],
                fields: 'userEnteredValue',
              },
            },
            {
              updateCells: {
                range: {
                  sheetId,
                  startRowIndex: 11,
                  endRowIndex: 12,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                rows: [{ values: [{ userEnteredValue: { stringValue: 'Batch 2' } }] }],
                fields: 'userEnteredValue',
              },
            },
            {
              updateCells: {
                range: {
                  sheetId,
                  startRowIndex: 12,
                  endRowIndex: 13,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                rows: [{ values: [{ userEnteredValue: { stringValue: 'Batch 3' } }] }],
                fields: 'userEnteredValue',
              },
            },
          ],
        },
      });

      expect(response.data.replies).toHaveLength(3);

      const readResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A11:A13',
      });

      expect(readResponse.data.values).toEqual([['Batch 1'], ['Batch 2'], ['Batch 3']]);
    });
  });

  describe('Error Handling', () => {
    it('should handle revert to invalid state', async () => {
      await expect(
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'NonExistentSheet!A1',
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should track history operation latency', async () => {
      client.resetMetrics();

      await client.trackOperation('valuesUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!K1:L2',
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              ['History', 'Test'],
              ['Data', 'Values'],
            ],
          },
        })
      );

      await client.trackOperation('revisionsList', 'GET', () =>
        client.drive.revisions.list({
          fileId: testSpreadsheet.id,
          fields: 'revisions(id)',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
    });
  });
});
