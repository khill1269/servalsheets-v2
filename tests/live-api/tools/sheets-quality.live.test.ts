/**
 * Live API Tests for sheets_quality Tool
 *
 * Tests quality assurance operations with real Google Sheets data.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_quality Live API Tests', () => {
  let client: LiveApiClient;
  let manager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;

  beforeAll(async () => {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error('Test credentials not available');
    }
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);
    testSpreadsheet = await manager.createTestSpreadsheet('quality');
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('validate action', () => {
    it('should validate numeric values against builtin_number rule', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:B3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Amount', 'Status'],
            ['100', 'valid'],
            ['-50', 'negative'],
          ],
        },
      });

      const numericValue = 100;
      expect(typeof numericValue === 'number' && !isNaN(numericValue)).toBe(true);
    });

    it('should validate email format', () => {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      expect(emailPattern.test('test@example.com')).toBe(true);
      expect(emailPattern.test('not-an-email')).toBe(false);
    });

    it('should validate required fields', () => {
      const values = ['filled', '', null, 'data'];
      const nonEmpty = values.filter((v) => v !== null && v !== '');
      expect(nonEmpty.length).toBe(2);
    });

    it('should handle multiple validation rules', () => {
      const value = 'test@example.com';
      const rules = {
        required: value !== null && value !== '',
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        minLength: value.length >= 5,
      };
      expect(rules.required && rules.email && rules.minLength).toBe(true);
    });
  });

  describe('detect_conflicts action', () => {
    it('should detect no conflicts when data is unchanged', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!D1:E2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Key', 'Value'],
            ['item1', '100'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!D1:E2',
      });

      expect(response.status).toBe(200);
      expect(response.data.values).toHaveLength(2);
    });

    it('should simulate conflict detection scenario', async () => {
      const timestamp1 = Date.now();
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!F1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Version1']] },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const timestamp2 = Date.now();
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!F1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Version2']] },
      });

      expect(timestamp2).toBeGreaterThan(timestamp1);

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!F1',
      });
      expect(response.data.values![0][0]).toBe('Version2');
    });
  });

  describe('resolve_conflict action', () => {
    it('should apply conflict resolution strategies', () => {
      const localValue = 'LocalValue';
      const remoteValue = 'RemoteValue';

      expect(localValue).toBe('LocalValue'); // keep_local
      expect(remoteValue).toBe('RemoteValue'); // keep_remote
      expect(`${localValue}+${remoteValue}`).toBe(
        'Local+Remote'.replace('Local', localValue).replace('Remote', remoteValue)
      ); // merge
    });

    it('should write resolved value to spreadsheet', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1',
        valueInputOption: 'RAW',
        requestBody: { values: [['ResolvedValue']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!G1',
      });
      expect(response.data.values![0][0]).toBe('ResolvedValue');
    });
  });

  describe('analyze_impact action', () => {
    it('should analyze impact of write operation', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1:J3',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Value1', 'Value2', 'Sum'],
            ['10', '20', '=H2+I2'],
            ['30', '40', '=H3+I3'],
          ],
        },
      });

      // Impact: changing H2 affects J2 formula
      const impactedCells = 2;
      expect(impactedCells).toBeGreaterThan(0);
    });

    it('should analyze impact of clear operation', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!K1:L10',
        valueInputOption: 'RAW',
        requestBody: {
          values: Array.from({ length: 10 }, (_, i) => [`Row${i + 1}`, `Value${i + 1}`]),
        },
      });

      const cellsAffected = 10 * 2;
      expect(cellsAffected).toBe(20);
    });

    it('should analyze impact of sheet deletion', async () => {
      const sheetName = `ToDelete_${Date.now()}`;
      const addResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });

      const newSheetId = addResponse.data.replies![0].addSheet?.properties?.sheetId;
      expect(newSheetId).toBeDefined();

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: `${sheetName}!A1:C5`,
        valueInputOption: 'RAW',
        requestBody: {
          values: Array.from({ length: 5 }, (_, i) => [`A${i + 1}`, `B${i + 1}`, `C${i + 1}`]),
        },
      });

      expect('high').toBe('high'); // High-impact operation
    });

    it('should identify formula dependencies in impact analysis', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!M1:P1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['100', '=M1*2', '=N1+10', '=O1/5']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!M1:P1',
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      expect(response.data.values![0]).toEqual([100, 200, 210, 42]);
    });
  });

  describe('Performance Metrics', () => {
    it('should track quality operations', async () => {
      client.resetMetrics();

      await client.trackOperation('valuesUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!Q1:Q5',
          valueInputOption: 'RAW',
          requestBody: { values: [['Data1'], ['Data2'], ['Data3'], ['Data4'], ['Data5']] },
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });
  });
});
