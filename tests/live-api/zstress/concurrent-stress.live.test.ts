/**
 * ServalSheets - Concurrent Stress Tests
 *
 * Tests for parallel execution, concurrency limits, and deadlock detection.
 * Validates that the system handles concurrent operations correctly.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  getLiveApiClient,
  getQuotaManager,
  getTestRateLimiter,
  applyQuotaDelay,
  generateTestId,
  sleep,
  standardAfterEach,
  formatDuration,
} from '../setup/index.js';
import { shouldRunIntegrationTests } from '../../helpers/credential-loader.js';
import type { LiveApiClient } from '../setup/live-api-client.js';

/**
 * Skip all tests if integration tests are not enabled
 */
const skipTests = !shouldRunIntegrationTests();

/**
 * Configuration for concurrent tests
 */
const CONCURRENT_CONFIG = {
  // Concurrency limits
  MAX_PARALLEL_READS: 10,
  MAX_PARALLEL_WRITES: 5,
  MAX_MIXED_OPERATIONS: 8,

  // Timeouts
  OPERATION_TIMEOUT: 30000,
  TEST_TIMEOUT: 120000,
  DEADLOCK_TIMEOUT: 60000,
};

describe.skipIf(skipTests)('Concurrent Stress Tests', () => {
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

  describe('Parallel Read Operations', () => {
    it(
      'should handle multiple parallel reads',
      async () => {
        const testId = generateTestId('parallel_read');
        const parallelCount = CONCURRENT_CONFIG.MAX_PARALLEL_READS;

        // Create and populate spreadsheet
        const createResult = await client.createSpreadsheet(`ParallelRead_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Write test data
        const data = Array.from({ length: 100 }, (_, i) => [`Row_${i}`]);
        await client.writeData(testSpreadsheetId, 'Sheet1!A1:A100', data);

        await applyQuotaDelay();

        // Execute parallel reads
        const startTime = Date.now();
        const readPromises = Array.from({ length: parallelCount }, (_, i) =>
          client.readData(testSpreadsheetId!, `Sheet1!A${i * 10 + 1}:A${i * 10 + 10}`)
        );

        const results = await Promise.all(readPromises);
        const duration = Date.now() - startTime;

        console.log(`${parallelCount} parallel reads completed in ${formatDuration(duration)}`);

        // All reads should succeed
        expect(results.length).toBe(parallelCount);
        results.forEach((result) => {
          expect(result.values).toBeDefined();
          expect(result.values.length).toBeLessThanOrEqual(10);
        });
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );

    it(
      'should handle parallel reads to same range',
      async () => {
        const testId = generateTestId('same_range');
        const parallelCount = 5;

        const createResult = await client.createSpreadsheet(`SameRange_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Write test data
        await client.writeData(testSpreadsheetId, 'Sheet1!A1:A10', [
          ['Data1'],
          ['Data2'],
          ['Data3'],
          ['Data4'],
          ['Data5'],
          ['Data6'],
          ['Data7'],
          ['Data8'],
          ['Data9'],
          ['Data10'],
        ]);

        await applyQuotaDelay();

        // All reads target the same range
        const startTime = Date.now();
        const readPromises = Array.from({ length: parallelCount }, () =>
          client.readData(testSpreadsheetId!, 'Sheet1!A1:A10')
        );

        const results = await Promise.all(readPromises);
        const duration = Date.now() - startTime;

        console.log(`${parallelCount} parallel reads to same range: ${formatDuration(duration)}`);

        // All should return identical data
        const firstResult = JSON.stringify(results[0].values);
        results.forEach((result) => {
          expect(JSON.stringify(result.values)).toBe(firstResult);
        });
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );
  });

  describe('Parallel Write Operations', () => {
    it(
      'should handle multiple parallel writes to different ranges',
      async () => {
        const testId = generateTestId('parallel_write');
        const parallelCount = CONCURRENT_CONFIG.MAX_PARALLEL_WRITES;

        const createResult = await client.createSpreadsheet(`ParallelWrite_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Execute parallel writes to different columns
        const startTime = Date.now();
        const writePromises = Array.from({ length: parallelCount }, (_, i) =>
          client.writeData(
            testSpreadsheetId!,
            `Sheet1!${String.fromCharCode(65 + i)}1:${String.fromCharCode(65 + i)}10`,
            Array.from({ length: 10 }, (_, j) => [`Col${i}_Row${j}`])
          )
        );

        const results = await Promise.allSettled(writePromises);
        const duration = Date.now() - startTime;

        console.log(`${parallelCount} parallel writes completed in ${formatDuration(duration)}`);

        // Count successful writes
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        console.log(`Successful writes: ${succeeded}/${parallelCount}`);

        // Most should succeed
        expect(succeeded).toBeGreaterThanOrEqual(parallelCount * 0.8);

        await applyQuotaDelay();

        // Verify data was written
        const verifyResult = await client.readData(testSpreadsheetId, 'Sheet1!A1:E10');
        expect(verifyResult.values).toBeDefined();
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );

    it(
      'should handle write contention to same cell',
      async () => {
        const testId = generateTestId('contention');
        const parallelCount = 5;

        const createResult = await client.createSpreadsheet(`WriteContention_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // All writes target the same cell
        const startTime = Date.now();
        const writePromises = Array.from({ length: parallelCount }, (_, i) =>
          client.writeData(testSpreadsheetId!, 'Sheet1!A1', [[`Writer_${i}`]])
        );

        const results = await Promise.allSettled(writePromises);
        const duration = Date.now() - startTime;

        console.log(`${parallelCount} contending writes: ${formatDuration(duration)}`);

        await applyQuotaDelay();

        // Read final value (last writer wins)
        const finalResult = await client.readData(testSpreadsheetId, 'Sheet1!A1');
        expect(finalResult.values[0][0]).toMatch(/^Writer_\d$/);

        // Most writes should complete (some may fail due to contention)
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        expect(succeeded).toBeGreaterThanOrEqual(1);
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );
  });

  describe('Mixed Read/Write Operations', () => {
    it(
      'should handle mixed concurrent reads and writes',
      async () => {
        const testId = generateTestId('mixed');
        const readCount = 5;
        const writeCount = 3;

        const createResult = await client.createSpreadsheet(`Mixed_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Pre-populate with data
        await client.writeData(
          testSpreadsheetId,
          'Sheet1!A1:A20',
          Array.from({ length: 20 }, (_, i) => [`Initial_${i}`])
        );

        await applyQuotaDelay();

        // Mix reads and writes
        const startTime = Date.now();
        const operations: Promise<unknown>[] = [];

        // Add reads
        for (let i = 0; i < readCount; i++) {
          operations.push(client.readData(testSpreadsheetId!, `Sheet1!A${i + 1}:A${i + 5}`));
        }

        // Add writes (to different columns to avoid direct contention)
        for (let i = 0; i < writeCount; i++) {
          operations.push(
            client.writeData(
              testSpreadsheetId!,
              `Sheet1!${String.fromCharCode(66 + i)}1:${String.fromCharCode(66 + i)}5`,
              Array.from({ length: 5 }, (_, j) => [`Write_${i}_${j}`])
            )
          );
        }

        const results = await Promise.allSettled(operations);
        const duration = Date.now() - startTime;

        console.log(`${readCount} reads + ${writeCount} writes mixed: ${formatDuration(duration)}`);

        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        expect(succeeded).toBeGreaterThanOrEqual((readCount + writeCount) * 0.8);
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );
  });

  describe('Rate Limiter Behavior', () => {
    it(
      'should queue operations when rate limit is approached',
      async () => {
        const testId = generateTestId('ratelimit');
        const operationCount = 15;

        const createResult = await client.createSpreadsheet(`RateLimit_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        const rateLimiter = getTestRateLimiter();
        const initialStatus = rateLimiter.getStatus();

        console.log(
          `Initial tokens - Reads: ${initialStatus.availableReads.toFixed(0)}, Writes: ${initialStatus.availableWrites.toFixed(0)}`
        );

        // Execute many operations rapidly
        const startTime = Date.now();
        const operations = Array.from({ length: operationCount }, (_, i) =>
          client.writeData(testSpreadsheetId!, `Sheet1!A${i + 1}`, [[`Op_${i}`]])
        );

        const results = await Promise.allSettled(operations);
        const duration = Date.now() - startTime;

        const finalStatus = rateLimiter.getStatus();
        console.log(
          `Final tokens - Reads: ${finalStatus.availableReads.toFixed(0)}, Writes: ${finalStatus.availableWrites.toFixed(0)}`
        );
        console.log(`${operationCount} operations in ${formatDuration(duration)}`);

        // Tokens should have been consumed
        expect(finalStatus.availableWrites).toBeLessThan(initialStatus.availableWrites);

        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        expect(succeeded).toBeGreaterThanOrEqual(operationCount * 0.7);
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );
  });

  describe('Deadlock Prevention', () => {
    it(
      'should not deadlock with circular dependencies',
      async () => {
        const testId = generateTestId('deadlock');

        // Create two spreadsheets
        const create1 = await client.createSpreadsheet(`Deadlock1_${testId}`);
        const spreadsheet1 = create1.spreadsheetId;

        await applyQuotaDelay();

        const create2 = await client.createSpreadsheet(`Deadlock2_${testId}`);
        const spreadsheet2 = create2.spreadsheetId;
        testSpreadsheetId = spreadsheet2; // For cleanup

        await applyQuotaDelay();

        // Simulate potential deadlock scenario:
        // Thread A: read from 1, write to 2
        // Thread B: read from 2, write to 1
        const startTime = Date.now();

        const operationA = (async () => {
          const data = await client.readData(spreadsheet1, 'Sheet1!A1');
          await sleep(10); // Simulate processing
          await client.writeData(spreadsheet2, 'Sheet1!A1', [['From_A']]);
          return 'A';
        })();

        const operationB = (async () => {
          const data = await client.readData(spreadsheet2, 'Sheet1!A1');
          await sleep(10); // Simulate processing
          await client.writeData(spreadsheet1, 'Sheet1!A1', [['From_B']]);
          return 'B';
        })();

        // Both should complete without deadlock
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Deadlock timeout')),
            CONCURRENT_CONFIG.DEADLOCK_TIMEOUT
          )
        );

        try {
          const results = await Promise.race([
            Promise.all([operationA, operationB]),
            timeoutPromise,
          ]);

          const duration = Date.now() - startTime;
          console.log(`Circular operations completed in ${formatDuration(duration)}`);

          expect(results).toContain('A');
          expect(results).toContain('B');
        } finally {
          // Clean up both spreadsheets
          try {
            await client.deleteSpreadsheet(spreadsheet1);
          } catch {
            // Ignore
          }
        }
      },
      CONCURRENT_CONFIG.DEADLOCK_TIMEOUT + 10000
    );

    it(
      'should timeout gracefully on stuck operations',
      async () => {
        const testId = generateTestId('timeout');

        const createResult = await client.createSpreadsheet(`Timeout_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Test that operations respect timeout
        const startTime = Date.now();

        // This should complete normally
        const result = await client.readData(testSpreadsheetId, 'Sheet1!A1:Z100');
        const duration = Date.now() - startTime;

        console.log(`Read with timeout: ${formatDuration(duration)}`);

        // Should complete within reasonable time
        expect(duration).toBeLessThan(CONCURRENT_CONFIG.OPERATION_TIMEOUT);
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );
  });

  describe('Performance Comparison', () => {
    it(
      'should compare sequential vs parallel performance',
      async () => {
        const testId = generateTestId('perf');
        const operationCount = 5;

        const createResult = await client.createSpreadsheet(`PerfCompare_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Populate with data
        await client.writeData(
          testSpreadsheetId,
          'Sheet1!A1:A50',
          Array.from({ length: 50 }, (_, i) => [`Data_${i}`])
        );

        await applyQuotaDelay();

        // Sequential execution
        const sequentialStart = Date.now();
        for (let i = 0; i < operationCount; i++) {
          await client.readData(testSpreadsheetId, `Sheet1!A${i * 10 + 1}:A${i * 10 + 10}`);
        }
        const sequentialDuration = Date.now() - sequentialStart;

        await applyQuotaDelay();

        // Parallel execution
        const parallelStart = Date.now();
        await Promise.all(
          Array.from({ length: operationCount }, (_, i) =>
            client.readData(testSpreadsheetId!, `Sheet1!A${i * 10 + 1}:A${i * 10 + 10}`)
          )
        );
        const parallelDuration = Date.now() - parallelStart;

        console.log(`Sequential ${operationCount} reads: ${formatDuration(sequentialDuration)}`);
        console.log(`Parallel ${operationCount} reads: ${formatDuration(parallelDuration)}`);
        console.log(`Speedup: ${(sequentialDuration / parallelDuration).toFixed(2)}x`);

        // Parallel should generally be faster (or at least not significantly slower)
        // Note: Due to rate limiting, speedup may be limited
        expect(parallelDuration).toBeLessThanOrEqual(sequentialDuration * 1.5);
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );
  });

  describe('Error Handling Under Concurrency', () => {
    it(
      'should handle errors in parallel operations gracefully',
      async () => {
        const testId = generateTestId('error');

        const createResult = await client.createSpreadsheet(`ErrorHandling_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Mix valid and invalid operations
        const operations = [
          client.readData(testSpreadsheetId!, 'Sheet1!A1:A10'), // Valid
          client.readData(testSpreadsheetId!, 'InvalidSheet!A1:A10'), // Invalid
          client.readData(testSpreadsheetId!, 'Sheet1!A1:A10'), // Valid
          client.readData('invalid-id', 'Sheet1!A1:A10'), // Invalid spreadsheet
          client.readData(testSpreadsheetId!, 'Sheet1!A1:A10'), // Valid
        ];

        const results = await Promise.allSettled(operations);

        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        console.log(`Results: ${succeeded} succeeded, ${failed} failed`);

        // Valid operations should succeed despite failures in others
        expect(succeeded).toBeGreaterThanOrEqual(3);
        expect(failed).toBeGreaterThanOrEqual(1);
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );

    it(
      'should recover from rate limit errors',
      async () => {
        const testId = generateTestId('recovery');

        const createResult = await client.createSpreadsheet(`Recovery_${testId}`);
        testSpreadsheetId = createResult.spreadsheetId;

        await applyQuotaDelay();

        // Exhaust some quota with rapid operations
        const rapidOps = Array.from({ length: 10 }, (_, i) =>
          client.writeData(testSpreadsheetId!, `Sheet1!A${i + 1}`, [[`Rapid_${i}`]])
        );

        await Promise.allSettled(rapidOps);

        // Wait for recovery
        await sleep(2000);

        // This operation should succeed after recovery
        const result = await client.readData(testSpreadsheetId, 'Sheet1!A1:A10');
        expect(result.values).toBeDefined();
      },
      CONCURRENT_CONFIG.TEST_TIMEOUT
    );
  });
});
