/**
 * MetricsExporter
 *
 * @purpose Exports performance metrics in Prometheus text format for external monitoring (Grafana, Datadog, etc.)
 * @category Infrastructure
 * @usage Use for continuous monitoring; exposes /metrics endpoint, includes cache hits, batching efficiency, API latency
 * @dependencies MetricsService, CacheManager
 * @stateful No - reads current state from MetricsService on-demand
 * @singleton No - can be instantiated per export request
 *
 * @example
 * const exporter = new MetricsExporter(metricsService, cacheManager);
 * const prometheusText = exporter.export();
 * // # HELP servalsheets_api_calls_total Total API calls
 * // # TYPE servalsheets_api_calls_total counter
 * // servalsheets_api_calls_total{operation="read"} 1250
 */

import { MetricsService, type FeatureFlagMetrics, type PayloadWarningMetrics } from './metrics.js';
import { CacheManager } from '../utils/cache-manager.js';

export interface MetricsSnapshot {
  timestamp: number;
  cache: Record<string, CacheStats>;
  batching: BatchingStats;
  api: APIStats;
  featureFlags: FeatureFlagMetrics;
  payloadWarnings: PayloadWarningMetrics;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number;
}

export interface BatchingStats {
  currentWindowMs: number;
  totalBatches: number;
  totalRequests: number;
  averageBatchSize: number;
  deduplicatedCount: number;
}

export interface APIStats {
  callsByMethod: Record<string, number>;
  errorsByCode: Record<string, number>;
  totalCalls: number;
  totalErrors: number;
}

/**
 * Exports metrics in various formats
 */
export class MetricsExporter {
  private metricsService: MetricsService;
  private cacheManager?: CacheManager;

  constructor(metricsService: MetricsService, cacheManager?: CacheManager) {
    this.metricsService = metricsService;
    this.cacheManager = cacheManager;
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    const cacheStats = this.cacheManager?.getStats() || {};
    const summary = this.metricsService.getSummary();

    // Extract batching stats from metrics
    const batchingStats: BatchingStats = {
      currentWindowMs: 0, // Would need to expose from batching system
      totalBatches: 0,
      totalRequests: summary.totalOperations || 0,
      averageBatchSize: 0,
      deduplicatedCount: 0,
    };

    // Extract API stats
    const apiStats: APIStats = {
      callsByMethod: summary.api.byMethod || {},
      errorsByCode: {},
      totalCalls: summary.api.calls || 0,
      totalErrors: summary.api.errors || 0,
    };

    return {
      timestamp: Date.now(),
      cache: cacheStats as Record<string, CacheStats>,
      batching: batchingStats,
      api: apiStats,
      featureFlags: summary.featureFlags,
      payloadWarnings: summary.payloadWarnings,
    };
  }

  /**
   * Export metrics in Prometheus text format
   * Spec: https://prometheus.io/docs/instrumenting/exposition_formats/
   */
  exportPrometheus(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [];

    // Add metadata
    lines.push(`# ServalSheets MCP Server Metrics`);
    lines.push(`# Generated: ${new Date(snapshot.timestamp).toISOString()}`);
    lines.push(``);

    // Cache metrics
    if (Object.keys(snapshot.cache).length > 0) {
      lines.push(`# HELP cache_hit_rate Cache hit rate by cache type (0-1)`);
      lines.push(`# TYPE cache_hit_rate gauge`);
      for (const [type, stats] of Object.entries(snapshot.cache)) {
        const hitRate = stats.hitRate.toFixed(4);
        lines.push(`cache_hit_rate{type="${type}"} ${hitRate}`);
      }
      lines.push(``);

      lines.push(`# HELP cache_hits_total Total cache hits by type`);
      lines.push(`# TYPE cache_hits_total counter`);
      for (const [type, stats] of Object.entries(snapshot.cache)) {
        lines.push(`cache_hits_total{type="${type}"} ${stats.hits}`);
      }
      lines.push(``);

      lines.push(`# HELP cache_misses_total Total cache misses by type`);
      lines.push(`# TYPE cache_misses_total counter`);
      for (const [type, stats] of Object.entries(snapshot.cache)) {
        lines.push(`cache_misses_total{type="${type}"} ${stats.misses}`);
      }
      lines.push(``);

      lines.push(`# HELP cache_evictions_total Total cache evictions by type`);
      lines.push(`# TYPE cache_evictions_total counter`);
      for (const [type, stats] of Object.entries(snapshot.cache)) {
        lines.push(`cache_evictions_total{type="${type}"} ${stats.evictions}`);
      }
      lines.push(``);

      lines.push(`# HELP cache_size_bytes Current cache size in bytes by type`);
      lines.push(`# TYPE cache_size_bytes gauge`);
      for (const [type, stats] of Object.entries(snapshot.cache)) {
        lines.push(`cache_size_bytes{type="${type}"} ${stats.size}`);
      }
      lines.push(``);
    }

    // Batching metrics
    lines.push(`# HELP batch_window_ms Current adaptive batch window in milliseconds`);
    lines.push(`# TYPE batch_window_ms gauge`);
    lines.push(`batch_window_ms ${snapshot.batching.currentWindowMs}`);
    lines.push(``);

    lines.push(`# HELP batch_requests_total Total requests processed in batches`);
    lines.push(`# TYPE batch_requests_total counter`);
    lines.push(`batch_requests_total ${snapshot.batching.totalRequests}`);
    lines.push(``);

    lines.push(`# HELP batch_count_total Total number of batches executed`);
    lines.push(`# TYPE batch_count_total counter`);
    lines.push(`batch_count_total ${snapshot.batching.totalBatches}`);
    lines.push(``);

    lines.push(`# HELP batch_size_avg Average batch size (requests per batch)`);
    lines.push(`# TYPE batch_size_avg gauge`);
    lines.push(`batch_size_avg ${snapshot.batching.averageBatchSize.toFixed(2)}`);
    lines.push(``);

    lines.push(`# HELP requests_deduplicated_total Total requests deduplicated`);
    lines.push(`# TYPE requests_deduplicated_total counter`);
    lines.push(`requests_deduplicated_total ${snapshot.batching.deduplicatedCount}`);
    lines.push(``);

    // API call metrics
    lines.push(`# HELP api_calls_total Total API calls by method`);
    lines.push(`# TYPE api_calls_total counter`);
    for (const [method, count] of Object.entries(snapshot.api.callsByMethod)) {
      lines.push(`api_calls_total{method="${method}"} ${count}`);
    }
    lines.push(``);

    lines.push(`# HELP api_errors_total Total API errors by error code`);
    lines.push(`# TYPE api_errors_total counter`);
    for (const [code, count] of Object.entries(snapshot.api.errorsByCode)) {
      lines.push(`api_errors_total{code="${code}"} ${count}`);
    }
    lines.push(``);

    // Feature flag block metrics
    lines.push(`# HELP feature_flag_blocks_total Total feature flag blocks by flag`);
    lines.push(`# TYPE feature_flag_blocks_total counter`);
    for (const [flag, count] of Object.entries(snapshot.featureFlags.byFlag)) {
      lines.push(`feature_flag_blocks_total{flag="${flag}"} ${count}`);
    }
    lines.push(``);

    lines.push(`# HELP feature_flag_blocks_by_action_total Total feature flag blocks by action`);
    lines.push(`# TYPE feature_flag_blocks_by_action_total counter`);
    for (const [action, count] of Object.entries(snapshot.featureFlags.byAction)) {
      lines.push(`feature_flag_blocks_by_action_total{action="${action}"} ${count}`);
    }
    lines.push(``);

    // Payload warning metrics
    lines.push(`# HELP payload_warnings_total Total payload warnings by level`);
    lines.push(`# TYPE payload_warnings_total counter`);
    lines.push(`payload_warnings_total{level="warning"} ${snapshot.payloadWarnings.warning}`);
    lines.push(`payload_warnings_total{level="critical"} ${snapshot.payloadWarnings.critical}`);
    lines.push(`payload_warnings_total{level="exceeded"} ${snapshot.payloadWarnings.exceeded}`);
    lines.push(``);

    lines.push(
      `# HELP payload_warnings_by_action_total Total payload warnings by action and level`
    );
    lines.push(`# TYPE payload_warnings_by_action_total counter`);
    for (const [action, stats] of Object.entries(snapshot.payloadWarnings.byAction)) {
      lines.push(
        `payload_warnings_by_action_total{action="${action}",level="warning"} ${stats.warning}`
      );
      lines.push(
        `payload_warnings_by_action_total{action="${action}",level="critical"} ${stats.critical}`
      );
      lines.push(
        `payload_warnings_by_action_total{action="${action}",level="exceeded"} ${stats.exceeded}`
      );
    }
    lines.push(``);

    // Summary metrics
    lines.push(`# HELP api_calls_summary_total Total API calls across all methods`);
    lines.push(`# TYPE api_calls_summary_total counter`);
    lines.push(`api_calls_summary_total ${snapshot.api.totalCalls}`);
    lines.push(``);

    lines.push(`# HELP api_errors_summary_total Total API errors across all codes`);
    lines.push(`# TYPE api_errors_summary_total counter`);
    lines.push(`api_errors_summary_total ${snapshot.api.totalErrors}`);
    lines.push(``);

    return lines.join('\n');
  }

  /**
   * Export metrics in JSON format
   */
  exportJSON(): string {
    const snapshot = this.getSnapshot();
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Export metrics in human-readable text format
   */
  exportText(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [];

    lines.push(`ServalSheets MCP Server Metrics`);
    lines.push(`================================`);
    lines.push(`Timestamp: ${new Date(snapshot.timestamp).toISOString()}`);
    lines.push(``);

    // Cache metrics
    if (Object.keys(snapshot.cache).length > 0) {
      lines.push(`Cache Statistics:`);
      for (const [type, stats] of Object.entries(snapshot.cache)) {
        lines.push(`  ${type}:`);
        lines.push(`    Hit Rate: ${(stats.hitRate * 100).toFixed(1)}%`);
        lines.push(`    Hits: ${stats.hits}`);
        lines.push(`    Misses: ${stats.misses}`);
        lines.push(`    Evictions: ${stats.evictions}`);
        lines.push(`    Size: ${stats.size} bytes`);
      }
      lines.push(``);
    }

    // Batching metrics
    lines.push(`Batching Statistics:`);
    lines.push(`  Current Window: ${snapshot.batching.currentWindowMs}ms`);
    lines.push(`  Total Batches: ${snapshot.batching.totalBatches}`);
    lines.push(`  Total Requests: ${snapshot.batching.totalRequests}`);
    lines.push(`  Average Batch Size: ${snapshot.batching.averageBatchSize.toFixed(2)}`);
    lines.push(`  Deduplicated: ${snapshot.batching.deduplicatedCount}`);
    lines.push(``);

    // API metrics
    lines.push(`API Statistics:`);
    lines.push(`  Total Calls: ${snapshot.api.totalCalls}`);
    lines.push(`  Total Errors: ${snapshot.api.totalErrors}`);
    if (Object.keys(snapshot.api.callsByMethod).length > 0) {
      lines.push(`  Calls by Method:`);
      for (const [method, count] of Object.entries(snapshot.api.callsByMethod)) {
        lines.push(`    ${method}: ${count}`);
      }
    }
    if (Object.keys(snapshot.api.errorsByCode).length > 0) {
      lines.push(`  Errors by Code:`);
      for (const [code, count] of Object.entries(snapshot.api.errorsByCode)) {
        lines.push(`    ${code}: ${count}`);
      }
    }
    lines.push(``);

    // Feature flag blocks
    lines.push(`Feature Flag Blocks:`);
    lines.push(`  Total Blocks: ${snapshot.featureFlags.totalBlocks}`);
    if (Object.keys(snapshot.featureFlags.byFlag).length > 0) {
      lines.push(`  By Flag:`);
      for (const [flag, count] of Object.entries(snapshot.featureFlags.byFlag)) {
        lines.push(`    ${flag}: ${count}`);
      }
    }
    if (Object.keys(snapshot.featureFlags.byAction).length > 0) {
      lines.push(`  By Action:`);
      for (const [action, count] of Object.entries(snapshot.featureFlags.byAction)) {
        lines.push(`    ${action}: ${count}`);
      }
    }
    lines.push(``);

    // Payload warnings
    lines.push(`Payload Warnings:`);
    lines.push(`  Warning: ${snapshot.payloadWarnings.warning}`);
    lines.push(`  Critical: ${snapshot.payloadWarnings.critical}`);
    lines.push(`  Exceeded: ${snapshot.payloadWarnings.exceeded}`);
    lines.push(`  Total: ${snapshot.payloadWarnings.total}`);
    if (Object.keys(snapshot.payloadWarnings.byAction).length > 0) {
      lines.push(`  By Action:`);
      for (const [action, stats] of Object.entries(snapshot.payloadWarnings.byAction)) {
        lines.push(
          `    ${action}: warning=${stats.warning}, critical=${stats.critical}, exceeded=${stats.exceeded}, total=${stats.total}`
        );
      }
    }

    return lines.join('\n');
  }
}
