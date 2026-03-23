/**
 * Serval Core - Observability exports
 */
export {
  circuitBreakerState,
  circuitBreakerTransitions,
  retryAttemptsTotal,
  retryDelaySeconds,
  rateLimitHitsTotal,
  http2ErrorsTotal,
  toolCallsTotal,
  toolCallDuration,
  cacheHitsTotal,
  cacheMissesTotal,
  updateCircuitBreakerMetric,
  recordCircuitBreakerTransition,
  recordRetryAttempt,
  recordRateLimitHit,
  recordHttp2Error,
} from './metrics.js';
