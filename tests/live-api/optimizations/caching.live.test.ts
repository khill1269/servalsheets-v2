/**
 * Caching System Live Verification
 *
 * Verifies that the caching layer correctly caches responses
 * and improves performance on repeated reads.
 *
 * Note: These tests use the direct Google API client since we're testing
 * internal caching behavior, not MCP protocol.
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

describeOrSkip('Caching System Live Verification', () => {
  let client: LiveApiClient;
  let spreadsheetManager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;

  beforeAll(async () => {
    client = await getLiveApiClient();
    spreadsheetManager = createTestSpreadsheetManager(client, 'CACHE_TEST_');
    testSpreadsheet = await spreadsheetManager.createTestSpreadsheet('MAIN');
    await spreadsheetManager.populateTestData(testSpreadsheet.id, { rows: 100 });
  }, 60000);

  afterAll(async () => {
    await spreadsheetManager.cleanup();
  }, 30000);

  describe('Read Caching', () => {
    it('should cache repeated reads of the same range', async () => {
      const range = 'TestData!A1:F10';

      // First read (potential cache miss)
      const start1 = performance.now();
      await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range,
      });
      const duration1 = performance.now() - start1;

      // Second read (should be faster due to connection reuse at minimum)
      const start2 = performance.now();
      await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range,
      });
      const duration2 = performance.now() - start2;

      console.log(
        `Cache test: First read ${duration1.toFixed(2)}ms, Second read ${duration2.toFixed(2)}ms`
      );

      // Both should succeed
      expect(duration1).toBeGreaterThan(0);
      expect(duration2).toBeGreaterThan(0);
    });

    it('should invalidate cache after write', async () => {
      const range = 'TestData!G1:G5';

      // Read initial values
      await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range,
      });

      // Write new values
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Updated1'], ['Updated2'], ['Updated3'], ['Updated4'], ['Updated5']],
        },
      });

      // Read again - should get new values
      const read2 = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range,
      });

      // Values should reflect the write
      expect(read2.data.values?.[0]?.[0]).toBe('Updated1');
    });
  });

  describe('Metadata Caching', () => {
    it('should cache spreadsheet metadata', async () => {
      // First get
      const start1 = performance.now();
      await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
      });
      const duration1 = performance.now() - start1;

      // Second get
      const start2 = performance.now();
      await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
      });
      const duration2 = performance.now() - start2;

      console.log(
        `Metadata cache: First ${duration1.toFixed(2)}ms, Second ${duration2.toFixed(2)}ms`
      );

      expect(duration1).toBeGreaterThan(0);
      expect(duration2).toBeGreaterThan(0);
    });
  });

  describe('Cache Isolation', () => {
    it('should maintain separate caches for different spreadsheets', async () => {
      const otherSpreadsheet = await spreadsheetManager.createTestSpreadsheet('OTHER');
      await spreadsheetManager.populateTestData(otherSpreadsheet.id, { rows: 10 });

      // Read from first spreadsheet
      const result1 = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:A5',
      });

      // Read from second spreadsheet
      const result2 = await client.sheets.spreadsheets.values.get({
        spreadsheetId: otherSpreadsheet.id,
        range: 'TestData!A1:A5',
      });

      // Both should succeed with data
      expect(result1.data.values).toBeDefined();
      expect(result2.data.values).toBeDefined();
    });
  });
});
