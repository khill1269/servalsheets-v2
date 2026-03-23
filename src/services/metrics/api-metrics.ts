/**
 * API Metrics
 *
 * Tracks Google API calls, tool-level metrics, action-level metrics, and error types.
 *
 * @category Metrics
 */

import { logger } from '../../utils/logger.js';

// ==================== Types ====================

export interface ApiMetrics {
  /** Total API calls */
  calls: number;
  /** API calls by method */
  byMethod: Record<string, number>;
  /** Errors */
  errors: number;
  /** Error rate (0-1) */
  errorRate: number;
}

export interface RecordApiCallOptions {
  /** Tool name (e.g., "sheets_data") */
  tool: string;
  /** Action name (e.g., "read", "write") */
  action: string;
  /** Duration in milliseconds */
  duration: number;
  /** Success status */
  success: boolean;
  /** Error type (if failed) */
  errorType?: string;
  /** Timestamp (defaults to Date.now() if not provided) */
  timestamp?: number;
}

export interface ToolMetrics {
  /** Total calls */
  totalCalls: number;
  /** Successful calls */
  successCalls: number;
  /** Failed calls */
  failedCalls: number;
  /** Average duration (ms) */
  avgDuration: number;
  /** Minimum duration (ms) */
  minDuration: number;
  /** Maximum duration (ms) */
  maxDuration: number;
}

export interface ActionMetrics {
  /** Total calls */
  totalCalls: number;
  /** Average duration (ms) */
  avgDuration: number;
}

// ==================== Constants ====================

/**
 * Maximum number of duration samples to keep per tool/action
 * Prevents unbounded memory growth
 */
const MAX_DURATION_SAMPLES = 1000;

/**
 * Maximum cardinality for metric labels (tools, actions, error types)
 * Prevents unbounded memory growth from high-cardinality labels
 */
const MAX_LABEL_CARDINALITY = 10000;

// ==================== API Metrics Service ====================

export class ApiMetricsService {
  private apiCalls = 0;
  private apiCallsByMethod: Map<string, number> = new Map();
  private apiErrors = 0;

  private toolMetrics: Map<
    string,
    {
      totalCalls: number;
      successCalls: number;
      failedCalls: number;
      durations: number[];
      timestamps: number[];
    }
  > = new Map();

  private actionMetrics: Map<
    string,
    {
      // key: "tool:action"
      totalCalls: number;
      durations: number[];
      timestamps: number[];
    }
  > = new Map();

  private errorMetrics: Map<string, number> = new Map(); // errorType -> count

  private enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Record API call (simple signature for backward compatibility)
   */
  recordApiCall(method: string, success?: boolean): void;
  /**
   * Record API call (extended signature with tool/action tracking)
   */
  recordApiCall(options: RecordApiCallOptions): void;
  recordApiCall(methodOrOptions: string | RecordApiCallOptions, success: boolean = true): void {
    if (!this.enabled) return;

    // Handle both signatures
    if (typeof methodOrOptions === 'string') {
      // Simple signature: recordApiCall(method, success)
      const method = methodOrOptions;
      this.apiCalls++;
      this.apiCallsByMethod.set(method, (this.apiCallsByMethod.get(method) || 0) + 1);
      if (!success) {
        this.apiErrors++;
      }
    } else {
      // Extended signature: recordApiCall({ tool, action, duration, success, errorType, timestamp })
      const { tool, action, duration, success: isSuccess, errorType, timestamp } = methodOrOptions;
      const recordTimestamp = timestamp ?? Date.now();

      // Update basic API metrics
      this.apiCalls++;
      const method = `${tool}.${action}`;
      this.apiCallsByMethod.set(method, (this.apiCallsByMethod.get(method) || 0) + 1);
      if (!isSuccess) {
        this.apiErrors++;

        // Track error types
        if (errorType) {
          // CARDINALITY LIMIT: Prevent unbounded growth from many error types
          if (
            !this.errorMetrics.has(errorType) &&
            this.errorMetrics.size >= MAX_LABEL_CARDINALITY
          ) {
            logger.warn('Error metrics cardinality limit reached', {
              limit: MAX_LABEL_CARDINALITY,
              droppedErrorType: errorType,
            });
          } else {
            this.errorMetrics.set(errorType, (this.errorMetrics.get(errorType) || 0) + 1);
          }
        }
      }

      // Track tool-level metrics
      let toolStats = this.toolMetrics.get(tool);
      if (!toolStats) {
        // CARDINALITY LIMIT: Prevent unbounded growth
        if (this.toolMetrics.size >= MAX_LABEL_CARDINALITY) {
          logger.warn('Tool metrics cardinality limit reached', {
            limit: MAX_LABEL_CARDINALITY,
            droppedTool: tool,
            message: 'Metric will not be tracked to prevent memory issues',
          });
          return; // Drop metric to prevent unbounded growth
        }
        toolStats = {
          totalCalls: 0,
          successCalls: 0,
          failedCalls: 0,
          durations: [],
          timestamps: [],
        };
        this.toolMetrics.set(tool, toolStats);
      }
      toolStats.totalCalls++;
      if (isSuccess) {
        toolStats.successCalls++;
      } else {
        toolStats.failedCalls++;
      }
      toolStats.durations.push(duration);
      toolStats.timestamps.push(recordTimestamp);
      if (toolStats.durations.length > MAX_DURATION_SAMPLES) {
        toolStats.durations.shift();
        toolStats.timestamps.shift();
      }

      // Track action-level metrics
      const actionKey = `${tool}:${action}`;
      let actionStats = this.actionMetrics.get(actionKey);
      if (!actionStats) {
        // CARDINALITY LIMIT: Prevent unbounded growth
        if (this.actionMetrics.size >= MAX_LABEL_CARDINALITY) {
          logger.warn('Action metrics cardinality limit reached', {
            limit: MAX_LABEL_CARDINALITY,
            droppedAction: actionKey,
            message: 'Metric will not be tracked to prevent memory issues',
          });
          return; // Drop metric to prevent unbounded growth
        }
        actionStats = {
          totalCalls: 0,
          durations: [],
          timestamps: [],
        };
        this.actionMetrics.set(actionKey, actionStats);
      }
      actionStats.totalCalls++;
      actionStats.durations.push(duration);
      actionStats.timestamps.push(recordTimestamp);
      if (actionStats.durations.length > MAX_DURATION_SAMPLES) {
        actionStats.durations.shift();
        actionStats.timestamps.shift();
      }
    }
  }

  /**
   * Get API metrics
   */
  getApiMetrics(): ApiMetrics {
    return {
      calls: this.apiCalls,
      byMethod: Object.fromEntries(this.apiCallsByMethod),
      errors: this.apiErrors,
      errorRate: this.apiCalls > 0 ? this.apiErrors / this.apiCalls : 0,
    };
  }

  /**
   * Get tool-level metrics
   */
  getToolMetrics(tool: string): ToolMetrics {
    const stats = this.toolMetrics.get(tool);
    if (!stats) {
      return {
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
      };
    }

    const durations = stats.durations;
    const avgDuration =
      durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

    return {
      totalCalls: stats.totalCalls,
      successCalls: stats.successCalls,
      failedCalls: stats.failedCalls,
      avgDuration,
      minDuration,
      maxDuration,
    };
  }

  /**
   * Get action-level metrics
   */
  getActionMetrics(tool: string, action: string): ActionMetrics {
    const actionKey = `${tool}:${action}`;
    const stats = this.actionMetrics.get(actionKey);
    if (!stats) {
      return {
        totalCalls: 0,
        avgDuration: 0,
      };
    }

    const avgDuration =
      stats.durations.length > 0
        ? stats.durations.reduce((sum, d) => sum + d, 0) / stats.durations.length
        : 0;

    return {
      totalCalls: stats.totalCalls,
      avgDuration,
    };
  }

  /**
   * Get error metrics by type
   * @returns Record mapping error types to counts
   */
  getErrorMetrics(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [errorType, count] of this.errorMetrics.entries()) {
      result[errorType] = count;
    }
    return result;
  }

  /**
   * Get all tool names
   */
  getAllTools(): string[] {
    return Array.from(this.toolMetrics.keys());
  }

  /**
   * Get metrics within a time window
   * @param windowMs Time window in milliseconds (e.g., 60000 for last minute)
   */
  getMetricsInWindow(windowMs: number): { totalApiCalls: number } {
    const cutoffTime = Date.now() - windowMs;

    // Count API calls within window
    let totalApiCalls = 0;

    for (const [_tool, stats] of this.toolMetrics.entries()) {
      for (let i = 0; i < stats.timestamps.length; i++) {
        const timestamp = stats.timestamps[i];
        if (timestamp !== undefined && timestamp >= cutoffTime) {
          totalApiCalls++;
        }
      }
    }

    return { totalApiCalls };
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.apiCalls = 0;
    this.apiCallsByMethod.clear();
    this.apiErrors = 0;
    this.toolMetrics.clear();
    this.actionMetrics.clear();
    this.errorMetrics.clear();
  }
}
