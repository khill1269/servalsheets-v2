#!/usr/bin/env tsx
/**
 * ServalSheets Comprehensive Live API Test Runner
 *
 * Tests representative actions across the 16-tool suite against real Google Sheets API
 * Generates detailed report with issues and recommendations
 *
 * Usage: npx tsx tests/manual/comprehensive-api-test.ts
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Test configuration
const CONFIG = {
  testSpreadsheetPrefix: 'ServalSheets-Test-',
  timeout: 30000,
  outputDir: './test-results',
  logFile: 'comprehensive-test-log.json',
  reportFile: 'comprehensive-test-report.md',
};

// Types
interface TestResult {
  tool: string;
  action: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  duration: number;
  error?: string;
  response?: unknown;
  notes?: string;
}

interface TestReport {
  timestamp: string;
  duration: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
  };
  results: TestResult[];
  issues: Issue[];
}

interface Issue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  tool: string;
  action: string;
  description: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  recommendation?: string;
}

// MCP Server Communication
class MCPClient {
  private server: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }
  >();
  private buffer = '';

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = spawn('node', ['dist/cli.js'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.server.stdout?.on('data', (data) => this.handleData(data));
      this.server.stderr?.on('data', (data) => console.error('STDERR:', data.toString()));
      this.server.on('error', reject);
      this.server.on('exit', (code) => {
        if (code !== 0) console.error(`Server exited with code ${code}`);
      });

      // Initialize after startup
      setTimeout(async () => {
        try {
          await this.send('initialize', {
            protocolVersion: '2025-11-25',
            capabilities: { sampling: {}, elicitation: {} },
            clientInfo: { name: 'comprehensive-test', version: '1.0.0' },
          });
          await this.send('notifications/initialized', {}, true);
          resolve();
        } catch (e) {
          reject(e);
        }
      }, 2000);
    });
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id)!;
          clearTimeout(req.timeout);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            req.resolve(msg.result);
          }
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }
  }

  async send(method: string, params: unknown, isNotification = false): Promise<unknown> {
    const id = isNotification ? undefined : ++this.messageId;
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';

    this.server?.stdin?.write(msg);

    if (isNotification) return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id!);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, CONFIG.timeout);

      this.pendingRequests.set(id!, { resolve, reject, timeout });
    });
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.send('tools/call', { name: tool, arguments: args });
    return result;
  }

  stop(): void {
    this.server?.kill();
  }
}

// Test Context - stores state between tests
interface TestContext {
  spreadsheetId?: string;
  sheetId?: number;
  sheetTitle?: string;
  chartId?: number;
  pivotSheetId?: number;
  namedRangeId?: string;
  protectedRangeId?: number;
  bandedRangeId?: number;
  filterViewId?: number;
  slicerId?: number;
  transactionId?: string;
  commentId?: string;
  snapshotId?: string;
}

// Test Generator - creates test cases for each action
function generateTestCases(
  ctx: TestContext
): Map<string, Map<string, () => Record<string, unknown>>> {
  const tests = new Map<string, Map<string, () => Record<string, unknown>>>();

  tests.set(
    'sheets_auth',
    new Map([
      ['status', () => ({ action: 'status' })],
      ['login', () => ({ action: 'login' })],
      ['logout', () => ({ action: 'logout' })],
    ])
  );

  tests.set(
    'sheets_core',
    new Map([
      ['list', () => ({ action: 'list', maxResults: 5 })],
      [
        'create',
        () => ({
          action: 'create',
          title: `${CONFIG.testSpreadsheetPrefix}${Date.now()}`,
          sheets: [{ title: 'TestSheet', rowCount: 100, columnCount: 10 }],
        }),
      ],
      ['get', () => ({ action: 'get', spreadsheetId: ctx.spreadsheetId })],
      [
        'add_sheet',
        () => ({ action: 'add_sheet', spreadsheetId: ctx.spreadsheetId, title: 'NewTestSheet' }),
      ],
    ])
  );

  tests.set(
    'sheets_data',
    new Map([
      [
        'read',
        () => ({
          action: 'read',
          spreadsheetId: ctx.spreadsheetId,
          range: { a1: `${ctx.sheetTitle}!A1:D5` },
        }),
      ],
      [
        'write',
        () => ({
          action: 'write',
          spreadsheetId: ctx.spreadsheetId,
          range: { a1: `${ctx.sheetTitle}!E1` },
          values: [['Extra']],
        }),
      ],
      [
        'find_replace',
        () => ({
          action: 'find_replace',
          spreadsheetId: ctx.spreadsheetId,
          find: 'Widget',
          range: { a1: `${ctx.sheetTitle}!A1:D10` },
        }),
      ],
      [
        'add_note',
        () => ({
          action: 'add_note',
          spreadsheetId: ctx.spreadsheetId,
          cell: `${ctx.sheetTitle}!A1`,
          note: 'Test note',
        }),
      ],
    ])
  );

  tests.set(
    'sheets_format',
    new Map([
      [
        'set_background',
        () => ({
          action: 'set_background',
          spreadsheetId: ctx.spreadsheetId,
          range: { a1: `${ctx.sheetTitle}!A1:D1` },
          color: { red: 0.2, green: 0.4, blue: 0.8 },
        }),
      ],
      [
        'rule_add_conditional_format',
        () => ({
          action: 'rule_add_conditional_format',
          spreadsheetId: ctx.spreadsheetId,
          sheetId: ctx.sheetId,
          range: { a1: `${ctx.sheetTitle}!A2:A10` },
          rule: {
            type: 'boolean',
            condition: { type: 'NUMBER_GREATER', values: ['10'] },
            format: { backgroundColor: { red: 1, green: 0, blue: 0 } },
          },
        }),
      ],
    ])
  );

  tests.set(
    'sheets_dimensions',
    new Map([
      [
        'insert_rows',
        () => ({
          action: 'insert_rows',
          spreadsheetId: ctx.spreadsheetId,
          sheetId: ctx.sheetId,
          startIndex: 10,
          count: 2,
        }),
      ],
      [
        'sort_range',
        () => ({
          action: 'sort_range',
          spreadsheetId: ctx.spreadsheetId,
          sheetId: ctx.sheetId,
          range: { a1: `${ctx.sheetTitle}!A1:D10` },
          sortSpecs: [{ columnIndex: 0, ascending: true }],
        }),
      ],
    ])
  );

  tests.set(
    'sheets_visualize',
    new Map([['chart_list', () => ({ action: 'chart_list', spreadsheetId: ctx.spreadsheetId })]])
  );

  tests.set(
    'sheets_collaborate',
    new Map([
      ['share_list', () => ({ action: 'share_list', spreadsheetId: ctx.spreadsheetId })],
      ['comment_list', () => ({ action: 'comment_list', spreadsheetId: ctx.spreadsheetId })],
      [
        'version_list_revisions',
        () => ({ action: 'version_list_revisions', spreadsheetId: ctx.spreadsheetId }),
      ],
    ])
  );

  tests.set(
    'sheets_advanced',
    new Map([
      [
        'list_named_ranges',
        () => ({ action: 'list_named_ranges', spreadsheetId: ctx.spreadsheetId }),
      ],
    ])
  );

  tests.set(
    'sheets_transaction',
    new Map([['begin', () => ({ action: 'begin', spreadsheetId: ctx.spreadsheetId })]])
  );

  tests.set(
    'sheets_quality',
    new Map([['validate', () => ({ action: 'validate', value: 'test' })]])
  );

  tests.set('sheets_history', new Map([['list', () => ({ action: 'list' })]]));

  tests.set(
    'sheets_confirm',
    new Map([['get_stats', () => ({ request: { action: 'get_stats' } })]])
  );

  tests.set(
    'sheets_analyze',
    new Map([
      ['comprehensive', () => ({ action: 'comprehensive', spreadsheetId: ctx.spreadsheetId })],
    ])
  );

  tests.set(
    'sheets_fix',
    new Map([
      [
        'fix',
        () => ({
          action: 'fix',
          spreadsheetId: ctx.spreadsheetId,
          issues: [
            { type: 'NO_FROZEN_HEADERS', severity: 'low', description: 'Missing frozen header' },
          ],
          mode: 'preview',
        }),
      ],
    ])
  );

  tests.set(
    'sheets_composite',
    new Map([
      [
        'import_csv',
        () => ({
          action: 'import_csv',
          spreadsheetId: ctx.spreadsheetId,
          csvData: 'Name,Value\nA,1',
          mode: 'replace',
        }),
      ],
    ])
  );

  tests.set('sheets_session', new Map([['get_active', () => ({ action: 'get_active' })]]));

  return tests;
}

// Main test runner
async function runTests(): Promise<void> {
  const startTime = Date.now();
  const results: TestResult[] = [];
  const issues: Issue[] = [];
  const ctx: TestContext = {};

  console.log('🚀 Starting ServalSheets Comprehensive API Test\n');
  console.log('='.repeat(60));

  // Ensure output directory exists
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const client = new MCPClient();

  try {
    console.log('\n📡 Starting MCP server...');
    await client.start();
    console.log('✅ Server started\n');

    // Phase 1: Auth
    console.log('🔐 Phase 1: Authentication');
    const authResult = await runSingleTest(
      client,
      'sheets_auth',
      'status',
      { action: 'status' },
      results,
      issues
    );
    if (!authResult || !(authResult as Record<string, unknown>).response?.['authenticated']) {
      console.log('  ⚠️  Not authenticated, attempting login...');
      await runSingleTest(client, 'sheets_auth', 'login', { action: 'login' }, results, issues);
    }

    // Phase 2: Create test spreadsheet
    console.log('\n📊 Phase 2: Create Test Spreadsheet');
    const createResult = await runSingleTest(
      client,
      'sheets_core',
      'create',
      {
        action: 'create',
        title: `${CONFIG.testSpreadsheetPrefix}${Date.now()}`,
        sheets: [{ title: 'TestSheet', rowCount: 100, columnCount: 26 }],
      },
      results,
      issues
    );

    if (createResult) {
      const response = (createResult as Record<string, unknown>).response as Record<
        string,
        unknown
      >;
      ctx.spreadsheetId =
        response?.spreadsheet?.['spreadsheetId'] || (response?.newSpreadsheetId as string);
      const sheets = response?.spreadsheet?.['sheets'] as Array<Record<string, unknown>>;
      if (sheets?.[0]) {
        ctx.sheetId = sheets[0].sheetId as number;
        ctx.sheetTitle = sheets[0].title as string;
      }
      console.log(`  ✅ Created spreadsheet: ${ctx.spreadsheetId}`);
      console.log(`  ✅ Sheet ID: ${ctx.sheetId}, Title: ${ctx.sheetTitle}`);
    } else {
      console.error('  ❌ Failed to create test spreadsheet');
      throw new Error('Cannot proceed without test spreadsheet');
    }

    // Phase 3: Run all tests
    console.log('\n🧪 Phase 3: Running All Tool Tests');
    const testCases = generateTestCases(ctx);

    let toolIndex = 0;
    for (const [tool, actions] of testCases) {
      toolIndex++;
      console.log(`\n[${toolIndex}/${testCases.size}] Testing ${tool}...`);

      for (const [action, getParams] of actions) {
        try {
          const params = getParams();

          // Handle context-dependent params
          if (tool === 'sheets_transaction' && action === 'begin') {
            const txResult = await runSingleTest(client, tool, action, params, results, issues);
            if (txResult) {
              const txResponse = (txResult as Record<string, unknown>).response as Record<
                string,
                unknown
              >;
              ctx.transactionId = txResponse?.transactionId as string;
            }
            continue;
          }

          await runSingleTest(client, tool, action, params, results, issues);
        } catch (e) {
          console.error(`    ❌ ${action}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (e) {
    console.error('\n❌ Fatal error:', e);
  } finally {
    client.stop();
  }

  // Generate report
  const report: TestReport = {
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skip').length,
      errors: results.filter((r) => r.status === 'error').length,
    },
    results,
    issues,
  };

  // Save results
  const logPath = path.join(CONFIG.outputDir, CONFIG.logFile);
  fs.writeFileSync(logPath, JSON.stringify(report, null, 2));
  console.log(`\n📝 Detailed log saved to: ${logPath}`);

  // Generate markdown report
  const reportPath = path.join(CONFIG.outputDir, CONFIG.reportFile);
  fs.writeFileSync(reportPath, generateMarkdownReport(report));
  console.log(`📊 Report saved to: ${reportPath}`);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${report.summary.total}`);
  console.log(`✅ Passed: ${report.summary.passed}`);
  console.log(`❌ Failed: ${report.summary.failed}`);
  console.log(`⏭️  Skipped: ${report.summary.skipped}`);
  console.log(`💥 Errors: ${report.summary.errors}`);
  console.log(`⏱️  Duration: ${(report.duration / 1000).toFixed(2)}s`);

  if (issues.length > 0) {
    console.log(`\n⚠️  Found ${issues.length} issues:`);
    for (const issue of issues) {
      console.log(
        `  [${issue.severity.toUpperCase()}] ${issue.tool}:${issue.action} - ${issue.description}`
      );
    }
  }
}

async function runSingleTest(
  client: MCPClient,
  tool: string,
  action: string,
  params: Record<string, unknown>,
  results: TestResult[],
  issues: Issue[]
): Promise<unknown> {
  const start = Date.now();
  const toolName = `servalsheets:${tool}`;

  try {
    const result = await client.callTool(toolName, params);
    const duration = Date.now() - start;

    const response = result as Record<string, unknown>;
    const content = response?.content as Array<Record<string, unknown>>;
    const text = content?.[0]?.text as string;

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON
    }

    const success = parsed?.response?.['success'] === true;
    const error = parsed?.response?.['error'];

    if (success) {
      console.log(`    ✅ ${action} (${duration}ms)`);
      results.push({ tool, action, status: 'pass', duration, response: parsed });
    } else {
      console.log(`    ❌ ${action}: ${error?.['message'] || 'Unknown error'}`);
      results.push({
        tool,
        action,
        status: 'fail',
        duration,
        error: error?.['message'],
        response: parsed,
      });

      // Categorize issue
      issues.push({
        severity:
          error?.['severity'] === 'critical'
            ? 'critical'
            : error?.['code']?.includes('INTERNAL')
              ? 'high'
              : 'medium',
        tool,
        action,
        description: error?.['message'] || 'Unknown error',
        actualBehavior: JSON.stringify(error),
        recommendation: error?.['resolution'],
      });
    }

    return parsed;
  } catch (e) {
    const duration = Date.now() - start;
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.log(`    💥 ${action}: ${errorMsg}`);
    results.push({ tool, action, status: 'error', duration, error: errorMsg });

    issues.push({
      severity: 'critical',
      tool,
      action,
      description: `Exception: ${errorMsg}`,
    });

    return null;
  }
}

function generateMarkdownReport(report: TestReport): string {
  const lines: string[] = [
    '# ServalSheets Comprehensive API Test Report',
    '',
    `**Generated:** ${report.timestamp}`,
    `**Duration:** ${(report.duration / 1000).toFixed(2)} seconds`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|--------|-------|',
    `| Total Tests | ${report.summary.total} |`,
    `| ✅ Passed | ${report.summary.passed} |`,
    `| ❌ Failed | ${report.summary.failed} |`,
    `| ⏭️ Skipped | ${report.summary.skipped} |`,
    `| 💥 Errors | ${report.summary.errors} |`,
    '',
    `**Pass Rate:** ${((report.summary.passed / report.summary.total) * 100).toFixed(1)}%`,
    '',
  ];

  if (report.issues.length > 0) {
    lines.push('## Issues Found', '');

    const critical = report.issues.filter((i) => i.severity === 'critical');
    const high = report.issues.filter((i) => i.severity === 'high');
    const medium = report.issues.filter((i) => i.severity === 'medium');
    const low = report.issues.filter((i) => i.severity === 'low');

    if (critical.length > 0) {
      lines.push('### 🔴 Critical', '');
      for (const issue of critical) {
        lines.push(`- **${issue.tool}:${issue.action}** - ${issue.description}`);
        if (issue.recommendation) lines.push(`  - *Recommendation:* ${issue.recommendation}`);
      }
      lines.push('');
    }

    if (high.length > 0) {
      lines.push('### 🟠 High', '');
      for (const issue of high) {
        lines.push(`- **${issue.tool}:${issue.action}** - ${issue.description}`);
        if (issue.recommendation) lines.push(`  - *Recommendation:* ${issue.recommendation}`);
      }
      lines.push('');
    }

    if (medium.length > 0) {
      lines.push('### 🟡 Medium', '');
      for (const issue of medium) {
        lines.push(`- **${issue.tool}:${issue.action}** - ${issue.description}`);
      }
      lines.push('');
    }

    if (low.length > 0) {
      lines.push('### 🟢 Low', '');
      for (const issue of low) {
        lines.push(`- **${issue.tool}:${issue.action}** - ${issue.description}`);
      }
      lines.push('');
    }
  }

  // Results by tool
  lines.push('## Results by Tool', '');

  const byTool = new Map<string, TestResult[]>();
  for (const r of report.results) {
    if (!byTool.has(r.tool)) byTool.set(r.tool, []);
    byTool.get(r.tool)!.push(r);
  }

  for (const [tool, toolResults] of byTool) {
    const passed = toolResults.filter((r) => r.status === 'pass').length;
    const total = toolResults.length;
    const emoji = passed === total ? '✅' : passed > 0 ? '⚠️' : '❌';

    lines.push(`### ${emoji} ${tool} (${passed}/${total})`, '');
    lines.push('| Action | Status | Duration | Notes |');
    lines.push('|--------|--------|----------|-------|');

    for (const r of toolResults) {
      const statusEmoji =
        r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : r.status === 'skip' ? '⏭️' : '💥';
      const notes = r.error ? r.error.substring(0, 50) + (r.error.length > 50 ? '...' : '') : '';
      lines.push(`| ${r.action} | ${statusEmoji} | ${r.duration}ms | ${notes} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// Run tests
runTests().catch(console.error);
