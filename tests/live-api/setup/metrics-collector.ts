/**
 * ServalSheets - Test Metrics Collector
 *
 * Central collection for all test metrics including:
 * - Per-test: API calls, execution time, quota usage, errors, retries
 * - Aggregate: Pass rate, average duration, quota trends
 *
 * Supports multiple output formats for CI integration.
 */

import { TEST_CONFIG } from './config.js';

/**
 * Metrics for a single API call
 */
export interface ApiCallMetric {
  timestamp: number;
  type: 'read' | 'write';
  method: string;
  durationMs: number;
  success: boolean;
  statusCode?: number;
  errorCode?: string;
  retryCount: number;
}

/**
 * Metrics for a single test
 */
export interface TestMetric {
  testName: string;
  suiteName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: 'passed' | 'failed' | 'skipped';
  apiCalls: ApiCallMetric[];
  totalReads: number;
  totalWrites: number;
  totalRetries: number;
  quotaUsedReads: number;
  quotaUsedWrites: number;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * Aggregate metrics for a test suite
 */
export interface SuiteMetric {
  suiteName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  testCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  passRate: number;
  totalApiCalls: number;
  totalReads: number;
  totalWrites: number;
  avgDurationMs: number;
}

/**
 * Overall test run metrics
 */
export interface RunMetric {
  runId: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  suites: SuiteMetric[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  passRate: number;
  totalApiCalls: number;
  totalReads: number;
  totalWrites: number;
  quotaViolations: number;
  avgTestDurationMs: number;
}

/**
 * Active test context
 */
interface ActiveTest {
  testName: string;
  suiteName: string;
  startTime: number;
  apiCalls: ApiCallMetric[];
}

/**
 * Metrics Collector class
 */
export class MetricsCollector {
  private config = TEST_CONFIG.metrics;
  private enabled: boolean;

  // Storage
  private testMetrics: TestMetric[] = [];
  private activeTest: ActiveTest | null = null;
  private currentSuite: string = 'default';
  private runStartTime: number = 0;
  private runId: string = '';

  // Quotas tracking
  private quotaViolations: number = 0;

  constructor() {
    this.enabled = this.config.enabled;
    this.runId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.runStartTime = Date.now();
  }

  /**
   * Start a test run
   */
  startRun(runId: string): void {
    this.runId = runId;
    this.runStartTime = Date.now();
    this.testMetrics = [];
    this.quotaViolations = 0;
  }

  /**
   * End a test run
   */
  endRun(): void {
    // No-op: metrics are already collected, just marks the run as complete
  }

  /**
   * Set current suite name
   */
  setSuite(suiteName: string): void {
    this.currentSuite = suiteName;
  }

  /**
   * Start tracking a test
   */
  startTest(testName: string): void {
    if (!this.enabled) return;

    this.activeTest = {
      testName,
      suiteName: this.currentSuite,
      startTime: Date.now(),
      apiCalls: [],
    };
  }

  /**
   * Record an API call
   */
  recordApiCall(
    type: 'read' | 'write',
    method: string,
    durationMs: number,
    success: boolean,
    options: {
      statusCode?: number;
      errorCode?: string;
      retryCount?: number;
    } = {}
  ): void {
    if (!this.enabled) return;

    const metric: ApiCallMetric = {
      timestamp: Date.now(),
      type,
      method,
      durationMs,
      success,
      statusCode: options.statusCode,
      errorCode: options.errorCode,
      retryCount: options.retryCount ?? 0,
    };

    if (this.activeTest) {
      this.activeTest.apiCalls.push(metric);
    }
  }

  /**
   * Record a retry attempt
   */
  recordRetry(attempt: number, delayMs: number, errorCode?: string): void {
    if (!this.enabled || !this.activeTest) return;

    // Record as a special API call
    this.activeTest.apiCalls.push({
      timestamp: Date.now(),
      type: 'read', // retries are tracked separately
      method: 'RETRY',
      durationMs: delayMs,
      success: false,
      errorCode,
      retryCount: attempt,
    });
  }

  /**
   * End tracking a test
   */
  endTest(status: 'passed' | 'failed' | 'skipped', error?: Error): TestMetric | null {
    if (!this.enabled || !this.activeTest) return null;

    const endTime = Date.now();
    const apiCalls = this.activeTest.apiCalls;

    const totalReads = apiCalls.filter((c) => c.type === 'read' && c.method !== 'RETRY').length;
    const totalWrites = apiCalls.filter((c) => c.type === 'write').length;
    const totalRetries = apiCalls.filter((c) => c.method === 'RETRY').length;

    const metric: TestMetric = {
      testName: this.activeTest.testName,
      suiteName: this.activeTest.suiteName,
      startTime: this.activeTest.startTime,
      endTime,
      durationMs: endTime - this.activeTest.startTime,
      status,
      apiCalls,
      totalReads,
      totalWrites,
      totalRetries,
      quotaUsedReads: totalReads,
      quotaUsedWrites: totalWrites,
    };

    if (error) {
      metric.error = {
        message: error.message,
        stack: error.stack,
        code: (error as { code?: string }).code,
      };
    }

    this.testMetrics.push(metric);

    // Trim if too many
    if (this.testMetrics.length > this.config.maxHistoryEntries) {
      this.testMetrics = this.testMetrics.slice(-this.config.maxHistoryEntries);
    }

    this.activeTest = null;
    return metric;
  }

  /**
   * Record a quota violation
   */
  recordQuotaViolation(): void {
    this.quotaViolations++;
  }

  /**
   * Get all test metrics
   */
  getTestMetrics(): TestMetric[] {
    return [...this.testMetrics];
  }

  /**
   * Get metrics for a specific suite
   */
  getSuiteMetrics(suiteName: string): SuiteMetric {
    const suiteTests = this.testMetrics.filter((t) => t.suiteName === suiteName);

    if (suiteTests.length === 0) {
      return {
        suiteName,
        startTime: 0,
        endTime: 0,
        durationMs: 0,
        testCount: 0,
        passedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        passRate: 0,
        totalApiCalls: 0,
        totalReads: 0,
        totalWrites: 0,
        avgDurationMs: 0,
      };
    }

    const startTime = Math.min(...suiteTests.map((t) => t.startTime));
    const endTime = Math.max(...suiteTests.map((t) => t.endTime));
    const passedCount = suiteTests.filter((t) => t.status === 'passed').length;
    const failedCount = suiteTests.filter((t) => t.status === 'failed').length;
    const skippedCount = suiteTests.filter((t) => t.status === 'skipped').length;

    return {
      suiteName,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      testCount: suiteTests.length,
      passedCount,
      failedCount,
      skippedCount,
      passRate: suiteTests.length > 0 ? (passedCount / suiteTests.length) * 100 : 0,
      totalApiCalls: suiteTests.reduce((sum, t) => sum + t.apiCalls.length, 0),
      totalReads: suiteTests.reduce((sum, t) => sum + t.totalReads, 0),
      totalWrites: suiteTests.reduce((sum, t) => sum + t.totalWrites, 0),
      avgDurationMs:
        suiteTests.length > 0
          ? suiteTests.reduce((sum, t) => sum + t.durationMs, 0) / suiteTests.length
          : 0,
    };
  }

  /**
   * Get overall run metrics
   */
  getRunMetrics(): RunMetric {
    const suiteNames = [...new Set(this.testMetrics.map((t) => t.suiteName))];
    const suites = suiteNames.map((name) => this.getSuiteMetrics(name));

    const endTime = Date.now();
    const passedTests = this.testMetrics.filter((t) => t.status === 'passed').length;
    const failedTests = this.testMetrics.filter((t) => t.status === 'failed').length;
    const skippedTests = this.testMetrics.filter((t) => t.status === 'skipped').length;
    const totalTests = this.testMetrics.length;

    return {
      runId: this.runId,
      startTime: this.runStartTime,
      endTime,
      durationMs: endTime - this.runStartTime,
      suites,
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      passRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      totalApiCalls: this.testMetrics.reduce((sum, t) => sum + t.apiCalls.length, 0),
      totalReads: this.testMetrics.reduce((sum, t) => sum + t.totalReads, 0),
      totalWrites: this.testMetrics.reduce((sum, t) => sum + t.totalWrites, 0),
      quotaViolations: this.quotaViolations,
      avgTestDurationMs:
        totalTests > 0
          ? this.testMetrics.reduce((sum, t) => sum + t.durationMs, 0) / totalTests
          : 0,
    };
  }

  /**
   * Generate report in specified format
   */
  getReport(format: 'json' | 'markdown' | 'html' = 'json'): string {
    const metrics = this.getRunMetrics();

    switch (format) {
      case 'json':
        return JSON.stringify(metrics, null, 2);

      case 'markdown':
        return this.generateMarkdownReport(metrics);

      case 'html':
        return this.generateHtmlReport(metrics);

      default:
        return JSON.stringify(metrics, null, 2);
    }
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(metrics: RunMetric): string {
    const lines: string[] = [
      '# ServalSheets Test Report',
      '',
      `**Run ID:** ${metrics.runId}`,
      `**Duration:** ${(metrics.durationMs / 1000).toFixed(2)}s`,
      `**Date:** ${new Date(metrics.startTime).toISOString()}`,
      '',
      '## Summary',
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total Tests | ${metrics.totalTests} |`,
      `| Passed | ${metrics.passedTests} |`,
      `| Failed | ${metrics.failedTests} |`,
      `| Skipped | ${metrics.skippedTests} |`,
      `| Pass Rate | ${metrics.passRate.toFixed(1)}% |`,
      `| Total API Calls | ${metrics.totalApiCalls} |`,
      `| Total Reads | ${metrics.totalReads} |`,
      `| Total Writes | ${metrics.totalWrites} |`,
      `| Quota Violations | ${metrics.quotaViolations} |`,
      `| Avg Test Duration | ${metrics.avgTestDurationMs.toFixed(0)}ms |`,
      '',
      '## Suites',
      '',
    ];

    for (const suite of metrics.suites) {
      lines.push(`### ${suite.suiteName}`);
      lines.push('');
      lines.push(
        `- Tests: ${suite.testCount} (${suite.passedCount} passed, ${suite.failedCount} failed)`
      );
      lines.push(`- Pass Rate: ${suite.passRate.toFixed(1)}%`);
      lines.push(`- Duration: ${(suite.durationMs / 1000).toFixed(2)}s`);
      lines.push(
        `- API Calls: ${suite.totalApiCalls} (${suite.totalReads} reads, ${suite.totalWrites} writes)`
      );
      lines.push('');
    }

    // Failed tests section
    const failedTests = this.testMetrics.filter((t) => t.status === 'failed');
    if (failedTests.length > 0) {
      lines.push('## Failed Tests');
      lines.push('');
      for (const test of failedTests) {
        lines.push(`### ${test.suiteName} > ${test.testName}`);
        lines.push('');
        if (test.error) {
          lines.push('```');
          lines.push(test.error.message);
          lines.push('```');
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate HTML report
   */
  private generateHtmlReport(metrics: RunMetric): string {
    const passRateColor =
      metrics.passRate >= 95 ? '#22c55e' : metrics.passRate >= 80 ? '#eab308' : '#ef4444';

    return `<!DOCTYPE html>
<html>
<head>
  <title>ServalSheets Test Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
    .card { background: #f8fafc; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card-title { font-size: 14px; color: #64748b; margin-bottom: 8px; }
    .card-value { font-size: 28px; font-weight: bold; color: #1e293b; }
    .pass-rate { color: ${passRateColor}; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 600; }
    .status-passed { color: #22c55e; }
    .status-failed { color: #ef4444; }
    .status-skipped { color: #64748b; }
    .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 10px; margin: 10px 0; font-family: monospace; font-size: 12px; }
  </style>
</head>
<body>
  <h1>ServalSheets Test Report</h1>
  <p><strong>Run ID:</strong> ${metrics.runId} | <strong>Duration:</strong> ${(metrics.durationMs / 1000).toFixed(2)}s | <strong>Date:</strong> ${new Date(metrics.startTime).toLocaleString()}</p>

  <div class="summary">
    <div class="card">
      <div class="card-title">Pass Rate</div>
      <div class="card-value pass-rate">${metrics.passRate.toFixed(1)}%</div>
    </div>
    <div class="card">
      <div class="card-title">Total Tests</div>
      <div class="card-value">${metrics.totalTests}</div>
    </div>
    <div class="card">
      <div class="card-title">API Calls</div>
      <div class="card-value">${metrics.totalApiCalls}</div>
    </div>
    <div class="card">
      <div class="card-title">Avg Duration</div>
      <div class="card-value">${metrics.avgTestDurationMs.toFixed(0)}ms</div>
    </div>
  </div>

  <h2>Suites</h2>
  <table>
    <thead>
      <tr><th>Suite</th><th>Tests</th><th>Passed</th><th>Failed</th><th>Pass Rate</th><th>Duration</th><th>API Calls</th></tr>
    </thead>
    <tbody>
      ${metrics.suites
        .map(
          (s) => `
        <tr>
          <td>${s.suiteName}</td>
          <td>${s.testCount}</td>
          <td class="status-passed">${s.passedCount}</td>
          <td class="status-failed">${s.failedCount}</td>
          <td>${s.passRate.toFixed(1)}%</td>
          <td>${(s.durationMs / 1000).toFixed(2)}s</td>
          <td>${s.totalApiCalls}</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  ${
    this.testMetrics.filter((t) => t.status === 'failed').length > 0
      ? `
    <h2>Failed Tests</h2>
    ${this.testMetrics
      .filter((t) => t.status === 'failed')
      .map(
        (t) => `
      <h3>${t.suiteName} > ${t.testName}</h3>
      ${t.error ? `<div class="error-box">${t.error.message}</div>` : ''}
    `
      )
      .join('')}
  `
      : ''
  }
</body>
</html>`;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.testMetrics = [];
    this.activeTest = null;
    this.quotaViolations = 0;
    this.runId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.runStartTime = Date.now();
  }

  /**
   * Enable/disable metrics collection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if metrics collection is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Singleton instance
 */
let _instance: MetricsCollector | null = null;

/**
 * Get the singleton metrics collector
 */
export function getMetricsCollector(): MetricsCollector {
  if (!_instance) {
    _instance = new MetricsCollector();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetMetricsCollector(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}

/**
 * Convenience: Start tracking a test
 */
export function startTestMetrics(testName: string): void {
  getMetricsCollector().startTest(testName);
}

/**
 * Convenience: End tracking a test
 */
export function endTestMetrics(
  status: 'passed' | 'failed' | 'skipped',
  error?: Error
): TestMetric | null {
  return getMetricsCollector().endTest(status, error);
}

/**
 * Convenience: Record an API call
 */
export function recordApiCallMetric(
  type: 'read' | 'write',
  method: string,
  durationMs: number,
  success: boolean,
  options?: { statusCode?: number; errorCode?: string; retryCount?: number }
): void {
  getMetricsCollector().recordApiCall(type, method, durationMs, success, options);
}

/**
 * Convenience: Get the report
 */
export function getTestReport(format: 'json' | 'markdown' | 'html' = 'json'): string {
  return getMetricsCollector().getReport(format);
}
