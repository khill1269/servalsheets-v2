/**
 * Enhanced Test Logger with Request Tracing
 * Provides structured logging with full observability
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  requestId: string;
  tool: string;
  action: string;
  phase: string;
  message: string;
  data?: any;
  error?: any;
  duration?: number;
}

export class TestLogger {
  private logDir: string;
  private logFile: string;
  private entries: LogEntry[] = [];
  private startTimes = new Map<string, number>();

  constructor(logDir: string = './test-logs') {
    this.logDir = logDir;
    this.logFile = join(logDir, `test-run-${Date.now()}.jsonl`);

    // Create log directory if it doesn't exist
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Write initial log entry
    this.log('info', 'system', 'init', 'system', 'Test logger initialized', {
      logFile: this.logFile,
    });
  }

  /**
   * Start timing a request phase
   */
  startTimer(requestId: string): void {
    this.startTimes.set(requestId, Date.now());
  }

  /**
   * Get duration since timer started
   */
  getDuration(requestId: string): number {
    const start = this.startTimes.get(requestId);
    if (!start) return 0;
    return Date.now() - start;
  }

  /**
   * Log an entry
   */
  log(
    level: LogEntry['level'],
    requestId: string,
    tool: string,
    action: string,
    phase: string,
    message: string,
    data?: any
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      requestId,
      tool,
      action,
      phase,
      message,
      data,
    };

    this.entries.push(entry);

    // Write to file immediately (append mode)
    appendFileSync(this.logFile, JSON.stringify(entry) + '\n');

    // Console output with color coding
    const color = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m', // Green
      warn: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
    }[level];
    const reset = '\x1b[0m';

    console.log(
      `${color}[${level.toUpperCase()}]${reset} ${tool}.${action} (${phase}): ${message}`
    );
  }

  debug(
    requestId: string,
    tool: string,
    action: string,
    phase: string,
    message: string,
    data?: any
  ): void {
    this.log('debug', requestId, tool, action, phase, message, data);
  }

  info(
    requestId: string,
    tool: string,
    action: string,
    phase: string,
    message: string,
    data?: any
  ): void {
    this.log('info', requestId, tool, action, phase, message, data);
  }

  warn(
    requestId: string,
    tool: string,
    action: string,
    phase: string,
    message: string,
    data?: any
  ): void {
    this.log('warn', requestId, tool, action, phase, message, data);
  }

  error(
    requestId: string,
    tool: string,
    action: string,
    phase: string,
    message: string,
    error?: any
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      requestId,
      tool,
      action,
      phase,
      message,
      error: this.serializeError(error),
      duration: this.getDuration(requestId),
    };

    this.entries.push(entry);
    appendFileSync(this.logFile, JSON.stringify(entry) + '\n');

    console.error(`\x1b[31m[ERROR]\x1b[0m ${tool}.${action} (${phase}): ${message}`);
    if (error) {
      console.error('  Error details:', this.serializeError(error));
    }
  }

  /**
   * Serialize error for logging
   */
  private serializeError(error: any): any {
    if (!error) return null;

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error as any),
      };
    }

    return error;
  }

  /**
   * Get all log entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by tool
   */
  getEntriesByTool(tool: string): LogEntry[] {
    return this.entries.filter((e) => e.tool === tool);
  }

  /**
   * Get entries by level
   */
  getEntriesByLevel(level: LogEntry['level']): LogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }

  /**
   * Get errors
   */
  getErrors(): LogEntry[] {
    return this.entries.filter((e) => e.level === 'error');
  }

  /**
   * Generate summary
   */
  getSummary(): {
    total: number;
    byLevel: Record<string, number>;
    byTool: Record<string, number>;
    errors: LogEntry[];
  } {
    const byLevel: Record<string, number> = {};
    const byTool: Record<string, number> = {};

    for (const entry of this.entries) {
      byLevel[entry.level] = (byLevel[entry.level] || 0) + 1;
      byTool[entry.tool] = (byTool[entry.tool] || 0) + 1;
    }

    return {
      total: this.entries.length,
      byLevel,
      byTool,
      errors: this.getErrors(),
    };
  }

  /**
   * Write summary to file
   */
  writeSummary(): void {
    const summary = this.getSummary();
    const summaryFile = this.logFile.replace('.jsonl', '-summary.json');
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log(`\n📊 Summary written to: ${summaryFile}`);
  }

  /**
   * Get log file path
   */
  getLogFile(): string {
    return this.logFile;
  }
}
