/**
 * Live API Tests for sheets_data Tool
 *
 * Tests data read/write operations against the real Google Sheets API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single test spreadsheet with unique row ranges per test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_data Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('data');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Read Operations', () => {
    it('should read cell values from a range', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:C3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Age', 'City'],
            ['Alice', 30, 'NYC'],
            ['Bob', 25, 'LA'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:C3',
      });

      expect(response.status).toBe(200);
      expect(response.data.values![0]).toEqual(['Name', 'Age', 'City']);
    });

    it('should read with different value render options', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:F2',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['10', '20'],
            ['=E1+F1', '=SUM(E1:F1)'],
          ],
        },
      });

      const formattedResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E2:F2',
        valueRenderOption: 'FORMATTED_VALUE',
      });
      expect(formattedResponse.data.values![0][0]).toBe('30');

      const formulaResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E2:F2',
        valueRenderOption: 'FORMULA',
      });
      expect(formulaResponse.data.values![0][0]).toBe('=E1+F1');
    });

    it('should handle empty cells gracefully', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1:J3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['H1', '', 'J1'],
            ['', 'I2', ''],
            ['H3', '', 'J3'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1:J3',
      });

      expect(response.data.values![0][0]).toBe('H1');
      expect(response.data.values![0][1]).toBe('');
      expect(response.data.values![1][1]).toBe('I2');
    });

    it('should read multiple ranges in a single request', async () => {
      await client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: 'TestData!L1:L3', values: [['L1'], ['L2'], ['L3']] },
            { range: 'TestData!N1:N3', values: [['N1'], ['N2'], ['N3']] },
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.batchGet({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData!L1:L3', 'TestData!N1:N3'],
      });

      expect(response.data.valueRanges).toHaveLength(2);
      expect(response.data.valueRanges![0].values).toEqual([['L1'], ['L2'], ['L3']]);
    });
  });

  describe('Write Operations', () => {
    it('should write values to a range', async () => {
      const response = await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!P1:Q2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Hello', 'World'],
            ['Foo', 'Bar'],
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.data.updatedCells).toBe(4);
    });

    it('should handle USER_ENTERED input option', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!S1:S2',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['100'], ['=S1*2']] },
      });

      const verifyResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!S2',
        valueRenderOption: 'FORMATTED_VALUE',
      });

      expect(verifyResponse.data.values![0][0]).toBe('200');
    });

    it('should append values after existing data', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!U1:V2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Header1', 'Header2'],
            ['Row1', 'Data1'],
          ],
        },
      });

      const appendResponse = await client.sheets.spreadsheets.values.append({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!U:V',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [
            ['Row2', 'Data2'],
            ['Row3', 'Data3'],
          ],
        },
      });

      expect(appendResponse.data.updates?.updatedRows).toBe(2);

      const verifyResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!U1:V4',
      });
      expect(verifyResponse.data.values).toHaveLength(4);
    });

    it('should write to multiple ranges in a single request', async () => {
      const response = await client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: 'TestData!A10:A12', values: [['X1'], ['X2'], ['X3']] },
            { range: 'TestData!B10:B12', values: [['Y1'], ['Y2'], ['Y3']] },
            { range: 'TestData!C10:C12', values: [['Z1'], ['Z2'], ['Z3']] },
          ],
        },
      });

      expect(response.data.totalUpdatedCells).toBe(9);
    });

    it('should clear values from a range', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A20:B21',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Data1', 'Data2'],
            ['Data3', 'Data4'],
          ],
        },
      });

      const clearResponse = await client.sheets.spreadsheets.values.clear({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A20:B21',
      });

      expect(clearResponse.status).toBe(200);

      const verifyResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A20:B21',
      });
      expect(verifyResponse.data.values ?? []).toEqual([]);
    });
  });

  describe('Search Operations', () => {
    it('should find cells matching a pattern', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A30:C32',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['apple', 'banana', 'cherry'],
            ['apricot', 'blueberry', 'apple pie'],
            ['avocado', 'apple sauce', 'cranberry'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A30:C32',
      });

      const matches: Array<{ value: string }> = [];
      response.data.values!.forEach((row) => {
        row.forEach((cell: string) => {
          if (cell.includes('apple')) matches.push({ value: cell });
        });
      });

      expect(matches.length).toBe(3);
    });
  });

  describe('Cell Metadata Operations', () => {
    it('should add a note to a cell', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A40',
        valueInputOption: 'RAW',
        requestBody: { values: [['Cell with note']] },
      });

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateCells: {
                rows: [{ values: [{ note: 'This is a test note' }] }],
                fields: 'note',
                start: { sheetId, rowIndex: 39, columnIndex: 0 },
              },
            },
          ],
        },
      });

      const verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData!A40'],
        includeGridData: true,
      });

      const cellNote = verifyResponse.data.sheets![0].data![0].rowData![0].values![0].note;
      expect(cellNote).toBe('This is a test note');
    });

    it('should add a hyperlink to a cell', async () => {
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateCells: {
                rows: [
                  {
                    values: [
                      {
                        userEnteredValue: {
                          formulaValue: '=HYPERLINK("https://example.com", "Click here")',
                        },
                      },
                    ],
                  },
                ],
                fields: 'userEnteredValue',
                start: { sheetId, rowIndex: 44, columnIndex: 0 },
              },
            },
          ],
        },
      });

      const verifyResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A45',
        valueRenderOption: 'FORMULA',
      });

      expect(verifyResponse.data.values![0][0]).toContain('HYPERLINK');
    });
  });

  describe('Merge Operations', () => {
    it('should merge and unmerge cells', async () => {
      // Merge
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              mergeCells: {
                range: {
                  sheetId,
                  startRowIndex: 50,
                  endRowIndex: 52,
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
                mergeType: 'MERGE_ALL',
              },
            },
          ],
        },
      });

      const verifyMerge = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        includeGridData: false,
      });
      expect(verifyMerge.data.sheets![0].merges).toBeDefined();

      // Unmerge
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              unmergeCells: {
                range: {
                  sheetId,
                  startRowIndex: 50,
                  endRowIndex: 52,
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
              },
            },
          ],
        },
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid range format', async () => {
      await expect(
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'InvalidRange!!!',
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should track batch operation efficiency', async () => {
      client.resetMetrics();

      await client.trackOperation('valuesBatchUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            valueInputOption: 'RAW',
            data: [
              { range: 'TestData!A60:A69', values: Array(10).fill(['A']) },
              { range: 'TestData!B60:B69', values: Array(10).fill(['B']) },
              { range: 'TestData!C60:C69', values: Array(10).fill(['C']) },
            ],
          },
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.avgDuration).toBeGreaterThan(0);
    });
  });
});
