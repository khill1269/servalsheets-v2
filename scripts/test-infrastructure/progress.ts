/**
 * Real-Time Progress Tracker
 * Displays live progress of test execution
 */

import type { TestStatus } from './test-db.js';

export interface ProgressUpdate {
  tool: string;
  action: string;
  status: TestStatus;
  message: string;
  current: number;
  total: number;
  duration?: number;
}

export class ProgressTracker {
  private total: number;
  private current: number = 0;
  private passed: number = 0;
  private failed: number = 0;
  private skipped: number = 0;
  private authRequired: number = 0;
  private startTime: number;
  private currentTool?: string;
  private currentAction?: string;

  constructor(total: number) {
    this.total = total;
    this.startTime = Date.now();
  }

  /**
   * Update progress
   */
  update(update: ProgressUpdate): void {
    this.current = update.current;
    this.currentTool = update.tool;
    this.currentAction = update.action;

    // Update counters
    switch (update.status) {
      case 'pass':
        this.passed++;
        break;
      case 'fail':
        this.failed++;
        break;
      case 'skip':
        this.skipped++;
        break;
      case 'auth_required':
        this.authRequired++;
        break;
    }

    this.render();
  }

  /**
   * Render progress to console
   */
  private render(): void {
    const elapsed = Date.now() - this.startTime;
    const progress = (this.current / this.total) * 100;
    const avgTimePerTest = elapsed / this.current;
    const estimatedRemaining = avgTimePerTest * (this.total - this.current);

    // Clear previous line
    process.stdout.write('\r\x1b[K');

    // Progress bar
    const barWidth = 30;
    const filled = Math.floor((progress / 100) * barWidth);
    const empty = barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    // Status line
    const status = [
      `\x1b[32m✓ ${this.passed}\x1b[0m`, // Green
      `\x1b[31m✗ ${this.failed}\x1b[0m`, // Red
      `\x1b[33m⊘ ${this.skipped}\x1b[0m`, // Yellow
      `\x1b[36m🔐 ${this.authRequired}\x1b[0m`, // Cyan
    ].join(' ');

    // Time info
    const timeInfo = [
      `⏱ ${this.formatDuration(elapsed)}`,
      `~${this.formatDuration(estimatedRemaining)} left`,
    ].join(' | ');

    // Current test
    const current =
      this.currentTool && this.currentAction
        ? `${this.currentTool}.${this.currentAction}`
        : 'Starting...';

    // Full line
    const line = [
      `[${bar}]`,
      `${progress.toFixed(1)}%`,
      `(${this.current}/${this.total})`,
      status,
      `| ${current}`,
      `| ${timeInfo}`,
    ].join(' ');

    process.stdout.write(line);
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Complete progress tracking
   */
  complete(): void {
    this.render();
    console.log('\n'); // New line after progress bar
  }

  /**
   * Get summary
   */
  getSummary(): {
    total: number;
    completed: number;
    passed: number;
    failed: number;
    skipped: number;
    authRequired: number;
    duration: number;
  } {
    return {
      total: this.total,
      completed: this.current,
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      authRequired: this.authRequired,
      duration: Date.now() - this.startTime,
    };
  }
}
