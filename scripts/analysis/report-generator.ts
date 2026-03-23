#!/usr/bin/env tsx
/**
 * Report Generator for Multi-Agent Analysis
 *
 * Generates analysis reports in multiple formats:
 * - JSON (machine-readable)
 * - HTML (browser-viewable)
 * - Markdown (human-readable, GitHub-friendly)
 *
 * @module analysis/report-generator
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisIssue } from './multi-agent-analysis.js';
import type { OrchestratorReport as RawOrchestratorReport } from './orchestrator.js';

// ============================================================================
// REPORT FORMATS
// ============================================================================

export type ReportFormat = 'json' | 'html' | 'markdown';

export interface NormalizedReport {
  timestamp: string;
  overallScore: number;
  agents: AgentSummary[];
  issues: AnalysisIssue[];
  autoFixesApplied: number;
  duration: number;
}

export interface AgentSummary {
  name: string;
  status: 'pass' | 'warning' | 'fail';
  issues: AnalysisIssue[];
}

// ============================================================================
// REPORT GENERATOR CLASS
// ============================================================================

export class ReportGenerator {
  /**
   * Generate report in specified format
   */
  generateReport(report: NormalizedReport, format: ReportFormat): string {
    switch (format) {
      case 'json':
        return this.generateJSON(report);

      case 'html':
        return this.generateHTML(report);

      case 'markdown':
        return this.generateMarkdown(report);

      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }

  /**
   * Generate JSON report (machine-readable)
   */
  private generateJSON(report: NormalizedReport): string {
    const summary = {
      timestamp: report.timestamp,
      score: report.overallScore,
      agents: report.agents.map((a) => ({
        name: a.name,
        status: a.status,
        issueCount: a.issues.length,
      })),
      critical: report.issues.filter((i) => i.severity === 'critical').length,
      high: report.issues.filter((i) => i.severity === 'high').length,
      medium: report.issues.filter((i) => i.severity === 'medium').length,
      low: report.issues.filter((i) => i.severity === 'low').length,
      autoFixable: report.issues.filter((i) => i.autoFixable).length,
    };

    return JSON.stringify(
      {
        summary,
        issues: report.issues,
        autoFixesApplied: report.autoFixesApplied,
        duration: report.duration,
      },
      null,
      2
    );
  }

  /**
   * Generate HTML report (browser-viewable)
   */
  private generateHTML(report: NormalizedReport): string {
    const critical = report.issues.filter((i) => i.severity === 'critical').length;
    const high = report.issues.filter((i) => i.severity === 'high').length;
    const medium = report.issues.filter((i) => i.severity === 'medium').length;
    const low = report.issues.filter((i) => i.severity === 'low').length;
    const autoFixable = report.issues.filter((i) => i.autoFixable).length;

    const statusColor = critical > 0 ? '#dc3545' : high > 0 ? '#ffc107' : '#28a745';

    const agentRows = report.agents
      .map(
        (a) => `
        <tr>
          <td>${a.name}</td>
          <td><span class="badge badge-${a.status}">${a.status}</span></td>
          <td>${a.issues.length}</td>
        </tr>
      `
      )
      .join('');

    const issueRows = report.issues
      .slice(0, 50) // Limit to first 50 issues
      .map(
        (i) => `
        <tr>
          <td><span class="badge badge-${i.severity}">${i.severity}</span></td>
          <td>${i.dimension}</td>
          <td>${path.basename(i.file)}</td>
          <td>${i.line || '-'}</td>
          <td>${i.message}</td>
          <td>${i.autoFixable ? '✅' : '❌'}</td>
        </tr>
      `
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-Agent Analysis Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #333; margin-bottom: 0.5rem; }
    .timestamp { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
    .score-card { background: ${statusColor}; color: white; padding: 2rem; border-radius: 8px; text-align: center; margin-bottom: 2rem; }
    .score-card h2 { font-size: 3rem; margin-bottom: 0.5rem; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .metric { background: #f8f9fa; padding: 1rem; border-radius: 4px; text-align: center; }
    .metric-value { font-size: 2rem; font-weight: bold; color: #333; }
    .metric-label { color: #666; font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #ddd; }
    th { background: #f8f9fa; font-weight: 600; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; }
    .badge-pass { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-fail { background: #f8d7da; color: #721c24; }
    .badge-critical { background: #dc3545; color: white; }
    .badge-high { background: #fd7e14; color: white; }
    .badge-medium { background: #ffc107; color: #000; }
    .badge-low { background: #6c757d; color: white; }
    .badge-info { background: #17a2b8; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔍 Multi-Agent Analysis Report</h1>
    <div class="timestamp">Generated: ${report.timestamp} • Duration: ${report.duration}ms</div>

    <div class="score-card">
      <h2>${report.overallScore}/100</h2>
      <p>Overall Code Quality Score</p>
    </div>

    <div class="metrics">
      <div class="metric">
        <div class="metric-value">${critical}</div>
        <div class="metric-label">Critical</div>
      </div>
      <div class="metric">
        <div class="metric-value">${high}</div>
        <div class="metric-label">High</div>
      </div>
      <div class="metric">
        <div class="metric-value">${medium}</div>
        <div class="metric-label">Medium</div>
      </div>
      <div class="metric">
        <div class="metric-value">${low}</div>
        <div class="metric-label">Low</div>
      </div>
      <div class="metric">
        <div class="metric-value">${autoFixable}</div>
        <div class="metric-label">Auto-fixable</div>
      </div>
    </div>

    <h2>Agent Status</h2>
    <table>
      <thead>
        <tr>
          <th>Agent</th>
          <th>Status</th>
          <th>Issues</th>
        </tr>
      </thead>
      <tbody>
        ${agentRows}
      </tbody>
    </table>

    <h2>Issues (Top 50)</h2>
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Category</th>
          <th>File</th>
          <th>Line</th>
          <th>Message</th>
          <th>Auto-fix</th>
        </tr>
      </thead>
      <tbody>
        ${issueRows}
      </tbody>
    </table>

    ${report.issues.length > 50 ? `<p><em>+ ${report.issues.length - 50} more issues</em></p>` : ''}

    ${report.autoFixesApplied > 0 ? `<p><strong>✅ ${report.autoFixesApplied} auto-fixes applied</strong></p>` : ''}
  </div>
</body>
</html>`;
  }

  /**
   * Generate Markdown report (human-readable, GitHub-friendly)
   */
  private generateMarkdown(report: NormalizedReport): string {
    const critical = report.issues.filter((i) => i.severity === 'critical').length;
    const high = report.issues.filter((i) => i.severity === 'high').length;
    const medium = report.issues.filter((i) => i.severity === 'medium').length;
    const low = report.issues.filter((i) => i.severity === 'low').length;
    const autoFixable = report.issues.filter((i) => i.autoFixable).length;

    const statusEmoji = critical > 0 ? '❌' : high > 0 ? '⚠️' : '✅';

    let md = `# 🔍 Multi-Agent Analysis Report

**Generated:** ${report.timestamp} • **Duration:** ${report.duration}ms

## ${statusEmoji} Overall Score: ${report.overallScore}/100

| Metric | Count |
|--------|-------|
| **Critical** | ${critical} |
| **High** | ${high} |
| **Medium** | ${medium} |
| **Low** | ${low} |
| **Auto-fixable** | ${autoFixable} |

`;

    // Agent status
    md += `## Agent Status\n\n`;
    md += `| Agent | Status | Issues |\n`;
    md += `|-------|--------|--------|\n`;

    for (const agent of report.agents) {
      const emoji = agent.status === 'pass' ? '✅' : agent.status === 'warning' ? '⚠️' : '❌';
      md += `| ${agent.name} | ${emoji} ${agent.status} | ${agent.issues.length} |\n`;
    }

    md += `\n`;

    // Issues by severity
    if (critical > 0) {
      md += `## ❌ Critical Issues\n\n`;
      const criticalIssues = report.issues.filter((i) => i.severity === 'critical');
      for (const issue of criticalIssues) {
        md += `### ${issue.dimension}\n\n`;
        md += `**File:** \`${issue.file}\`${issue.line ? ` (Line ${issue.line})` : ''}\n\n`;
        md += `${issue.message}\n\n`;
        if (issue.suggestion) {
          md += `**Suggestion:** ${issue.suggestion}\n\n`;
        }
        md += `---\n\n`;
      }
    }

    if (high > 0) {
      md += `## ⚠️ High Priority Issues\n\n`;
      const highIssues = report.issues.filter((i) => i.severity === 'high');
      for (const issue of highIssues.slice(0, 10)) {
        md += `- **${issue.dimension}** in \`${path.basename(issue.file)}\`${issue.line ? `:${issue.line}` : ''}: ${issue.message}\n`;
      }
      if (highIssues.length > 10) {
        md += `\n_+ ${highIssues.length - 10} more high priority issues_\n`;
      }
      md += `\n`;
    }

    if (medium > 0) {
      md += `## 📝 Medium Priority Issues\n\n`;
      const mediumIssues = report.issues.filter((i) => i.severity === 'medium');
      md += `${mediumIssues.length} medium priority issues found. See full report for details.\n\n`;
    }

    if (autoFixable > 0) {
      md += `## 🔧 Auto-fixable Issues\n\n`;
      md += `**${autoFixable}** issues can be automatically fixed. Run:\n\n`;
      md += '```bash\nnpm run analyze:fix\n```\n\n';
    }

    if (report.autoFixesApplied > 0) {
      md += `## ✅ Auto-fixes Applied\n\n`;
      md += `**${report.autoFixesApplied}** issues were automatically fixed.\n\n`;
    }

    // Recommendations
    md += `## 💡 Recommendations\n\n`;

    if (critical > 0) {
      md += `- ⚠️ **Address ${critical} critical issue(s) immediately before proceeding**\n`;
    }

    if (high > 0) {
      md += `- 📋 Review and fix ${high} high priority issue(s)\n`;
    }

    if (autoFixable > report.autoFixesApplied) {
      md += `- 🔧 Run auto-fix to resolve ${autoFixable - report.autoFixesApplied} remaining fixable issues\n`;
    }

    return md;
  }
}

function isNormalizedReport(report: unknown): report is NormalizedReport {
  return (
    typeof report === 'object' &&
    report !== null &&
    'overallScore' in report &&
    'agents' in report &&
    'issues' in report
  );
}

function isRawOrchestratorReport(report: unknown): report is RawOrchestratorReport {
  return (
    typeof report === 'object' &&
    report !== null &&
    'agentReports' in report &&
    'validatedFindings' in report &&
    'summary' in report
  );
}

function calculateScore(report: RawOrchestratorReport): number {
  const penalty =
    report.summary.criticalIssues * 25 +
    report.summary.highIssues * 10 +
    report.summary.mediumIssues * 4 +
    report.summary.lowIssues;

  return Math.max(0, 100 - penalty);
}

function normalizeReport(report: unknown): NormalizedReport {
  if (isNormalizedReport(report)) {
    return report;
  }

  if (isRawOrchestratorReport(report)) {
    const issues = report.validatedFindings
      .filter((finding) => !finding.isFalsePositive)
      .map((finding) => finding.issue);

    return {
      timestamp: report.timestamp,
      overallScore: calculateScore(report),
      agents: report.agentReports.map((agent) => ({
        name: agent.agentName,
        status: agent.status,
        issues: agent.dimensionReports.flatMap((dimension) => dimension.issues),
      })),
      issues,
      autoFixesApplied: report.autoFixesApplied.filter((fix) => fix.applied).length,
      duration: report.duration,
    };
  }

  throw new Error('Unsupported analysis report format');
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      'Usage: npx tsx report-generator.ts --input <report.json> [--format json|html|markdown] [--output <file>]'
    );
    process.exit(1);
  }

  let inputFile = '';
  let format: ReportFormat = 'markdown';
  let outputFile = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') {
      inputFile = args[i + 1];
      i++;
    } else if (args[i] === '--format') {
      format = args[i + 1] as ReportFormat;
      i++;
    } else if (args[i] === '--output') {
      outputFile = args[i + 1];
      i++;
    }
  }

  if (!inputFile) {
    console.error('Error: --input is required');
    process.exit(1);
  }

  // Read report
  const reportData = normalizeReport(JSON.parse(fs.readFileSync(inputFile, 'utf-8')));

  // Generate report
  const generator = new ReportGenerator();
  const output = generator.generateReport(reportData, format);

  // Write or print
  if (outputFile) {
    fs.writeFileSync(outputFile, output);
    console.log(`Report written to ${outputFile}`);
  } else {
    console.log(output);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
