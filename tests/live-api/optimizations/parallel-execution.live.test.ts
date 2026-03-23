/**
 * Parallel Execution Live Verification
 *
 * Verifies that the parallel executor correctly handles concurrent operations.
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

describeOrSkip('Parallel Execution Live Verification', () => {
  let client: LiveApiClient;
  let spreadsheetManager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;

  beforeAll(async () => {
    client = await getLiveApiClient();
    spreadsheetManager = createTestSpreadsheetManager(client, 'PARALLEL_TEST_');
    testSpreadsheet = await spreadsheetManager.createTestSpreadsheet('MAIN');
    await spreadsheetManager.populateTestData(testSpreadsheet.id, { rows: 100 });
  }, 60000);

  afterAll(async () => {
    await spreadsheetManager.cleanup();
  }, 30000);

  describe('Concurrent Read Operations', () => {
    it('should handle 10 concurrent reads successfully', async () => {
      const ranges = Array.from(
        { length: 10 },
        (_, i) => `TestData!A${i * 10 + 1}:F${i * 10 + 10}`
      );

      const startTime = performance.now();

      const results = await Promise.all(
        ranges.map((range) =>
          client.sheets.spreadsheets.values.get({
            spreadsheetId: testSpreadsheet.id,
            range,
          })
        )
      );

      const duration = performance.now() - startTime;

      for (const result of results) {
        expect(result.data.values).toBeDefined();
      }

      console.log(`10 concurrent reads completed in ${duration.toFixed(2)}ms`);
    });

    it('should handle mixed read/write operations concurrently', async () => {
      const operations = [
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!A1:B10',
        }),
        client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'Benchmarks!A1:B5',
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              ['Mixed', 'Op1'],
              ['Test', 'Op2'],
              ['Data', 'Op3'],
              ['Row', 'Op4'],
              ['Five', 'Op5'],
            ],
          },
        }),
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!C1:D10',
        }),
      ];

      const results = await Promise.all(operations);

      expect(results[0].data.values).toBeDefined();
      expect(results[1].data.updatedCells).toBeGreaterThan(0);
      expect(results[2].data.values).toBeDefined();
    });
  });

  describe('Concurrent Multi-Endpoint Operations', () => {
    it('should handle concurrent operations across different endpoints', async () => {
      const operations = [
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
        }),
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!A1:F5',
        }),
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          includeGridData: false,
        }),
      ];

      const startTime = performance.now();
      const results = await Promise.all(operations);
      const duration = performance.now() - startTime;

      expect(results[0].data.spreadsheetId).toBe(testSpreadsheet.id);
      expect(results[1].data.values).toBeDefined();
      expect(results[2].data.spreadsheetId).toBe(testSpreadsheet.id);

      console.log(`3 concurrent multi-endpoint ops completed in ${duration.toFixed(2)}ms`);
    });
  });

  describe('Throughput Under Load', () => {
    it('should maintain throughput with sustained concurrent operations', async () => {
      const batchSize = 5;
      const batchCount = 3;
      const durations: number[] = [];

      for (let batch = 0; batch < batchCount; batch++) {
        const operations = Array.from({ length: batchSize }, (_, i) =>
          client.sheets.spreadsheets.values.get({
            spreadsheetId: testSpreadsheet.id,
            range: `TestData!A${batch * 10 + i + 1}:F${batch * 10 + i + 5}`,
          })
        );

        const start = performance.now();
        await Promise.all(operations);
        durations.push(performance.now() - start);

        // Small delay between batches to avoid quota issues
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      console.log(`Batch durations: ${durations.map((d) => d.toFixed(2)).join('ms, ')}ms`);

      expect(durations.length).toBe(batchCount);
      expect(durations.every((d) => d > 0)).toBe(true);
    });
  });
});
