#!/usr/bin/env tsx
/**
 * Consistency Check Example
 *
 * Demonstrates using ConsistencyAgent to check a file for convention violations
 */

import { AnalysisOrchestrator } from '../multi-agent-analysis.js';
import { ConsistencyAgent } from '../agents/consistency-agent.js';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const filePath = args[0];

  if (!filePath) {
    console.error('Usage: npx tsx consistency-check-example.ts <file>');
    console.error('');
    console.error('Example:');
    console.error('  npx tsx consistency-check-example.ts src/handlers/data.ts');
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Consistency Analysis Report');
  console.log('═══════════════════════════════════════════════════════\n');

  const context = {
    projectRoot: path.resolve(__dirname, '../../..'),
    projectFiles: [],
    testFiles: [],
    dependencies: {},
  };

  // Create orchestrator and register ConsistencyAgent
  const orchestrator = new AnalysisOrchestrator();
  orchestrator.registerAgent(new ConsistencyAgent());

  // Run analysis
  const report = await orchestrator.analyzeFile(absolutePath, context);

  console.log(`File: ${filePath}`);
  console.log(`Status: ${report.overallStatus.toUpperCase()}`);
  console.log(`Duration: ${report.duration}ms\n`);

  // Show consistency-specific reports
  const consistencyDimensions = [
    'namingConventions',
    'importOrdering',
    'errorHandling',
    'responseFormat',
    'commentStyle',
  ];

  for (const dimension of consistencyDimensions) {
    const dimReport = report.dimensions[dimension];
    if (!dimReport) continue;

    console.log(`\n${dimension} (${dimReport.status}):`);
    if (dimReport.issueCount === 0) {
      console.log('  ✓ No issues found');
    } else {
      for (const issue of dimReport.issues) {
        const location = issue.line ? `:${issue.line}` : '';
        console.log(`  ${issue.severity.toUpperCase()}: ${issue.message}${location}`);
        if (issue.suggestion) {
          console.log(`    → ${issue.suggestion}`);
        }
        if (issue.autoFixable) {
          console.log(`    ⚡ Auto-fixable`);
        }
      }
    }

    if (dimReport.metrics) {
      console.log(`\n  Metrics:`);
      for (const [key, value] of Object.entries(dimReport.metrics)) {
        console.log(`    ${key}: ${value}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════\n');

  if (report.recommendations.length > 0) {
    console.log('Recommendations:');
    for (const rec of report.recommendations) {
      console.log(`  ${rec}`);
    }
    console.log('');
  }

  process.exit(report.overallStatus === 'fail' ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
