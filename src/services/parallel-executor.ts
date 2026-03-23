/**
 * ParallelExecutor - Phase 1: Unified Concurrency Control
 *
 * @purpose Manages concurrent API requests with configurable concurrency (default: 5), automatic retry, and progress tracking
 * @category Performance
 * @usage Use for bulk operations requiring multiple API calls; executes in parallel up to limit, retries failures with backoff, aggregates errors
 * @dependencies logger, retry utility, ConcurrencyCoordinator (Phase 1)
 * @stateful Yes - maintains active request queue, concurrency counter, progress state, error aggregation
 * @singleton No - instantiate per bulk operation with specific concurrency needs
 *
 * Phase 1 Enhancement:
 * - Integrates with ConcurrencyCoordinator for global API limit enforcement
 * - Each task.fn() execution acquires a global permit before running
 * - Prevents quota exhaustion when combined with PrefetchingSystem + BatchingSystem
 *
 * @example
 * const executor = new ParallelExecutor({ concurrency: 5, retryAttempts: 3 });
 * const results = await executor.executeAll(operations, { onProgress: (done, total) => logger.info(`${done}/${total}`) });
 * if (results.errors.length > 0) logger.error('Some operations failed:', results.errors);
 * - Request deduplication integration
 */

import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';
import { getTracer } from '../utils/tracing.js';
import { getConcurrencyCoordinator } from './concurrency-coordinator.js';

export interface ParallelExecutorOptions {
  /** Maximum concurrent requests (default: 20) */
  concurrency?: number;
  /** Enable verbose logging (default: false) */
  verboseLogging?: boolean;
  /** Retry failed requests (default: true) */
  retryOnError?: boolean;
  /** Max retry attempts per request (default: 3) */
  maxRetries?: number;
  /** Initial retry delay in ms (default: 1000) */
  retryDelayMs?: number;
}

export interface ParallelTask<T> {
  /** Unique identifier for this task */
  id: string;
  /** Async function to execute */
  fn: () => Promise<T>;
  /** Optional priority (higher = earlier, default: 0) */
  priority?: number;
}

export interface ParallelResult<T> {
  /** Task ID */
  id: string;
  /** Task result (if successful) */
  result?: T;
  /** Error (if failed) */
  error?: Error;
  /** Whether task succeeded */
  success: boolean;
  /** Execution duration in ms */
  duration: number;
  /** Number of retries attempted */
  retries: number;
}

export interface ParallelProgress {
  /** Total tasks */
  total: number;
  /** Completed tasks */
  completed: number;
  /** Failed tasks */
  failed: number;
  /** Currently running tasks */
  running: number;
  /** Percentage complete (0-100) */
  percentComplete: number;
}

/**
 * Parallel Request Executor
 *
 * Executes multiple async tasks in parallel with concurrency control
 */
export class ParallelExecutor {
  private concurrency: number;
  private verboseLogging: boolean;
  private retryOnError: boolean;
  private maxRetries: number;
  private retryDelayMs: number;

  // Statistics
  private stats = {
    totalExecuted: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalRetries: 0,
    totalDuration: 0,
    durations: [] as number[], // Track individual durations for percentile calculations
  };

  constructor(options: ParallelExecutorOptions = {}) {
    // Default concurrency: 5 per-user (quota-safe default; set PARALLEL_CONCURRENCY to increase)
    const DEFAULT_CONCURRENCY = 5;

    // Support PARALLEL_CONCURRENCY environment variable
    const envConcurrency = process.env['PARALLEL_CONCURRENCY']
      ? parseInt(process.env['PARALLEL_CONCURRENCY'], 10)
      : undefined;

    // Use options.concurrency, then env var, then default
    this.concurrency = options.concurrency ?? envConcurrency ?? DEFAULT_CONCURRENCY;

    // Ensure reasonable bounds: minimum 1, maximum 100
    this.concurrency = Math.max(1, Math.min(100, this.concurrency));

    this.verboseLogging = options.verboseLogging ?? false;
    this.retryOnError = options.retryOnError ?? true;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;

    if (this.verboseLogging) {
      logger.info('Parallel executor initialized', {
        concurrency: this.concurrency,
        retryOnError: this.retryOnError,
        maxRetries: this.maxRetries,
      });
    }
  }

  /**
   * Execute tasks in parallel with concurrency control
   */
  async executeAll<T>(
    tasks: ParallelTask<T>[],
    onProgress?: (progress: ParallelProgress) => void
  ): Promise<ParallelResult<T>[]> {
    const span = getTracer().startSpan('parallel-executor.executeAll', {
      kind: 'internal',
      attributes: { 'tasks.count': tasks.length, 'executor.concurrency': this.concurrency },
    });
    if (tasks.length === 0) {
      span.end();
      return [];
    }

    // Sort by priority (higher first)
    const sortedTasks = [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    const results: ParallelResult<T>[] = [];
    const executing: Promise<void>[] = [];
    let completed = 0;
    let failed = 0;

    // Progress reporting helper
    const reportProgress = (): void => {
      if (onProgress) {
        onProgress({
          total: tasks.length,
          completed,
          failed,
          running: executing.length,
          percentComplete: (completed / tasks.length) * 100,
        });
      }
    };

    // Get global concurrency coordinator (Phase 1)
    const coordinator = getConcurrencyCoordinator();

    // Execute task with retry logic
    const executeTask = async (task: ParallelTask<T>): Promise<void> => {
      const startTime = Date.now();
      let retries = 0;
      let lastError: Error | undefined;

      while (retries <= this.maxRetries) {
        try {
          // Phase 1: Acquire global permit before execution
          const result = await coordinator.execute('ParallelExecutor', () => task.fn());
          const duration = Date.now() - startTime;

          results.push({
            id: task.id,
            result,
            success: true,
            duration,
            retries,
          });

          this.stats.totalExecuted++;
          this.stats.totalSucceeded++;
          this.stats.totalDuration += duration;
          this.stats.totalRetries += retries;
          this.stats.durations.push(duration);
          if (this.stats.durations.length > 10500) {
            this.stats.durations = this.stats.durations.slice(-10000);
          }
          completed++;

          if (this.verboseLogging) {
            logger.debug('Task completed successfully', {
              id: task.id,
              duration,
              retries,
            });
          }

          reportProgress();
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retries++;

          if (retries <= this.maxRetries && this.retryOnError) {
            const delay = this.retryDelayMs * Math.pow(2, retries - 1); // Exponential backoff
            logger.warn('Task failed, retrying', {
              id: task.id,
              attempt: retries,
              maxRetries: this.maxRetries,
              delayMs: delay,
              error: lastError.message,
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            break;
          }
        }
      }

      // All retries exhausted
      const duration = Date.now() - startTime;
      results.push({
        id: task.id,
        error: lastError,
        success: false,
        duration,
        retries: retries - 1,
      });

      this.stats.totalExecuted++;
      this.stats.totalFailed++;
      this.stats.totalDuration += duration;
      this.stats.totalRetries += retries - 1;
      this.stats.durations.push(duration);
      if (this.stats.durations.length > 10500) {
        this.stats.durations = this.stats.durations.slice(-10000);
      }
      completed++;
      failed++;

      logger.error('Task failed after retries', {
        id: task.id,
        retries: retries - 1,
        error: lastError?.message,
      });

      reportProgress();
    };

    // Execute with concurrency control
    for (const task of sortedTasks) {
      // Wait if we're at max concurrency
      if (executing.length >= this.concurrency) {
        await Promise.race(executing);
      }

      // Start task execution
      const promise = executeTask(task).then(() => {
        // Remove from executing array when done
        const index = executing.indexOf(promise);
        if (index > -1) {
          executing.splice(index, 1);
        }
      });

      executing.push(promise);
    }

    // Wait for all remaining tasks
    await Promise.all(executing);

    // Final progress report
    reportProgress();

    span.end();
    return results;
  }

  /**
   * Execute tasks and return only successful results
   */
  async executeAllSuccessful<T>(
    tasks: ParallelTask<T>[],
    onProgress?: (progress: ParallelProgress) => void
  ): Promise<T[]> {
    const results = await this.executeAll(tasks, onProgress);
    return results.reduce<T[]>((acc, r) => {
      if (r.success && r.result !== undefined) {
        acc.push(r.result);
      }
      return acc;
    }, []);
  }

  /**
   * Execute tasks and throw if any fail
   */
  async executeAllOrFail<T>(
    tasks: ParallelTask<T>[],
    onProgress?: (progress: ParallelProgress) => void
  ): Promise<T[]> {
    const results = await this.executeAll(tasks, onProgress);

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      const errorMessages = failures.map((f) => `${f.id}: ${f.error?.message}`).join('; ');
      throw new ServiceError(
        `${failures.length} task(s) failed: ${errorMessages}`,
        'INTERNAL_ERROR',
        'ParallelExecutor'
      );
    }

    return results.map((r) => r.result!);
  }

  /**
   * Get execution statistics with percentile metrics
   */
  getStats(): unknown {
    const sortedDurations = [...this.stats.durations].sort((a, b) => a - b);
    const p50 = this.getPercentile(sortedDurations, 50);
    const p95 = this.getPercentile(sortedDurations, 95);
    const p99 = this.getPercentile(sortedDurations, 99);

    return {
      totalExecuted: this.stats.totalExecuted,
      totalSucceeded: this.stats.totalSucceeded,
      totalFailed: this.stats.totalFailed,
      totalRetries: this.stats.totalRetries,
      totalDuration: this.stats.totalDuration,
      successRate:
        this.stats.totalExecuted > 0
          ? (this.stats.totalSucceeded / this.stats.totalExecuted) * 100
          : 0,
      averageDuration:
        this.stats.totalExecuted > 0 ? this.stats.totalDuration / this.stats.totalExecuted : 0,
      p50Duration: p50,
      p95Duration: p95,
      p99Duration: p99,
      minDuration: sortedDurations[0] ?? 0,
      maxDuration: sortedDurations[sortedDurations.length - 1] ?? 0,
      averageRetries:
        this.stats.totalExecuted > 0 ? this.stats.totalRetries / this.stats.totalExecuted : 0,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private getPercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)] ?? 0;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalExecuted: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalRetries: 0,
      totalDuration: 0,
      durations: [],
    };
  }
}

// Singleton instance
let parallelExecutor: ParallelExecutor | null = null;

/**
 * Get or create the parallel executor singleton
 */
export function getParallelExecutor(): ParallelExecutor {
  if (!parallelExecutor) {
    parallelExecutor = new ParallelExecutor({
      verboseLogging: process.env['PARALLEL_VERBOSE'] === 'true',
      // Concurrency will be determined by constructor's env var handling
    });
  }
  return parallelExecutor;
}

/**
 * Set the parallel executor (for testing or custom configuration)
 */
export function setParallelExecutor(executor: ParallelExecutor): void {
  parallelExecutor = executor;
}

/**
 * Reset the parallel executor (for testing only)
 * @internal
 */
export function resetParallelExecutor(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetParallelExecutor() can only be called in test environment',
      'INTERNAL_ERROR',
      'ParallelExecutor'
    );
  }
  parallelExecutor = null;
}
