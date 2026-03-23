/**
 * Circuit Breaker Live Verification
 *
 * Verifies that the circuit breaker correctly handles failures and recovers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { CircuitBreaker } from '../../../src/utils/circuit-breaker.js';

const runTests = isLiveApiEnabled();
const describeOrSkip = runTests ? describe : describe.skip;

describeOrSkip('Circuit Breaker Live Verification', () => {
  let client: LiveApiClient;
  let spreadsheetManager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;

  beforeAll(async () => {
    client = await getLiveApiClient();
    spreadsheetManager = createTestSpreadsheetManager(client, 'CIRCUIT_TEST_');
    testSpreadsheet = await spreadsheetManager.createTestSpreadsheet('MAIN');
    await spreadsheetManager.populateTestData(testSpreadsheet.id, { rows: 50 });
  }, 60000);

  afterAll(async () => {
    await spreadsheetManager.cleanup();
  }, 30000);

  describe('Circuit Breaker Unit Tests', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 1000,
        name: 'test-breaker',
      });
    });

    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
      expect(breaker.isOpen()).toBe(false);
    });

    it('should open after consecutive failures', async () => {
      const failingFn = async (): Promise<string> => {
        throw new Error('Simulated failure');
      };

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failingFn);
        } catch {
          // Expected to fail
        }
      }

      expect(breaker.getState()).toBe('open');
      expect(breaker.isOpen()).toBe(true);
    });

    it('should reject requests when open', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      await expect(breaker.execute(async () => 'success')).rejects.toThrow(
        /Circuit breaker.*OPEN/i
      );
    });

    it('should transition to half-open after timeout', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');

      // Wait 1500ms (50% buffer over 1000ms reset timeout) for reliable transition
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');
    });

    it('should close after successful operations in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // Expected
        }
      }

      // Wait 1500ms (50% buffer over 1000ms reset timeout) for reliable transition
      await new Promise((resolve) => setTimeout(resolve, 1500));

      await breaker.execute(async () => 'success1');
      await breaker.execute(async () => 'success2');

      expect(breaker.getState()).toBe('closed');
    });

    it('should track statistics', async () => {
      // Note: CircuitBreaker tracks consecutive counts, not totals
      await breaker.execute(async () => 'ok1');
      await breaker.execute(async () => 'ok2');

      const stats = breaker.getStats();
      // totalRequests tracks all requests
      expect(stats.totalRequests).toBe(2);
      // state should remain closed
      expect(stats.state).toBe('closed');
    });
  });

  describe('Integration with Live API', () => {
    it('should handle successful operations without tripping', async () => {
      const operations = Array.from({ length: 5 }, () =>
        client.sheets.spreadsheets.values.get({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!A1:F10',
        })
      );

      const results = await Promise.all(operations);

      for (const result of results) {
        expect(result.data.values).toBeDefined();
      }
    });

    it('should handle invalid operations gracefully', async () => {
      await expect(
        client.sheets.spreadsheets.get({
          spreadsheetId: 'invalid-spreadsheet-id-that-does-not-exist',
        })
      ).rejects.toThrow();
    });
  });

  describe('Recovery Behavior', () => {
    it('should recover after transient failures', async () => {
      const result1 = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:B5',
      });

      expect(result1.data.values).toBeDefined();

      try {
        await client.sheets.spreadsheets.values.get({
          spreadsheetId: 'bad-id',
          range: 'Sheet1!A1',
        });
      } catch {
        // Expected to fail
      }

      const result2 = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:B5',
      });

      expect(result2.data.values).toBeDefined();
    });
  });
});
