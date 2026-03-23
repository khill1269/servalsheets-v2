/**
 * Metrics Aggregator
 *
 * Combines all metrics services into a single facade for backward compatibility.
 * Provides the same interface as the original MetricsService.
 *
 * @category Metrics
 */

import { logger } from '../../utils/logger.js';
import { ServiceError } from '../../core/errors.js';
import { OperationMetricsService } from './operation-metrics.js';
import { CacheMetricsService } from './cache-metrics.js';
import { ApiMetricsService } from './api-metrics.js';
import { SystemMetricsService } from './system-metrics.js';
import { OptimizationMetricsService } from './optimization-metrics.js';
import { ValidationMetricsService } from './validation-metrics.js';

// Re-export all types for convenience
export type { OperationMetrics, RecordOperationOptions } from './operation-metrics.js';
export type { CacheMetrics, CategoryCacheMetrics } from './cache-metrics.js';
export type {
  ApiMetrics,
  RecordApiCallOptions,
  ToolMetrics,
  ActionMetrics,
} from './api-metrics.js';
export type { SystemMetrics } from './system-metrics.js';
export type {
  BatchOperationData,
  BatchMetrics,
  RateLimitMetrics,
  CircuitBreakerMetrics,
} from './optimization-metrics.js';
export type {
  FeatureFlagMetrics,
  PayloadWarningMetrics,
  ConfirmationSkipMetrics,
} from './validation-metrics.js';

// ==================== Aggregated Types ====================

export interface MetricsSummary {
  /** Service start time */
  startTime: string;
  /** Current time */
  currentTime: string;
  /** Uptime (seconds) */
  uptime: number;
  /** Operation metrics */
  operations: import('./operation-metrics.js').OperationMetrics[];
  /** Cache metrics */
  cache: import('./cache-metrics.js').CacheMetrics;
  /** API metrics */
  api: import('./api-metrics.js').ApiMetrics;
  /** System metrics */
  system: import('./system-metrics.js').SystemMetrics;
  /** Feature flag blocks */
  featureFlags: import('./validation-metrics.js').FeatureFlagMetrics;
  /** Payload size warnings */
  payloadWarnings: import('./validation-metrics.js').PayloadWarningMetrics;
  /** Total operations */
  totalOperations: number;
  /** Average success rate across all operations */
  avgSuccessRate: number;
  /** Circuit breaker metrics */
  circuitBreaker?: import('./optimization-metrics.js').CircuitBreakerMetrics;
  /** Confirmation skip tracking (data corruption risk) */
  confirmationSkips?: {
    totalSkips: number;
    destructiveSkips: number;
  };
}

export interface OverallMetrics {
  /** Total API calls */
  totalApiCalls: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Total cache requests */
  totalCacheRequests: number;
  /** Cache hit rate (0-1) */
  cacheHitRate: number;
  /** Total batches */
  totalBatches: number;
  /** Average batch efficiency (0-1) */
  avgBatchEfficiency: number;
  /** Rate limit hits */
  rateLimitHits: number;
  /** Circuit breaker state */
  circuitBreakerState: string;
}

// ==================== Metrics Service (Aggregator) ====================

export class MetricsService {
  private startTime: Date = new Date();
  private enabled: boolean;
  private verboseLogging: boolean;

  // Composed services
  private operations: OperationMetricsService;
  private cache: CacheMetricsService;
  private api: ApiMetricsService;
  private system: SystemMetricsService;
  private optimization: OptimizationMetricsService;
  private validation: ValidationMetricsService;

  constructor(options: { enabled?: boolean; verboseLogging?: boolean } = {}) {
    this.enabled = options.enabled ?? process.env['METRICS_ENABLED'] !== 'false';
    this.verboseLogging = options.verboseLogging ?? process.env['METRICS_VERBOSE'] === 'true';

    // Initialize all services
    this.operations = new OperationMetricsService({
      enabled: this.enabled,
      verboseLogging: this.verboseLogging,
    });
    this.cache = new CacheMetricsService({ enabled: this.enabled });
    this.api = new ApiMetricsService({ enabled: this.enabled });
    this.system = new SystemMetricsService({ enabled: this.enabled });
    this.optimization = new OptimizationMetricsService({ enabled: this.enabled });
    this.validation = new ValidationMetricsService({ enabled: this.enabled });

    if (this.enabled) {
      logger.info('Metrics service initialized', {
        enabled: this.enabled,
        verboseLogging: this.verboseLogging,
      });
    }
  }

  /**
   * Check if metrics are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ==================== Operation Metrics ====================

  recordOperation(
    ...args: Parameters<OperationMetricsService['recordOperation']>
  ): ReturnType<OperationMetricsService['recordOperation']> {
    return this.operations.recordOperation(...args);
  }

  getOperationMetrics(
    ...args: Parameters<OperationMetricsService['getOperationMetrics']>
  ): ReturnType<OperationMetricsService['getOperationMetrics']> {
    return this.operations.getOperationMetrics(...args);
  }

  getAllOperationMetrics(): ReturnType<OperationMetricsService['getAllOperationMetrics']> {
    return this.operations.getAllOperationMetrics();
  }

  // ==================== Cache Metrics ====================

  recordCacheAccess(
    ...args: Parameters<CacheMetricsService['recordCacheAccess']>
  ): ReturnType<CacheMetricsService['recordCacheAccess']> {
    return this.cache.recordCacheAccess(...args);
  }

  recordCacheHit(
    ...args: Parameters<CacheMetricsService['recordCacheHit']>
  ): ReturnType<CacheMetricsService['recordCacheHit']> {
    return this.cache.recordCacheHit(...args);
  }

  getCacheMetrics(): import('./cache-metrics.js').CacheMetrics;
  getCacheMetrics(category: string): import('./cache-metrics.js').CategoryCacheMetrics;
  getCacheMetrics(
    category?: string
  ): import('./cache-metrics.js').CacheMetrics | import('./cache-metrics.js').CategoryCacheMetrics {
    if (category) {
      return this.cache.getCacheMetrics(category);
    }
    return this.cache.getCacheMetrics();
  }

  getCategoryCacheMetrics(
    ...args: Parameters<CacheMetricsService['getCategoryCacheMetrics']>
  ): ReturnType<CacheMetricsService['getCategoryCacheMetrics']> {
    return this.cache.getCategoryCacheMetrics(...args);
  }

  // ==================== API Metrics ====================

  recordApiCall(
    ...args: Parameters<ApiMetricsService['recordApiCall']>
  ): ReturnType<ApiMetricsService['recordApiCall']> {
    return this.api.recordApiCall(...args);
  }

  getApiMetrics(): ReturnType<ApiMetricsService['getApiMetrics']> {
    return this.api.getApiMetrics();
  }

  getToolMetrics(
    ...args: Parameters<ApiMetricsService['getToolMetrics']>
  ): ReturnType<ApiMetricsService['getToolMetrics']> {
    return this.api.getToolMetrics(...args);
  }

  getActionMetrics(
    ...args: Parameters<ApiMetricsService['getActionMetrics']>
  ): ReturnType<ApiMetricsService['getActionMetrics']> {
    return this.api.getActionMetrics(...args);
  }

  getErrorMetrics(): ReturnType<ApiMetricsService['getErrorMetrics']> {
    return this.api.getErrorMetrics();
  }

  // ==================== System Metrics ====================

  incrementActiveRequests(): ReturnType<SystemMetricsService['incrementActiveRequests']> {
    return this.system.incrementActiveRequests();
  }

  decrementActiveRequests(): ReturnType<SystemMetricsService['decrementActiveRequests']> {
    return this.system.decrementActiveRequests();
  }

  getSystemMetrics(): ReturnType<SystemMetricsService['getSystemMetrics']> {
    return this.system.getSystemMetrics();
  }

  // ==================== Optimization Metrics ====================

  recordBatchOperation(
    ...args: Parameters<OptimizationMetricsService['recordBatchOperation']>
  ): ReturnType<OptimizationMetricsService['recordBatchOperation']> {
    return this.optimization.recordBatchOperation(...args);
  }

  getBatchMetrics(): ReturnType<OptimizationMetricsService['getBatchMetrics']> {
    return this.optimization.getBatchMetrics();
  }

  recordRateLimitHit(
    ...args: Parameters<OptimizationMetricsService['recordRateLimitHit']>
  ): ReturnType<OptimizationMetricsService['recordRateLimitHit']> {
    return this.optimization.recordRateLimitHit(...args);
  }

  getRateLimitMetrics(): ReturnType<OptimizationMetricsService['getRateLimitMetrics']> {
    return this.optimization.getRateLimitMetrics();
  }

  recordCircuitBreakerEvent(
    ...args: Parameters<OptimizationMetricsService['recordCircuitBreakerEvent']>
  ): ReturnType<OptimizationMetricsService['recordCircuitBreakerEvent']> {
    return this.optimization.recordCircuitBreakerEvent(...args);
  }

  getCircuitBreakerMetrics(): ReturnType<OptimizationMetricsService['getCircuitBreakerMetrics']> {
    return this.optimization.getCircuitBreakerMetrics();
  }

  // ==================== Validation Metrics ====================

  recordFeatureFlagBlock(
    ...args: Parameters<ValidationMetricsService['recordFeatureFlagBlock']>
  ): ReturnType<ValidationMetricsService['recordFeatureFlagBlock']> {
    return this.validation.recordFeatureFlagBlock(...args);
  }

  getFeatureFlagMetrics(): ReturnType<ValidationMetricsService['getFeatureFlagMetrics']> {
    return this.validation.getFeatureFlagMetrics();
  }

  recordPayloadWarning(
    ...args: Parameters<ValidationMetricsService['recordPayloadWarning']>
  ): ReturnType<ValidationMetricsService['recordPayloadWarning']> {
    return this.validation.recordPayloadWarning(...args);
  }

  getPayloadWarningMetrics(): ReturnType<ValidationMetricsService['getPayloadWarningMetrics']> {
    return this.validation.getPayloadWarningMetrics();
  }

  recordConfirmationSkip(
    ...args: Parameters<ValidationMetricsService['recordConfirmationSkip']>
  ): ReturnType<ValidationMetricsService['recordConfirmationSkip']> {
    return this.validation.recordConfirmationSkip(...args);
  }

  getConfirmationSkipMetrics(): ReturnType<ValidationMetricsService['getConfirmationSkipMetrics']> {
    return this.validation.getConfirmationSkipMetrics();
  }

  // ==================== Aggregated Metrics ====================

  /**
   * Get comprehensive metrics summary
   */
  getSummary(): MetricsSummary {
    const operations = this.getAllOperationMetrics();
    const totalOperations = operations.reduce((sum, op) => sum + op.count, 0);
    const avgSuccessRate =
      operations.length > 0
        ? operations.reduce((sum, op) => sum + op.successRate, 0) / operations.length
        : 0;

    const circuitBreaker = this.getCircuitBreakerMetrics();
    const confirmationSkipMetrics = this.getConfirmationSkipMetrics();
    const featureFlags = this.getFeatureFlagMetrics();
    const payloadWarnings = this.getPayloadWarningMetrics();

    return {
      startTime: this.startTime.toISOString(),
      currentTime: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      operations,
      cache: this.getCacheMetrics(),
      api: this.getApiMetrics(),
      system: this.getSystemMetrics(),
      featureFlags,
      payloadWarnings,
      totalOperations,
      avgSuccessRate,
      circuitBreaker,
      confirmationSkips: {
        totalSkips: confirmationSkipMetrics.totalSkips,
        destructiveSkips: confirmationSkipMetrics.destructiveSkips,
      },
    };
  }

  /**
   * Get overall aggregated metrics
   */
  getOverallMetrics(): OverallMetrics {
    const apiMetrics = this.getApiMetrics();
    const cacheMetrics = this.getCacheMetrics();
    const batchMetrics = this.getBatchMetrics();
    const rateLimitMetrics = this.getRateLimitMetrics();

    return {
      totalApiCalls: apiMetrics.calls,
      successRate:
        apiMetrics.calls > 0 ? (apiMetrics.calls - apiMetrics.errors) / apiMetrics.calls : 0,
      totalCacheRequests: cacheMetrics.requests,
      cacheHitRate: cacheMetrics.hitRate,
      totalBatches: batchMetrics.totalBatches,
      avgBatchEfficiency: batchMetrics.avgEfficiency,
      rateLimitHits: rateLimitMetrics.totalLimits,
      circuitBreakerState: this.optimization.getCircuitBreakerState(),
    };
  }

  /**
   * Get metrics within a time window
   * @param windowMs Time window in milliseconds (e.g., 60000 for last minute)
   */
  getMetricsInWindow(windowMs: number): OverallMetrics {
    const apiWindow = this.api.getMetricsInWindow(windowMs);
    const overallMetrics = this.getOverallMetrics();

    // Return metrics scaled to window (approximation)
    return {
      totalApiCalls: apiWindow.totalApiCalls,
      successRate: overallMetrics.successRate,
      totalCacheRequests: overallMetrics.totalCacheRequests,
      cacheHitRate: overallMetrics.cacheHitRate,
      totalBatches: overallMetrics.totalBatches,
      avgBatchEfficiency: overallMetrics.avgBatchEfficiency,
      rateLimitHits: overallMetrics.rateLimitHits,
      circuitBreakerState: overallMetrics.circuitBreakerState,
    };
  }

  /**
   * Get comprehensive dashboard data
   * @returns Dashboard data with overview, tool breakdown, cache stats, and batch stats
   */
  getDashboardData(): {
    overview: OverallMetrics;
    toolBreakdown: Record<string, import('./api-metrics.js').ToolMetrics>;
    cacheStats: import('./cache-metrics.js').CacheMetrics;
    batchStats: import('./optimization-metrics.js').BatchMetrics;
  } {
    // Get overview
    const overview = this.getOverallMetrics();

    // Build tool breakdown
    const toolBreakdown: Record<string, import('./api-metrics.js').ToolMetrics> = {};
    for (const tool of this.api.getAllTools()) {
      toolBreakdown[tool] = this.getToolMetrics(tool);
    }

    // Get cache stats
    const cacheStats = this.getCacheMetrics();

    // Get batch stats
    const batchStats = this.getBatchMetrics();

    return {
      overview,
      toolBreakdown,
      cacheStats,
      batchStats,
    };
  }

  /**
   * Get metrics as flat object for logging
   */
  getLogMetrics(): Record<string, unknown> {
    const summary = this.getSummary();
    return {
      uptime: summary.uptime,
      totalOperations: summary.totalOperations,
      avgSuccessRate: summary.avgSuccessRate,
      cacheHitRate: summary.cache.hitRate,
      apiCalls: summary.api.calls,
      apiErrorRate: summary.api.errorRate,
      activeRequests: summary.system.activeRequests,
      memoryUsageMB: Math.round(summary.system.memoryUsage / 1024 / 1024),
    };
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.operations.clear();
    this.cache.clear();
    this.api.clear();
    this.system.clear();
    this.optimization.clear();
    this.validation.clear();
    this.startTime = new Date();
  }

  /**
   * Reset all metrics (alias for clear, for testing)
   */
  reset(): void {
    this.clear();
  }
}

// ==================== Singleton ====================

let metricsService: MetricsService | null = null;

/**
 * Get or create metrics service singleton
 */
export function getMetricsService(): MetricsService {
  if (!metricsService) {
    metricsService = new MetricsService();
  }
  return metricsService;
}

/**
 * Set metrics service (for testing or custom configuration)
 */
export function setMetricsService(service: MetricsService): void {
  metricsService = service;
}

/**
 * Initialize metrics service with options
 */
export function initMetricsService(options?: {
  enabled?: boolean;
  verboseLogging?: boolean;
}): MetricsService {
  metricsService = new MetricsService(options);
  return metricsService;
}

/**
 * Reset metrics service (for testing only)
 * @internal
 */
export function resetMetricsService(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetMetricsService() can only be called in test environment',
      'INTERNAL_ERROR',
      'MetricsService'
    );
  }
  metricsService = null;
}
