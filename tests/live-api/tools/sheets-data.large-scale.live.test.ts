/**
 * ServalSheets - Large Scale Data Tests
 *
 * Performance validation tests for large datasets.
 * Tests operations on 1000+ rows and verifies quota management.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  getLiveApiClient,
  getQuotaManager,
  applyQuotaDelay,
  generateLargeTemplate,
  generateTestId,
  generateTestData,
  columnLetter,
  standardAfterEach,
  formatDuration,
  formatBytes,
} from '../setup/index.js';
import { shouldRunIntegrationTests } from '../../helpers/credential-loader.js';
import type { LiveApiClient } from '../setup/live-api-client.js';

/**
 * Skip all tests if integration tests are not enabled
 */
const skipTests = !shouldRunIntegrationTests();

/**
 * Configuration for large scale tests
 */
const LARGE_SCALE_CONFIG = {
  // Row counts for different test sizes
  SMALL: 100,
  MEDIUM: 500,
  LARGE: 1000,
  EXTRA_LARGE: 5000,

  // Column counts
  NARROW: 5,
  WIDE: 26,
  EXTRA_WIDE: 52,

  // Timeouts (ms)
  SMALL_TIMEOUT: 30000,
  MEDIUM_TIMEOUT: 60000,
  LARGE_TIMEOUT: 120000,
  EXTRA_LARGE_TIMEOUT: 300000,
};

describe.skipIf(skipTests)('Large Scale Data Tests', () => {
  let client: LiveApiClient;
  let testSpreadsheetId: string | null = null;

  beforeAll(async () => {
    client = await getLiveApiClient();
  });

  afterEach(async () => {
    await standardAfterEach();
  });

  afterAll(async () => {
    if (testSpreadsheetId) {
      try {
        await client.deleteSpreadsheet(testSpreadsheetId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Write Performance', () => {
    it(
      'should write 100 rows efficiently',
      async () => {
        const testId = generateTestId('write100');
        const rows = LARGE_SCALE_CONFIG.SMALL;
        const cols = LARGE_SCALE_CONFIG.NARROW;

        const createResult = await client.createSpreadsheet(`LargeWrite_100_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        const data = generateTestData(rows, cols);
        const startTime = Date.now();

        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          data
        );

        const duration = Date.now() - startTime;
        console.log(`Write 100 rows (${rows * cols} cells): ${formatDuration(duration)}`);

        await applyQuotaDelay();

        // Verify row count
        const result = await client.readData(testSpreadsheetId, 'Sheet1!A:A');
        expect(result.values.length).toBe(rows);
      },
      LARGE_SCALE_CONFIG.SMALL_TIMEOUT
    );

    it(
      'should write 500 rows with acceptable performance',
      async () => {
        const testId = generateTestId('write500');
        const rows = LARGE_SCALE_CONFIG.MEDIUM;
        const cols = LARGE_SCALE_CONFIG.NARROW;

        const createResult = await client.createSpreadsheet(`LargeWrite_500_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        const data = generateTestData(rows, cols);
        const startTime = Date.now();

        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          data
        );

        const duration = Date.now() - startTime;
        console.log(`Write 500 rows (${rows * cols} cells): ${formatDuration(duration)}`);

        await applyQuotaDelay();

        // Verify row count
        const result = await client.readData(testSpreadsheetId, 'Sheet1!A:A');
        expect(result.values.length).toBe(rows);
      },
      LARGE_SCALE_CONFIG.MEDIUM_TIMEOUT
    );

    it(
      'should write 1000 rows',
      async () => {
        const testId = generateTestId('write1000');
        const rows = LARGE_SCALE_CONFIG.LARGE;
        const cols = LARGE_SCALE_CONFIG.NARROW;

        const createResult = await client.createSpreadsheet(`LargeWrite_1000_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        const data = generateTestData(rows, cols);
        const startTime = Date.now();

        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          data
        );

        const duration = Date.now() - startTime;
        console.log(`Write 1000 rows (${rows * cols} cells): ${formatDuration(duration)}`);

        await applyQuotaDelay();

        // Verify row count
        const result = await client.readData(testSpreadsheetId, 'Sheet1!A:A');
        expect(result.values.length).toBe(rows);
      },
      LARGE_SCALE_CONFIG.LARGE_TIMEOUT
    );
  });

  describe('Read Performance', () => {
    it(
      'should read 1000 rows efficiently',
      async () => {
        const testId = generateTestId('read1000');
        const rows = LARGE_SCALE_CONFIG.LARGE;
        const cols = LARGE_SCALE_CONFIG.NARROW;

        const createResult = await client.createSpreadsheet(`LargeRead_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Write data first
        const data = generateTestData(rows, cols);
        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          data
        );

        await applyQuotaDelay();

        // Time the read operation
        const startTime = Date.now();
        const result = await client.readData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`
        );
        const duration = Date.now() - startTime;

        console.log(`Read 1000 rows (${rows * cols} cells): ${formatDuration(duration)}`);

        expect(result.values.length).toBe(rows);
        expect(result.values[0].length).toBe(cols);
      },
      LARGE_SCALE_CONFIG.LARGE_TIMEOUT
    );

    it(
      'should handle wide data (26 columns)',
      async () => {
        const testId = generateTestId('wide');
        const rows = LARGE_SCALE_CONFIG.SMALL;
        const cols = LARGE_SCALE_CONFIG.WIDE;

        const createResult = await client.createSpreadsheet(`WideData_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        const data = generateTestData(rows, cols);
        const startTime = Date.now();

        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          data
        );

        const writeTime = Date.now() - startTime;
        console.log(`Write ${rows}x${cols} (${rows * cols} cells): ${formatDuration(writeTime)}`);

        await applyQuotaDelay();

        const readStart = Date.now();
        const result = await client.readData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`
        );
        const readTime = Date.now() - readStart;

        console.log(`Read ${rows}x${cols}: ${formatDuration(readTime)}`);

        expect(result.values.length).toBe(rows);
        expect(result.values[0].length).toBe(cols);
      },
      LARGE_SCALE_CONFIG.MEDIUM_TIMEOUT
    );
  });

  describe('Batch Operations', () => {
    it(
      'should handle batch write of 1000 rows in chunks',
      async () => {
        const testId = generateTestId('batch');
        const totalRows = LARGE_SCALE_CONFIG.LARGE;
        const cols = LARGE_SCALE_CONFIG.NARROW;
        const chunkSize = 200;

        const createResult = await client.createSpreadsheet(`BatchWrite_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        const startTime = Date.now();

        // Write in chunks
        for (let offset = 0; offset < totalRows; offset += chunkSize) {
          const rowsToWrite = Math.min(chunkSize, totalRows - offset);
          const data = generateTestData(rowsToWrite, cols);

          await client.writeData(
            testSpreadsheetId,
            `Sheet1!A${offset + 1}:${columnLetter(cols - 1)}${offset + rowsToWrite}`,
            data
          );

          await applyQuotaDelay();
        }

        const duration = Date.now() - startTime;
        console.log(
          `Batch write ${totalRows} rows in ${chunkSize}-row chunks: ${formatDuration(duration)}`
        );

        // Verify total row count
        const result = await client.readData(testSpreadsheetId, 'Sheet1!A:A');
        expect(result.values.length).toBe(totalRows);
      },
      LARGE_SCALE_CONFIG.LARGE_TIMEOUT
    );

    it(
      'should handle batch read of multiple ranges',
      async () => {
        const testId = generateTestId('batchread');
        const rows = LARGE_SCALE_CONFIG.MEDIUM;
        const cols = LARGE_SCALE_CONFIG.NARROW;

        const createResult = await client.createSpreadsheet(`BatchRead_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Write data
        const data = generateTestData(rows, cols);
        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          data
        );

        await applyQuotaDelay();

        // Batch read multiple ranges
        const ranges = [
          'Sheet1!A1:E100',
          'Sheet1!A101:E200',
          'Sheet1!A201:E300',
          'Sheet1!A301:E400',
          'Sheet1!A401:E500',
        ];

        const startTime = Date.now();
        const result = await client.batchReadData(testSpreadsheetId, ranges);
        const duration = Date.now() - startTime;

        console.log(`Batch read ${ranges.length} ranges: ${formatDuration(duration)}`);

        expect(result.valueRanges.length).toBe(ranges.length);
        expect(result.valueRanges[0].values.length).toBe(100);
      },
      LARGE_SCALE_CONFIG.MEDIUM_TIMEOUT
    );
  });

  describe('Row Operations', () => {
    it(
      'should delete multiple rows efficiently',
      async () => {
        const testId = generateTestId('delete');
        const rows = LARGE_SCALE_CONFIG.MEDIUM;
        const cols = LARGE_SCALE_CONFIG.NARROW;

        const createResult = await client.createSpreadsheet(`DeleteRows_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Write initial data
        const data = generateTestData(rows, cols);
        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          data
        );

        await applyQuotaDelay();

        // Get sheet ID
        const metadata = await client.getSpreadsheet(testSpreadsheetId);
        const sheetId = metadata.sheets?.[0]?.properties?.sheetId ?? 0;

        await applyQuotaDelay();

        // Delete 100 rows from the middle
        const startTime = Date.now();
        await client.deleteRows(testSpreadsheetId, sheetId, 200, 300);
        const duration = Date.now() - startTime;

        console.log(`Delete 100 rows: ${formatDuration(duration)}`);

        await applyQuotaDelay();

        // Verify row count decreased
        const result = await client.readData(testSpreadsheetId, 'Sheet1!A:A');
        expect(result.values.length).toBe(rows - 100);
      },
      LARGE_SCALE_CONFIG.MEDIUM_TIMEOUT
    );

    it(
      'should insert rows efficiently',
      async () => {
        const testId = generateTestId('insert');
        const initialRows = LARGE_SCALE_CONFIG.SMALL;
        const cols = LARGE_SCALE_CONFIG.NARROW;

        const createResult = await client.createSpreadsheet(`InsertRows_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Write initial data
        const data = generateTestData(initialRows, cols);
        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${initialRows}`,
          data
        );

        await applyQuotaDelay();

        // Get sheet ID
        const metadata = await client.getSpreadsheet(testSpreadsheetId);
        const sheetId = metadata.sheets?.[0]?.properties?.sheetId ?? 0;

        await applyQuotaDelay();

        // Insert 50 rows
        const startTime = Date.now();
        await client.insertRows(testSpreadsheetId, sheetId, 50, 50);
        const duration = Date.now() - startTime;

        console.log(`Insert 50 rows: ${formatDuration(duration)}`);

        await applyQuotaDelay();

        // Verify row count increased (empty rows may not show in read)
        const result = await client.getSpreadsheet(testSpreadsheetId);
        const rowCount = result.sheets?.[0]?.properties?.gridProperties?.rowCount ?? 0;
        expect(rowCount).toBeGreaterThanOrEqual(initialRows + 50);
      },
      LARGE_SCALE_CONFIG.MEDIUM_TIMEOUT
    );
  });

  describe('Memory Efficiency', () => {
    it(
      'should handle large template without memory issues',
      async () => {
        const testId = generateTestId('memory');
        const rows = LARGE_SCALE_CONFIG.LARGE;
        const cols = 10;

        const createResult = await client.createSpreadsheet(`MemoryTest_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Generate large template
        const template = generateLargeTemplate(rows, cols);
        const dataSize = JSON.stringify(template.data).length;

        console.log(`Template size: ${formatBytes(dataSize)}`);

        const startTime = Date.now();
        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          template.data
        );
        const writeTime = Date.now() - startTime;

        console.log(`Write large template: ${formatDuration(writeTime)}`);

        await applyQuotaDelay();

        // Read back
        const readStart = Date.now();
        const result = await client.readData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`
        );
        const readTime = Date.now() - readStart;

        console.log(`Read large template: ${formatDuration(readTime)}`);

        expect(result.values.length).toBe(rows);
      },
      LARGE_SCALE_CONFIG.LARGE_TIMEOUT
    );
  });

  describe('Quota Management', () => {
    it(
      'should track quota usage during large operations',
      async () => {
        const testId = generateTestId('quota');
        const rows = LARGE_SCALE_CONFIG.MEDIUM;
        const cols = LARGE_SCALE_CONFIG.NARROW;

        const createResult = await client.createSpreadsheet(`QuotaTest_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        const quotaManager = getQuotaManager();
        const initialState = quotaManager.getState();

        await applyQuotaDelay();

        // Perform operations
        const data = generateTestData(rows, cols);
        await client.writeData(
          testSpreadsheetId,
          `Sheet1!A1:${columnLetter(cols - 1)}${rows}`,
          data
        );

        await applyQuotaDelay();

        await client.readData(testSpreadsheetId, `Sheet1!A1:${columnLetter(cols - 1)}${rows}`);

        const finalState = quotaManager.getState();

        // Quota should have been consumed (current usage should be >= initial usage)
        console.log(
          `Quota used: Reads +${finalState.estimatedReadsCurrent - initialState.estimatedReadsCurrent}, Writes +${finalState.estimatedWritesCurrent - initialState.estimatedWritesCurrent}`
        );

        expect(finalState.estimatedReadsCurrent).toBeGreaterThanOrEqual(
          initialState.estimatedReadsCurrent
        );
      },
      LARGE_SCALE_CONFIG.MEDIUM_TIMEOUT
    );

    it(
      'should respect rate limits during sustained operations',
      async () => {
        const testId = generateTestId('ratelimit');
        const iterations = 10;

        const createResult = await client.createSpreadsheet(`RateLimitTest_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        const durations: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();

          // Small write
          await client.writeData(testSpreadsheetId, `Sheet1!A${i + 1}`, [[`Iteration_${i}`]]);

          await applyQuotaDelay();

          // Small read
          await client.readData(testSpreadsheetId, `Sheet1!A${i + 1}`);

          durations.push(Date.now() - startTime);

          await applyQuotaDelay();
        }

        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        console.log(
          `Average iteration time: ${formatDuration(avgDuration)} (${iterations} iterations)`
        );

        // Should complete all iterations without rate limit errors
        expect(durations.length).toBe(iterations);
      },
      LARGE_SCALE_CONFIG.LARGE_TIMEOUT
    );
  });

  describe('Stress Test', () => {
    it(
      'should handle rapid sequential operations',
      async () => {
        const testId = generateTestId('stress');
        const operations = 20;

        const createResult = await client.createSpreadsheet(`StressTest_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        const startTime = Date.now();
        let successCount = 0;

        for (let i = 0; i < operations; i++) {
          try {
            // Alternate between writes and reads
            if (i % 2 === 0) {
              await client.writeData(testSpreadsheetId, `Sheet1!A${i + 1}`, [[`Op_${i}`]]);
            } else {
              await client.readData(testSpreadsheetId, `Sheet1!A1:A${i}`);
            }
            successCount++;
            await applyQuotaDelay();
          } catch (error) {
            console.log(`Operation ${i} failed:`, error);
          }
        }

        const duration = Date.now() - startTime;
        console.log(
          `Stress test: ${successCount}/${operations} operations in ${formatDuration(duration)}`
        );

        // At least 80% should succeed
        expect(successCount).toBeGreaterThanOrEqual(operations * 0.8);
      },
      LARGE_SCALE_CONFIG.LARGE_TIMEOUT
    );
  });
});
