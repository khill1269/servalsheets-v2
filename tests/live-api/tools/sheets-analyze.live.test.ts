/**
 * Live API Tests for sheets_analyze Tool
 *
 * Tests analysis operations against the real Google API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet, no beforeEach data clearing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_analyze Live API Tests', () => {
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

    testSpreadsheet = await manager.createTestSpreadsheet('analyze');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;

    // Pre-seed all data once
    await client.sheets.spreadsheets.values.update({
      spreadsheetId: testSpreadsheet.id,
      range: 'TestData!A1:E10',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['Name', 'Department', 'Sales', 'Quarter', 'Year'],
          ['Alice', 'Engineering', '15000', 'Q1', '2024'],
          ['Bob', 'Sales', '22000', 'Q1', '2024'],
          ['Carol', 'Engineering', '18000', 'Q2', '2024'],
          ['David', 'Marketing', '12000', 'Q2', '2024'],
          ['Eve', 'Sales', '28000', 'Q3', '2024'],
          ['Frank', 'Engineering', '21000', 'Q3', '2024'],
          ['Grace', 'Marketing', '16000', 'Q4', '2024'],
          ['Henry', 'Sales', '25000', 'Q4', '2024'],
          ['Ivy', 'Engineering', '19000', 'Q4', '2024'],
        ],
      },
    });
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Structure Analysis', () => {
    it('should get spreadsheet metadata', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'properties,sheets.properties,namedRanges',
      });

      expect(response.status).toBe(200);
      expect(response.data.properties?.title).toBeDefined();
      expect(response.data.sheets!.length).toBeGreaterThan(0);
    });

    it('should detect sheet structure', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets(properties,data.rowData.values.userEnteredValue)',
      });

      expect(response.status).toBe(200);
      expect(response.data.sheets![0].properties).toBeDefined();
    });
  });

  describe('Data Quality Analysis', () => {
    it('should detect data types in columns', async () => {
      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:E10',
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      expect(response.data.values!.length).toBe(10);
      expect(response.data.values![0]).toContain('Name');
      expect(response.data.values![0]).toContain('Sales');
    });

    it('should detect missing values', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1:K4',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Department', 'Sales', 'Quarter', 'Year'],
            ['John', '', '10000', 'Q1', '2024'],
            ['Jane', 'Sales', '', 'Q2', '2024'],
            ['', 'Marketing', '15000', 'Q3', ''],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1:K4',
      });

      expect(response.data.values![1][1]).toBe('');
      expect(response.data.values![2][2]).toBe('');
    });

    it('should detect duplicates', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!M1:N5',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['ID', 'Value'],
            ['A001', '100'],
            ['A002', '200'],
            ['A001', '150'],
            ['A003', '300'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!M1:N5',
      });

      const ids = response.data.values!.slice(1).map((row) => row[0]);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      expect(duplicates).toContain('A001');
    });
  });

  describe('Statistical Analysis', () => {
    it('should compute basic statistics', async () => {
      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!C2:C10',
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const values = response.data.values!.flat().map(Number);
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;

      expect(sum).toBeGreaterThan(0);
      expect(avg).toBeGreaterThan(0);
    });

    it('should analyze data distribution', async () => {
      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!B2:B10',
      });

      const departments = response.data.values!.flat();
      const distribution: Record<string, number> = {};
      departments.forEach((dept) => {
        distribution[dept] = (distribution[dept] || 0) + 1;
      });

      expect(Object.keys(distribution).length).toBeGreaterThan(1);
    });
  });

  describe('Pattern Detection', () => {
    it('should detect trends in time series data', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'Benchmarks!A1:B13',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Month', 'Revenue'],
            ['Jan', '10000'],
            ['Feb', '11500'],
            ['Mar', '12000'],
            ['Apr', '13500'],
            ['May', '14000'],
            ['Jun', '15500'],
            ['Jul', '16000'],
            ['Aug', '17500'],
            ['Sep', '18000'],
            ['Oct', '19500'],
            ['Nov', '20000'],
            ['Dec', '21500'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'Benchmarks!B2:B13',
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const values = response.data.values!.flat().map(Number);
      let isUpwardTrend = true;
      for (let i = 1; i < values.length; i++) {
        if (values[i] < values[i - 1]) {
          isUpwardTrend = false;
          break;
        }
      }
      expect(isUpwardTrend).toBe(true);
    });

    it('should detect outliers', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'Formulas!A1:B10',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['ID', 'Value'],
            ['1', '100'],
            ['2', '105'],
            ['3', '98'],
            ['4', '102'],
            ['5', '500'],
            ['6', '99'],
            ['7', '103'],
            ['8', '97'],
            ['9', '101'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'Formulas!B2:B10',
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const values = response.data.values!.flat().map(Number);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance =
        values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);
      const outliers = values.filter((v) => Math.abs(v - mean) > 2 * stdDev);
      expect(outliers).toContain(500);
    });
  });

  describe('Formula Analysis', () => {
    it('should detect formulas in a range', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'Formulas!D1:E5',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Sum', 'Average'],
            ['=SUM(B2:B10)', '=AVERAGE(B2:B10)'],
            ['=MAX(B2:B10)', '=MIN(B2:B10)'],
            ['=COUNT(B2:B10)', '=COUNTA(B2:B10)'],
            ['=MEDIAN(B2:B10)', '=STDEV(B2:B10)'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'Formulas!D2:E5',
        valueRenderOption: 'FORMULA',
      });

      const formulas = response.data.values!.flat();
      expect(formulas.some((f) => f.includes('SUM'))).toBe(true);
      expect(formulas.some((f) => f.includes('AVERAGE'))).toBe(true);
    });

    it('should detect formula errors', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'Formulas!G1:G3',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Error Tests'], ['=1/0'], ['=SQRT(-1)']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'Formulas!G2:G3',
        valueRenderOption: 'FORMATTED_VALUE',
      });

      const values = response.data.values!.flat();
      expect(values.some((v) => v.includes('#'))).toBe(true);
    });
  });

  describe('Visualization Suggestions', () => {
    it('should identify suitable chart types for categorical data', async () => {
      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:E10',
      });

      const headers = response.data.values![0];
      expect(headers).toContain('Department');
      expect(headers).toContain('Sales');
      expect(headers).toContain('Quarter');
    });
  });

  describe('Scout (Quick Metadata Scan)', () => {
    it('should quickly retrieve spreadsheet metadata', async () => {
      const startTime = Date.now();
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'properties,sheets.properties',
      });
      const duration = Date.now() - startTime;

      expect(response.data.properties?.title).toBeDefined();
      expect(duration).toBeLessThan(5000);
    });

    it('should get sheet-level statistics', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'sheets(properties(sheetId,title,gridProperties))',
      });

      response.data.sheets!.forEach((sheet) => {
        expect(sheet.properties?.sheetId).toBeDefined();
        expect(sheet.properties?.title).toBeDefined();
      });
    });
  });

  describe('Comprehensive Analysis', () => {
    it('should retrieve complete spreadsheet data for analysis', async () => {
      const dataResponse = await client.sheets.spreadsheets.values.batchGet({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData!A1:E10', 'Benchmarks!A1:B13', 'Formulas!A1:G10'],
      });

      expect(dataResponse.data.valueRanges!.length).toBeGreaterThan(0);
    });

    it('should get both metadata and data in single operation', async () => {
      const metaResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'properties,sheets.properties,namedRanges',
      });

      const dataResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:E10',
      });

      expect(metaResponse.data.sheets).toBeDefined();
      expect(dataResponse.data.values).toBeDefined();
    });
  });

  describe('Large Dataset Handling', () => {
    it('should handle sampling for large datasets', async () => {
      const largeData = [['ID', 'Value', 'Category']];
      for (let i = 1; i <= 100; i++) {
        largeData.push([
          String(i),
          String(Math.floor(Math.random() * 1000)),
          ['A', 'B', 'C'][i % 3],
        ]);
      }

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'Benchmarks!D1:F101',
        valueInputOption: 'RAW',
        requestBody: { values: largeData },
      });

      const sampleResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'Benchmarks!D1:F20',
      });

      expect(sampleResponse.data.values!.length).toBe(20);
    });
  });

  describe('Performance Metrics', () => {
    it('should track analysis API latency', async () => {
      client.resetMetrics();

      await client.trackOperation('get', 'GET', () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'properties,sheets.properties',
        })
      );

      await client.trackOperation('valuesGet', 'GET', () =>
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!A1:E10',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid range gracefully', async () => {
      await expect(
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'NonExistentSheet!A1:Z100',
        })
      ).rejects.toThrow();
    });

    it('should handle non-existent spreadsheet', async () => {
      await expect(
        client.sheets.spreadsheets.get({
          spreadsheetId: 'non-existent-spreadsheet-id',
        })
      ).rejects.toThrow();
    });
  });
});
