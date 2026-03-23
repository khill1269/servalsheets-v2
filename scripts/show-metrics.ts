#!/usr/bin/env tsx
/**
 * ServalSheets Metrics Dashboard CLI
 *
 * Display API efficiency metrics and cost savings.
 * Run: npm run metrics
 */

import {
  generateMetricsDashboard,
  formatDashboardAsText,
} from '../src/services/metrics-dashboard.js';

async function main() {
  try {
    console.log('Generating metrics dashboard...\n');
    const dashboard = await generateMetricsDashboard();
    const formatted = formatDashboardAsText(dashboard);
    console.log(formatted);

    // Also output JSON for programmatic access
    if (process.argv.includes('--json')) {
      console.log('\n📄 JSON Output:\n');
      console.log(JSON.stringify(dashboard, null, 2));
    }

    // Show help
    if (process.argv.includes('--help')) {
      console.log(`
Usage: npm run metrics [options]

Options:
  --json    Also output metrics in JSON format
  --help    Show this help message

Metrics are collected via Prometheus and include:
  • API efficiency gains (batching, caching, deduplication)
  • Performance statistics
  • Tool usage analytics
  • Cost savings estimates

Raw Prometheus metrics available at: GET /metrics (when server is running)
      `);
    }
  } catch (error) {
    console.error('Error generating metrics dashboard:', error);
    console.log('\n⚠️  Note: Metrics are only available after server has processed requests.');
    console.log('   Start the server and make some API calls first.');
    process.exit(1);
  }
}

main();
