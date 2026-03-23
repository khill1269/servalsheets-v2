#!/usr/bin/env tsx
/**
 * Watch Mode for Continuous Analysis
 *
 * Monitors files for changes and runs analysis automatically:
 * - Debounced file watching (500ms)
 * - Live terminal UI with progress
 * - Auto-fix on save (optional)
 * - Filtered output (only changed files)
 * - Performance metrics
 */

import chokidar from 'chokidar';
import * as path from 'path';
import { AnalysisOrchestrator, OrchestratorOptions, OrchestratorReport } from './orchestrator.js';

// ============================================================================
// WATCH MODE OPTIONS
// ============================================================================

export interface WatchModeOptions extends OrchestratorOptions {
  debounceMs?: number;
  clearConsole?: boolean;
  soundOnError?: boolean;
  excludePatterns?: string[];
}

// ============================================================================
// TERMINAL UI HELPERS
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour12: false });
}

// ============================================================================
// WATCH MODE
// ============================================================================

export class WatchMode {
  private orchestrator: AnalysisOrchestrator;
  private options: WatchModeOptions;
  private debounceMap = new Map<string, NodeJS.Timeout>();
  private isAnalyzing = false;
  private analysisQueue: string[] = [];
  private stats = {
    totalAnalyses: 0,
    totalIssuesFound: 0,
    totalAutoFixed: 0,
    averageDuration: 0,
  };

  constructor(options: WatchModeOptions = {}) {
    this.options = {
      debounceMs: 500,
      clearConsole: true,
      soundOnError: false,
      verbose: false,
      autoFix: false,
      ...options,
    };

    this.orchestrator = new AnalysisOrchestrator({
      autoFix: this.options.autoFix,
      verbose: this.options.verbose,
      minConfidence: this.options.minConfidence,
      excludeAgents: this.options.excludeAgents,
    });
  }

  /**
   * Start watch mode
   */
  async start(paths: string[]): Promise<void> {
    this.printHeader();

    console.log(`${COLORS.cyan}🔍 Watch mode started${COLORS.reset}`);
    console.log(`   Monitoring: ${paths.join(', ')}`);
    console.log(`   Debounce: ${this.options.debounceMs}ms`);
    console.log(`   Auto-fix: ${this.options.autoFix ? 'enabled' : 'disabled'}`);
    console.log(`   Agents: ${this.orchestrator['agents'].size}\n`);

    const watcher = chokidar.watch(paths, {
      ignored: this.getIgnorePatterns(),
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    watcher.on('add', (filePath) => {
      this.handleFileChange(filePath, 'added');
    });

    watcher.on('change', (filePath) => {
      this.handleFileChange(filePath, 'changed');
    });

    watcher.on('error', (error) => {
      console.error(`${COLORS.red}✗ Watcher error:${COLORS.reset}`, error);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(`\n\n${COLORS.cyan}📊 Watch mode statistics:${COLORS.reset}`);
      console.log(`   Total analyses: ${this.stats.totalAnalyses}`);
      console.log(`   Total issues: ${this.stats.totalIssuesFound}`);
      console.log(`   Auto-fixed: ${this.stats.totalAutoFixed}`);
      console.log(`   Average duration: ${formatDuration(this.stats.averageDuration)}`);
      console.log('\n👋 Goodbye!\n');
      process.exit(0);
    });

    console.log(`${COLORS.dim}Waiting for file changes... (Ctrl+C to exit)${COLORS.reset}\n`);
  }

  /**
   * Handle file change event
   */
  private handleFileChange(filePath: string, changeType: 'added' | 'changed'): void {
    // Skip if not TypeScript file
    if (!filePath.endsWith('.ts')) return;

    // Debounce rapid changes
    if (this.debounceMap.has(filePath)) {
      clearTimeout(this.debounceMap.get(filePath)!);
    }

    this.debounceMap.set(
      filePath,
      setTimeout(async () => {
        this.debounceMap.delete(filePath);

        // Add to queue if currently analyzing
        if (this.isAnalyzing) {
          if (!this.analysisQueue.includes(filePath)) {
            this.analysisQueue.push(filePath);
            console.log(`${COLORS.dim}   Queued: ${path.basename(filePath)}${COLORS.reset}`);
          }
          return;
        }

        await this.analyzeFile(filePath, changeType);

        // Process queue
        while (this.analysisQueue.length > 0) {
          const nextFile = this.analysisQueue.shift()!;
          await this.analyzeFile(nextFile, 'changed');
        }
      }, this.options.debounceMs)
    );
  }

  /**
   * Analyze a single file
   */
  private async analyzeFile(filePath: string, changeType: 'added' | 'changed'): Promise<void> {
    this.isAnalyzing = true;

    if (this.options.clearConsole) {
      console.clear();
      this.printHeader();
    }

    const timestamp = formatTimestamp();
    const fileName = path.basename(filePath);
    const relPath = path.relative(process.cwd(), filePath);

    console.log(
      `\n${COLORS.cyan}[${timestamp}]${COLORS.reset} ${COLORS.bright}${fileName}${COLORS.reset} ${changeType}`
    );
    console.log(`${COLORS.dim}${relPath}${COLORS.reset}\n`);

    const startTime = Date.now();

    try {
      // Run analysis
      const report = await this.orchestrator.runFullAnalysis([filePath]);
      const duration = Date.now() - startTime;

      // Update stats
      this.stats.totalAnalyses++;
      this.stats.totalIssuesFound += report.summary.totalIssues;
      this.stats.totalAutoFixed += report.summary.autoFixed;
      this.stats.averageDuration =
        (this.stats.averageDuration * (this.stats.totalAnalyses - 1) + duration) /
        this.stats.totalAnalyses;

      // Display results
      this.displayResults(report, duration);
    } catch (error) {
      console.error(`${COLORS.red}✗ Analysis failed:${COLORS.reset}`, error);

      if (this.options.soundOnError) {
        process.stdout.write('\x07'); // Bell sound
      }
    }

    this.isAnalyzing = false;
  }

  /**
   * Display analysis results
   */
  private displayResults(report: OrchestratorReport, duration: number): void {
    const { summary } = report;

    // Status indicator
    let statusIcon = '✓';
    let statusColor = COLORS.green;

    if (summary.criticalIssues > 0) {
      statusIcon = '✗';
      statusColor = COLORS.red;
    } else if (summary.highIssues > 0 || summary.mediumIssues > 0) {
      statusIcon = '⚠';
      statusColor = COLORS.yellow;
    }

    console.log(
      `${statusColor}${statusIcon} Analysis complete${COLORS.reset} (${formatDuration(duration)})\n`
    );

    // Agent summary
    console.log(`${COLORS.bright}Agents (${report.agentReports.length}):${COLORS.reset}`);
    for (const agentReport of report.agentReports) {
      const icon =
        agentReport.status === 'pass' ? '✓' : agentReport.status === 'warning' ? '⚠' : '✗';
      const color =
        agentReport.status === 'pass'
          ? COLORS.green
          : agentReport.status === 'warning'
            ? COLORS.yellow
            : COLORS.red;

      const issueCount = agentReport.dimensionReports.reduce((sum, r) => sum + r.issueCount, 0);

      console.log(
        `  ${color}${icon}${COLORS.reset} ${agentReport.agentName.padEnd(25)} ${issueCount} issue(s)`
      );
    }

    // Issue summary
    if (summary.totalIssues > 0) {
      console.log(`\n${COLORS.bright}Issues:${COLORS.reset}`);
      if (summary.criticalIssues > 0) {
        console.log(`  ${COLORS.red}● Critical: ${summary.criticalIssues}${COLORS.reset}`);
      }
      if (summary.highIssues > 0) {
        console.log(`  ${COLORS.red}● High: ${summary.highIssues}${COLORS.reset}`);
      }
      if (summary.mediumIssues > 0) {
        console.log(`  ${COLORS.yellow}● Medium: ${summary.mediumIssues}${COLORS.reset}`);
      }
      if (summary.lowIssues > 0) {
        console.log(`  ${COLORS.dim}● Low: ${summary.lowIssues}${COLORS.reset}`);
      }

      // Show top 3 issues
      const topIssues = report.validatedFindings
        .filter((f) => !f.isFalsePositive)
        .sort((a, b) => {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
          return severityOrder[a.issue.severity] - severityOrder[b.issue.severity];
        })
        .slice(0, 3);

      if (topIssues.length > 0) {
        console.log(`\n${COLORS.bright}Top Issues:${COLORS.reset}`);
        for (const finding of topIssues) {
          const { issue } = finding;
          const severityColor =
            issue.severity === 'critical' || issue.severity === 'high'
              ? COLORS.red
              : issue.severity === 'medium'
                ? COLORS.yellow
                : COLORS.dim;

          console.log(
            `  ${severityColor}[${issue.severity.toUpperCase()}]${COLORS.reset} ${issue.message.slice(0, 80)}`
          );
          if (issue.line) {
            console.log(`    ${COLORS.dim}at line ${issue.line}${COLORS.reset}`);
          }
        }
      }
    } else {
      console.log(`\n${COLORS.green}✓ No issues found${COLORS.reset}`);
    }

    // Auto-fix summary
    if (report.summary.autoFixed > 0) {
      console.log(
        `\n${COLORS.green}✓ Auto-fixed: ${report.summary.autoFixed} issue(s)${COLORS.reset}`
      );
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      console.log(`\n${COLORS.bright}Recommendations:${COLORS.reset}`);
      for (const rec of report.recommendations) {
        console.log(`  ${rec}`);
      }
    }

    // Conflict resolutions
    if (report.resolvedConflicts.length > 0) {
      console.log(
        `\n${COLORS.cyan}ℹ ${report.resolvedConflicts.length} conflict(s) resolved${COLORS.reset}`
      );
    }

    console.log(`\n${COLORS.dim}Waiting for file changes...${COLORS.reset}\n`);
  }

  /**
   * Print header
   */
  private printHeader(): void {
    console.log(`${COLORS.cyan}${'═'.repeat(60)}${COLORS.reset}`);
    console.log(`${COLORS.bright}  ServalSheets Analysis Watch Mode${COLORS.reset}`);
    console.log(`${COLORS.cyan}${'═'.repeat(60)}${COLORS.reset}\n`);
  }

  /**
   * Get ignore patterns
   */
  private getIgnorePatterns(): (string | RegExp)[] {
    const defaults = [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/coverage/**',
      '**/*.d.ts',
    ];

    return [...defaults, ...(this.options.excludePatterns || [])];
  }
}
