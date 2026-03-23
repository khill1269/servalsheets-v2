/**
 * Serval Core - Prometheus Metrics
 *
 * Platform-agnostic operational metrics. Prefixed with 'serval_' instead of
 * platform-specific names.
 */

import { Counter, Histogram, Gauge } from 'prom-client';

// Circuit breaker metrics
export const circuitBreakerState = new Gauge({
  name: 'serval_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half_open, 2=open)',
  labelNames: ['circuit'],
});

export const circuitBreakerTransitions = new Counter({
  name: 'serval_circuit_breaker_transitions_total',
  help: 'Total circuit breaker state transitions',
  labelNames: ['circuit', 'from_state', 'to_state'],
});

// Retry metrics
export const retryAttemptsTotal = new Counter({
  name: 'serval_retry_attempts_total',
  help: 'Total retry attempts',
  labelNames: ['api', 'reason', 'success'],
});

export const retryDelaySeconds = new Histogram({
  name: 'serval_retry_delay_seconds',
  help: 'Retry delay duration in seconds',
  labelNames: ['api', 'reason'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

// Rate limit metrics
export const rateLimitHitsTotal = new Counter({
  name: 'serval_rate_limit_hits_total',
  help: 'Total rate limit hits',
  labelNames: ['api', 'endpoint'],
});

// HTTP/2 error metrics
export const http2ErrorsTotal = new Counter({
  name: 'serval_http2_errors_total',
  help: 'Total HTTP/2 errors',
  labelNames: ['error_code', 'error_type'],
});

// Tool call metrics (generic)
export const toolCallsTotal = new Counter({
  name: 'serval_tool_calls_total',
  help: 'Total number of tool calls',
  labelNames: ['tool', 'action', 'status'],
});

export const toolCallDuration = new Histogram({
  name: 'serval_tool_call_duration_seconds',
  help: 'Tool call duration in seconds',
  labelNames: ['tool', 'action'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

// Cache metrics
export const cacheHitsTotal = new Counter({
  name: 'serval_cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['namespace'],
});

export const cacheMissesTotal = new Counter({
  name: 'serval_cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['namespace'],
});

/**
 * Helper functions for recording metrics
 */

const STATE_MAP: Record<string, number> = {
  closed: 0,
  half_open: 1,
  open: 2,
};

export function updateCircuitBreakerMetric(circuit: string, state: string): void {
  const stateValue = STATE_MAP[state] ?? -1;
  circuitBreakerState.labels(circuit).set(stateValue);
}

export function recordCircuitBreakerTransition(
  circuit: string,
  fromState: string,
  toState: string
): void {
  circuitBreakerTransitions.labels(circuit, fromState, toState).inc();
}

export function recordRetryAttempt(
  api: string,
  reason: string,
  success: boolean,
  delaySeconds: number
): void {
  retryAttemptsTotal.labels(api, reason, String(success)).inc();
  if (delaySeconds > 0) {
    retryDelaySeconds.labels(api, reason).observe(delaySeconds);
  }
}

export function recordRateLimitHit(api: string, endpoint: string): void {
  rateLimitHitsTotal.labels(api, endpoint).inc();
}

export function recordHttp2Error(errorCode: string, errorType: string): void {
  http2ErrorsTotal.labels(errorCode, errorType).inc();
}
