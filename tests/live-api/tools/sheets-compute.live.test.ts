/**
 * Live API Tests for sheets_compute Tool
 *
 * Tests computation operations. Some tests use the real Google Sheets API
 * for range data; others (evaluate with pure arithmetic) work without API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * Actions tested:
 * - evaluate    — pure arithmetic (no API call needed)
 * - statistics  — requires seeded spreadsheet data
 * - run_query   — requires DuckDB engine (skipped when not available)
 *
 * Skipped:
 * - regression  — requires large numeric dataset and LLM for insights
 * - forecast    — requires time series data
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { shouldRunIntegrationTests } from '../../helpers/credential-loader.js';
import { getLiveApiClient } from '../setup/index.js';
import type { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, type TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { ComputeHandler } from '../../../src/handlers/compute.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_compute Live API Tests', () => {
  let liveClient: LiveApiClient;
  let manager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;
  let handler: ComputeHandler;

  beforeAll(async () => {
    liveClient = await getLiveApiClient();
    manager = new TestSpreadsheetManager(liveClient);
    testSpreadsheet = await manager.createTestSpreadsheet('compute');

    // Seed numeric data for statistics tests
    await liveClient.sheets.spreadsheets.values.update({
      spreadsheetId: testSpreadsheet.id,
      range: 'Sheet1!A1:B6',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['Score', 'Category'],
          [10, 'A'],
          [20, 'A'],
          [30, 'B'],
          [40, 'B'],
          [50, 'C'],
        ],
      },
    });

    handler = new ComputeHandler(liveClient.sheets);
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('evaluate — pure arithmetic (no API call)', () => {
    it('should evaluate a simple arithmetic expression', async () => {
      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: testSpreadsheet.id,
          formula: '=2+3*4',
        },
      });

      // evaluate returns success with a result value
      expect(result.response.success).toBe(true);
      if (result.response.success) {
        const resp = result.response as { result: unknown };
        expect(resp.result).toBeDefined();
      }
    });

    it('should evaluate SUM expression', async () => {
      const result = await handler.handle({
        request: {
          action: 'evaluate',
          spreadsheetId: testSpreadsheet.id,
          formula: '=SUM(10,20,30)',
        },
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('statistics — uses seeded spreadsheet data', () => {
    it('should compute descriptive statistics on a numeric column', async () => {
      const result = await handler.handle({
        request: {
          action: 'statistical',
          spreadsheetId: testSpreadsheet.id,
          range: 'Sheet1!A2:A6',
          metrics: ['mean', 'median', 'stddev', 'min', 'max'],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        const resp = result.response as Record<string, unknown>;
        // Should contain statistical results
        expect(resp.statistics ?? resp.result ?? resp.data).toBeDefined();
      }
    });
  });

  describe('run_query (DuckDB)', () => {
    it.skip('run_query — requires DuckDB engine passed in constructor options', () => {
      // DuckDB queries require ComputeHandler to be instantiated with duckdbEngine option.
      // In live tests, the DuckDB worker compiles to duckdb-worker.js in dist/.
      // Skip to avoid build-time dependency on compiled output.
    });
  });

  // Skipped: require large datasets or LLM
  it.skip('regression — requires large numeric dataset', () => {});
  it.skip('forecast — requires time series data', () => {});
});
