/**
 * Live API Tests for sheets_dimensions Tool
 *
 * Tests row and column operations against the real Google Sheets API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet but each test sets up its own data.
 * Note: Dimension operations permanently modify sheet structure, so tests
 * must be designed to not depend on previous test state.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

// Helper to add delay between tests to avoid quota limits
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!runLiveTests)('sheets_dimensions Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('dimensions');

    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  // Add delay between tests to avoid quota limits
  afterEach(async () => {
    await delay(2000);
  });

  // Helper to write test data
  async function writeTestData(range: string, values: string[][]) {
    await client.sheets.spreadsheets.values.update({
      spreadsheetId: testSpreadsheet.id,
      range,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  }

  describe('Row Operations', () => {
    it('should insert rows at the beginning', async () => {
      // Write data starting at row 5 so insert at beginning doesn't affect it
      await writeTestData('TestData!A5:E6', [
        ['ID', 'Name', 'Value', 'Date', 'Status'],
        ['1', 'Item A', '100', '2024-01-01', 'Active'],
      ]);

      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 2 },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);

      // Data should have shifted down by 2 rows
      const verifyResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A7:A8',
      });

      expect(verifyResponse.data.values![0][0]).toBe('ID');
    });

    it('should resize row height', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'ROWS', startIndex: 10, endIndex: 11 },
                properties: { pixelSize: 50 },
                fields: 'pixelSize',
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);

      const verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData'],
        includeGridData: true,
      });

      const rowMetadata = verifyResponse.data.sheets![0].data![0].rowMetadata![10];
      expect(rowMetadata.pixelSize).toBe(50);
    });

    it('should auto-resize rows to fit content', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              autoResizeDimensions: {
                dimensions: { sheetId, dimension: 'ROWS', startIndex: 15, endIndex: 20 },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should hide and unhide rows', async () => {
      // Hide rows
      const hideResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'ROWS', startIndex: 20, endIndex: 23 },
                properties: { hiddenByUser: true },
                fields: 'hiddenByUser',
              },
            },
          ],
        },
      });

      expect(hideResponse.status).toBe(200);

      // Verify hidden
      let verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData'],
        includeGridData: true,
      });

      expect(verifyResponse.data.sheets![0].data![0].rowMetadata![20].hiddenByUser).toBe(true);

      // Unhide rows
      const unhideResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'ROWS', startIndex: 20, endIndex: 23 },
                properties: { hiddenByUser: false },
                fields: 'hiddenByUser',
              },
            },
          ],
        },
      });

      expect(unhideResponse.status).toBe(200);
    });

    it('should move rows to a new position', async () => {
      // Write data to specific rows
      await writeTestData('TestData!A30:B32', [
        ['Row30', 'Data30'],
        ['Row31', 'Data31'],
        ['Row32', 'Data32'],
      ]);

      // Move rows 30-31 to after row 35
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              moveDimension: {
                source: { sheetId, dimension: 'ROWS', startIndex: 29, endIndex: 31 },
                destinationIndex: 35,
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Column Operations', () => {
    it('should resize column width', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 },
                properties: { pixelSize: 200 },
                fields: 'pixelSize',
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);

      const verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData'],
        includeGridData: true,
      });

      const colMetadata = verifyResponse.data.sheets![0].data![0].columnMetadata![10];
      expect(colMetadata.pixelSize).toBe(200);
    });

    it('should auto-resize columns to fit content', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              autoResizeDimensions: {
                dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 12, endIndex: 15 },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should hide specific columns', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 15, endIndex: 17 },
                properties: { hiddenByUser: true },
                fields: 'hiddenByUser',
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Freeze Operations', () => {
    it('should freeze header row', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
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

      expect(response.status).toBe(200);

      const verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
      });

      const gridProps = verifyResponse.data.sheets![0].properties!.gridProperties;
      expect(gridProps!.frozenRowCount).toBe(1);
    });

    it('should freeze first column', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenColumnCount: 1 } },
                fields: 'gridProperties.frozenColumnCount',
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);

      const verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
      });

      const gridProps = verifyResponse.data.sheets![0].properties!.gridProperties;
      expect(gridProps!.frozenColumnCount).toBe(1);
    });

    it('should unfreeze all rows and columns', async () => {
      // First ensure some are frozen
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: { frozenRowCount: 2, frozenColumnCount: 2 },
                },
                fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
              },
            },
          ],
        },
      });

      // Then unfreeze
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 },
                },
                fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Group Operations', () => {
    it('should group and ungroup rows', async () => {
      // Group rows
      const groupResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addDimensionGroup: {
                range: { sheetId, dimension: 'ROWS', startIndex: 40, endIndex: 45 },
              },
            },
          ],
        },
      });

      expect(groupResponse.status).toBe(200);

      // Ungroup rows
      const ungroupResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              deleteDimensionGroup: {
                range: { sheetId, dimension: 'ROWS', startIndex: 40, endIndex: 45 },
              },
            },
          ],
        },
      });

      expect(ungroupResponse.status).toBe(200);
    });
  });

  describe('Batch Dimension Operations', () => {
    it('should perform multiple dimension operations in one request', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'ROWS', startIndex: 50, endIndex: 51 },
                properties: { pixelSize: 40 },
                fields: 'pixelSize',
              },
            },
            {
              autoResizeDimensions: {
                dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 20, endIndex: 22 },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.data.replies).toHaveLength(2);
    });
  });

  describe('Insert and Delete Operations (Isolated)', () => {
    // These tests use a separate sheet to avoid affecting other tests
    let testSheet2Id: number;
    let testSheet2Name: string;

    it('should create test sheet for insert/delete operations', async () => {
      testSheet2Name = `DimensionTest_${Date.now()}`;
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addSheet: { properties: { title: testSheet2Name } },
            },
          ],
        },
      });

      testSheet2Id = response.data.replies![0].addSheet?.properties?.sheetId!;
      expect(testSheet2Id).toBeDefined();
    });

    it('should insert and delete rows', async () => {
      // Write initial data
      await writeTestData(`${testSheet2Name}!A1:C5`, [
        ['ID', 'Name', 'Value'],
        ['1', 'Item1', '100'],
        ['2', 'Item2', '200'],
        ['3', 'Item3', '300'],
        ['4', 'Item4', '400'],
      ]);

      // Insert 2 rows at position 2
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: { sheetId: testSheet2Id, dimension: 'ROWS', startIndex: 2, endIndex: 4 },
                inheritFromBefore: true,
              },
            },
          ],
        },
      });

      // Data should have shifted
      const afterInsert = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: `${testSheet2Name}!A1:A7`,
      });

      expect(afterInsert.data.values![0][0]).toBe('ID');
      expect(afterInsert.data.values![1][0]).toBe('1');
      // Rows 3-4 are inserted (empty or inherited)
      expect(afterInsert.data.values![4][0]).toBe('2');

      // Delete those inserted rows
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: { sheetId: testSheet2Id, dimension: 'ROWS', startIndex: 2, endIndex: 4 },
              },
            },
          ],
        },
      });

      // Data should be back to original positions
      const afterDelete = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: `${testSheet2Name}!A1:A5`,
      });

      expect(afterDelete.data.values!.length).toBe(5);
    });

    it('should insert and delete columns', async () => {
      // Write fresh data
      await writeTestData(`${testSheet2Name}!A1:E2`, [
        ['Col1', 'Col2', 'Col3', 'Col4', 'Col5'],
        ['A', 'B', 'C', 'D', 'E'],
      ]);

      // Insert 2 columns at position 1
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: { sheetId: testSheet2Id, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });

      // Col1 stays at A, Col2 moves to D
      const afterInsert = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: `${testSheet2Name}!A1:G1`,
      });

      expect(afterInsert.data.values![0][0]).toBe('Col1');
      expect(afterInsert.data.values![0][3]).toBe('Col2');

      // Delete the inserted columns
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: { sheetId: testSheet2Id, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 },
              },
            },
          ],
        },
      });

      // Back to original
      const afterDelete = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: `${testSheet2Name}!A1:E1`,
      });

      expect(afterDelete.data.values![0]).toEqual(['Col1', 'Col2', 'Col3', 'Col4', 'Col5']);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid row indices', async () => {
      await expect(
        client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: { sheetId, dimension: 'ROWS', startIndex: 1000000, endIndex: 1000001 },
                },
              },
            ],
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should track batch dimension operations', async () => {
      client.resetMetrics();

      await client.trackOperation('batchUpdate', 'POST', () =>
        client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                updateDimensionProperties: {
                  range: { sheetId, dimension: 'COLUMNS', startIndex: 25, endIndex: 27 },
                  properties: { pixelSize: 100 },
                  fields: 'pixelSize',
                },
              },
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
