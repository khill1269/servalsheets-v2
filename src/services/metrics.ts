/**
 * MetricsService - Backward Compatibility Facade
 *
 * This file maintains backward compatibility by re-exporting from the new
 * modular metrics implementation in services/metrics/.
 *
 * The metrics service has been split into focused modules:
 * - operation-metrics.ts: Tool call tracking with durations and percentiles
 * - cache-metrics.ts: Cache hit/miss rates by category
 * - api-metrics.ts: Google API call tracking, tool/action metrics, error types
 * - system-metrics.ts: Memory, CPU, active requests
 * - optimization-metrics.ts: Batching, rate limiting, circuit breaker
 * - validation-metrics.ts: Feature flags, payload warnings, confirmation skips
 * - aggregator.ts: Combines all services with unified interface
 *
 * @purpose Aggregates performance metrics with percentiles (p50, p95, p99), error rates, cache hit rates, and active request tracking
 * @category Infrastructure
 * @usage Use for observability and monitoring; tracks operation counters, durations, API calls, memory-efficient sliding window
 * @dependencies logger
 * @stateful Yes - maintains operation metrics map, histogram buckets, active request counter, cache hit/miss stats
 * @singleton Yes - one instance per process to aggregate metrics across all requests
 *
 * @example
 * const metrics = new MetricsService({ windowSize: 1000 });
 * metrics.recordOperation('sheets_data.write', 150, true);
 * metrics.recordCacheHit('spreadsheet', true);
 * const summary = metrics.getSummary(); // { operations: {...}, cache: {...}, active: 5 }
 */

// Re-export all types
export type { OperationMetrics, RecordOperationOptions } from './metrics/operation-metrics.js';
export type { CacheMetrics, CategoryCacheMetrics } from './metrics/cache-metrics.js';
export type {
  ApiMetrics,
  RecordApiCallOptions,
  ToolMetrics,
  ActionMetrics,
} from './metrics/api-metrics.js';
export type { SystemMetrics } from './metrics/system-metrics.js';
export type {
  BatchOperationData,
  BatchMetrics,
  RateLimitMetrics,
  CircuitBreakerMetrics,
} from './metrics/optimization-metrics.js';
export type {
  FeatureFlagMetrics,
  PayloadWarningMetrics,
  ConfirmationSkipMetrics,
} from './metrics/validation-metrics.js';
export type { MetricsSummary, OverallMetrics } from './metrics/aggregator.js';

// Re-export the main service and helpers
export {
  MetricsService,
  getMetricsService,
  setMetricsService,
  initMetricsService,
  resetMetricsService,
} from './metrics/aggregator.js';
