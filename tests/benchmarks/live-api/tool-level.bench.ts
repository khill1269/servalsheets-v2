/**
 * Tool-Level Performance Benchmarks
 *
 * Measures P50/P95/P99 latency for each of the 21 ServalSheets tools.
 * Run with: npm run bench:tool-level
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BenchmarkHarness, createBenchmarkHarness } from '../harness/benchmark-harness.js';
import {
  BenchmarkReporter,
  createDefaultReporter,
  printResults,
} from '../harness/benchmark-reporter.js';
import {
  getLiveApiClient,
  isLiveApiEnabled,
  type LiveApiClient,
} from '../../live-api/setup/live-api-client.js';
import {
  TestSpreadsheetManager,
  createTestSpreadsheetManager,
  type TestSpreadsheet,
} from '../../live-api/setup/test-spreadsheet-manager.js';
import {
  createServalSheetsTestHarness,
  type McpTestHarness,
} from '../../helpers/mcp-test-harness.js';

const runBenchmarks = process.env['RUN_BENCHMARKS'] === 'true' && isLiveApiEnabled();
const describeOrSkip = runBenchmarks ? describe : describe.skip;

describeOrSkip('Tool-Level Performance Benchmarks', () => {
  let harness: McpTestHarness;
  let liveClient: LiveApiClient;
  let spreadsheetManager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;
  let benchHarness: BenchmarkHarness;
  let reporter: BenchmarkReporter;

  beforeAll(async () => {
    // Initialize live API client
    liveClient = await getLiveApiClient({ trackMetrics: true });
    spreadsheetManager = createTestSpreadsheetManager(liveClient, 'BENCH_TOOLS_');

    // Create dedicated benchmark spreadsheet with test data
    testSpreadsheet = await spreadsheetManager.createTestSpreadsheet('MAIN');
    await spreadsheetManager.populateTestData(testSpreadsheet.id, {
      rows: 500,
      columns: 6,
      includeFormulas: true,
      includeDates: true,
      includeNumbers: true,
    });

    // Initialize MCP test harness with live API
    harness = await createServalSheetsTestHarness({
      serverOptions: {
        googleApiOptions: {
          serviceAccountKeyPath: process.env['GOOGLE_APPLICATION_CREDENTIALS'],
        },
      },
    });

    // Initialize benchmark harness with optimized settings for live API
    benchHarness = createBenchmarkHarness({
      warmupRuns: 2,
      measurementRuns: 10,
      cooldownMs: 200, // Longer cooldown for API rate limits
      timeoutMs: 30000,
    });

    // Initialize reporter with thresholds
    reporter = createDefaultReporter();
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    // Cleanup test spreadsheets
    const { deleted, failed } = await spreadsheetManager.cleanup();
    console.log(`Cleanup: ${deleted} deleted, ${failed} failed`);

    // Generate reports
    const results = benchHarness.getResults();
    if (results.length > 0) {
      printResults(results);

      const report = reporter.generateReport(results);
      await reporter.writeJsonReport(report, 'benchmark-results/tool-level.json');
      await reporter.writeMarkdownReport(report, 'benchmark-results/tool-level.md');
    }

    // Close harness
    await harness.close();
  }, 30000);

  // ============================================================================
  // Core Operations (sheets_auth, sheets_core, sheets_data)
  // ============================================================================

  describe('Core Operations', () => {
    it('sheets_auth:status - should check auth status under 100ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_auth:status',
        'Core Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_auth',
            arguments: { request: { action: 'status' } },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(100);
    });

    it('sheets_core:get - should fetch spreadsheet metadata under 500ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_core:get',
        'Core Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_core',
            arguments: {
              request: {
                action: 'get',
                spreadsheetId: testSpreadsheet.id,
              },
            },
          });
        },
        { spreadsheetId: testSpreadsheet.id }
      );

      expect(result.statistics.p95).toBeLessThan(500);
    });

    it('sheets_data:read - should read 500 rows under 600ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_data:read',
        'Core Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_data',
            arguments: {
              request: {
                action: 'read',
                spreadsheetId: testSpreadsheet.id,
                range: 'TestData!A1:F501',
              },
            },
          });
        },
        { rowCount: 500, columnCount: 6 }
      );

      expect(result.statistics.p95).toBeLessThan(600);
    });

    it('sheets_data:write - should write 100 cells under 700ms P95', async () => {
      const values = Array.from({ length: 10 }, (_, i) =>
        Array.from({ length: 10 }, (_, j) => `Cell_${i}_${j}`)
      );

      const result = await benchHarness.measure(
        'sheets_data:write',
        'Core Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_data',
            arguments: {
              request: {
                action: 'write',
                spreadsheetId: testSpreadsheet.id,
                range: 'Benchmarks!A1:J10',
                values,
              },
            },
          });
        },
        { cellCount: 100 }
      );

      expect(result.statistics.p95).toBeLessThan(700);
    });
  });

  // ============================================================================
  // Format & Dimensions Operations
  // ============================================================================

  describe('Format & Dimensions', () => {
    it('sheets_format:set_format - should apply formatting under 600ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_format:set_format',
        'Format Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_format',
            arguments: {
              request: {
                action: 'set_format',
                spreadsheetId: testSpreadsheet.id,
                range: 'TestData!A1:F1',
                format: {
                  backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
                  textFormat: { bold: true },
                },
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(600);
    });

    it('sheets_dimensions:insert - should insert rows under 600ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_dimensions:insert',
        'Format Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_dimensions',
            arguments: {
              request: {
                action: 'insert',
                spreadsheetId: testSpreadsheet.id,
                sheetId: testSpreadsheet.sheets[1].sheetId,
                dimension: 'ROWS',
                startIndex: 0,
                endIndex: 5,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(600);
    });
  });

  // ============================================================================
  // Visualization & Analysis
  // ============================================================================

  describe('Visualization & Analysis', () => {
    it('sheets_visualize:chart_list - should list charts under 500ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_visualize:chart_list',
        'Analysis Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_visualize',
            arguments: {
              request: {
                action: 'chart_list',
                spreadsheetId: testSpreadsheet.id,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(500);
    });

    it('sheets_analyze:comprehensive - should analyze spreadsheet under 2500ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_analyze:comprehensive',
        'Analysis Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_analyze',
            arguments: {
              request: {
                action: 'comprehensive',
                spreadsheetId: testSpreadsheet.id,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(2500);
    });
  });

  // ============================================================================
  // Collaboration & History
  // ============================================================================

  describe('Collaboration & History', () => {
    it('sheets_collaborate:share_list - should list shares under 600ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_collaborate:share_list',
        'Collaboration Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_collaborate',
            arguments: {
              request: {
                action: 'share_list',
                spreadsheetId: testSpreadsheet.id,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(600);
    });

    it('sheets_history:list - should list history under 300ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_history:list',
        'Collaboration Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_history',
            arguments: {
              request: {
                action: 'list',
                spreadsheetId: testSpreadsheet.id,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(300);
    });
  });

  // ============================================================================
  // Advanced Operations
  // ============================================================================

  describe('Advanced Operations', () => {
    it('sheets_advanced:list_named_ranges - should list named ranges under 500ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_advanced:list_named_ranges',
        'Advanced Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_advanced',
            arguments: {
              request: {
                action: 'list_named_ranges',
                spreadsheetId: testSpreadsheet.id,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(500);
    });

    it('sheets_transaction:list - should list transactions under 200ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_transaction:list',
        'Advanced Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_transaction',
            arguments: {
              request: { action: 'list' },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(200);
    });

    it('sheets_quality:validate - should validate data under 800ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_quality:validate',
        'Advanced Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_quality',
            arguments: {
              request: {
                action: 'validate',
                spreadsheetId: testSpreadsheet.id,
                range: 'TestData!A1:F100',
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(800);
    });
  });

  // ============================================================================
  // MCP-Native Operations (confirm, fix, composite)
  // ============================================================================

  describe('MCP-Native Operations', () => {
    it('sheets_confirm:get_stats - should get stats under 100ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_confirm:get_stats',
        'MCP-Native Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_confirm',
            arguments: {
              request: { action: 'get_stats' },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(100);
    });

    it('sheets_fix:fix (dryRun) - should analyze fixes under 1000ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_fix:fix',
        'MCP-Native Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_fix',
            arguments: {
              request: {
                action: 'fix',
                spreadsheetId: testSpreadsheet.id,
                dryRun: true,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(1000);
    });
  });

  // ============================================================================
  // Session Operations
  // ============================================================================

  describe('Session Operations', () => {
    it('sheets_session:get_context - should get context under 50ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_session:get_context',
        'Session Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_session',
            arguments: {
              request: { action: 'get_context' },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(50);
    });

    it('sheets_session:set_active - should set active under 100ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_session:set_active',
        'Session Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_session',
            arguments: {
              request: {
                action: 'set_active',
                spreadsheetId: testSpreadsheet.id,
                spreadsheetTitle: testSpreadsheet.title,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(100);
    });
  });

  // ============================================================================
  // Enterprise Tier 7 Operations (templates, bigquery, appsscript)
  // ============================================================================

  describe('Enterprise Operations', () => {
    it('sheets_templates:list - should list templates under 300ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_templates:list',
        'Enterprise Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_templates',
            arguments: {
              request: { action: 'list' },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(300);
    });

    it('sheets_dependencies:get_stats - should get dependency stats under 200ms P95', async () => {
      const result = await benchHarness.measure(
        'sheets_dependencies:get_stats',
        'Enterprise Operations',
        async () => {
          await harness.client.callTool({
            name: 'sheets_dependencies',
            arguments: {
              request: {
                action: 'get_stats',
                spreadsheetId: testSpreadsheet.id,
              },
            },
          });
        }
      );

      expect(result.statistics.p95).toBeLessThan(200);
    });
  });
});
