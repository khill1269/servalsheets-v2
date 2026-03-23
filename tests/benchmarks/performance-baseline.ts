/**
 * Performance Baseline Tracker
 *
 * Stores and compares performance metrics across commits.
 * Detects regressions in latency, memory usage, and throughput.
 *
 * Usage:
 *   import { storeBaseline, compareWithBaseline, loadBaseline } from './performance-baseline.js';
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Performance metrics for a single test
 */
export interface PerformanceMetrics {
  name: string;
  latency: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
    stdDev: number;
  };
  memory?: {
    heapUsed: number;
    external: number;
    rss: number;
  };
  throughput?: number; // ops/sec
}

/**
 * Complete baseline snapshot
 */
export interface PerformanceBaseline {
  timestamp: string;
  gitCommit: string;
  gitBranch: string;
  nodeVersion: string;
  platform: string;
  cpuModel: string;
  metrics: PerformanceMetrics[];
}

/**
 * Regression detection result
 */
export interface RegressionResult {
  test: string;
  metric: string;
  baseline: number;
  current: number;
  changePercent: number;
  severity: 'critical' | 'warning' | 'info';
}

// Configuration
const BASELINE_DIR = join(process.cwd(), '.performance-history');
const BASELINE_FILE = join(BASELINE_DIR, 'baseline.json');
const HISTORY_DIR = join(BASELINE_DIR, 'history');

// Regression thresholds
const THRESHOLDS = {
  latency: {
    critical: 20, // 20% increase is critical
    warning: 15, // 15% increase is warning
  },
  memory: {
    critical: 25, // 25% increase is critical
    warning: 20, // 20% increase is warning
  },
  throughput: {
    critical: -20, // 20% decrease is critical
    warning: -15, // 15% decrease is warning
  },
};

/**
 * Initialize baseline directory structure
 */
export function initializeBaselineStorage(): void {
  if (!existsSync(BASELINE_DIR)) {
    mkdirSync(BASELINE_DIR, { recursive: true });
  }
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

/**
 * Get current git information
 */
function getGitInfo(): { commit: string; branch: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

/**
 * Get system information
 */
async function getSystemInfo(): Promise<{ cpuModel: string; platform: string }> {
  const os = await import('node:os');
  const cpus = os.cpus();
  return {
    cpuModel: cpus[0]?.model ?? 'unknown',
    platform: `${os.platform()} ${os.release()}`,
  };
}

/**
 * Store performance baseline
 */
export async function storeBaseline(metrics: PerformanceMetrics[]): Promise<string> {
  initializeBaselineStorage();

  const gitInfo = getGitInfo();
  const systemInfo = getSystemInfo();

  const baseline: PerformanceBaseline = {
    timestamp: new Date().toISOString(),
    gitCommit: gitInfo.commit,
    gitBranch: gitInfo.branch,
    nodeVersion: process.version,
    platform: systemInfo.platform,
    cpuModel: systemInfo.cpuModel,
    metrics,
  };

  // Save as current baseline
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));

  // Save to history
  const historyFile = join(
    HISTORY_DIR,
    `baseline-${baseline.timestamp.replace(/:/g, '-').replace(/\./g, '-')}.json`
  );
  writeFileSync(historyFile, JSON.stringify(baseline, null, 2));

  return historyFile;
}

/**
 * Load current baseline
 */
export function loadBaseline(): PerformanceBaseline | null {
  if (!existsSync(BASELINE_FILE)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as PerformanceBaseline;
  } catch {
    return null;
  }
}

/**
 * Load all historical baselines
 */
export function loadHistory(): PerformanceBaseline[] {
  if (!existsSync(HISTORY_DIR)) {
    return [];
  }

  const files = readdirSync(HISTORY_DIR)
    .filter((f) => f.startsWith('baseline-') && f.endsWith('.json'))
    .sort()
    .reverse(); // Most recent first

  return files
    .map((file) => {
      try {
        return JSON.parse(readFileSync(join(HISTORY_DIR, file), 'utf-8')) as PerformanceBaseline;
      } catch {
        return null;
      }
    })
    .filter((b): b is PerformanceBaseline => b !== null);
}

/**
 * Compare current metrics against baseline
 */
export function compareWithBaseline(
  current: PerformanceMetrics[],
  baseline: PerformanceBaseline | null
): {
  regressions: RegressionResult[];
  improvements: RegressionResult[];
  unchanged: string[];
} {
  if (!baseline) {
    return { regressions: [], improvements: [], unchanged: [] };
  }

  const regressions: RegressionResult[] = [];
  const improvements: RegressionResult[] = [];
  const unchanged: string[] = [];

  for (const currentMetric of current) {
    const baselineMetric = baseline.metrics.find((m) => m.name === currentMetric.name);

    if (!baselineMetric) {
      // New test, skip comparison
      continue;
    }

    // Compare latency metrics
    const latencyComparison = compareLatency(currentMetric, baselineMetric);
    if (latencyComparison.length > 0) {
      for (const result of latencyComparison) {
        if (result.changePercent > THRESHOLDS.latency.warning) {
          regressions.push(result);
        } else if (result.changePercent < -5) {
          improvements.push(result);
        }
      }
    }

    // Compare memory metrics
    if (currentMetric.memory && baselineMetric.memory) {
      const memoryComparison = compareMemory(currentMetric, baselineMetric);
      if (memoryComparison.length > 0) {
        for (const result of memoryComparison) {
          if (result.changePercent > THRESHOLDS.memory.warning) {
            regressions.push(result);
          } else if (result.changePercent < -5) {
            improvements.push(result);
          }
        }
      }
    }

    // Compare throughput
    if (currentMetric.throughput !== undefined && baselineMetric.throughput !== undefined) {
      const throughputResult = compareThroughput(currentMetric, baselineMetric);
      if (throughputResult) {
        if (throughputResult.changePercent < THRESHOLDS.throughput.warning) {
          regressions.push(throughputResult);
        } else if (throughputResult.changePercent > 5) {
          improvements.push(throughputResult);
        }
      }
    }

    // If no significant changes
    if (
      !regressions.some((r) => r.test === currentMetric.name) &&
      !improvements.some((i) => i.test === currentMetric.name)
    ) {
      unchanged.push(currentMetric.name);
    }
  }

  return { regressions, improvements, unchanged };
}

/**
 * Compare latency metrics
 */
function compareLatency(
  current: PerformanceMetrics,
  baseline: PerformanceMetrics
): RegressionResult[] {
  const results: RegressionResult[] = [];
  const metrics = ['mean', 'median', 'p95', 'p99'] as const;

  for (const metric of metrics) {
    const currentValue = current.latency[metric];
    const baselineValue = baseline.latency[metric];
    const changePercent = ((currentValue - baselineValue) / baselineValue) * 100;

    let severity: 'critical' | 'warning' | 'info' = 'info';
    if (Math.abs(changePercent) >= THRESHOLDS.latency.critical) {
      severity = 'critical';
    } else if (Math.abs(changePercent) >= THRESHOLDS.latency.warning) {
      severity = 'warning';
    }

    results.push({
      test: current.name,
      metric: `latency.${metric}`,
      baseline: baselineValue,
      current: currentValue,
      changePercent,
      severity,
    });
  }

  return results;
}

/**
 * Compare memory metrics
 */
function compareMemory(
  current: PerformanceMetrics,
  baseline: PerformanceMetrics
): RegressionResult[] {
  if (!current.memory || !baseline.memory) {
    return [];
  }

  const results: RegressionResult[] = [];
  const metrics = ['heapUsed', 'external', 'rss'] as const;

  for (const metric of metrics) {
    const currentValue = current.memory[metric];
    const baselineValue = baseline.memory[metric];
    const changePercent = ((currentValue - baselineValue) / baselineValue) * 100;

    let severity: 'critical' | 'warning' | 'info' = 'info';
    if (changePercent >= THRESHOLDS.memory.critical) {
      severity = 'critical';
    } else if (changePercent >= THRESHOLDS.memory.warning) {
      severity = 'warning';
    }

    results.push({
      test: current.name,
      metric: `memory.${metric}`,
      baseline: baselineValue,
      current: currentValue,
      changePercent,
      severity,
    });
  }

  return results;
}

/**
 * Compare throughput metrics
 */
function compareThroughput(
  current: PerformanceMetrics,
  baseline: PerformanceMetrics
): RegressionResult | null {
  if (current.throughput === undefined || baseline.throughput === undefined) {
    return null;
  }

  const changePercent = ((current.throughput - baseline.throughput) / baseline.throughput) * 100;

  let severity: 'critical' | 'warning' | 'info' = 'info';
  if (changePercent <= THRESHOLDS.throughput.critical) {
    severity = 'critical';
  } else if (changePercent <= THRESHOLDS.throughput.warning) {
    severity = 'warning';
  }

  return {
    test: current.name,
    metric: 'throughput',
    baseline: baseline.throughput,
    current: current.throughput,
    changePercent,
    severity,
  };
}

/**
 * Generate comparison report
 */
export function generateReport(
  current: PerformanceMetrics[],
  baseline: PerformanceBaseline | null,
  comparison: ReturnType<typeof compareWithBaseline>
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('='.repeat(80));
  lines.push('Performance Regression Report');
  lines.push('='.repeat(80));
  lines.push('');

  if (!baseline) {
    lines.push('No baseline found. Creating new baseline from current run.');
    lines.push(`Total tests: ${current.length}`);
    lines.push('');
    return lines.join('\n');
  }

  const gitInfo = getGitInfo();
  lines.push(`Current:  ${gitInfo.commit} (${gitInfo.branch})`);
  lines.push(`Baseline: ${baseline.gitCommit} (${baseline.gitBranch})`);
  lines.push(`Baseline Date: ${baseline.timestamp}`);
  lines.push('');

  // Critical regressions
  const critical = comparison.regressions.filter((r) => r.severity === 'critical');
  if (critical.length > 0) {
    lines.push('CRITICAL REGRESSIONS:');
    for (const reg of critical) {
      lines.push(
        `  ${reg.test} - ${reg.metric}: ${formatValue(reg.baseline)} → ${formatValue(reg.current)} (${reg.changePercent.toFixed(1)}%)`
      );
    }
    lines.push('');
  }

  // Warnings
  const warnings = comparison.regressions.filter((r) => r.severity === 'warning');
  if (warnings.length > 0) {
    lines.push('WARNINGS:');
    for (const warn of warnings) {
      lines.push(
        `  ${warn.test} - ${warn.metric}: ${formatValue(warn.baseline)} → ${formatValue(warn.current)} (${warn.changePercent.toFixed(1)}%)`
      );
    }
    lines.push('');
  }

  // Improvements
  if (comparison.improvements.length > 0) {
    lines.push('IMPROVEMENTS:');
    for (const imp of comparison.improvements) {
      lines.push(
        `  ${imp.test} - ${imp.metric}: ${formatValue(imp.baseline)} → ${formatValue(imp.current)} (${imp.changePercent.toFixed(1)}%)`
      );
    }
    lines.push('');
  }

  // Summary
  lines.push('SUMMARY:');
  lines.push(`  Total tests: ${current.length}`);
  lines.push(`  Critical regressions: ${critical.length}`);
  lines.push(`  Warnings: ${warnings.length}`);
  lines.push(`  Improvements: ${comparison.improvements.length}`);
  lines.push(`  Unchanged: ${comparison.unchanged.length}`);
  lines.push('');
  lines.push('='.repeat(80));

  return lines.join('\n');
}

/**
 * Format value based on metric type
 */
function formatValue(value: number): string {
  if (value < 1) {
    return `${(value * 1000).toFixed(2)}μs`;
  }
  if (value < 1000) {
    return `${value.toFixed(2)}ms`;
  }
  if (value < 1000000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${(value / 1024 / 1024).toFixed(2)}MB`;
}
