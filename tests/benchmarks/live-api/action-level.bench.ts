/**
 * Action-Level Performance Benchmarks
 *
 * Comprehensive benchmarks for representative actions across all tools.
 * Run with: npm run bench:action-level
 *
 * Note: This is a more granular benchmark than tool-level.bench.ts.
 * Each action is tested individually with representative inputs.
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
import { TOOL_ACTIONS } from '../../../src/mcp/completions.js';

const runBenchmarks = process.env['RUN_BENCHMARKS'] === 'true' && isLiveApiEnabled();
const describeOrSkip = runBenchmarks ? describe : describe.skip;

// Action configurations for each tool
interface ActionConfig {
  action: string;
  getArgs: (spreadsheetId: string, sheetId: number) => Record<string, unknown>;
  category: string;
  maxP95Ms: number;
}

// Helper to create action benchmark configurations
function createActionConfigs(): Map<string, ActionConfig[]> {
  const configs = new Map<string, ActionConfig[]>();

  // sheets_auth (4 actions)
  configs.set('sheets_auth', [
    { action: 'status', getArgs: () => ({}), category: 'Auth', maxP95Ms: 100 },
    { action: 'login', getArgs: () => ({}), category: 'Auth', maxP95Ms: 200 },
    // callback and logout require specific state, skip in automated benchmarks
  ]);

  // sheets_core (17 actions)
  configs.set('sheets_core', [
    { action: 'get', getArgs: (sid) => ({ spreadsheetId: sid }), category: 'Core', maxP95Ms: 500 },
    {
      action: 'get_url',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Core',
      maxP95Ms: 100,
    },
    {
      action: 'list_sheets',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Core',
      maxP95Ms: 500,
    },
    {
      action: 'get_comprehensive',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Core',
      maxP95Ms: 1000,
    },
  ]);

  // sheets_data (19 actions)
  configs.set('sheets_data', [
    {
      action: 'read',
      getArgs: (sid) => ({ spreadsheetId: sid, range: 'TestData!A1:F10' }),
      category: 'Data',
      maxP95Ms: 500,
    },
    {
      action: 'write',
      getArgs: (sid) => ({
        spreadsheetId: sid,
        range: 'Benchmarks!A1:B3',
        values: [
          ['A', 'B'],
          ['C', 'D'],
          ['E', 'F'],
        ],
      }),
      category: 'Data',
      maxP95Ms: 700,
    },
    {
      action: 'append',
      getArgs: (sid) => ({ spreadsheetId: sid, range: 'Benchmarks!A1', values: [['Appended']] }),
      category: 'Data',
      maxP95Ms: 700,
    },
    {
      action: 'clear',
      getArgs: (sid) => ({ spreadsheetId: sid, range: 'Benchmarks!Z1:Z10' }),
      category: 'Data',
      maxP95Ms: 600,
    },
    {
      action: 'batch_read',
      getArgs: (sid) => ({ spreadsheetId: sid, ranges: ['TestData!A1:B5', 'TestData!C1:D5'] }),
      category: 'Data',
      maxP95Ms: 600,
    },
  ]);

  // sheets_format (18 actions)
  configs.set('sheets_format', [
    {
      action: 'set_format',
      getArgs: (sid) => ({
        spreadsheetId: sid,
        range: 'TestData!A1:B2',
        format: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } },
      }),
      category: 'Format',
      maxP95Ms: 700,
    },
    {
      action: 'clear_format',
      getArgs: (sid) => ({ spreadsheetId: sid, range: 'Benchmarks!A1:B2' }),
      category: 'Format',
      maxP95Ms: 600,
    },
    {
      action: 'set_background',
      getArgs: (sid) => ({
        spreadsheetId: sid,
        range: 'TestData!A1',
        color: { red: 1, green: 1, blue: 0.8 },
      }),
      category: 'Format',
      maxP95Ms: 600,
    },
    {
      action: 'set_text_format',
      getArgs: (sid) => ({ spreadsheetId: sid, range: 'TestData!A1', textFormat: { bold: true } }),
      category: 'Format',
      maxP95Ms: 600,
    },
  ]);

  // sheets_dimensions (21+ actions)
  configs.set('sheets_dimensions', [
    {
      action: 'insert',
      getArgs: (sid, sheetId) => ({
        spreadsheetId: sid,
        sheetId,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: 2,
      }),
      category: 'Dimensions',
      maxP95Ms: 700,
    },
    {
      action: 'delete',
      getArgs: (sid, sheetId) => ({
        spreadsheetId: sid,
        sheetId,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: 1,
      }),
      category: 'Dimensions',
      maxP95Ms: 700,
    },
    {
      action: 'resize',
      getArgs: (sid, sheetId) => ({
        spreadsheetId: sid,
        sheetId,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: 1,
        size: 150,
      }),
      category: 'Dimensions',
      maxP95Ms: 600,
    },
  ]);

  // sheets_visualize (16 actions)
  configs.set('sheets_visualize', [
    {
      action: 'chart_list',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Visualize',
      maxP95Ms: 500,
    },
    {
      action: 'pivot_list',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Visualize',
      maxP95Ms: 500,
    },
    {
      action: 'suggest_chart',
      getArgs: (sid) => ({ spreadsheetId: sid, range: 'TestData!A1:F10' }),
      category: 'Visualize',
      maxP95Ms: 1000,
    },
  ]);

  // sheets_collaborate (28 actions)
  configs.set('sheets_collaborate', [
    {
      action: 'share_list',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Collaborate',
      maxP95Ms: 600,
    },
    {
      action: 'comment_list',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Collaborate',
      maxP95Ms: 600,
    },
    {
      action: 'version_list_revisions',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Collaborate',
      maxP95Ms: 800,
    },
  ]);

  // sheets_advanced (23 actions)
  configs.set('sheets_advanced', [
    {
      action: 'list_named_ranges',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Advanced',
      maxP95Ms: 500,
    },
    {
      action: 'list_protected_ranges',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Advanced',
      maxP95Ms: 500,
    },
    {
      action: 'list_banding',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Advanced',
      maxP95Ms: 500,
    },
  ]);

  // sheets_transaction (6 actions)
  configs.set('sheets_transaction', [
    { action: 'list', getArgs: () => ({}), category: 'Transaction', maxP95Ms: 200 },
  ]);

  // sheets_quality (4 actions)
  configs.set('sheets_quality', [
    {
      action: 'validate',
      getArgs: (sid) => ({ spreadsheetId: sid, range: 'TestData!A1:F50' }),
      category: 'Quality',
      maxP95Ms: 1000,
    },
  ]);

  // sheets_history (7 actions)
  configs.set('sheets_history', [
    {
      action: 'list',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'History',
      maxP95Ms: 300,
    },
    {
      action: 'stats',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'History',
      maxP95Ms: 200,
    },
  ]);

  // sheets_confirm (2 actions)
  configs.set('sheets_confirm', [
    { action: 'get_stats', getArgs: () => ({}), category: 'Confirm', maxP95Ms: 100 },
  ]);

  // sheets_analyze (16 actions)
  configs.set('sheets_analyze', [
    {
      action: 'comprehensive',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Analyze',
      maxP95Ms: 2500,
    },
    {
      action: 'analyze_structure',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Analyze',
      maxP95Ms: 1000,
    },
    {
      action: 'analyze_quality',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Analyze',
      maxP95Ms: 1500,
    },
    {
      action: 'detect_patterns',
      getArgs: (sid) => ({ spreadsheetId: sid, range: 'TestData!A1:F50' }),
      category: 'Analyze',
      maxP95Ms: 1500,
    },
  ]);

  // sheets_fix (1 action)
  configs.set('sheets_fix', [
    {
      action: 'fix',
      getArgs: (sid) => ({ spreadsheetId: sid, dryRun: true }),
      category: 'Fix',
      maxP95Ms: 1500,
    },
  ]);

  // sheets_composite (4 actions)
  configs.set('sheets_composite', [
    // These require more setup, testing basic availability
  ]);

  // sheets_session (13 actions)
  configs.set('sheets_session', [
    { action: 'get_context', getArgs: () => ({}), category: 'Session', maxP95Ms: 50 },
    { action: 'get_active', getArgs: () => ({}), category: 'Session', maxP95Ms: 50 },
    { action: 'get_preferences', getArgs: () => ({}), category: 'Session', maxP95Ms: 50 },
    { action: 'get_history', getArgs: () => ({}), category: 'Session', maxP95Ms: 100 },
    {
      action: 'set_active',
      getArgs: (sid) => ({ spreadsheetId: sid, spreadsheetTitle: 'Test' }),
      category: 'Session',
      maxP95Ms: 100,
    },
  ]);

  // sheets_templates (8 actions)
  configs.set('sheets_templates', [
    { action: 'list', getArgs: () => ({}), category: 'Templates', maxP95Ms: 300 },
  ]);

  // sheets_dependencies (7 actions)
  configs.set('sheets_dependencies', [
    {
      action: 'get_stats',
      getArgs: (sid) => ({ spreadsheetId: sid }),
      category: 'Dependencies',
      maxP95Ms: 200,
    },
  ]);

  // sheets_webhook (7 actions)
  configs.set('sheets_webhook', [
    { action: 'list', getArgs: () => ({}), category: 'Webhook', maxP95Ms: 200 },
    { action: 'get_stats', getArgs: () => ({}), category: 'Webhook', maxP95Ms: 100 },
  ]);

  return configs;
}

describeOrSkip('Action-Level Performance Benchmarks', () => {
  let harness: McpTestHarness;
  let liveClient: LiveApiClient;
  let spreadsheetManager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;
  let benchHarness: BenchmarkHarness;
  let reporter: BenchmarkReporter;
  let actionConfigs: Map<string, ActionConfig[]>;

  beforeAll(async () => {
    // Initialize live API client
    liveClient = await getLiveApiClient({ trackMetrics: true });
    spreadsheetManager = createTestSpreadsheetManager(liveClient, 'BENCH_ACTIONS_');

    // Create dedicated benchmark spreadsheet
    testSpreadsheet = await spreadsheetManager.createTestSpreadsheet('MAIN');
    await spreadsheetManager.populateTestData(testSpreadsheet.id, {
      rows: 200,
      columns: 6,
      includeFormulas: true,
      includeDates: true,
    });

    // Initialize MCP test harness
    harness = await createServalSheetsTestHarness({
      serverOptions: {
        googleApiOptions: {
          serviceAccountKeyPath: process.env['GOOGLE_APPLICATION_CREDENTIALS'],
        },
      },
    });

    // Initialize benchmark harness with reduced runs for action-level (many tests)
    benchHarness = createBenchmarkHarness({
      warmupRuns: 1,
      measurementRuns: 5, // Fewer runs per action due to volume
      cooldownMs: 150,
      timeoutMs: 30000,
    });

    // Initialize reporter
    reporter = createDefaultReporter();

    // Get action configs
    actionConfigs = createActionConfigs();
  }, 120000);

  afterAll(async () => {
    // Cleanup
    await spreadsheetManager.cleanup();

    // Generate reports
    const results = benchHarness.getResults();
    if (results.length > 0) {
      printResults(results);

      const report = reporter.generateReport(results);
      await reporter.writeJsonReport(report, 'benchmark-results/action-level.json');
      await reporter.writeMarkdownReport(report, 'benchmark-results/action-level.md');
    }

    await harness.close();
  }, 60000);

  // Dynamically create tests for each configured tool
  for (const toolName of Object.keys(TOOL_ACTIONS)) {
    const configs = actionConfigs.get(toolName) || [];

    if (configs.length === 0) {
      // Skip tools without configs
      continue;
    }

    describe(toolName, () => {
      for (const config of configs) {
        it(`${toolName}:${config.action} - should complete under ${config.maxP95Ms}ms P95`, async () => {
          const sheetId = testSpreadsheet.sheets[0]?.sheetId || 0;
          const args = config.getArgs(testSpreadsheet.id, sheetId);

          const result = await benchHarness.measure(
            `${toolName}:${config.action}`,
            config.category,
            async () => {
              await harness.client.callTool({
                name: toolName,
                arguments: {
                  request: {
                    action: config.action,
                    ...args,
                  },
                },
              });
            },
            { tool: toolName, action: config.action }
          );

          // Log result
          console.log(
            `  ${toolName}:${config.action} - P50: ${result.statistics.p50.toFixed(2)}ms, ` +
              `P95: ${result.statistics.p95.toFixed(2)}ms`
          );

          expect(result.statistics.p95).toBeLessThan(config.maxP95Ms);
        });
      }
    });
  }

  // Summary test
  describe('Summary', () => {
    it('should have benchmarked multiple actions', () => {
      const results = benchHarness.getResults();
      expect(results.length).toBeGreaterThan(0);

      const summary = benchHarness.getSummary();
      console.log(
        `\nBenchmarked ${summary.totalBenchmarks} actions across ${summary.categories.length} categories`
      );
      console.log(`Average P95: ${summary.avgP95.toFixed(2)}ms`);
      console.log(`Max P95: ${summary.maxP95.toFixed(2)}ms`);
      console.log(`Min P95: ${summary.minP95.toFixed(2)}ms`);
    });
  });
});
