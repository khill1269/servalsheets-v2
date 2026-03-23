/**
 * ServalSheets - Trace Aggregator Service
 *
 * Collects and aggregates request traces for debugging and performance analysis.
 * Builds on top of the existing OpenTelemetry-compatible tracing infrastructure.
 *
 * Features:
 * - Request-level trace aggregation (groups spans by request)
 * - Search and filtering by tool, action, error, duration
 * - LRU cache with TTL (5 minutes, max 1000 traces)
 * - Performance metrics and statistics
 *
 * Usage:
 * ```typescript
 * const aggregator = getTraceAggregator();
 *
 * // Record trace after request completes
 * aggregator.recordTrace({
 *   requestId: 'req_abc123',
 *   traceId: 'trace_xyz789',
 *   timestamp: Date.now(),
 *   duration: 250,
 *   tool: 'sheets_data',
 *   action: 'read',
 *   success: true,
 *   spans: [...],
 * });
 *
 * // Search traces
 * const slowTraces = aggregator.searchTraces({ minDuration: 1000 });
 * const errorTraces = aggregator.searchTraces({ errorCode: 'INVALID_RANGE' });
 *
 * // Get specific trace
 * const trace = aggregator.getTrace('req_abc123');
 * ```
 *
 * @category Services
 */

import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger.js';
import type { Span } from '../utils/tracing.js';

// ==================== Types ====================

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'server' | 'client' | 'internal' | 'producer' | 'consumer';
  startTime: number;
  endTime: number;
  duration: number;
  attributes: Record<string, string | number | boolean | undefined>;
  status: 'ok' | 'error' | 'unset';
  statusMessage?: string;
  events?: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, string | number | boolean | undefined>;
  }>;
}

export interface RequestTrace {
  requestId: string;
  traceId: string;
  timestamp: number;
  duration: number;
  tool: string;
  action: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  spans: TraceSpan[];
  metadata?: Record<string, unknown>;
}

export interface TraceSearchFilters {
  tool?: string;
  action?: string;
  errorCode?: string;
  minDuration?: number;
  maxDuration?: number;
  success?: boolean;
  startTime?: number;
  endTime?: number;
}

export interface TraceStats {
  totalTraces: number;
  successCount: number;
  errorCount: number;
  averageDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  byTool: Record<
    string,
    {
      count: number;
      averageDuration: number;
      errorRate: number;
    }
  >;
  byError: Record<string, number>;
}

// ==================== Trace Aggregator Implementation ====================

class TraceAggregatorImpl {
  private traces: LRUCache<string, RequestTrace>;
  private enabled: boolean;

  constructor(
    options: {
      maxSize?: number;
      ttl?: number;
      enabled?: boolean;
    } = {}
  ) {
    this.enabled = options.enabled ?? process.env['TRACE_AGGREGATION_ENABLED'] === 'true';

    this.traces = new LRUCache<string, RequestTrace>({
      max: options.maxSize ?? 1000,
      ttl: options.ttl ?? 5 * 60 * 1000, // 5 minutes
      updateAgeOnGet: true,
    });

    if (this.enabled) {
      logger.info('Trace aggregation enabled', {
        maxSize: options.maxSize ?? 1000,
        ttl: `${(options.ttl ?? 5 * 60 * 1000) / 1000}s`,
      });
    }
  }

  /**
   * Check if trace aggregation is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Record a completed request trace
   */
  recordTrace(trace: RequestTrace): void {
    if (!this.enabled) return;

    this.traces.set(trace.requestId, trace);

    logger.debug('Trace recorded', {
      requestId: trace.requestId,
      traceId: trace.traceId,
      tool: trace.tool,
      action: trace.action,
      duration: `${trace.duration}ms`,
      success: trace.success,
      spanCount: trace.spans.length,
    });
  }

  /**
   * Get a specific trace by request ID
   */
  getTrace(requestId: string): RequestTrace | undefined {
    return this.traces.get(requestId);
  }

  /**
   * Get a trace by trace ID (searches all traces)
   */
  getTraceByTraceId(traceId: string): RequestTrace | undefined {
    for (const trace of this.traces.values()) {
      if (trace.traceId === traceId) {
        return trace;
      }
    }
    return undefined;
  }

  /**
   * Search traces with filters
   */
  searchTraces(filters: TraceSearchFilters = {}): RequestTrace[] {
    const traces = Array.from(this.traces.values());

    return traces.filter((trace) => {
      // Tool filter
      if (filters.tool && trace.tool !== filters.tool) {
        return false;
      }

      // Action filter
      if (filters.action && trace.action !== filters.action) {
        return false;
      }

      // Error code filter
      if (filters.errorCode && trace.errorCode !== filters.errorCode) {
        return false;
      }

      // Success filter
      if (filters.success !== undefined && trace.success !== filters.success) {
        return false;
      }

      // Duration filters
      if (filters.minDuration !== undefined && trace.duration < filters.minDuration) {
        return false;
      }
      if (filters.maxDuration !== undefined && trace.duration > filters.maxDuration) {
        return false;
      }

      // Time range filters
      if (filters.startTime !== undefined && trace.timestamp < filters.startTime) {
        return false;
      }
      if (filters.endTime !== undefined && trace.timestamp > filters.endTime) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get recent traces (last N traces)
   */
  getRecentTraces(limit: number = 100): RequestTrace[] {
    const traces = Array.from(this.traces.values());
    return traces.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Get slowest traces
   */
  getSlowestTraces(limit: number = 10): RequestTrace[] {
    const traces = Array.from(this.traces.values());
    return traces.sort((a, b) => b.duration - a.duration).slice(0, limit);
  }

  /**
   * Get error traces
   */
  getErrorTraces(limit?: number): RequestTrace[] {
    const traces = Array.from(this.traces.values());
    const errorTraces = traces
      .filter((trace) => !trace.success)
      .sort((a, b) => b.timestamp - a.timestamp);

    return limit ? errorTraces.slice(0, limit) : errorTraces;
  }

  /**
   * Get trace statistics
   */
  getStats(): TraceStats {
    const traces = Array.from(this.traces.values());

    if (traces.length === 0) {
      return {
        totalTraces: 0,
        successCount: 0,
        errorCount: 0,
        averageDuration: 0,
        p50Duration: 0,
        p95Duration: 0,
        p99Duration: 0,
        byTool: {},
        byError: {},
      };
    }

    // Calculate success/error counts
    const successCount = traces.filter((t) => t.success).length;
    const errorCount = traces.length - successCount;

    // Calculate duration statistics
    const durations = traces.map((t) => t.duration).sort((a, b) => a - b);
    const averageDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const p50Duration = durations[Math.floor(durations.length * 0.5)] ?? 0;
    const p95Duration = durations[Math.floor(durations.length * 0.95)] ?? 0;
    const p99Duration = durations[Math.floor(durations.length * 0.99)] ?? 0;

    // Group by tool
    const byTool: Record<string, { count: number; totalDuration: number; errorCount: number }> = {};
    for (const trace of traces) {
      if (!byTool[trace.tool]) {
        byTool[trace.tool] = { count: 0, totalDuration: 0, errorCount: 0 };
      }
      const toolData = byTool[trace.tool];
      if (toolData) {
        toolData.count++;
        toolData.totalDuration += trace.duration;
        if (!trace.success) {
          toolData.errorCount++;
        }
      }
    }

    const toolStats: Record<string, { count: number; averageDuration: number; errorRate: number }> =
      {};
    for (const [tool, stats] of Object.entries(byTool)) {
      toolStats[tool] = {
        count: stats.count,
        averageDuration: stats.totalDuration / stats.count,
        errorRate: stats.errorCount / stats.count,
      };
    }

    // Group errors by code
    const byError: Record<string, number> = {};
    for (const trace of traces) {
      if (trace.errorCode) {
        byError[trace.errorCode] = (byError[trace.errorCode] || 0) + 1;
      }
    }

    return {
      totalTraces: traces.length,
      successCount,
      errorCount,
      averageDuration,
      p50Duration,
      p95Duration,
      p99Duration,
      byTool: toolStats,
      byError,
    };
  }

  /**
   * Get cache size and statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    ttl: number;
  } {
    return {
      size: this.traces.size,
      maxSize: this.traces.max,
      ttl: this.traces.ttl ?? 0,
    };
  }

  /**
   * Clear all traces (for testing)
   */
  clear(): void {
    this.traces.clear();
  }

  /**
   * Convert OpenTelemetry Span to TraceSpan format
   */
  static spanToTraceSpan(span: Span): TraceSpan {
    const duration = span.endTime ? (span.endTime - span.startTime) / 1000 : 0;

    return {
      spanId: span.context.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: span.kind,
      startTime: span.startTime,
      endTime: span.endTime ?? span.startTime,
      duration,
      attributes: span.attributes,
      status: span.status,
      statusMessage: span.statusMessage,
      events: span.events?.map((e) => ({
        name: e.name,
        timestamp: e.timestamp,
        attributes: e.attributes,
      })),
    };
  }

  /**
   * Build a RequestTrace from tool execution data
   */
  static buildRequestTrace(
    requestId: string,
    traceId: string,
    tool: string,
    action: string,
    success: boolean,
    duration: number,
    spans: Span[],
    errorCode?: string,
    errorMessage?: string,
    metadata?: Record<string, unknown>
  ): RequestTrace {
    return {
      requestId,
      traceId,
      timestamp: Date.now(),
      duration,
      tool,
      action,
      success,
      errorCode,
      errorMessage,
      spans: spans.map((s) => TraceAggregatorImpl.spanToTraceSpan(s)),
      metadata,
    };
  }
}

// ==================== Global Instance ====================

let globalAggregator: TraceAggregatorImpl | undefined;

/**
 * Get the global trace aggregator instance
 */
export function getTraceAggregator(): TraceAggregatorImpl {
  if (!globalAggregator) {
    globalAggregator = new TraceAggregatorImpl();
  }
  return globalAggregator;
}

/**
 * Initialize the trace aggregator with options
 */
export function initTraceAggregator(options?: {
  maxSize?: number;
  ttl?: number;
  enabled?: boolean;
}): TraceAggregatorImpl {
  globalAggregator = new TraceAggregatorImpl(options);
  return globalAggregator;
}

// Export implementation for testing
export { TraceAggregatorImpl };
