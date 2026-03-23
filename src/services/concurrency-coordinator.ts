/**
 * Unified Concurrency Coordinator - Phase 1: Critical Stability
 *
 * Purpose: Centralized management of all concurrent Google API operations
 * to prevent quota exhaustion and 429 errors.
 *
 * Problem Solved:
 * - ParallelExecutor: 20 concurrent
 * - PrefetchingSystem: 2 concurrent
 * - BatchingSystem: adaptive
 * - Total: 22+ concurrent connections → quota exceeded!
 *
 * Solution: Shared semaphore with global limit of 15 concurrent operations
 * (safely below Google's per-user quota limits while maintaining performance)
 */

import { logger } from '../utils/logger.js';
import { ValidationError } from '../core/errors.js';
import {
  record429Error,
  recordConcurrencyAdjustment,
  recordConcurrencyStatus,
  recordQuotaUtilization,
  updateRequestQueueDepth,
} from '../observability/metrics.js';

/**
 * Configuration for concurrency coordinator
 */
export interface ConcurrencyConfig {
  /** Maximum concurrent Google API operations across ALL systems */
  maxConcurrent: number;
  /** Enable metrics tracking */
  enableMetrics?: boolean;
  /** Enable verbose logging for debugging */
  verboseLogging?: boolean;
  /** Enable adaptive concurrency adjustment based on quota utilization */
  enableAdaptive?: boolean;
  /** Minimum concurrent limit for adaptive mode */
  minConcurrent?: number;
  /** Maximum concurrent limit for adaptive mode */
  maxConcurrentCeiling?: number;
  /** Quota adjustment interval (ms) */
  adjustmentIntervalMs?: number;
}

/**
 * Metrics for monitoring concurrency usage
 */
export interface ConcurrencyMetrics {
  /** Current number of active operations */
  activeOperations: number;
  /** Peak concurrent operations observed */
  peakConcurrent: number;
  /** Total operations executed */
  totalOperations: number;
  /** Total time spent waiting for permits (ms) */
  totalWaitTimeMs: number;
  /** Number of times limit was reached */
  limitReachedCount: number;
  /** Average wait time per operation (ms) */
  averageWaitTimeMs: number;
  /** Number of 429 rate limit errors encountered */
  rateLimitErrorCount: number;
  /** Current concurrency limit (dynamic) */
  currentLimit: number;
  /** Number of times limit was adjusted */
  limitAdjustmentCount: number;
  /** Time since last 429 error (ms) */
  timeSinceLast429Ms: number | null;
  /** Whether minimum limit has been reached */
  minimumLimitReached: boolean;
  /** Whether maximum limit has been reached */
  maximumLimitReached: boolean;
}

/**
 * Quota status for monitoring
 */
export interface QuotaStatus {
  /** Quota units used in current window */
  used: number;
  /** Quota limit per window */
  limit: number;
  /** Quota utilization (0-1) */
  utilization: number;
  /** Time remaining in current window (ms) */
  windowRemainingMs: number;
}

/**
 * Limit adjustment history entry
 */
export interface LimitAdjustment {
  /** Timestamp of adjustment */
  timestamp: number;
  /** Previous limit */
  oldLimit: number;
  /** New limit */
  newLimit: number;
  /** Reason for adjustment */
  reason: string;
  /** Quota utilization at time of adjustment */
  quotaUtilization: number;
}

/**
 * Operation metadata for tracking
 */
interface Operation {
  id: string;
  source: string; // Which system requested this (ParallelExecutor, Prefetching, etc.)
  startTime: number;
  acquireTime: number;
}

/**
 * Unified Concurrency Coordinator
 *
 * Implements a semaphore pattern to limit total concurrent Google API operations.
 * All systems (ParallelExecutor, PrefetchingSystem, BatchingSystem) must
 * acquire a permit before making API calls.
 *
 * Thread-safe: Uses async queue with FIFO ordering
 */
export class ConcurrencyCoordinator {
  private readonly config: Required<ConcurrencyConfig>;
  private activeOperations: Map<string, Operation> = new Map();
  private waitQueue: Array<{
    resolve: () => void;
    source: string;
    queuedAt: number;
  }> = [];

  // Metrics
  private metrics: ConcurrencyMetrics = {
    activeOperations: 0,
    peakConcurrent: 0,
    totalOperations: 0,
    totalWaitTimeMs: 0,
    limitReachedCount: 0,
    averageWaitTimeMs: 0,
    rateLimitErrorCount: 0,
    currentLimit: 15,
    limitAdjustmentCount: 0,
    timeSinceLast429Ms: null,
    minimumLimitReached: false,
    maximumLimitReached: false,
  };

  // Adaptive concurrency fields
  private quotaUsed = 0;
  private quotaLimit = 60; // Google's default: 60 requests per minute per user
  private quotaWindowStart = Date.now();
  private adjustmentTimer?: NodeJS.Timeout;
  private last429Timestamp: number | null = null;
  private adjustmentHistory: LimitAdjustment[] = [];

  constructor(config?: Partial<ConcurrencyConfig>) {
    const maxConcurrent = config?.maxConcurrent ?? 25;

    // Smart defaults based on maxConcurrent
    const minConcurrent = config?.minConcurrent ?? Math.min(5, maxConcurrent);
    const maxConcurrentCeiling = config?.maxConcurrentCeiling ?? Math.max(30, maxConcurrent);

    this.config = {
      maxConcurrent,
      enableMetrics: config?.enableMetrics ?? true,
      verboseLogging: config?.verboseLogging ?? false,
      enableAdaptive: config?.enableAdaptive ?? true,
      minConcurrent,
      maxConcurrentCeiling,
      adjustmentIntervalMs: config?.adjustmentIntervalMs ?? 10000, // 10 seconds
    };

    // Validate configuration bounds
    if (this.config.minConcurrent! > this.config.maxConcurrent) {
      throw new ValidationError(
        `Invalid configuration: minConcurrent (${this.config.minConcurrent}) cannot be greater than maxConcurrent (${this.config.maxConcurrent})`,
        'minConcurrent'
      );
    }

    if (this.config.maxConcurrent > this.config.maxConcurrentCeiling!) {
      throw new ValidationError(
        `Invalid configuration: maxConcurrent (${this.config.maxConcurrent}) cannot be greater than maxConcurrentCeiling (${this.config.maxConcurrentCeiling})`,
        'maxConcurrent'
      );
    }

    // Initialize metrics with current limit
    this.metrics.currentLimit = this.config.maxConcurrent;

    if (this.config.verboseLogging) {
      logger.info('ConcurrencyCoordinator initialized', {
        maxConcurrent: this.config.maxConcurrent,
        adaptive: this.config.enableAdaptive,
        range: `${this.config.minConcurrent}-${this.config.maxConcurrentCeiling}`,
      });
    }

    // Support environment variable override
    const envLimit = process.env['GOOGLE_API_MAX_CONCURRENT'];
    if (envLimit) {
      const parsed = parseInt(envLimit, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
        this.config.maxConcurrent = parsed;
        this.metrics.currentLimit = parsed;
        logger.info(`Concurrency limit overridden by env: ${parsed}`);
      }
    }

    // Start adaptive adjustment timer if enabled
    if (this.config.enableAdaptive) {
      this.startAdaptiveAdjustment();
    }
  }

  /**
   * Report quota usage (call after each Google API operation)
   *
   * Used by adaptive concurrency to track quota utilization and
   * adjust the concurrency limit dynamically.
   *
   * @param used - Number of quota units consumed (typically 1 per API call)
   */
  reportQuotaUsage(used: number = 1): void {
    // Reset quota tracking every minute (Google's quota window)
    const now = Date.now();
    if (now - this.quotaWindowStart >= 60000) {
      if (this.config.verboseLogging) {
        logger.debug('Quota window reset', {
          previousUsage: this.quotaUsed,
          limit: this.quotaLimit,
          utilization: ((this.quotaUsed / this.quotaLimit) * 100).toFixed(1) + '%',
        });
      }
      this.quotaUsed = 0;
      this.quotaWindowStart = now;
    }

    this.quotaUsed += used;
  }

  /**
   * Handle 429 rate limit error - immediately reduce concurrency
   *
   * Provides aggressive backoff to recover from rate limiting.
   * Reduces limit by 5 concurrent operations (but not below minimum).
   */
  on429Error(): void {
    const currentLimit = this.config.maxConcurrent;
    const newLimit = Math.max(this.config.minConcurrent!, currentLimit - 5);

    if (newLimit !== currentLimit) {
      this.recordLimitAdjustment(
        currentLimit,
        newLimit,
        '429_error',
        this.quotaUsed / this.quotaLimit
      );

      this.config.maxConcurrent = newLimit;
      this.metrics.currentLimit = newLimit;
      this.metrics.limitAdjustmentCount++;

      if (newLimit === this.config.minConcurrent) {
        this.metrics.minimumLimitReached = true;
      }

      // Update Prometheus metrics
      recordConcurrencyAdjustment('429_error', currentLimit, newLimit);

      logger.warn('Rate limit error (429): Reducing concurrency immediately', {
        oldLimit: currentLimit,
        newLimit,
        minLimit: this.config.minConcurrent,
      });
    }

    this.metrics.rateLimitErrorCount++;
    this.last429Timestamp = Date.now();

    // Record 429 error in Prometheus
    record429Error();
  }

  /**
   * Start adaptive concurrency adjustment
   *
   * Periodically adjusts the concurrency limit based on quota utilization:
   * - High utilization (>80%): Decrease concurrency to avoid 429 errors
   * - Medium utilization (50-80%): Maintain current level
   * - Low utilization (<50%): Increase concurrency for better performance
   */
  private startAdaptiveAdjustment(): void {
    this.adjustmentTimer = setInterval(() => {
      const quotaUtilization = this.quotaUsed / this.quotaLimit;
      const currentLimit = this.config.maxConcurrent;
      let newLimit = currentLimit;
      let reason = 'periodic_adjustment';

      // 16-A5: Heap pressure monitoring — reduce concurrency when heap > 80%
      // This prevents OOM kills during large batch operations regardless of quota state
      const { heapUsed, heapTotal } = process.memoryUsage();
      const heapUtilization = heapUsed / heapTotal;
      if (heapUtilization > 0.8) {
        newLimit = Math.max(this.config.minConcurrent!, Math.floor(currentLimit * 0.7));
        reason = 'heap_pressure';
        if (newLimit !== currentLimit) {
          logger.warn('Adaptive concurrency: Reducing limit due to heap pressure', {
            heapUtilization: (heapUtilization * 100).toFixed(1) + '%',
            heapUsedMB: Math.round(heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(heapTotal / 1024 / 1024),
            oldLimit: currentLimit,
            newLimit,
          });
          this.recordLimitAdjustment(currentLimit, newLimit, reason, quotaUtilization);
          this.config.maxConcurrent = newLimit;
          this.metrics.currentLimit = newLimit;
          this.metrics.limitAdjustmentCount++;
          if (newLimit === this.config.minConcurrent) this.metrics.minimumLimitReached = true;
          recordConcurrencyAdjustment(reason, currentLimit, newLimit);
        }
        recordQuotaUtilization(quotaUtilization * 100);
        return; // Skip quota-based adjustment this cycle
      }

      if (quotaUtilization > 0.8) {
        // High utilization - decrease by 20% (but not below minimum)
        newLimit = Math.max(this.config.minConcurrent!, Math.floor(currentLimit * 0.8));
        reason = 'high_quota_utilization';
        if (newLimit !== currentLimit) {
          logger.info('Adaptive concurrency: Decreasing limit (high quota usage)', {
            utilization: (quotaUtilization * 100).toFixed(1) + '%',
            oldLimit: currentLimit,
            newLimit,
          });
        }
      } else if (quotaUtilization < 0.5 && currentLimit < this.config.maxConcurrentCeiling!) {
        // Low utilization - increase by 20% (but not above ceiling)
        newLimit = Math.min(this.config.maxConcurrentCeiling!, Math.ceil(currentLimit * 1.2));
        reason = 'low_quota_utilization';
        if (newLimit !== currentLimit) {
          logger.info('Adaptive concurrency: Increasing limit (low quota usage)', {
            utilization: (quotaUtilization * 100).toFixed(1) + '%',
            oldLimit: currentLimit,
            newLimit,
          });
        }
      }

      if (newLimit !== currentLimit) {
        this.recordLimitAdjustment(currentLimit, newLimit, reason, quotaUtilization);

        this.config.maxConcurrent = newLimit;
        this.metrics.currentLimit = newLimit;
        this.metrics.limitAdjustmentCount++;

        if (newLimit === this.config.minConcurrent) {
          this.metrics.minimumLimitReached = true;
        }
        if (newLimit === this.config.maxConcurrentCeiling) {
          this.metrics.maximumLimitReached = true;
        }

        // Update Prometheus metrics
        recordConcurrencyAdjustment(reason, currentLimit, newLimit);
      }

      // Update quota utilization metric
      recordQuotaUtilization(quotaUtilization * 100);
    }, this.config.adjustmentIntervalMs!);

    logger.info('Adaptive concurrency adjustment started', {
      interval: this.config.adjustmentIntervalMs,
      range: `${this.config.minConcurrent}-${this.config.maxConcurrentCeiling}`,
    });
  }

  /**
   * Record limit adjustment for history tracking
   */
  private recordLimitAdjustment(
    oldLimit: number,
    newLimit: number,
    reason: string,
    quotaUtilization: number
  ): void {
    this.adjustmentHistory.push({
      timestamp: Date.now(),
      oldLimit,
      newLimit,
      reason,
      quotaUtilization,
    });

    // Keep only last 100 adjustments
    if (this.adjustmentHistory.length > 100) {
      this.adjustmentHistory.shift();
    }
  }

  /**
   * Stop adaptive adjustment (cleanup)
   */
  stopAdaptiveAdjustment(): void {
    if (this.adjustmentTimer) {
      clearInterval(this.adjustmentTimer);
      this.adjustmentTimer = undefined;
      logger.debug('Adaptive concurrency adjustment stopped');
    }
  }

  /**
   * Acquire a permit to execute a Google API operation
   *
   * Blocks until a permit is available if the limit is reached.
   * Must be followed by release() when operation completes.
   *
   * @param source - Identifier for the system requesting permit (e.g., "ParallelExecutor")
   * @returns Operation ID to pass to release()
   */
  async acquire(source: string): Promise<string> {
    const operationId = `${source}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const startTime = Date.now();

    // Check if we can proceed immediately
    if (this.activeOperations.size < this.config.maxConcurrent) {
      return this.grantPermit(operationId, source, startTime);
    }

    // Queue and wait for permit
    if (this.config.verboseLogging) {
      logger.debug('Concurrency limit reached, queuing operation', {
        source,
        active: this.activeOperations.size,
        limit: this.config.maxConcurrent,
        queueSize: this.waitQueue.length,
      });
    }

    this.metrics.limitReachedCount++;

    // ISSUE-113: Reject when the pending queue exceeds 500 to prevent unbounded growth
    const MAX_PENDING = 500;
    if (this.waitQueue.length >= MAX_PENDING) {
      // ISSUE-149: Include retryAfterMs hint for LLM clients
      const avgWaitMs = this.metrics.averageWaitTimeMs || 5000;
      const estimatedRetryAfterMs = Math.max(
        5000,
        Math.ceil((this.waitQueue.length * avgWaitMs) / this.config.maxConcurrent)
      );
      const queueErr = new Error(
        `Concurrency queue full (${MAX_PENDING} pending). ` +
          `Retry after approximately ${Math.ceil(estimatedRetryAfterMs / 1000)}s.`
      );
      (queueErr as Error & { retryAfterMs: number }).retryAfterMs = estimatedRetryAfterMs;
      throw queueErr;
    }

    return new Promise<string>((resolve) => {
      this.waitQueue.push({
        resolve: () => resolve(this.grantPermit(operationId, source, startTime)),
        source,
        queuedAt: Date.now(),
      });
      updateRequestQueueDepth(this.waitQueue.length);
    });
  }

  /**
   * Release a permit after operation completes
   *
   * @param operationId - ID returned from acquire()
   */
  release(operationId: string): void {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      logger.warn('Attempted to release unknown operation', { operationId });
      return;
    }

    this.activeOperations.delete(operationId);
    this.metrics.activeOperations = this.activeOperations.size;

    if (this.config.verboseLogging) {
      const duration = Date.now() - operation.startTime;
      logger.debug('Released concurrency permit', {
        source: operation.source,
        duration,
        active: this.activeOperations.size,
        queued: this.waitQueue.length,
      });
    }

    // Grant permit to next waiting operation
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      updateRequestQueueDepth(this.waitQueue.length);
      next.resolve();
    }
  }

  /**
   * Execute an async operation with automatic permit management
   *
   * Acquires permit, executes operation, releases permit on completion or error.
   * Automatically reports quota usage if adaptive concurrency is enabled.
   *
   * @param source - Identifier for the system (e.g., "ParallelExecutor")
   * @param fn - Async function to execute
   * @returns Result of the operation
   */
  async execute<T>(source: string, fn: () => Promise<T>): Promise<T> {
    const operationId = await this.acquire(source);
    try {
      const result = await fn();

      // Report quota usage for adaptive concurrency
      if (this.config.enableAdaptive) {
        this.reportQuotaUsage(1);
      }

      return result;
    } finally {
      this.release(operationId);
    }
  }

  /**
   * Get current concurrency metrics
   */
  getMetrics(): ConcurrencyMetrics {
    return {
      ...this.metrics,
      averageWaitTimeMs:
        this.metrics.totalOperations > 0
          ? this.metrics.totalWaitTimeMs / this.metrics.totalOperations
          : 0,
      currentLimit: this.config.maxConcurrent,
      timeSinceLast429Ms: this.last429Timestamp ? Date.now() - this.last429Timestamp : null,
    };
  }

  /**
   * Get current quota status
   */
  getQuotaStatus(): QuotaStatus {
    const now = Date.now();
    const windowElapsed = now - this.quotaWindowStart;
    const windowRemainingMs = Math.max(0, 60000 - windowElapsed);

    return {
      used: this.quotaUsed,
      limit: this.quotaLimit,
      utilization: this.quotaLimit > 0 ? this.quotaUsed / this.quotaLimit : 0,
      windowRemainingMs,
    };
  }

  /**
   * Get adjustment history
   */
  getAdjustmentHistory(): LimitAdjustment[] {
    return [...this.adjustmentHistory];
  }

  /**
   * Set manual concurrency limit (overrides adaptive adjustments temporarily)
   */
  setManualLimit(limit: number): void {
    if (limit < 1 || limit > 100) {
      throw new ValidationError(`Manual limit must be between 1 and 100, got ${limit}`, 'limit');
    }

    const oldLimit = this.config.maxConcurrent;
    this.config.maxConcurrent = limit;
    this.metrics.currentLimit = limit;

    logger.info('Manual concurrency limit set', {
      oldLimit,
      newLimit: limit,
    });
  }

  /**
   * Set quota limit (for testing or custom quota configurations)
   */
  setQuotaLimit(limit: number): void {
    if (limit < 0) {
      throw new ValidationError(`Quota limit must be non-negative, got ${limit}`, 'limit');
    }

    this.quotaLimit = limit;
    logger.debug('Quota limit updated', { limit });
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      activeOperations: this.activeOperations.size,
      peakConcurrent: 0,
      totalOperations: 0,
      totalWaitTimeMs: 0,
      limitReachedCount: 0,
      averageWaitTimeMs: 0,
      rateLimitErrorCount: 0,
      currentLimit: this.config.maxConcurrent,
      limitAdjustmentCount: 0,
      timeSinceLast429Ms: null,
      minimumLimitReached: false,
      maximumLimitReached: false,
    };
    this.last429Timestamp = null;
    this.adjustmentHistory = [];
  }

  /**
   * Get current status for monitoring
   */
  getStatus(): {
    active: number;
    queued: number;
    limit: number;
    utilization: number;
  } {
    const status = {
      active: this.activeOperations.size,
      queued: this.waitQueue.length,
      limit: this.config.maxConcurrent,
      utilization: (this.activeOperations.size / this.config.maxConcurrent) * 100,
    };

    // Update Prometheus metrics on every status check
    recordConcurrencyStatus(status);

    return status;
  }

  /**
   * Internal: Grant a permit and start tracking operation
   */
  private grantPermit(operationId: string, source: string, startTime: number): string {
    const acquireTime = Date.now();
    const waitTime = acquireTime - startTime;

    this.activeOperations.set(operationId, {
      id: operationId,
      source,
      startTime,
      acquireTime,
    });

    // Update metrics
    this.metrics.activeOperations = this.activeOperations.size;
    this.metrics.totalOperations++;
    this.metrics.totalWaitTimeMs += waitTime;
    this.metrics.peakConcurrent = Math.max(this.metrics.peakConcurrent, this.activeOperations.size);

    if (this.config.verboseLogging && waitTime > 100) {
      logger.debug('Operation waited for permit', {
        source,
        waitTime,
        active: this.activeOperations.size,
      });
    }

    return operationId;
  }
}

/**
 * Global singleton instance
 *
 * Shared across all systems to enforce unified concurrency limit.
 * Initialize once at application startup.
 */
let globalCoordinator: ConcurrencyCoordinator | null = null;

/**
 * Get or create the global concurrency coordinator
 *
 * @param config - Configuration (only used on first call)
 * @returns Global coordinator instance
 */
export function getConcurrencyCoordinator(
  config?: Partial<ConcurrencyConfig>
): ConcurrencyCoordinator {
  if (!globalCoordinator) {
    globalCoordinator = new ConcurrencyCoordinator(config);
  }
  return globalCoordinator;
}

/**
 * Reset the global coordinator (for testing only)
 */
export function resetConcurrencyCoordinator(): void {
  globalCoordinator = null;
}
