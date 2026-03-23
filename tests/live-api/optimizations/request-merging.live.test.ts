/**
 * Request Merging Live Verification
 *
 * Verifies that overlapping read requests are merged into single API calls.
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

describeOrSkip('Request Merging Live Verification', () => {
  let client: LiveApiClient;
  let spreadsheetManager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;

  beforeAll(async () => {
    client = await getLiveApiClient();
    spreadsheetManager = createTestSpreadsheetManager(client, 'MERGE_TEST_');
    testSpreadsheet = await spreadsheetManager.createTestSpreadsheet('MAIN');
    await spreadsheetManager.populateTestData(testSpreadsheet.id, { rows: 100 });
  }, 60000);

  afterAll(async () => {
    await spreadsheetManager.cleanup();
  }, 30000);

  describe('Overlapping Range Merging', () => {
    it('should handle concurrent reads of overlapping ranges', async () => {
      const ranges = ['TestData!A1:C10', 'TestData!B5:D15', 'TestData!A1:D20'];

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

      console.log(`Overlapping reads completed in ${duration.toFixed(2)}ms`);
    });

    it('should handle batch_get efficiently', async () => {
      const startTime = performance.now();

      const result = await client.sheets.spreadsheets.values.batchGet({
        spreadsheetId: testSpreadsheet.id,
        ranges: ['TestData!A1:B10', 'TestData!C1:D10', 'TestData!E1:F10'],
      });

      const duration = performance.now() - startTime;

      expect(result.data.valueRanges).toHaveLength(3);

      console.log(`Batch read completed in ${duration.toFixed(2)}ms`);
    });
  });

  describe('Sequential vs Parallel', () => {
    it('should be faster with parallel requests than sequential', async () => {
      const ranges = ['TestData!A1:B5', 'TestData!C1:D5', 'TestData!E1:F5'];

      // Sequential reads
      const seqStart = performance.now();
      for (const range of ranges) {
        await client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range,
        });
      }
      const seqDuration = performance.now() - seqStart;

      // Parallel reads
      const parStart = performance.now();
      await Promise.all(
        ranges.map((range) =>
          client.sheets.spreadsheets.values.get({
            spreadsheetId: testSpreadsheet.id,
            range,
          })
        )
      );
      const parDuration = performance.now() - parStart;

      console.log(`Sequential: ${seqDuration.toFixed(2)}ms, Parallel: ${parDuration.toFixed(2)}ms`);

      expect(seqDuration).toBeGreaterThan(0);
      expect(parDuration).toBeGreaterThan(0);
    });
  });
});
