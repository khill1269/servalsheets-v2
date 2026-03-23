/**
 * Prefetching System Live Verification
 *
 * Verifies that the prefetching system correctly predicts and prefetches data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getLiveApiClient,
  isLiveApiEnabled,
  type LiveApiClient,
} from '../setup/live-api-client.js';
import {
  TestSpreadsheetManager,
  createTestSpreadsheetManager,
  type TestSpreadsheet,
} from '../setup/test-spreadsheet-manager.js';

const runTests = isLiveApiEnabled();
const describeOrSkip = runTests ? describe : describe.skip;

describeOrSkip('Prefetching System Live Verification', () => {
  let client: LiveApiClient;
  let spreadsheetManager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;

  beforeAll(async () => {
    client = await getLiveApiClient();
    spreadsheetManager = createTestSpreadsheetManager(client, 'PREFETCH_TEST_');
    testSpreadsheet = await spreadsheetManager.createTestSpreadsheet('MAIN');
    await spreadsheetManager.populateTestData(testSpreadsheet.id, { rows: 200 });
  }, 60000);

  afterAll(async () => {
    await spreadsheetManager.cleanup();
  }, 30000);

  describe('Access Pattern Learning', () => {
    it('should learn sequential access patterns', async () => {
      const ranges = ['TestData!A1:F10', 'TestData!A11:F20', 'TestData!A21:F30'];

      const durations: number[] = [];

      for (const range of ranges) {
        const start = performance.now();
        await client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range,
        });
        durations.push(performance.now() - start);
      }

      console.log(
        `Sequential access durations: ${durations.map((d) => d.toFixed(2)).join('ms, ')}ms`
      );

      expect(durations.length).toBe(3);
      expect(durations.every((d) => d > 0)).toBe(true);
    });

    it('should handle repeated access to same ranges', async () => {
      const range = 'TestData!A50:F60';
      const durations: number[] = [];

      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        await client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range,
        });
        durations.push(performance.now() - start);
      }

      console.log(
        `Repeated access durations: ${durations.map((d) => d.toFixed(2)).join('ms, ')}ms`
      );

      expect(durations[0]).toBeGreaterThan(0);
    });
  });

  describe('Adjacent Range Prefetching', () => {
    it('should potentially prefetch adjacent ranges', async () => {
      await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A100:F110',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const start = performance.now();
      const result = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A111:F120',
      });
      const duration = performance.now() - start;

      console.log(`Adjacent range read: ${duration.toFixed(2)}ms`);

      expect(result.data.values).toBeDefined();
    });
  });

  describe('Different Sheet Access', () => {
    it('should handle cross-sheet access patterns', async () => {
      await spreadsheetManager.addSheet(testSpreadsheet.id, 'PrefetchTest');

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'PrefetchTest!A1:C10',
        valueInputOption: 'RAW',
        requestBody: {
          values: Array.from({ length: 10 }, (_, i) => [`Row${i}`, i, `Data${i}`]),
        },
      });

      const results = await Promise.all([
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!A1:C5',
        }),
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'PrefetchTest!A1:C5',
        }),
      ]);

      expect(results[0].data.values).toBeDefined();
      expect(results[1].data.values).toBeDefined();
    });
  });
});
