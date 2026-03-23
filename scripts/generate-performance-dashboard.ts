#!/usr/bin/env tsx

/**
 * Performance Dashboard Generator
 *
 * Generates an HTML dashboard with charts showing performance trends over time.
 * Uses Chart.js for visualization and displays regression alerts.
 *
 * Usage:
 *   npm run perf:dashboard
 *   tsx scripts/generate-performance-dashboard.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PerformanceBaseline } from '../tests/benchmarks/performance-baseline.js';

// Configuration
const HISTORY_DIR = join(process.cwd(), '.performance-history', 'history');
const OUTPUT_FILE = join(process.cwd(), '.performance-history', 'dashboard.html');

/**
 * Load all historical baselines
 */
function loadHistory(): PerformanceBaseline[] {
  if (!existsSync(HISTORY_DIR)) {
    console.error('No performance history found. Run benchmarks first.');
    process.exit(1);
  }

  const files = readdirSync(HISTORY_DIR)
    .filter((f) => f.startsWith('baseline-') && f.endsWith('.json'))
    .sort();

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
 * Extract time series data for a specific metric
 */
function extractTimeSeries(
  history: PerformanceBaseline[],
  testName: string,
  metricPath: string
): Array<{ timestamp: string; value: number; commit: string }> {
  return history
    .map((baseline) => {
      const metric = baseline.metrics.find((m) => m.name === testName);
      if (!metric) return null;

      const pathParts = metricPath.split('.');
      let value: any = metric;
      for (const part of pathParts) {
        value = value?.[part];
      }

      if (typeof value !== 'number') return null;

      return {
        timestamp: baseline.timestamp,
        value,
        commit: baseline.gitCommit,
      };
    })
    .filter((d): d is { timestamp: string; value: number; commit: string } => d !== null);
}

/**
 * Get unique test names from history
 */
function getUniqueTests(history: PerformanceBaseline[]): string[] {
  const testNames = new Set<string>();
  for (const baseline of history) {
    for (const metric of baseline.metrics) {
      testNames.add(metric.name);
    }
  }
  return Array.from(testNames).sort();
}

/**
 * Calculate regression alerts
 */
function calculateRegressionAlerts(history: PerformanceBaseline[]): Array<{
  test: string;
  metric: string;
  changePercent: number;
  timestamp: string;
}> {
  if (history.length < 2) return [];

  const alerts: Array<{
    test: string;
    metric: string;
    changePercent: number;
    timestamp: string;
  }> = [];

  const latest = history[history.length - 1];
  const previous = history[history.length - 2];

  for (const latestMetric of latest.metrics) {
    const previousMetric = previous.metrics.find((m) => m.name === latestMetric.name);
    if (!previousMetric) continue;

    // Check P95 latency
    const p95Change =
      ((latestMetric.latency.p95 - previousMetric.latency.p95) / previousMetric.latency.p95) * 100;

    if (p95Change > 15) {
      alerts.push({
        test: latestMetric.name,
        metric: 'latency.p95',
        changePercent: p95Change,
        timestamp: latest.timestamp,
      });
    }

    // Check memory
    if (latestMetric.memory && previousMetric.memory) {
      const memChange =
        ((latestMetric.memory.heapUsed - previousMetric.memory.heapUsed) /
          previousMetric.memory.heapUsed) *
        100;

      if (memChange > 20) {
        alerts.push({
          test: latestMetric.name,
          metric: 'memory.heapUsed',
          changePercent: memChange,
          timestamp: latest.timestamp,
        });
      }
    }

    // Check throughput
    if (latestMetric.throughput !== undefined && previousMetric.throughput !== undefined) {
      const throughputChange =
        ((latestMetric.throughput - previousMetric.throughput) / previousMetric.throughput) * 100;

      if (throughputChange < -15) {
        alerts.push({
          test: latestMetric.name,
          metric: 'throughput',
          changePercent: throughputChange,
          timestamp: latest.timestamp,
        });
      }
    }
  }

  return alerts;
}

/**
 * Generate HTML dashboard
 */
function generateDashboard(history: PerformanceBaseline[]): string {
  const tests = getUniqueTests(history);
  const alerts = calculateRegressionAlerts(history);

  // Extract time series for key metrics
  const latencyData = tests
    .filter((test) => test.startsWith('handler.'))
    .map((test) => ({
      name: test,
      data: extractTimeSeries(history, test, 'latency.p95'),
    }));

  const memoryData = tests
    .filter((test) => test.startsWith('handler.'))
    .map((test) => ({
      name: test,
      data: extractTimeSeries(history, test, 'memory.heapUsed'),
    }))
    .filter((d) => d.data.length > 0);

  const throughputData = tests
    .filter((test) => test.startsWith('throughput.'))
    .map((test) => ({
      name: test,
      data: extractTimeSeries(history, test, 'throughput'),
    }))
    .filter((d) => d.data.length > 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ServalSheets Performance Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      padding: 20px;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 8px 32px rgba(102, 126, 234, 0.3);
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 10px;
    }

    .subtitle {
      font-size: 1.1rem;
      opacity: 0.9;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: #1a1a1a;
      padding: 25px;
      border-radius: 10px;
      border: 1px solid #2a2a2a;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .stat-card h3 {
      font-size: 0.9rem;
      color: #888;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .stat-card .value {
      font-size: 2.5rem;
      font-weight: 700;
      color: #667eea;
    }

    .alerts {
      background: #1a1a1a;
      padding: 25px;
      border-radius: 10px;
      margin-bottom: 30px;
      border: 1px solid #2a2a2a;
    }

    .alerts h2 {
      font-size: 1.5rem;
      margin-bottom: 20px;
      color: #ff6b6b;
    }

    .alert {
      background: #2a1a1a;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 10px;
      border-left: 4px solid #ff6b6b;
    }

    .alert .test-name {
      font-weight: 600;
      color: #fff;
      margin-bottom: 5px;
    }

    .alert .metric {
      color: #888;
      font-size: 0.9rem;
    }

    .alert .change {
      color: #ff6b6b;
      font-weight: 600;
      font-size: 1.1rem;
    }

    .no-alerts {
      color: #51cf66;
      font-size: 1.1rem;
    }

    .charts {
      display: grid;
      gap: 30px;
    }

    .chart-container {
      background: #1a1a1a;
      padding: 25px;
      border-radius: 10px;
      border: 1px solid #2a2a2a;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .chart-container h2 {
      font-size: 1.3rem;
      margin-bottom: 20px;
      color: #667eea;
    }

    .chart-wrapper {
      position: relative;
      height: 400px;
    }

    footer {
      margin-top: 50px;
      padding: 20px;
      text-align: center;
      color: #666;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>ServalSheets Performance Dashboard</h1>
    <div class="subtitle">Automated Performance Regression Tracking</div>
  </div>

  <div class="summary">
    <div class="stat-card">
      <h3>Total Runs</h3>
      <div class="value">${history.length}</div>
    </div>
    <div class="stat-card">
      <h3>Tests Tracked</h3>
      <div class="value">${tests.length}</div>
    </div>
    <div class="stat-card">
      <h3>Active Alerts</h3>
      <div class="value">${alerts.length}</div>
    </div>
    <div class="stat-card">
      <h3>Last Updated</h3>
      <div class="value" style="font-size: 1.2rem;">${new Date(history[history.length - 1]?.timestamp ?? Date.now()).toLocaleDateString()}</div>
    </div>
  </div>

  <div class="alerts">
    <h2>Regression Alerts</h2>
    ${
      alerts.length === 0
        ? '<div class="no-alerts">✓ No performance regressions detected</div>'
        : alerts
            .map(
              (alert) => `
      <div class="alert">
        <div class="test-name">${alert.test}</div>
        <div class="metric">${alert.metric}</div>
        <div class="change">+${alert.changePercent.toFixed(1)}% regression</div>
      </div>
    `
            )
            .join('')
    }
  </div>

  <div class="charts">
    <div class="chart-container">
      <h2>Handler Execution Latency (P95)</h2>
      <div class="chart-wrapper">
        <canvas id="latencyChart"></canvas>
      </div>
    </div>

    ${
      memoryData.length > 0
        ? `
    <div class="chart-container">
      <h2>Memory Usage (Heap)</h2>
      <div class="chart-wrapper">
        <canvas id="memoryChart"></canvas>
      </div>
    </div>
    `
        : ''
    }

    ${
      throughputData.length > 0
        ? `
    <div class="chart-container">
      <h2>Throughput (ops/sec)</h2>
      <div class="chart-wrapper">
        <canvas id="throughputChart"></canvas>
      </div>
    </div>
    `
        : ''
    }
  </div>

  <footer>
    Generated on ${new Date().toLocaleString()} | ServalSheets Performance Tracking
  </footer>

  <script>
    const latencyData = ${JSON.stringify(latencyData)};
    const memoryData = ${JSON.stringify(memoryData)};
    const throughputData = ${JSON.stringify(throughputData)};

    // Configure Chart.js defaults
    Chart.defaults.color = '#e0e0e0';
    Chart.defaults.borderColor = '#2a2a2a';
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif';

    // Color palette
    const colors = [
      '#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b',
      '#fa709a', '#fee140', '#30cfd0', '#a8edea', '#fed6e3'
    ];

    // Latency Chart
    if (latencyData.length > 0) {
      new Chart(document.getElementById('latencyChart'), {
        type: 'line',
        data: {
          datasets: latencyData.map((series, idx) => ({
            label: series.name,
            data: series.data.map(d => ({ x: new Date(d.timestamp), y: d.value })),
            borderColor: colors[idx % colors.length],
            backgroundColor: colors[idx % colors.length] + '20',
            borderWidth: 2,
            tension: 0.3,
            fill: false,
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (context) => context.dataset.label + ': ' + context.parsed.y.toFixed(2) + 'ms'
              }
            }
          },
          scales: {
            x: { type: 'time', time: { unit: 'day' }, title: { display: true, text: 'Date' } },
            y: { title: { display: true, text: 'Latency (ms)' }, beginAtZero: true }
          },
          interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
      });
    }

    // Memory Chart
    if (memoryData.length > 0) {
      new Chart(document.getElementById('memoryChart'), {
        type: 'line',
        data: {
          datasets: memoryData.map((series, idx) => ({
            label: series.name,
            data: series.data.map(d => ({ x: new Date(d.timestamp), y: d.value / 1024 / 1024 })),
            borderColor: colors[idx % colors.length],
            backgroundColor: colors[idx % colors.length] + '20',
            borderWidth: 2,
            tension: 0.3,
            fill: false,
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (context) => context.dataset.label + ': ' + context.parsed.y.toFixed(2) + 'MB'
              }
            }
          },
          scales: {
            x: { type: 'time', time: { unit: 'day' }, title: { display: true, text: 'Date' } },
            y: { title: { display: true, text: 'Memory (MB)' }, beginAtZero: true }
          },
          interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
      });
    }

    // Throughput Chart
    if (throughputData.length > 0) {
      new Chart(document.getElementById('throughputChart'), {
        type: 'line',
        data: {
          datasets: throughputData.map((series, idx) => ({
            label: series.name,
            data: series.data.map(d => ({ x: new Date(d.timestamp), y: d.value })),
            borderColor: colors[idx % colors.length],
            backgroundColor: colors[idx % colors.length] + '20',
            borderWidth: 2,
            tension: 0.3,
            fill: false,
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (context) => context.dataset.label + ': ' + context.parsed.y.toFixed(0) + ' ops/sec'
              }
            }
          },
          scales: {
            x: { type: 'time', time: { unit: 'day' }, title: { display: true, text: 'Date' } },
            y: { title: { display: true, text: 'Throughput (ops/sec)' }, beginAtZero: true }
          },
          interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Main execution
 */
try {
  console.log('Generating performance dashboard...');

  const history = loadHistory();

  if (history.length === 0) {
    console.error('No performance history found. Run benchmarks first.');
    process.exit(1);
  }

  const html = generateDashboard(history);
  writeFileSync(OUTPUT_FILE, html);

  console.log(`\nDashboard generated: ${OUTPUT_FILE}`);
  console.log(`Total runs: ${history.length}`);
  console.log(`Tests tracked: ${getUniqueTests(history).length}`);
  console.log(`\nOpen in browser: file://${OUTPUT_FILE}`);
} catch (error) {
  console.error('Failed to generate dashboard:', (error as Error).message);
  process.exit(1);
}
