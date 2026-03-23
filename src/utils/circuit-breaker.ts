/**
 * ServalSheets - Circuit Breaker
 *
 * Google Sheets-specific circuit breaker wrapper over @serval/core's
 * platform-agnostic implementation. Adds: readOnlyMode fallback strategy
 * for Google Sheets write operations.
 */

import {
  CircuitBreaker,
  CircuitBreakerError,
  FallbackStrategies as CoreFallbackStrategies,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitState,
  type FallbackStrategy,
} from '@serval/core';
import { logger } from './logger.js';

// Re-export types and classes so callers don't need to change imports
export {
  CircuitBreaker,
  CircuitBreakerError,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitState,
  type FallbackStrategy,
};

/**
 * Extended fallback strategies including Google Sheets-specific strategies.
 *
 * Extends serval-core's FallbackStrategies with:
 * - readOnlyMode: Returns a degraded response for failed write operations
 */
/**
 * Structural interface satisfied by both CircuitBreaker and QuotaCircuitBreaker.
 * Use this type in consumers that accept either implementation.
 */
export interface ICircuitBreaker {
  execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>;
  registerFallback<T>(strategy: FallbackStrategy<T>): void;
  getStats(): CircuitBreakerStats & { fallbackUsageCount: number; registeredFallbacks: number };
  getState(): CircuitState;
  isOpen(): boolean;
  reset(): void;
}

/**
 * Quota-aware circuit breaker (Fix 3).
 *
 * Wraps a standard CircuitBreaker and tracks 429 quota errors separately.
 * Opens a quota gate after `quotaThreshold` consecutive quota failures
 * (default: half of the standard failureThreshold) with a longer cool-down
 * (default: 2× the standard timeout) to match Google's recommended retry window.
 *
 * This stops the 5-minute 429 burst window from persisting by opening after
 * ~3 quota hits instead of waiting for the full 5-failure standard threshold.
 */
export class QuotaCircuitBreaker {
  private readonly inner: CircuitBreaker;
  private quotaConsecutiveCount = 0;
  private readonly quotaThreshold: number;
  private quotaBlockedUntil = 0;
  private readonly quotaBlockMs: number;

  constructor(
    config: CircuitBreakerConfig,
    quotaOptions?: { quotaThreshold?: number; quotaBlockMs?: number }
  ) {
    this.inner = new CircuitBreaker(config);
    this.quotaThreshold = quotaOptions?.quotaThreshold ?? Math.ceil(config.failureThreshold / 2);
    this.quotaBlockMs = quotaOptions?.quotaBlockMs ?? config.timeout * 2;
  }

  async execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    // Quota gate: block faster than the standard circuit breaker for 429s
    if (Date.now() < this.quotaBlockedUntil) {
      throw new CircuitBreakerError(
        `Quota circuit gate open — too many 429 responses`,
        'quota',
        this.quotaBlockedUntil
      );
    }

    try {
      const result = await this.inner.execute(operation, fallback);
      this.quotaConsecutiveCount = 0;
      return result;
    } catch (error) {
      const is429 = (error as { response?: { status?: number } })?.response?.status === 429;
      if (is429) {
        this.quotaConsecutiveCount++;
        if (this.quotaConsecutiveCount >= this.quotaThreshold) {
          this.quotaBlockedUntil = Date.now() + this.quotaBlockMs;
          this.quotaConsecutiveCount = 0;
          logger.warn('Quota circuit gate opened', {
            quotaThreshold: this.quotaThreshold,
            openForMs: this.quotaBlockMs,
          });
        }
      } else {
        this.quotaConsecutiveCount = 0;
      }
      throw error;
    }
  }

  registerFallback<T>(strategy: FallbackStrategy<T>): void {
    this.inner.registerFallback(strategy);
  }

  getStats(): ReturnType<CircuitBreaker['getStats']> {
    return this.inner.getStats();
  }

  getState(): CircuitState {
    return this.inner.getState();
  }

  isOpen(): boolean {
    return this.inner.isOpen() || Date.now() < this.quotaBlockedUntil;
  }

  reset(): void {
    this.inner.reset();
    this.quotaConsecutiveCount = 0;
    this.quotaBlockedUntil = 0;
  }
}

export const FallbackStrategies = {
  ...CoreFallbackStrategies,

  /**
   * Return read-only mode response.
   * Use when write operations fail but read operations still work.
   *
   * shouldUse() uses code-based classification instead of text-based message
   * inspection. Permanent failures (PERMISSION_DENIED, UNAUTHENTICATED,
   * SPREADSHEET_NOT_FOUND, INVALID_ARGUMENT) do NOT enter read-only mode —
   * those require manual intervention, not degraded retries. Transient errors
   * (rate limits, server errors, unknown) DO enter read-only mode.
   *
   * @example
   * circuitBreaker.registerFallback(
   *   FallbackStrategies.readOnlyMode(
   *     { success: false, error: 'Read-only mode', data: null },
   *     30
   *   )
   * );
   */
  readOnlyMode: <T>(readOnlyResponse: T, priority = 30): FallbackStrategy<T> => ({
    name: 'read-only-mode',
    priority,
    execute: async () => readOnlyResponse,
    shouldUse: (error: Error) => {
      // Code-based classification: permanent errors do not trigger read-only mode
      const NON_RETRYABLE_FOR_CIRCUIT_BREAKER = new Set([
        'PERMISSION_DENIED',
        'UNAUTHENTICATED',
        'SPREADSHEET_NOT_FOUND',
        'INVALID_ARGUMENT',
      ]);
      const errorCode = (error as Error & { errorCode?: string }).errorCode ?? '';
      // Only permanent, non-retryable codes skip read-only mode.
      // All other errors (transient, unknown) may benefit from read-only degradation.
      return !NON_RETRYABLE_FOR_CIRCUIT_BREAKER.has(errorCode);
    },
  }),
};
