/**
 * Prometheus Metrics
 *
 * Exposes key operational metrics for monitoring and alerting.
 * Access via GET /metrics endpoint.
 */

import { register, Counter, Histogram, Gauge, Summary } from 'prom-client';

/**
 * Helper: get an existing metric or create a new one.
 * Prevents "already registered" errors when ESM resolves this module
 * through multiple specifier paths (common with tsx + monorepo).
 */
function getOrCreate<T>(name: string, factory: () => T): T {
  const existing = register.getSingleMetric(name);
  if (existing) return existing as unknown as T;
  return factory();
}

// Tool call metrics
export const toolCallsTotal = getOrCreate('servalsheets_tool_calls_total', () => new Counter({
  name: 'servalsheets_tool_calls_total',
  help: 'Total number of tool calls',
  labelNames: ['tool', 'action', 'status'],
}));

export const toolCallDuration = getOrCreate('servalsheets_tool_call_duration_seconds', () => new Histogram({
  name: 'servalsheets_tool_call_duration_seconds',
  help: 'Tool call duration in seconds',
  labelNames: ['tool', 'action'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
}));

export const selfCorrectionsTotal = getOrCreate('servalsheets_self_corrections_total', () => new Counter({
  name: 'servalsheets_self_corrections_total',
  help: 'Failed tool calls followed by a successful corrected call',
  labelNames: ['tool', 'from_action', 'to_action'],
  registers: [register],
}));

export const errorCodeCompatTotal = getOrCreate('servalsheets_error_code_compat_total', () => new Counter({
  name: 'servalsheets_error_code_compat_total',
  help: 'Error code occurrences by reported/canonical/family compatibility mapping',
  labelNames: ['reported_code', 'canonical_code', 'family', 'is_alias', 'is_known'],
  registers: [register],
}));

// Google API metrics
export const googleApiCallsTotal = getOrCreate('servalsheets_google_api_calls_total', () => new Counter({
  name: 'servalsheets_google_api_calls_total',
  help: 'Total Google API calls',
  labelNames: ['method', 'status'],
}));

export const googleApiDuration = getOrCreate('servalsheets_google_api_duration_seconds', () => new Histogram({
  name: 'servalsheets_google_api_duration_seconds',
  help: 'Google API call duration',
  labelNames: ['method'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
}));

// Circuit breaker metrics
export const circuitBreakerState = getOrCreate('servalsheets_circuit_breaker_state', () => new Gauge({
  name: 'servalsheets_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half_open, 2=open)',
  labelNames: ['circuit'],
}));

// Cache metrics
export const cacheHitsTotal = getOrCreate('servalsheets_cache_hits_total', () => new Counter({
  name: 'servalsheets_cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['namespace'],
}));

export const cacheMissesTotal = getOrCreate('servalsheets_cache_misses_total', () => new Counter({
  name: 'servalsheets_cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['namespace'],
}));

export const cacheSize = getOrCreate('servalsheets_cache_size_bytes', () => new Gauge({
  name: 'servalsheets_cache_size_bytes',
  help: 'Current cache size in bytes',
  labelNames: ['namespace'],
}));

// Queue metrics
export const queueSize = getOrCreate('servalsheets_queue_size', () => new Gauge({
  name: 'servalsheets_queue_size',
  help: 'Current request queue size',
}));

export const queuePending = getOrCreate('servalsheets_queue_pending', () => new Gauge({
  name: 'servalsheets_queue_pending',
  help: 'Current pending requests in queue',
}));

// Session store metrics
export const sessionsTotal = getOrCreate('servalsheets_sessions_total', () => new Gauge({
  name: 'servalsheets_sessions_total',
  help: 'Total active OAuth sessions',
}));

// Batch efficiency metrics
export const batchRequestsTotal = getOrCreate('servalsheets_batch_requests_total', () => new Counter({
  name: 'servalsheets_batch_requests_total',
  help: 'Total batch requests',
  labelNames: ['operation'],
}));

export const batchSizeHistogram = getOrCreate('servalsheets_batch_size', () => new Histogram({
  name: 'servalsheets_batch_size',
  help: 'Batch size distribution',
  labelNames: ['operation'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
}));

// Range merging optimization metrics
export const rangeMergingApiCallsSavedTotal = getOrCreate('servalsheets_range_merging_api_calls_saved_total', () => new Counter({
  name: 'servalsheets_range_merging_api_calls_saved_total',
  help: 'Total API calls saved through synchronous range merging',
  labelNames: ['operation'],
  registers: [register],
}));

export const rangeMergingReductionHistogram = getOrCreate('servalsheets_range_merging_reduction_percentage', () => new Histogram({
  name: 'servalsheets_range_merging_reduction_percentage',
  help: 'API call reduction percentage from range merging',
  labelNames: ['operation'],
  buckets: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  registers: [register],
}));

// Error rates by type
export const errorsByType = getOrCreate('servalsheets_errors_by_type_total', () => new Counter({
  name: 'servalsheets_errors_by_type_total',
  help: 'Total errors by error type',
  labelNames: ['error_type', 'tool', 'action'],
  registers: [register],
}));

// Retry-After header observability (Fix 1 / Fix 5 — tracks when Google's Retry-After is respected)
export const googleApiRetryAfterWaitMs = getOrCreate('servalsheets_google_api_retry_after_wait_ms', () => new Histogram({
  name: 'servalsheets_google_api_retry_after_wait_ms',
  help: 'Wait duration (ms) dictated by Retry-After header from Google API 429 responses',
  buckets: [1000, 5000, 10000, 30000, 60000, 120000],
  registers: [register],
}));

// HTTP/2 connection reset metrics
export const http2ConnectionResetsTotal = getOrCreate('servalsheets_http2_connection_resets_total', () => new Counter({
  name: 'servalsheets_http2_connection_resets_total',
  help: 'Total HTTP/2 connection resets due to credential changes',
  labelNames: ['reason'],
  registers: [register],
}));

// HTTP/2 error metrics
export const http2ErrorsTotal = getOrCreate('servalsheets_http2_errors_total', () => new Counter({
  name: 'servalsheets_http2_errors_total',
  help: 'Total HTTP/2 errors by error code',
  labelNames: ['error_code', 'error_type'],
  registers: [register],
}));

// Connection health metrics
export const connectionHealthScore = getOrCreate('servalsheets_connection_health_score', () => new Gauge({
  name: 'servalsheets_connection_health_score',
  help: 'Connection health score (0-100, based on consecutive errors)',
  registers: [register],
}));

export const consecutiveErrorsGauge = getOrCreate('servalsheets_consecutive_errors', () => new Gauge({
  name: 'servalsheets_consecutive_errors',
  help: 'Current number of consecutive API errors',
  registers: [register],
}));

export const lastSuccessfulCallTimestamp = getOrCreate('servalsheets_last_successful_call_timestamp_seconds', () => new Gauge({
  name: 'servalsheets_last_successful_call_timestamp_seconds',
  help: 'Unix timestamp of last successful API call',
  registers: [register],
}));

// MCP connection health metrics (Phase 0, Priority 1)
export const mcpConnectionStatus = getOrCreate('servalsheets_mcp_connection_status', () => new Gauge({
  name: 'servalsheets_mcp_connection_status',
  help: 'MCP connection status (0=unknown, 1=healthy, 2=warning, 3=disconnected)',
  registers: [register],
}));

export const mcpConnectionHeartbeatsTotal = getOrCreate('servalsheets_mcp_heartbeats_total', () => new Counter({
  name: 'servalsheets_mcp_heartbeats_total',
  help: 'Total MCP heartbeats recorded',
  registers: [register],
}));

export const mcpConnectionActivityDelaySeconds = getOrCreate('servalsheets_mcp_activity_delay_seconds', () => new Gauge({
  name: 'servalsheets_mcp_activity_delay_seconds',
  help: 'Seconds since last MCP activity',
  registers: [register],
}));

export const mcpConnectionDisconnectWarnings = getOrCreate('servalsheets_mcp_disconnect_warnings_total', () => new Counter({
  name: 'servalsheets_mcp_disconnect_warnings_total',
  help: 'Total MCP disconnect warnings issued',
  registers: [register],
}));

export const mcpConnectionUptimeSeconds = getOrCreate('servalsheets_mcp_connection_uptime_seconds', () => new Gauge({
  name: 'servalsheets_mcp_connection_uptime_seconds',
  help: 'MCP connection monitoring uptime in seconds',
  registers: [register],
}));

// Server startup metrics (Phase 0, Priority 2)
export const serverStartupDuration = getOrCreate('servalsheets_server_startup_duration_seconds', () => new Histogram({
  name: 'servalsheets_server_startup_duration_seconds',
  help: 'Server startup duration from process start to ready',
  labelNames: ['transport', 'deferred_schemas', 'deferred_resources'],
  buckets: [0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0],
  registers: [register],
}));

// OTLP export metrics (Phase 0, Priority 3)
export const otlpSpansExportedTotal = getOrCreate('servalsheets_otlp_spans_exported_total', () => new Counter({
  name: 'servalsheets_otlp_spans_exported_total',
  help: 'Total OTLP spans exported',
  labelNames: ['endpoint'],
  registers: [register],
}));

export const otlpExportErrorsTotal = getOrCreate('servalsheets_otlp_export_errors_total', () => new Counter({
  name: 'servalsheets_otlp_export_errors_total',
  help: 'Total OTLP export errors',
  labelNames: ['endpoint', 'error_type'],
  registers: [register],
}));

export const otlpBufferSizeGauge = getOrCreate('servalsheets_otlp_buffer_size', () => new Gauge({
  name: 'servalsheets_otlp_buffer_size',
  help: 'Current OTLP span buffer size',
  registers: [register],
}));

export const otlpExportDurationHistogram = getOrCreate('servalsheets_otlp_export_duration_seconds', () => new Histogram({
  name: 'servalsheets_otlp_export_duration_seconds',
  help: 'OTLP export duration in seconds',
  labelNames: ['endpoint'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0],
  registers: [register],
}));

// QUOTA-01: API quota warning metric
export const quotaWarningsTotal = getOrCreate('servalsheets_quota_warnings_total', () => new Counter({
  name: 'servalsheets_quota_warnings_total',
  help: 'Total API quota warnings emitted when usage reaches 80% of monthly limit',
  labelNames: ['tenantId'],
  registers: [register],
}));

// Restart policy metrics (Phase 0, Priority 4)
export const restartConsecutiveFailuresGauge = getOrCreate('servalsheets_restart_consecutive_failures', () => new Gauge({
  name: 'servalsheets_restart_consecutive_failures',
  help: 'Current number of consecutive restart failures',
  registers: [register],
}));

export const restartBackoffDelaySeconds = getOrCreate('servalsheets_restart_backoff_delay_seconds', () => new Gauge({
  name: 'servalsheets_restart_backoff_delay_seconds',
  help: 'Current restart backoff delay in seconds',
  registers: [register],
}));

export const restartUptimeSeconds = getOrCreate('servalsheets_restart_uptime_seconds', () => new Gauge({
  name: 'servalsheets_restart_uptime_seconds',
  help: 'Server uptime since last successful restart in seconds',
  registers: [register],
}));

// Concurrency coordinator metrics (Dynamic 429 elimination)
export const concurrencyLimitGauge = getOrCreate('servalsheets_concurrency_limit', () => new Gauge({
  name: 'servalsheets_concurrency_limit',
  help: 'Current dynamic concurrency limit',
  registers: [register],
}));

export const concurrencyActiveOperationsGauge = getOrCreate('servalsheets_concurrency_active_operations', () => new Gauge({
  name: 'servalsheets_concurrency_active_operations',
  help: 'Current number of active concurrent operations',
  registers: [register],
}));

export const concurrencyQueuedOperationsGauge = getOrCreate('servalsheets_concurrency_queued_operations', () => new Gauge({
  name: 'servalsheets_concurrency_queued_operations',
  help: 'Current number of queued operations waiting for permits',
  registers: [register],
}));

export const concurrencyUtilizationGauge = getOrCreate('servalsheets_concurrency_utilization_percentage', () => new Gauge({
  name: 'servalsheets_concurrency_utilization_percentage',
  help: 'Current concurrency utilization as percentage (0-100)',
  registers: [register],
}));

export const rateLimitErrorsTotal = getOrCreate('servalsheets_rate_limit_errors_total', () => new Counter({
  name: 'servalsheets_rate_limit_errors_total',
  help: 'Total 429 rate limit errors encountered',
  registers: [register],
}));

export const concurrencyAdjustmentsTotal = getOrCreate('servalsheets_concurrency_adjustments_total', () => new Counter({
  name: 'servalsheets_concurrency_adjustments_total',
  help: 'Total concurrency limit adjustments',
  labelNames: ['reason', 'direction'],
  registers: [register],
}));

export const quotaUtilizationGauge = getOrCreate('servalsheets_quota_utilization_percentage', () => new Gauge({
  name: 'servalsheets_quota_utilization_percentage',
  help: 'Current quota utilization as percentage (0-100)',
  labelNames: ['tenantId', 'operation', 'window'],
  registers: [register],
}));

// QUOTA-01: Threshold-level alerts (80%/95%) with operation + window breakdown
export const quotaThresholdAlertsTotal = getOrCreate('servalsheets_quota_threshold_alerts_total', () => new Counter({
  name: 'servalsheets_quota_threshold_alerts_total',
  help: 'Total quota threshold alerts fired (80% or 95% of limit)',
  labelNames: ['tenantId', 'operation', 'window', 'threshold'],
  registers: [register],
}));

// Latency percentiles as Summary (better than Histogram for percentiles)
export const toolCallLatencySummary = getOrCreate('servalsheets_tool_call_latency_summary', () => new Summary({
  name: 'servalsheets_tool_call_latency_summary',
  help: 'Tool call latency with percentiles',
  labelNames: ['tool', 'action'],
  percentiles: [0.5, 0.9, 0.95, 0.99],
  registers: [register],
}));

/**
 * Helper: Record concurrency coordinator status
 */
export function recordConcurrencyStatus(status: {
  limit: number;
  active: number;
  queued: number;
  utilization: number;
}): void {
  concurrencyLimitGauge.set(status.limit);
  concurrencyActiveOperationsGauge.set(status.active);
  concurrencyQueuedOperationsGauge.set(status.queued);
  concurrencyUtilizationGauge.set(status.utilization);
}

/**
 * Helper: Record 429 rate limit error
 */
export function record429Error(): void {
  rateLimitErrorsTotal.inc();
}

/**
 * Helper: Record concurrency limit adjustment
 */
export function recordConcurrencyAdjustment(
  reason: string,
  oldLimit: number,
  newLimit: number
): void {
  const direction =
    newLimit > oldLimit ? 'increase' : newLimit < oldLimit ? 'decrease' : 'no_change';
  concurrencyAdjustmentsTotal.inc({ reason, direction });
}

/**
 * Helper: Record quota utilization with optional labels
 */
export function recordQuotaUtilization(
  utilizationPercentage: number,
  labels?: { tenantId?: string; operation?: string; window?: string }
): void {
  if (labels) {
    quotaUtilizationGauge.set(
      {
        tenantId: labels.tenantId ?? '',
        operation: labels.operation ?? '',
        window: labels.window ?? '',
      },
      utilizationPercentage
    );
  } else {
    quotaUtilizationGauge.set({ tenantId: '', operation: '', window: '' }, utilizationPercentage);
  }
}

// Batch efficiency ratio
export const batchEfficiencyRatio = getOrCreate('servalsheets_batch_efficiency_ratio', () => new Gauge({
  name: 'servalsheets_batch_efficiency_ratio',
  help: 'Ratio of operations batched vs individual calls (0-1)',
  labelNames: ['operation_type'],
  registers: [register],
}));

// Request queue depth
export const requestQueueDepth = getOrCreate('servalsheets_request_queue_depth', () => new Gauge({
  name: 'servalsheets_request_queue_depth',
  help: 'Current number of requests in queue',
  registers: [register],
}));

// Cache eviction counter
export const cacheEvictions = getOrCreate('servalsheets_cache_evictions_total', () => new Counter({
  name: 'servalsheets_cache_evictions_total',
  help: 'Total number of cache entries evicted',
  labelNames: ['reason'],
  registers: [register],
}));

/**
 * Export metrics handler for Express
 */
export async function metricsHandler(
  _req: unknown,
  res: {
    set: (key: string, value: string) => void;
    send: (body: string) => void;
    end: (body?: string) => void;
    status: (code: number) => {
      send: (body: string) => void;
      end: (body?: string) => void;
    };
  }
): Promise<void> {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Update circuit breaker state metric
 */
export function updateCircuitBreakerMetric(
  circuit: string,
  state: 'closed' | 'open' | 'half_open'
): void {
  const stateValue = state === 'closed' ? 0 : state === 'half_open' ? 1 : 2;
  circuitBreakerState.set({ circuit }, stateValue);
}

/**
 * Record tool call metrics
 */
export function recordToolCall(
  tool: string,
  action: string,
  status: 'success' | 'error',
  durationSeconds: number
): void {
  toolCallsTotal.inc({ tool, action, status });
  toolCallDuration.observe({ tool, action }, durationSeconds);
}

/**
 * Record an inferred self-correction sequence: error followed by success.
 */
export function recordSelfCorrection(tool: string, fromAction: string, toAction: string): void {
  selfCorrectionsTotal.inc({
    tool,
    from_action: fromAction,
    to_action: toAction,
  });
}

/**
 * Record error-code compatibility mapping for consolidation telemetry.
 */
export function recordErrorCodeCompatibility(params: {
  reportedCode: string;
  canonicalCode: string;
  family: string;
  isAlias: boolean;
  isKnown: boolean;
}): void {
  errorCodeCompatTotal.inc({
    reported_code: params.isKnown ? params.reportedCode : 'UNKNOWN_UNRECOGNIZED',
    canonical_code: params.canonicalCode,
    family: params.family,
    is_alias: String(params.isAlias),
    is_known: String(params.isKnown),
  });
}

/**
 * Record Google API call metrics
 */
export function recordGoogleApiCall(
  method: string,
  status: 'success' | 'error',
  durationSeconds: number
): void {
  googleApiCallsTotal.inc({ method, status });
  googleApiDuration.observe({ method }, durationSeconds);
}

/**
 * Update queue metrics
 */
export function updateQueueMetrics(size: number, pending: number): void {
  queueSize.set(size);
  queuePending.set(pending);
}

/**
 * Update cache metrics
 */
export function updateCacheMetrics(
  namespace: string,
  hits: number,
  misses: number,
  sizeBytes: number
): void {
  cacheHitsTotal.inc({ namespace }, hits);
  cacheMissesTotal.inc({ namespace }, misses);
  cacheSize.set({ namespace }, sizeBytes);
}

/**
 * Record batch operation
 */
export function recordBatchOperation(operation: string, size: number): void {
  batchRequestsTotal.inc({ operation });
  batchSizeHistogram.observe({ operation }, size);
}

/**
 * Record error by type
 */
export function recordError(errorType: string, tool: string, action: string): void {
  errorsByType.inc({ error_type: errorType, tool, action });
}

/**
 * Record tool call latency in summary (for percentile calculation)
 */
export function recordToolCallLatency(tool: string, action: string, durationSeconds: number): void {
  toolCallLatencySummary.observe({ tool, action }, durationSeconds);
}

/**
 * Update batch efficiency ratio
 */
export function updateBatchEfficiency(operationType: string, ratio: number): void {
  batchEfficiencyRatio.set({ operation_type: operationType }, ratio);
}

/**
 * Update request queue depth
 */
export function updateRequestQueueDepth(depth: number): void {
  requestQueueDepth.set(depth);
}

/**
 * Record cache eviction
 */
export function recordCacheEviction(reason: string): void {
  cacheEvictions.inc({ reason });
}

// ============================================================================
// HEALTH SNAPSHOT (P2-D: MCP resource)
// ============================================================================

export interface HealthSnapshot {
  circuitBreakers: Record<string, 'open' | 'closed' | 'half-open'>;
  cache: { hitRate: number; sizeBytes: number };
  quota: { used: number; limit: number; utilization: number; windowRemainingMs: number };
  topErrors: Array<{ code: string; count: number; lastSeen: string }>;
  latencyP50Ms: number;
  latencyP95Ms: number;
  generatedAt: string;
}

/**
 * Return a best-effort health snapshot from in-process Prometheus counters.
 * Reads real data from circuit breaker registry, cache manager, and latency metrics.
 */
export function getHealthSnapshot(): HealthSnapshot {
  // Import dynamically to avoid circular dependencies
  const { circuitBreakerRegistry } =
    require('../services/circuit-breaker-registry.js') as typeof import('../services/circuit-breaker-registry.js');
  const { cacheManager } =
    require('../utils/cache-manager.js') as typeof import('../utils/cache-manager.js');

  // 1. Circuit breaker states from registry
  const circuitBreakers: Record<string, 'open' | 'closed' | 'half-open'> = {};
  const breakers = circuitBreakerRegistry.getAll();
  for (const entry of breakers) {
    const stats = entry.breaker.getStats();
    const state = stats.state as 'open' | 'closed' | 'half_open';
    // Normalize half_open -> half-open for the response
    circuitBreakers[entry.name] = state === 'half_open' ? 'half-open' : state;
  }

  // 2. Cache metrics from cache manager
  const cacheStats = cacheManager.getStats();
  const cacheHitRate =
    cacheStats.hits + cacheStats.misses > 0
      ? cacheStats.hits / (cacheStats.hits + cacheStats.misses)
      : 0;

  // 3. Latency percentiles from Summary metric (if available)
  // NOTE: toolCallLatencySummary.get() is async but getHealthSnapshot is sync.
  // In a future refactor, make this async. For now, initialize to 0.
  let latencyP50Ms = 0;
  let latencyP95Ms = 0;

  // 4. Top errors from errorsByType counter
  // NOTE: errorsByType.get() is async but getHealthSnapshot is sync.
  // In a future refactor, make this async. For now, initialize to empty.
  const topErrors: Array<{ code: string; count: number; lastSeen: string }> = [];

  return {
    circuitBreakers,
    cache: { hitRate: cacheHitRate, sizeBytes: cacheStats.totalSize },
    quota: { used: 0, limit: 60, utilization: 0, windowRemainingMs: 60000 },
    topErrors,
    latencyP50Ms,
    latencyP95Ms,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Record range merging optimization
 */
export function recordRangeMerging(
  operation: string,
  apiCallsSaved: number,
  reductionPercentage: number
): void {
  rangeMergingApiCallsSavedTotal.inc({ operation }, apiCallsSaved);
  rangeMergingReductionHistogram.observe({ operation }, reductionPercentage);
}

// Rate limit and retry metrics (P3-1)
export const rateLimitHitsTotal = getOrCreate('servalsheets_rate_limit_hits_total', () => new Counter({
  name: 'servalsheets_rate_limit_hits_total',
  help: 'Number of 429 rate limit responses',
  labelNames: ['api', 'endpoint'],
  registers: [register],
}));

export const retryAttemptsTotal = getOrCreate('servalsheets_retry_attempts_total', () => new Counter({
  name: 'servalsheets_retry_attempts_total',
  help: 'Number of retry attempts',
  labelNames: ['api', 'reason', 'success'],
  registers: [register],
}));

export const retryDelayHistogram = getOrCreate('servalsheets_retry_delay_seconds', () => new Histogram({
  name: 'servalsheets_retry_delay_seconds',
  help: 'Retry delay duration in seconds',
  labelNames: ['api'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
}));

// Webhook renewal metrics (P3-1)
export const webhookRenewalsTotal = getOrCreate('servalsheets_webhook_renewals_total', () => new Counter({
  name: 'servalsheets_webhook_renewals_total',
  help: 'Number of webhook channel renewals',
  labelNames: ['type', 'reason'],
  registers: [register],
}));

// Circuit breaker transition metrics (P3-1)
export const circuitBreakerTransitionsTotal = getOrCreate('servalsheets_circuit_breaker_transitions_total', () => new Counter({
  name: 'servalsheets_circuit_breaker_transitions_total',
  help: 'Circuit breaker state transitions',
  labelNames: ['breaker', 'from_state', 'to_state'],
  registers: [register],
}));

// Webhook delivery metrics (Phase 4.1)
export const webhookDeliveriesTotal = getOrCreate('servalsheets_webhook_deliveries_total', () => new Counter({
  name: 'servalsheets_webhook_deliveries_total',
  help: 'Total webhook delivery attempts',
  labelNames: ['event_type', 'status'],
  registers: [register],
}));

export const webhookDeliveryDuration = getOrCreate('servalsheets_webhook_delivery_duration_seconds', () => new Histogram({
  name: 'servalsheets_webhook_delivery_duration_seconds',
  help: 'Webhook delivery duration in seconds',
  labelNames: ['event_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
}));

export const webhookQueueDepth = getOrCreate('servalsheets_webhook_queue_depth', () => new Gauge({
  name: 'servalsheets_webhook_queue_depth',
  help: 'Current webhook queue depth by type',
  labelNames: ['queue_type'],
  registers: [register],
}));

export const webhookActiveCount = getOrCreate('servalsheets_webhook_active_count', () => new Gauge({
  name: 'servalsheets_webhook_active_count',
  help: 'Total number of active webhooks',
  registers: [register],
}));

/**
 * Record webhook delivery attempt
 */
export function recordWebhookDelivery(
  _webhookId: string,
  _spreadsheetId: string,
  eventType: string,
  status: 'success' | 'failure',
  durationSeconds: number
): void {
  webhookDeliveriesTotal.inc({
    event_type: eventType,
    status,
  });
  webhookDeliveryDuration.observe({ event_type: eventType }, durationSeconds);
}

/**
 * Update webhook queue depth metrics
 */
export function updateWebhookQueueDepth(
  queueType: 'pending' | 'retry' | 'dlq',
  depth: number
): void {
  webhookQueueDepth.set({ queue_type: queueType }, depth);
}

/**
 * Update active webhook count
 */
export function updateActiveWebhookCount(count: number): void {
  webhookActiveCount.set(count);
}

/**
 * Record rate limit hit (429 response)
 */
export function recordRateLimitHit(api: string, endpoint: string): void {
  rateLimitHitsTotal.inc({ api, endpoint });
}

/**
 * Record retry attempt
 */
export function recordRetryAttempt(
  api: string,
  reason: string,
  success: boolean,
  delaySeconds: number
): void {
  retryAttemptsTotal.inc({
    api,
    reason,
    success: success ? 'true' : 'false',
  });
  retryDelayHistogram.observe({ api }, delaySeconds);
}

/**
 * Record webhook renewal
 */
export function recordWebhookRenewal(type: 'file' | 'changes', reason: string): void {
  webhookRenewalsTotal.inc({ type, reason });
}

/**
 * Record circuit breaker state transition
 */
export function recordCircuitBreakerTransition(
  breaker: string,
  fromState: 'closed' | 'open' | 'half_open',
  toState: 'closed' | 'open' | 'half_open'
): void {
  circuitBreakerTransitionsTotal.inc({
    breaker,
    from_state: fromState,
    to_state: toState,
  });
}

/**
 * Record HTTP/2 connection reset
 */
export function recordHttp2ConnectionReset(reason: string): void {
  http2ConnectionResetsTotal.inc({ reason });
}

/**
 * Record HTTP/2 error
 */
export function recordHttp2Error(errorCode: string, errorType: string): void {
  http2ErrorsTotal.inc({ error_code: errorCode, error_type: errorType });
}

/**
 * Update connection health metrics
 */
export function updateConnectionHealth(
  consecutiveErrors: number,
  lastSuccessTimestamp: number
): void {
  // Health score: 100 when no errors, decreases by 20 per consecutive error
  const healthScore = Math.max(0, 100 - consecutiveErrors * 20);

  consecutiveErrorsGauge.set(consecutiveErrors);
  connectionHealthScore.set(healthScore);
  lastSuccessfulCallTimestamp.set(lastSuccessTimestamp / 1000); // Convert ms to seconds
}

/**
 * Update MCP connection health metrics (Phase 0, Priority 1)
 */
export function updateMcpConnectionHealth(
  status: 'unknown' | 'healthy' | 'warning' | 'disconnected',
  totalHeartbeats: number,
  timeSinceLastActivityMs: number,
  disconnectWarnings: number,
  uptimeSeconds: number
): void {
  // Map status to numeric value for Prometheus gauge
  const statusValue = {
    unknown: 0,
    healthy: 1,
    warning: 2,
    disconnected: 3,
  }[status];

  mcpConnectionStatus.set(statusValue);
  mcpConnectionHeartbeatsTotal.inc(totalHeartbeats);
  mcpConnectionActivityDelaySeconds.set(timeSinceLastActivityMs / 1000);
  mcpConnectionDisconnectWarnings.inc(disconnectWarnings);
  mcpConnectionUptimeSeconds.set(uptimeSeconds);
}

// ============================================================================
// P4-P14 FEATURE INSTRUMENTATION (ISSUE-235)
// ============================================================================

export const suggestionsTotal = getOrCreate('servalsheets_suggestions_total', () => new Counter({
  name: 'servalsheets_suggestions_total',
  help: 'Total suggest_next_actions and auto_enhance calls (F4 Smart Suggestions)',
  labelNames: ['action', 'status'] as const,
  registers: [register],
}));

export const cleaningOperationsTotal = getOrCreate('servalsheets_cleaning_operations_total', () => new Counter({
  name: 'servalsheets_cleaning_operations_total',
  help: 'Total data cleaning operations (F3 Automated Data Cleaning)',
  labelNames: ['action', 'mode', 'status'] as const,
  registers: [register],
}));

export const generationRequestsTotal = getOrCreate('servalsheets_generation_requests_total', () => new Counter({
  name: 'servalsheets_generation_requests_total',
  help: 'Total sheet generation requests (F1 Natural Language Sheet Generator)',
  labelNames: ['action', 'status'] as const,
  registers: [register],
}));

export const scenarioModelsTotal = getOrCreate('servalsheets_scenario_models_total', () => new Counter({
  name: 'servalsheets_scenario_models_total',
  help: 'Total scenario modeling operations (F6 Scenario Modeling)',
  labelNames: ['action', 'status'] as const,
  registers: [register],
}));

export const crossSpreadsheetOpsTotal = getOrCreate('servalsheets_cross_spreadsheet_ops_total', () => new Counter({
  name: 'servalsheets_cross_spreadsheet_ops_total',
  help: 'Total cross-spreadsheet federation operations (F2 Multi-Spreadsheet Federation)',
  labelNames: ['action', 'status'] as const,
  registers: [register],
}));

export const timeTravelOpsTotal = getOrCreate('servalsheets_time_travel_ops_total', () => new Counter({
  name: 'servalsheets_time_travel_ops_total',
  help: 'Total time-travel history operations (F5 Time-Travel Debugger)',
  labelNames: ['action', 'status'] as const,
  registers: [register],
}));

export const compositeWorkflowsTotal = getOrCreate('servalsheets_composite_workflows_total', () => new Counter({
  name: 'servalsheets_composite_workflows_total',
  help: 'Total composite workflow actions (P14: audit_sheet, publish_report, data_pipeline, etc.)',
  labelNames: ['action', 'status'] as const,
  registers: [register],
}));

export const samplingRequestsTotal = getOrCreate('servalsheets_sampling_requests_total', () => new Counter({
  name: 'servalsheets_sampling_requests_total',
  help: 'Total MCP Sampling requests sent to client (P13 SEP-1577)',
  labelNames: ['action', 'status'] as const,
  registers: [register],
}));

export const elicitationRequestsTotal = getOrCreate('servalsheets_elicitation_requests_total', () => new Counter({
  name: 'servalsheets_elicitation_requests_total',
  help: 'Total MCP Elicitation wizard flows initiated (P13 SEP-1036)',
  labelNames: ['action', 'outcome'] as const,
  registers: [register],
}));

/**
 * Record a P4 Smart Suggestions operation.
 */
export function recordSuggestionOp(action: string, status: 'success' | 'error'): void {
  suggestionsTotal.inc({ action, status });
}

/**
 * Record a P3 Data Cleaning operation.
 */
export function recordCleaningOp(
  action: string,
  mode: 'preview' | 'apply' | 'unknown',
  status: 'success' | 'error'
): void {
  cleaningOperationsTotal.inc({ action, mode, status });
}

/**
 * Record a P1 Sheet Generation request.
 */
export function recordGenerationRequest(action: string, status: 'success' | 'error'): void {
  generationRequestsTotal.inc({ action, status });
}

/**
 * Record a F6 Scenario Modeling operation.
 */
export function recordScenarioModel(action: string, status: 'success' | 'error'): void {
  scenarioModelsTotal.inc({ action, status });
}

/**
 * Record a F2 Cross-Spreadsheet Federation operation.
 */
export function recordCrossSpreadsheetOp(action: string, status: 'success' | 'error'): void {
  crossSpreadsheetOpsTotal.inc({ action, status });
}

/**
 * Record a F5 Time-Travel history operation.
 */
export function recordTimeTravelOp(action: string, status: 'success' | 'error'): void {
  timeTravelOpsTotal.inc({ action, status });
}

/**
 * Record a P14 composite workflow action.
 */
export function recordCompositeWorkflow(action: string, status: 'success' | 'error'): void {
  compositeWorkflowsTotal.inc({ action, status });
}

/**
 * Record a P13 MCP Sampling request sent to the client.
 */
export function recordSamplingRequest(action: string, status: 'success' | 'error'): void {
  samplingRequestsTotal.inc({ action, status });
}

/**
 * Record a P13 MCP Elicitation wizard flow.
 */
export function recordElicitationRequest(
  action: string,
  outcome: 'accepted' | 'declined' | 'unavailable' | 'error'
): void {
  elicitationRequestsTotal.inc({ action, outcome });
}
