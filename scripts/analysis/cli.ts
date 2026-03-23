#!/usr/bin/env tsx
/**
 * Analysis CLI
 *
 * Command-line interface for the multi-agent analysis system:
 * - analyze <files...> - Analyze specific files
 * - watch <paths...> - Watch mode for continuous analysis
 * - report - Generate detailed report
 */

import { program } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { AnalysisOrchestrator, OrchestratorReport } from './orchestrator.js';
import { WatchMode } from './watch-mode.js';

// ============================================================================
// CLI COLORS
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// ============================================================================
// FORMATTERS
// ============================================================================

function formatTable(report: OrchestratorReport): void {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Multi-Agent Analysis Report');
  console.log('═══════════════════════════════════════════════════════\n');

  // File summary
  console.log(`Files analyzed: ${report.files.length}`);
  console.log(`Duration: ${formatDuration(report.duration)}\n`);

  // Agent summary table
  console.log('Agent Results:');
  console.log('─'.repeat(60));
  console.log('Agent                      Status    Issues    Duration');
  console.log('─'.repeat(60));

  for (const agentReport of report.agentReports) {
    const issueCount = agentReport.dimensionReports.reduce((sum, r) => sum + r.issueCount, 0);
    const status = agentReport.status.toUpperCase().padEnd(8);
    const statusColor =
      agentReport.status === 'pass'
        ? COLORS.green
        : agentReport.status === 'warning'
          ? COLORS.yellow
          : COLORS.red;

    console.log(
      `${agentReport.agentName.padEnd(25)} ${statusColor}${status}${COLORS.reset} ${String(issueCount).padEnd(8)} ${formatDuration(agentReport.duration)}`
    );
  }

  console.log('─'.repeat(60));

  // Issue summary
  console.log(`\nIssue Summary:`);
  console.log(`  Total: ${report.summary.totalIssues}`);
  if (report.summary.criticalIssues > 0) {
    console.log(`  ${COLORS.red}Critical: ${report.summary.criticalIssues}${COLORS.reset}`);
  }
  if (report.summary.highIssues > 0) {
    console.log(`  ${COLORS.red}High: ${report.summary.highIssues}${COLORS.reset}`);
  }
  if (report.summary.mediumIssues > 0) {
    console.log(`  ${COLORS.yellow}Medium: ${report.summary.mediumIssues}${COLORS.reset}`);
  }
  if (report.summary.lowIssues > 0) {
    console.log(`  ${COLORS.dim}Low: ${report.summary.lowIssues}${COLORS.reset}`);
  }
  console.log(`  False positives: ${report.summary.falsePositives}`);
  console.log(`  Auto-fixable: ${report.summary.autoFixable}`);
  if (report.summary.autoFixed > 0) {
    console.log(`  ${COLORS.green}Auto-fixed: ${report.summary.autoFixed}${COLORS.reset}`);
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(`\nRecommendations:`);
    for (const rec of report.recommendations) {
      console.log(`  ${rec}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════\n');
}

function formatJson(report: OrchestratorReport): void {
  console.log(JSON.stringify(report, null, 2));
}

function formatDetailed(report: OrchestratorReport): void {
  formatTable(report);

  // Detailed issues by dimension
  for (const agentReport of report.agentReports) {
    for (const dimReport of agentReport.dimensionReports) {
      if (dimReport.issueCount === 0) continue;

      console.log(
        `\n${COLORS.cyan}${agentReport.agentName} → ${dimReport.dimension}${COLORS.reset}`
      );
      console.log(`Status: ${dimReport.status.toUpperCase()}`);
      console.log(`Issues: ${dimReport.issueCount}\n`);

      for (const issue of dimReport.issues) {
        const severityColor =
          issue.severity === 'critical' || issue.severity === 'high'
            ? COLORS.red
            : issue.severity === 'medium'
              ? COLORS.yellow
              : COLORS.dim;

        console.log(
          `  ${severityColor}[${issue.severity.toUpperCase()}]${COLORS.reset} ${issue.message}`
        );
        console.log(`    File: ${issue.file}${issue.line ? `:${issue.line}` : ''}`);

        if (issue.suggestion) {
          console.log(`    ${COLORS.dim}→ ${issue.suggestion}${COLORS.reset}`);
        }

        if (issue.estimatedEffort) {
          console.log(`    Effort: ${issue.estimatedEffort}`);
        }

        if (issue.autoFixable) {
          console.log(`    ${COLORS.green}✓ Auto-fixable${COLORS.reset}`);
        }

        console.log('');
      }
    }
  }

  // Conflict resolutions
  if (report.resolvedConflicts.length > 0) {
    console.log(`\n${COLORS.cyan}Conflict Resolutions:${COLORS.reset}\n`);

    for (const conflict of report.resolvedConflicts) {
      console.log(`  Type: ${conflict.conflictType}`);
      console.log(`  Conflicts: ${conflict.issues.length} issues`);
      console.log(`  Resolution: ${conflict.resolution}`);
      console.log(`  Reasoning: ${conflict.reasoning}`);
      console.log(`  Winner: ${COLORS.green}${conflict.winner}${COLORS.reset}\n`);
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ============================================================================
// CLI COMMANDS
// ============================================================================

program
  .name('analysis')
  .description('Multi-agent code analysis system for ServalSheets')
  .version('1.0.0');

// Analyze command
program
  .command('analyze')
  .description('Analyze specific files or directories')
  .argument('<files...>', 'Files or directories to analyze')
  .option('-f, --format <type>', 'Output format (table|json|detailed)', 'table')
  .option('--fix', 'Apply auto-fixes where possible')
  .option('--exclude <agents>', 'Exclude specific agents (comma-separated)')
  .option('--min-confidence <level>', 'Minimum confidence level (high|medium|low)', 'medium')
  .option('-v, --verbose', 'Verbose output')
  .option('--fail-fast', 'Stop on first error')
  .action(async (files: string[], options) => {
    try {
      // Resolve file paths
      const resolvedFiles: string[] = [];
      for (const file of files) {
        const fullPath = path.resolve(file);

        if (fs.statSync(fullPath).isDirectory()) {
          // Recursively find .ts files
          const tsFiles = findTsFiles(fullPath);
          resolvedFiles.push(...tsFiles);
        } else {
          resolvedFiles.push(fullPath);
        }
      }

      if (resolvedFiles.length === 0) {
        console.error('No files found to analyze');
        process.exit(1);
      }

      if (options.format !== 'json') {
        console.log(`${COLORS.cyan}Analyzing ${resolvedFiles.length} file(s)...${COLORS.reset}\n`);
      }

      const orchestrator = new AnalysisOrchestrator({
        autoFix: options.fix,
        verbose: options.verbose,
        failFast: options.failFast,
        excludeAgents: options.exclude ? options.exclude.split(',') : undefined,
        minConfidence: options.minConfidence,
      });

      const report = await orchestrator.runFullAnalysis(resolvedFiles);

      // Format output
      switch (options.format) {
        case 'json':
          formatJson(report);
          break;
        case 'detailed':
          formatDetailed(report);
          break;
        case 'table':
        default:
          formatTable(report);
          break;
      }

      // Exit code based on results
      if (report.summary.criticalIssues > 0) {
        process.exit(2); // Critical issues
      } else if (report.summary.highIssues > 0) {
        process.exit(1); // High-priority issues
      }

      process.exit(0);
    } catch (error) {
      console.error(`${COLORS.red}Error:${COLORS.reset}`, error);
      process.exit(1);
    }
  });

// Watch command
program
  .command('watch')
  .description('Watch files for changes and analyze automatically')
  .argument('<paths...>', 'Paths to watch (files or directories)')
  .option('--fix', 'Apply auto-fixes on change')
  .option('--debounce <ms>', 'Debounce delay in milliseconds', '500')
  .option('--no-clear', 'Do not clear console on change')
  .option('--exclude <agents>', 'Exclude specific agents (comma-separated)')
  .option('--exclude-patterns <patterns>', 'Exclude file patterns (comma-separated)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (paths: string[], options) => {
    try {
      const watcher = new WatchMode({
        autoFix: options.fix,
        verbose: options.verbose,
        debounceMs: parseInt(options.debounce),
        clearConsole: options.clear,
        excludeAgents: options.exclude ? options.exclude.split(',') : undefined,
        excludePatterns: options.excludePatterns ? options.excludePatterns.split(',') : undefined,
      });

      await watcher.start(paths);
    } catch (error) {
      console.error(`${COLORS.red}Error:${COLORS.reset}`, error);
      process.exit(1);
    }
  });

// Report command (for CI/CD)
program
  .command('report')
  .description('Generate detailed report and save to file')
  .argument('<files...>', 'Files to analyze')
  .option('-o, --output <file>', 'Output file path', 'analysis-report.json')
  .option('--html', 'Generate HTML report')
  .option(
    '--fail-on <severity>',
    'Fail if issues of this severity found (critical|high|medium|low)',
    'critical'
  )
  .action(async (files: string[], options) => {
    try {
      const resolvedFiles: string[] = [];
      for (const file of files) {
        const fullPath = path.resolve(file);

        if (fs.statSync(fullPath).isDirectory()) {
          const tsFiles = findTsFiles(fullPath);
          resolvedFiles.push(...tsFiles);
        } else {
          resolvedFiles.push(fullPath);
        }
      }

      const orchestrator = new AnalysisOrchestrator({
        autoFix: false,
        verbose: false,
      });

      const report = await orchestrator.runFullAnalysis(resolvedFiles);

      // Save JSON report
      fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
      console.log(`${COLORS.green}✓ Report saved to ${options.output}${COLORS.reset}`);

      // Generate HTML if requested
      if (options.html) {
        const htmlPath = options.output.replace(/\.json$/, '.html');
        const html = generateHtmlReport(report);
        fs.writeFileSync(htmlPath, html);
        console.log(`${COLORS.green}✓ HTML report saved to ${htmlPath}${COLORS.reset}`);
      }

      // Check fail threshold
      const failOn = options.failOn;
      const severityOrder = ['critical', 'high', 'medium', 'low'];
      const failIndex = severityOrder.indexOf(failOn);

      let shouldFail = false;
      if (failIndex >= 0) {
        if (report.summary.criticalIssues > 0 && failIndex >= 0) shouldFail = true;
        if (report.summary.highIssues > 0 && failIndex >= 1) shouldFail = true;
        if (report.summary.mediumIssues > 0 && failIndex >= 2) shouldFail = true;
        if (report.summary.lowIssues > 0 && failIndex >= 3) shouldFail = true;
      }

      if (shouldFail) {
        console.log(
          `${COLORS.red}✗ Analysis failed (found ${failOn} or higher severity issues)${COLORS.reset}`
        );
        process.exit(1);
      }

      console.log(`${COLORS.green}✓ Analysis passed${COLORS.reset}`);
      process.exit(0);
    } catch (error) {
      console.error(`${COLORS.red}Error:${COLORS.reset}`, error);
      process.exit(1);
    }
  });

// ============================================================================
// HELPERS
// ============================================================================

function findTsFiles(dir: string): string[] {
  const files: string[] = [];

  const walk = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // Skip excluded directories
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git' ||
        entry.name === 'coverage'
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
  };

  walk(dir);
  return files;
}

function generateHtmlReport(report: OrchestratorReport): string {
  // Simple HTML template
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analysis Report - ${new Date(report.timestamp).toLocaleString()}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1, h2 { color: #333; }
    .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-item { display: flex; justify-content: space-between; margin: 10px 0; }
    .critical { color: #d32f2f; font-weight: bold; }
    .high { color: #f57c00; font-weight: bold; }
    .medium { color: #fbc02d; }
    .low { color: #616161; }
    .pass { color: #388e3c; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .issue { margin: 15px 0; padding: 15px; border-left: 4px solid #ccc; background: #fafafa; }
    .issue.critical { border-left-color: #d32f2f; }
    .issue.high { border-left-color: #f57c00; }
    .issue.medium { border-left-color: #fbc02d; }
  </style>
</head>
<body>
  <h1>Analysis Report</h1>
  <p>Generated: ${new Date(report.timestamp).toLocaleString()}</p>
  <p>Duration: ${formatDuration(report.duration)}</p>

  <div class="summary">
    <h2>Summary</h2>
    <div class="summary-item">
      <span>Total Issues:</span>
      <strong>${report.summary.totalIssues}</strong>
    </div>
    <div class="summary-item">
      <span>Critical:</span>
      <strong class="critical">${report.summary.criticalIssues}</strong>
    </div>
    <div class="summary-item">
      <span>High:</span>
      <strong class="high">${report.summary.highIssues}</strong>
    </div>
    <div class="summary-item">
      <span>Medium:</span>
      <strong class="medium">${report.summary.mediumIssues}</strong>
    </div>
    <div class="summary-item">
      <span>Low:</span>
      <strong class="low">${report.summary.lowIssues}</strong>
    </div>
  </div>

  <h2>Agent Results</h2>
  <table>
    <thead>
      <tr>
        <th>Agent</th>
        <th>Status</th>
        <th>Issues</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody>
      ${report.agentReports
        .map(
          (agent) => `
        <tr>
          <td>${agent.agentName}</td>
          <td class="${agent.status}">${agent.status.toUpperCase()}</td>
          <td>${agent.dimensionReports.reduce((sum, r) => sum + r.issueCount, 0)}</td>
          <td>${formatDuration(agent.duration)}</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  <h2>Issues</h2>
  ${report.validatedFindings
    .filter((f) => !f.isFalsePositive)
    .map(
      (f) => `
    <div class="issue ${f.issue.severity}">
      <strong class="${f.issue.severity}">[${f.issue.severity.toUpperCase()}]</strong>
      ${f.issue.message}
      <br>
      <small>File: ${f.issue.file}${f.issue.line ? `:${f.issue.line}` : ''}</small>
      ${f.issue.suggestion ? `<br><em>→ ${f.issue.suggestion}</em>` : ''}
    </div>
  `
    )
    .join('')}

  <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666;">
    <p>Generated by ServalSheets Multi-Agent Analysis System</p>
  </footer>
</body>
</html>
  `.trim();
}

// ============================================================================
// RUN CLI
// ============================================================================

program.parse();
