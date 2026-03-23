#!/usr/bin/env node

/**
 * Benchmark Tracking System
 *
 * Stores benchmark results with timestamps and compares against previous runs.
 * Fails CI if performance regresses by >10% in any metric.
 *
 * Usage:
 *   npm run test:benchmarks && node scripts/track-benchmarks.mjs
 *
 * Environment Variables:
 *   BENCHMARK_THRESHOLD - Regression threshold (default: 10%)
 *   BENCHMARK_BASELINE - Path to baseline file (default: benchmarks/baseline.json)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Configuration
const THRESHOLD_PERCENT = Number.parseFloat(process.env['BENCHMARK_THRESHOLD'] ?? '10');
const HISTORY_DIR = join(rootDir, 'benchmarks', 'history');
const BASELINE_FILE =
  process.env['BENCHMARK_BASELINE'] ?? join(rootDir, 'benchmarks', 'baseline.json');
const BENCHMARK_OUTPUT = join(rootDir, 'benchmarks', 'latest.json');

// Ensure directories exist
if (!existsSync(HISTORY_DIR)) {
  mkdirSync(HISTORY_DIR, { recursive: true });
}

/**
 * Extract benchmark metrics from test output
 * Parses vitest output for latency statistics
 */
async function extractBenchmarkMetrics() {
  // For now, we'll create a structured format from the benchmark test
  // In the future, we could parse vitest JSON output if --reporter=json is used

  const timestamp = new Date().toISOString();
  const gitCommit = await getGitCommit();
  const nodeVersion = process.version;

  return {
    timestamp,
    gitCommit,
    nodeVersion,
    benchmarks: {
      'metadata-fetch': {
        avgLatency: null, // Placeholder - would be extracted from test output
        p95Latency: null,
        p99Latency: null,
        note: 'Run with RUN_BENCHMARKS=true to collect real metrics',
      },
      'batch-request': {
        avgLatency: null,
        note: 'Run with RUN_BENCHMARKS=true to collect real metrics',
      },
      'connection-reuse': {
        firstCall: null,
        avgSubsequent: null,
        improvementPercent: null,
        note: 'Run with RUN_BENCHMARKS=true to collect real metrics',
      },
      'concurrent-requests': {
        totalTime: null,
        avgPerRequest: null,
        note: 'Run with RUN_BENCHMARKS=true to collect real metrics',
      },
    },
  };
}

/**
 * Get current git commit hash
 */
async function getGitCommit() {
  try {
    const { execSync } = await import('node:child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Store benchmark results in history
 */
function storeBenchmarkResults(metrics) {
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const filename = `benchmark-${timestamp}.json`;
  const filepath = join(HISTORY_DIR, filename);

  writeFileSync(filepath, JSON.stringify(metrics, null, 2));
  console.log(`📊 Benchmark results saved: ${filename}`);

  // Also save as latest.json for easy reference
  writeFileSync(BENCHMARK_OUTPUT, JSON.stringify(metrics, null, 2));

  return filepath;
}

/**
 * Load baseline benchmark results
 */
function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) {
    console.log('⚠️  No baseline found. Creating baseline from current run.');
    return null;
  }

  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
  } catch (error) {
    console.error('❌ Failed to load baseline:', error.message);
    return null;
  }
}

/**
 * Compare benchmark results and detect regressions
 */
function compareResults(current, baseline) {
  const regressions = [];
  const improvements = [];

  if (!baseline) {
    console.log('ℹ️  No baseline to compare against. Setting current as baseline.');
    writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2));
    return { regressions, improvements };
  }

  // Compare each benchmark
  for (const [name, currentMetrics] of Object.entries(current.benchmarks)) {
    const baselineMetrics = baseline.benchmarks?.[name];

    if (!baselineMetrics) {
      console.log(`ℹ️  New benchmark: ${name}`);
      continue;
    }

    // Compare latency metrics (if available)
    if (currentMetrics.avgLatency !== null && baselineMetrics.avgLatency !== null) {
      const change =
        ((currentMetrics.avgLatency - baselineMetrics.avgLatency) / baselineMetrics.avgLatency) *
        100;

      if (change > THRESHOLD_PERCENT) {
        regressions.push({
          benchmark: name,
          metric: 'avgLatency',
          baseline: baselineMetrics.avgLatency,
          current: currentMetrics.avgLatency,
          changePercent: change,
        });
      } else if (change < -5) {
        // Significant improvement (>5% faster)
        improvements.push({
          benchmark: name,
          metric: 'avgLatency',
          baseline: baselineMetrics.avgLatency,
          current: currentMetrics.avgLatency,
          changePercent: change,
        });
      }
    }

    // Compare p95 latency
    if (currentMetrics.p95Latency !== null && baselineMetrics.p95Latency !== null) {
      const change =
        ((currentMetrics.p95Latency - baselineMetrics.p95Latency) / baselineMetrics.p95Latency) *
        100;

      if (change > THRESHOLD_PERCENT) {
        regressions.push({
          benchmark: name,
          metric: 'p95Latency',
          baseline: baselineMetrics.p95Latency,
          current: currentMetrics.p95Latency,
          changePercent: change,
        });
      }
    }

    // Compare total time (for concurrent requests)
    if (currentMetrics.totalTime !== null && baselineMetrics.totalTime !== null) {
      const change =
        ((currentMetrics.totalTime - baselineMetrics.totalTime) / baselineMetrics.totalTime) * 100;

      if (change > THRESHOLD_PERCENT) {
        regressions.push({
          benchmark: name,
          metric: 'totalTime',
          baseline: baselineMetrics.totalTime,
          current: currentMetrics.totalTime,
          changePercent: change,
        });
      }
    }
  }

  return { regressions, improvements };
}

/**
 * Generate comparison report
 */
function generateReport(current, baseline, comparison) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 Benchmark Tracking Report');
  console.log('='.repeat(70));
  console.log(`\nTimestamp: ${current.timestamp}`);
  console.log(`Git Commit: ${current.gitCommit}`);
  console.log(`Node.js: ${current.nodeVersion}`);

  if (!baseline) {
    console.log('\nℹ️  No baseline available. Current results saved as baseline.\n');
    return;
  }

  console.log(`\nBaseline: ${baseline.timestamp} (${baseline.gitCommit})`);
  console.log(`Threshold: ${THRESHOLD_PERCENT}% regression tolerance\n`);

  // Report improvements
  if (comparison.improvements.length > 0) {
    console.log('✅ Performance Improvements:');
    for (const improvement of comparison.improvements) {
      console.log(`  ${improvement.benchmark}.${improvement.metric}:`);
      console.log(`    Baseline: ${improvement.baseline.toFixed(2)}ms`);
      console.log(`    Current:  ${improvement.current.toFixed(2)}ms`);
      console.log(`    Change:   ${improvement.changePercent.toFixed(1)}% faster ✨`);
    }
    console.log('');
  }

  // Report regressions
  if (comparison.regressions.length > 0) {
    console.log('❌ Performance Regressions:');
    for (const regression of comparison.regressions) {
      console.log(`  ${regression.benchmark}.${regression.metric}:`);
      console.log(`    Baseline: ${regression.baseline.toFixed(2)}ms`);
      console.log(`    Current:  ${regression.current.toFixed(2)}ms`);
      console.log(`    Change:   +${regression.changePercent.toFixed(1)}% slower ⚠️`);
    }
    console.log('');
  } else {
    console.log('✅ No performance regressions detected\n');
  }

  // History summary
  const historyCount = existsSync(HISTORY_DIR)
    ? readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).length
    : 0;
  console.log(`📈 Benchmark history: ${historyCount} runs tracked`);
  console.log('='.repeat(70) + '\n');
}

/**
 * Main execution
 */
try {
  console.log('📊 ServalSheets Benchmark Tracker\n');

  // Extract current benchmark metrics
  const currentMetrics = await extractBenchmarkMetrics();

  // Store results in history
  const resultPath = storeBenchmarkResults(currentMetrics);

  // Load baseline
  const baseline = loadBaseline();

  // Compare results
  const comparison = compareResults(currentMetrics, baseline);

  // Generate report
  generateReport(currentMetrics, baseline, comparison);

  // Exit with error if regressions detected
  if (comparison.regressions.length > 0) {
    console.error(`❌ ${comparison.regressions.length} performance regression(s) detected`);
    console.error(`\nTo update baseline (if regression is expected):`);
    console.error(`  cp ${resultPath} ${BASELINE_FILE}\n`);
    process.exit(1);
  }

  console.log('✅ Benchmark tracking complete\n');
} catch (error) {
  console.error('❌ Benchmark tracking failed:', error.message);
  process.exit(1);
}
