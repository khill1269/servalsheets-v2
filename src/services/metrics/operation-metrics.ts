/**
 * Operation Metrics
 *
 * Tracks tool call performance with durations, success rates, and percentiles.
 *
 * @category Metrics
 */

import { logger } from '../../utils/logger.js';

// ==================== Types ====================

export interface OperationMetrics {
  /** Operation name (e.g., "sheets_data.write") */
  name: string;
  /** Total count */
  count: number;
  /** Success count */
  successCount: number;
  /** Failure count */
  failureCount: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Duration statistics (milliseconds) */
  duration: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    total: number;
  };
  /** Last recorded timestamp */
  lastRecorded: number;
}

export interface RecordOperationOptions {
  /** Operation name */
  name: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Success status */
  success: boolean;
  /** Optional error */
  error?: Error;
}

// ==================== Constants ====================

/**
 * Maximum number of duration samples to keep per operation
 * Prevents unbounded memory growth
 */
const MAX_DURATION_SAMPLES = 1000;

/**
 * Maximum number of operations to track
 */
const MAX_OPERATIONS = 500;

// ==================== Operation Metrics Service ====================

export class OperationMetricsService {
  private operations: Map<
    string,
    {
      count: number;
      successCount: number;
      failureCount: number;
      durations: number[]; // Circular buffer
      lastRecorded: number;
    }
  > = new Map();

  private enabled: boolean;
  private verboseLogging: boolean;

  constructor(options: { enabled?: boolean; verboseLogging?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
    this.verboseLogging = options.verboseLogging ?? false;
  }

  /**
   * Record an operation
   */
  recordOperation(options: RecordOperationOptions): void;
  recordOperation(name: string, durationMs: number, success: boolean): void;
  recordOperation(
    optionsOrName: RecordOperationOptions | string,
    durationMs?: number,
    success?: boolean
  ): void {
    if (!this.enabled) return;

    // Handle both signatures
    const options: RecordOperationOptions =
      typeof optionsOrName === 'string'
        ? { name: optionsOrName, durationMs: durationMs!, success: success! }
        : optionsOrName;

    const { name, durationMs: duration, success: isSuccess } = options;

    let op = this.operations.get(name);
    if (!op) {
      // Check if we're at the operation limit
      if (this.operations.size >= MAX_OPERATIONS) {
        // Remove least recently recorded operation
        let oldestOp: string | null = null;
        let oldestTime = Infinity;
        for (const [opName, opData] of Array.from(this.operations.entries())) {
          if (opData.lastRecorded < oldestTime) {
            oldestTime = opData.lastRecorded;
            oldestOp = opName;
          }
        }
        if (oldestOp) {
          this.operations.delete(oldestOp);
        }
      }

      op = {
        count: 0,
        successCount: 0,
        failureCount: 0,
        durations: [],
        lastRecorded: 0,
      };
      this.operations.set(name, op);
    }

    // Update counters
    op.count++;
    if (isSuccess) {
      op.successCount++;
    } else {
      op.failureCount++;
    }
    op.lastRecorded = Date.now();

    // Record duration (circular buffer)
    op.durations.push(duration);
    if (op.durations.length > MAX_DURATION_SAMPLES) {
      op.durations.shift();
    }

    if (this.verboseLogging) {
      logger.debug('Operation recorded in metrics', {
        name,
        durationMs: duration,
        success: isSuccess,
        totalCount: op.count,
      });
    }
  }

  /**
   * Get operation metrics
   */
  getOperationMetrics(name: string): OperationMetrics | undefined {
    const op = this.operations.get(name);
    if (!op) return undefined;

    return this.calculateOperationMetrics(name, op);
  }

  /**
   * Get all operation metrics
   */
  getAllOperationMetrics(): OperationMetrics[] {
    const metrics: OperationMetrics[] = [];
    for (const [name, op] of Array.from(this.operations.entries())) {
      metrics.push(this.calculateOperationMetrics(name, op));
    }
    // Sort by count (most frequent first)
    return metrics.sort((a, b) => b.count - a.count);
  }

  /**
   * Calculate operation metrics with percentiles
   */
  private calculateOperationMetrics(
    name: string,
    op: {
      count: number;
      successCount: number;
      failureCount: number;
      durations: number[];
      lastRecorded: number;
    }
  ): OperationMetrics {
    const durations = [...op.durations].sort((a, b) => a - b);
    const total = durations.reduce((sum, d) => sum + d, 0);

    return {
      name,
      count: op.count,
      successCount: op.successCount,
      failureCount: op.failureCount,
      successRate: op.count > 0 ? op.successCount / op.count : 0,
      duration: {
        min: durations[0] || 0,
        max: durations[durations.length - 1] || 0,
        avg: durations.length > 0 ? total / durations.length : 0,
        p50: this.percentile(durations, 0.5),
        p95: this.percentile(durations, 0.95),
        p99: this.percentile(durations, 0.99),
        total,
      },
      lastRecorded: op.lastRecorded,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.operations.clear();
  }
}
