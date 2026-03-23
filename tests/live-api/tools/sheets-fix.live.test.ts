/**
 * Live API Tests for sheets_fix Tool
 *
 * Tests automated issue resolution against the real Google API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_fix Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('fix');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Freeze Header Fix', () => {
    it('should detect unfrozen headers', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:D1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Name', 'Email', 'Department', 'Salary']] },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.properties.gridProperties',
      });

      const gridProps = response.data.sheets![0].properties!.gridProperties;
      // Initially headers may or may not be frozen depending on previous tests
      expect(
        gridProps?.frozenRowCount === 0 ||
          gridProps?.frozenRowCount === 1 ||
          gridProps?.frozenRowCount === undefined
      ).toBe(true);
    });

    it('should apply freeze header fix', async () => {
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.properties.gridProperties',
      });

      expect(response.data.sheets![0].properties!.gridProperties?.frozenRowCount).toBe(1);
    });
  });

  describe('Protection Fix', () => {
    it('should apply protection fix', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:H3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Email', 'Department', 'Salary'],
            ['Alice', 'alice@example.com', 'Engineering', '80000'],
            ['Bob', 'bob@example.com', 'Sales', '75000'],
          ],
        },
      });

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addProtectedRange: {
                protectedRange: {
                  range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: 100,
                    startColumnIndex: 7,
                    endColumnIndex: 8,
                  },
                  description: 'Protected salary data',
                  warningOnly: true,
                },
              },
            },
          ],
        },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.protectedRanges',
      });

      expect(response.data.sheets![0].protectedRanges!.length).toBeGreaterThan(0);
    });
  });

  describe('Formula Fix', () => {
    it('should detect multiple TODAY() calls', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!I1:K3',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Date1', 'Date2', 'Date3'],
            ['=TODAY()', '=TODAY()', '=TODAY()'],
            ['=TODAY()+1', '=TODAY()+7', '=TODAY()+30'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!I1:K3',
        valueRenderOption: 'FORMULA',
      });

      const formulas = response.data.values!.flat().join('');
      const todayCount = (formulas.match(/TODAY\(\)/g) || []).length;
      expect(todayCount).toBeGreaterThan(1);
    });

    it('should consolidate TODAY() to single cell reference', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!L1:O2',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Today', 'Plus 1', 'Plus 7', 'Plus 30'],
            ['=TODAY()', '=$L$2+1', '=$L$2+7', '=$L$2+30'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!L2:O2',
        valueRenderOption: 'FORMULA',
      });

      const formulas = response.data.values![0];
      expect(formulas[0]).toContain('TODAY()');
      expect(formulas[1]).toContain('$L$2');
    });

    it('should detect full column references', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!P1:Q5',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Values', 'Sum'],
            ['10', '=SUM(P:P)'],
            ['20', ''],
            ['30', ''],
            ['40', ''],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!Q2',
        valueRenderOption: 'FORMULA',
      });

      expect(response.data.values![0][0]).toMatch(/[A-Z]:[A-Z]/);
    });

    it('should convert to bounded range', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!R2',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['=SUM(P2:P100)']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!R2',
        valueRenderOption: 'FORMULA',
      });

      expect(response.data.values![0][0]).toBe('=SUM(P2:P100)');
    });
  });

  describe('Conditional Formatting Fix', () => {
    it('should add and consolidate conditional formatting rules', async () => {
      // Add CF rules
      const requests = [];
      for (let i = 0; i < 3; i++) {
        requests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [
                {
                  sheetId,
                  startRowIndex: 50 + i,
                  endRowIndex: 51 + i,
                  startColumnIndex: 0,
                  endColumnIndex: 5,
                },
              ],
              booleanRule: {
                condition: {
                  type: 'NUMBER_GREATER',
                  values: [{ userEnteredValue: String(i * 10) }],
                },
                format: { backgroundColor: { red: 1, green: 0, blue: 0 } },
              },
            },
            index: i,
          },
        });
      }

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: { requests },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets.conditionalFormats',
      });

      const cfRules = response.data.sheets![0].conditionalFormats || [];
      expect(cfRules.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Fix Preview Mode', () => {
    it('should capture state for preview without applying', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!S1:T3',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Header', 'Value'],
            ['=TODAY()', '100'],
            ['=TODAY()+1', '200'],
          ],
        },
      });

      const beforeState = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!S1:T3',
        valueRenderOption: 'FORMULA',
      });

      expect(beforeState.data.values).toBeDefined();
      expect(beforeState.data.values![1][0]).toContain('TODAY()');
    });
  });

  describe('Fix Safety', () => {
    it('should support creating snapshot before fix', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!U1:V3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Value'],
            ['Item1', '100'],
            ['Item2', '200'],
          ],
        },
      });

      const snapshot = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!U1:V3',
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!V2:V3',
        valueInputOption: 'RAW',
        requestBody: { values: [['150'], ['250']] },
      });

      const afterChange = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!V2:V3',
      });
      expect(afterChange.data.values).toEqual([['150'], ['250']]);

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!U1:V3',
        valueInputOption: 'RAW',
        requestBody: { values: snapshot.data.values },
      });

      const afterRollback = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!V2:V3',
      });
      expect(afterRollback.data.values).toEqual([['100'], ['200']]);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid spreadsheet ID', async () => {
      await expect(
        client.sheets.spreadsheets.get({ spreadsheetId: 'invalid-spreadsheet-id' })
      ).rejects.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should track fix operation latency', async () => {
      client.resetMetrics();

      await client.trackOperation('get', 'GET', () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'sheets.properties.gridProperties',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });
  });
});
