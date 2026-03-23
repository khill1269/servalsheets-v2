/**
 * Benchmark Reporter
 *
 * Generates JSON and Markdown reports from benchmark results.
 * Supports trend tracking and regression detection.
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import type { BenchmarkResult } from './benchmark-harness.js';
import { formatDuration } from './benchmark-harness.js';

export interface EnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuCount: number;
  memoryGB: number;
  sdkVersion: string;
  serverVersion: string;
  timestamp: string;
}

export interface BenchmarkThreshold {
  name: string;
  maxP95Ms: number;
  category?: string;
}

export interface RegressionInfo {
  benchmark: string;
  metric: string;
  current: number;
  previous: number;
  changePercent: number;
  threshold: number;
}

export interface CategorySummary {
  count: number;
  avgP50: number;
  avgP95: number;
  avgP99: number;
  totalDuration: number;
  passedThresholds: number;
  failedThresholds: number;
}

export interface ReportSummary {
  totalBenchmarks: number;
  passedThresholds: number;
  failedThresholds: number;
  categories: Record<string, CategorySummary>;
}

export interface BenchmarkReport {
  timestamp: string;
  environment: EnvironmentInfo;
  summary: ReportSummary;
  results: BenchmarkResult[];
  regressions: RegressionInfo[];
  thresholds: BenchmarkThreshold[];
}

const DEFAULT_REGRESSION_THRESHOLD = 0.15; // 15% slower = regression

/**
 * Benchmark reporter with JSON/Markdown output
 */
export class BenchmarkReporter {
  private thresholds: Map<string, number> = new Map();
  private categoryThresholds: Map<string, number> = new Map();

  /**
   * Set P95 threshold for a specific benchmark
   */
  setThreshold(benchmarkName: string, maxP95Ms: number): void {
    this.thresholds.set(benchmarkName, maxP95Ms);
  }

  /**
   * Set default threshold for a category
   */
  setCategoryThreshold(category: string, maxP95Ms: number): void {
    this.categoryThresholds.set(category, maxP95Ms);
  }

  /**
   * Get threshold for a benchmark (specific or category default)
   */
  getThreshold(benchmarkName: string, category: string): number | undefined {
    return this.thresholds.get(benchmarkName) ?? this.categoryThresholds.get(category);
  }

  /**
   * Generate a complete benchmark report
   */
  generateReport(results: BenchmarkResult[], previousReport?: BenchmarkReport): BenchmarkReport {
    const environment = this.getEnvironmentInfo();
    const regressions = this.detectRegressions(results, previousReport);
    const summary = this.calculateSummary(results);
    const thresholds = this.getThresholdsList();

    return {
      timestamp: new Date().toISOString(),
      environment,
      summary,
      results,
      regressions,
      thresholds,
    };
  }

  /**
   * Write report as JSON file
   */
  async writeJsonReport(report: BenchmarkReport, outputPath: string): Promise<void> {
    await this.ensureDirectory(outputPath);
    await writeFile(outputPath, JSON.stringify(report, null, 2));
  }

  /**
   * Write report as Markdown file
   */
  async writeMarkdownReport(report: BenchmarkReport, outputPath: string): Promise<void> {
    await this.ensureDirectory(outputPath);
    const md = this.generateMarkdown(report);
    await writeFile(outputPath, md);
  }

  /**
   * Load a previous report for comparison
   */
  async loadPreviousReport(reportPath: string): Promise<BenchmarkReport | null> {
    try {
      if (!existsSync(reportPath)) {
        return null;
      }
      const content = await readFile(reportPath, 'utf-8');
      return JSON.parse(content) as BenchmarkReport;
    } catch {
      return null;
    }
  }

  /**
   * Generate Markdown report content
   */
  private generateMarkdown(report: BenchmarkReport): string {
    const lines: string[] = [
      '# ServalSheets Benchmark Report',
      '',
      `**Generated:** ${report.timestamp}`,
      `**Node.js:** ${report.environment.nodeVersion}`,
      `**Platform:** ${report.environment.platform} (${report.environment.arch})`,
      `**CPUs:** ${report.environment.cpuCount}`,
      `**Memory:** ${report.environment.memoryGB}GB`,
      '',
      '## Summary',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Total Benchmarks | ${report.summary.totalBenchmarks} |`,
      `| Passed Thresholds | ${report.summary.passedThresholds} |`,
      `| Failed Thresholds | ${report.summary.failedThresholds} |`,
      `| Regressions | ${report.regressions.length} |`,
      '',
    ];

    // Category breakdown
    lines.push('## Results by Category', '');

    for (const [category, summary] of Object.entries(report.summary.categories)) {
      lines.push(`### ${category}`);
      lines.push('');
      lines.push(
        `*${summary.count} benchmarks | Avg P95: ${formatDuration(summary.avgP95)} | ` +
          `Passed: ${summary.passedThresholds}/${summary.count}*`
      );
      lines.push('');
      lines.push('| Benchmark | P50 | P95 | P99 | StdDev | Status |');
      lines.push('|-----------|-----|-----|-----|--------|--------|');

      for (const result of report.results.filter((r) => r.category === category)) {
        const threshold = this.getThreshold(result.name, result.category);
        let status = ':grey_question:';
        if (threshold) {
          status = result.statistics.p95 <= threshold ? ':white_check_mark:' : ':x:';
        }

        lines.push(
          `| ${result.name} | ${formatDuration(result.statistics.p50)} | ` +
            `${formatDuration(result.statistics.p95)} | ${formatDuration(result.statistics.p99)} | ` +
            `${formatDuration(result.statistics.stdDev)} | ${status} |`
        );
      }
      lines.push('');
    }

    // Regressions section
    if (report.regressions.length > 0) {
      lines.push('## :warning: Regressions Detected', '');
      lines.push('| Benchmark | Metric | Previous | Current | Change |');
      lines.push('|-----------|--------|----------|---------|--------|');

      for (const reg of report.regressions) {
        const emoji = reg.changePercent > 25 ? ':rotating_light:' : ':warning:';
        lines.push(
          `| ${reg.benchmark} | ${reg.metric} | ${formatDuration(reg.previous)} | ` +
            `${formatDuration(reg.current)} | ${emoji} +${reg.changePercent.toFixed(1)}% |`
        );
      }
      lines.push('');
    }

    // Thresholds reference
    if (report.thresholds.length > 0) {
      lines.push('## Thresholds Reference', '');
      lines.push('| Benchmark | Max P95 |');
      lines.push('|-----------|---------|');

      for (const threshold of report.thresholds) {
        lines.push(`| ${threshold.name} | ${formatDuration(threshold.maxP95Ms)} |`);
      }
      lines.push('');
    }

    // Environment details
    lines.push('## Environment', '');
    lines.push('```json');
    lines.push(JSON.stringify(report.environment, null, 2));
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Get environment information
   */
  private getEnvironmentInfo(): EnvironmentInfo {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('os') as typeof import('os');

    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / 1024 ** 3),
      sdkVersion: '^1.25.2',
      serverVersion: '1.6.0',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Detect performance regressions
   */
  private detectRegressions(
    results: BenchmarkResult[],
    previous?: BenchmarkReport
  ): RegressionInfo[] {
    if (!previous) return [];

    const regressions: RegressionInfo[] = [];

    for (const result of results) {
      const prevResult = previous.results.find((r) => r.name === result.name);
      if (!prevResult) continue;

      const changePercent =
        ((result.statistics.p95 - prevResult.statistics.p95) / prevResult.statistics.p95) * 100;

      if (changePercent > DEFAULT_REGRESSION_THRESHOLD * 100) {
        regressions.push({
          benchmark: result.name,
          metric: 'p95',
          current: result.statistics.p95,
          previous: prevResult.statistics.p95,
          changePercent,
          threshold: DEFAULT_REGRESSION_THRESHOLD * 100,
        });
      }
    }

    return regressions;
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(results: BenchmarkResult[]): ReportSummary {
    const categories: Record<string, CategorySummary> = {};
    let totalPassed = 0;
    let totalFailed = 0;

    for (const result of results) {
      // Initialize category if needed
      if (!categories[result.category]) {
        categories[result.category] = {
          count: 0,
          avgP50: 0,
          avgP95: 0,
          avgP99: 0,
          totalDuration: 0,
          passedThresholds: 0,
          failedThresholds: 0,
        };
      }

      const cat = categories[result.category];
      cat.count++;
      cat.avgP50 += result.statistics.p50;
      cat.avgP95 += result.statistics.p95;
      cat.avgP99 += result.statistics.p99;
      cat.totalDuration += result.statistics.mean * result.statistics.count;

      // Check threshold
      const threshold = this.getThreshold(result.name, result.category);
      if (threshold) {
        if (result.statistics.p95 <= threshold) {
          cat.passedThresholds++;
          totalPassed++;
        } else {
          cat.failedThresholds++;
          totalFailed++;
        }
      }
    }

    // Finalize averages
    for (const cat of Object.values(categories)) {
      if (cat.count > 0) {
        cat.avgP50 /= cat.count;
        cat.avgP95 /= cat.count;
        cat.avgP99 /= cat.count;
      }
    }

    return {
      totalBenchmarks: results.length,
      passedThresholds: totalPassed,
      failedThresholds: totalFailed,
      categories,
    };
  }

  /**
   * Get all thresholds as list
   */
  private getThresholdsList(): BenchmarkThreshold[] {
    const list: BenchmarkThreshold[] = [];

    for (const [name, maxP95Ms] of this.thresholds) {
      list.push({ name, maxP95Ms });
    }

    for (const [category, maxP95Ms] of this.categoryThresholds) {
      list.push({ name: `[Category] ${category}`, maxP95Ms, category });
    }

    return list;
  }

  /**
   * Ensure output directory exists
   */
  private async ensureDirectory(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

/**
 * Create a reporter with default thresholds for ServalSheets
 */
export function createDefaultReporter(): BenchmarkReporter {
  const reporter = new BenchmarkReporter();

  // Set category-level defaults
  reporter.setCategoryThreshold('Core Operations', 300);
  reporter.setCategoryThreshold('Data Operations', 500);
  reporter.setCategoryThreshold('Format Operations', 400);
  reporter.setCategoryThreshold('Analysis Operations', 2000);
  reporter.setCategoryThreshold('Collaboration Operations', 600);
  reporter.setCategoryThreshold('Transaction Operations', 500);
  reporter.setCategoryThreshold('Session Operations', 100);

  // Set specific tool thresholds
  reporter.setThreshold('sheets_auth:status', 50);
  reporter.setThreshold('sheets_core:get', 300);
  reporter.setThreshold('sheets_data:read', 400);
  reporter.setThreshold('sheets_data:write', 500);
  reporter.setThreshold('sheets_analyze:comprehensive', 2000);

  return reporter;
}

/**
 * Print results to console
 */
export function printResults(results: BenchmarkResult[]): void {
  console.log('\n📊 Benchmark Results\n');
  console.log('| Benchmark | P50 | P95 | P99 | Runs |');
  console.log('|-----------|-----|-----|-----|------|');

  for (const result of results) {
    console.log(
      `| ${result.name} | ${formatDuration(result.statistics.p50)} | ` +
        `${formatDuration(result.statistics.p95)} | ${formatDuration(result.statistics.p99)} | ` +
        `${result.statistics.count} |`
    );
  }

  console.log('');
}
