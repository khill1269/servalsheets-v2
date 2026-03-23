/**
 * Serval Core - Safety exports
 */
export {
  CircuitBreaker,
  CircuitBreakerError,
  FallbackStrategies,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitState,
  type FallbackStrategy,
} from './circuit-breaker.js';

export {
  executeWithRetry,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
  type RetryOptions,
  type RetryConfig,
} from './retry.js';

export {
  requiresConfirmation,
  generateSafetyWarnings,
  createSnapshotIfNeeded,
  calculateAffectedCells,
  calculateAffectedRows,
  formatSafetyWarnings,
  shouldReturnPreview,
  buildSnapshotInfo,
  type SafetyOptions,
  type SafetyContext,
  type SafetyWarning,
  type SnapshotResult,
  type SnapshotProvider,
} from './safety-helpers.js';
