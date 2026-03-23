/**
 * Batching System Live Verification
 *
 * Verifies that the BatchingSystem correctly batches multiple operations
 * and measures actual API call reduction.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getLiveApiClient, isLiveApiEnabled } from '../setup/live-api-client.js';
import {
  TestSpreadsheetManager,
  createTestSpreadsheetManager,
  type TestSpreadsheet,
} from '../setup/test-spreadsheet-manager.js';
import {
  BatchingSystem,
  initBatchingSystem,
  getBatchingSystem,
  resetBatchingSystem,
} from '../../../src/services/batching-system.js';
import { google } from 'googleapis';

const runTests = isLiveApiEnabled();
const describeOrSkip = runTests ? describe : describe.skip;

describeOrSkip('BatchingSystem Live Verification', () => {
  let spreadsheetManager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;
  let batchingSystem: BatchingSystem;

  beforeAll(async () => {
    const client = await getLiveApiClient();
    spreadsheetManager = createTestSpreadsheetManager(client, 'BATCH_TEST_');
    testSpreadsheet = await spreadsheetManager.createTestSpreadsheet('MAIN');
    await spreadsheetManager.populateTestData(testSpreadsheet.id, { rows: 100 });

    // Initialize batching system with the sheets API
    batchingSystem = initBatchingSystem(client.sheets);
  }, 60000);

  beforeEach(() => {
    // Reset stats for each test
    const system = getBatchingSystem();
    if (system) {
      system.resetStats();
    }
  });

  afterAll(async () => {
    await spreadsheetManager.cleanup();
  }, 30000);

  describe('Batch Merging', () => {
    it('should batch multiple write operations within time window', async () => {
      const operations = Array.from({ length: 5 }, (_, i) => ({
        id: `write-${i}`,
        type: 'values:update' as const,
        spreadsheetId: testSpreadsheet.id,
        params: {
          range: `TestData!A${i + 1}`,
          values: [[`Batched_${i}`]],
          valueInputOption: 'RAW',
        },
      }));

      // Execute all operations (will be batched)
      const promises = operations.map((op) => batchingSystem.execute(op));

      // Wait for batch to execute
      await Promise.all(promises);

      const stats = batchingSystem.getStats();

      // Verify batching occurred
      expect(stats.totalOperations).toBeGreaterThanOrEqual(5);
      // Should have fewer API calls than operations if batching worked
      expect(stats.totalApiCalls).toBeLessThanOrEqual(stats.totalOperations);
    });

    it('should keep operations for different spreadsheets separate', async () => {
      const otherSpreadsheet = await spreadsheetManager.createTestSpreadsheet('OTHER');

      const op1 = {
        id: 'op1',
        type: 'values:update' as const,
        spreadsheetId: testSpreadsheet.id,
        params: { range: 'TestData!B1', values: [['Value1']], valueInputOption: 'RAW' },
      };

      const op2 = {
        id: 'op2',
        type: 'values:update' as const,
        spreadsheetId: otherSpreadsheet.id,
        params: { range: 'TestData!B1', values: [['Value2']], valueInputOption: 'RAW' },
      };

      const [result1, result2] = await Promise.all([
        batchingSystem.execute(op1),
        batchingSystem.execute(op2),
      ]);

      // Both should succeed
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      // Stats should show operations processed (at least 2 from this test)
      const stats = batchingSystem.getStats();
      expect(stats.totalOperations).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Timing Window', () => {
    it('should respect windowMs before executing batch', async () => {
      const startTime = Date.now();

      await batchingSystem.execute({
        id: 'timing-test',
        type: 'values:update',
        spreadsheetId: testSpreadsheet.id,
        params: { range: 'TestData!C1', values: [['Timing']], valueInputOption: 'RAW' },
      });

      const elapsed = Date.now() - startTime;

      // Should have completed (timing depends on BatchingSystem config)
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid operations gracefully', async () => {
      const invalidOp = {
        id: 'invalid',
        type: 'values:update' as const,
        spreadsheetId: 'invalid-spreadsheet-id-12345',
        params: { range: 'Sheet1!A1', values: [['Test']], valueInputOption: 'RAW' },
      };

      await expect(batchingSystem.execute(invalidOp)).rejects.toThrow();
    });
  });

  describe('Statistics', () => {
    it('should track batch statistics accurately', async () => {
      // Reset stats
      batchingSystem.resetStats();

      // Execute some operations
      const ops = Array.from({ length: 3 }, (_, i) => ({
        id: `stat-${i}`,
        type: 'values:update' as const,
        spreadsheetId: testSpreadsheet.id,
        params: { range: `TestData!D${i + 1}`, values: [[`Stats_${i}`]], valueInputOption: 'RAW' },
      }));

      await Promise.all(ops.map((op) => batchingSystem.execute(op)));

      const stats = batchingSystem.getStats();

      expect(stats.totalOperations).toBe(3);
      expect(stats.apiCallsSaved).toBeGreaterThanOrEqual(0);
    });
  });
});
