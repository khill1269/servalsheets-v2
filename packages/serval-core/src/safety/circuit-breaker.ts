/**
 * Serval Core - Circuit Breaker Pattern
 *
 * Protects against cascading failures by temporarily blocking requests
 * to a failing service, giving it time to recover.
 *
 * Platform-agnostic: Works with any API backend.
 */

import { defaultLogger } from '../utils/logger.js';
import {
  recordCircuitBreakerTransition,
  updateCircuitBreakerMetric,
} from '../observability/metrics.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface FallbackStrategy<T> {
  name: string;
  execute: () => Promise<T>;
  shouldUse: (error: Error) => boolean;
  priority?: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  name?: string;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  lastFailure?: string;
  nextAttempt?: string;
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly circuitName: string,
    public readonly nextAttemptTime: number
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private totalRequests = 0;
  private lastFailureTime?: number;
  private nextAttemptTime = Date.now();
  private readonly name: string;
  private fallbackStrategies: FallbackStrategy<unknown>[] = [];
  private fallbackUsageCount = 0;
  private logger = defaultLogger;

  constructor(private config: CircuitBreakerConfig) {
    this.name = config.name ?? 'default';
  }

  registerFallback<T>(strategy: FallbackStrategy<T>): void {
    this.fallbackStrategies.push(strategy as FallbackStrategy<unknown>);
    this.fallbackStrategies.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.logger.debug('Fallback strategy registered', {
      circuit: this.name,
      strategy: strategy.name,
      priority: strategy.priority ?? 0,
      totalStrategies: this.fallbackStrategies.length,
    });
  }

  clearFallbacks(): void {
    this.fallbackStrategies = [];
    this.logger.debug('Fallback strategies cleared', { circuit: this.name });
  }

  async execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === 'open') {
      if (Date.now() < this.nextAttemptTime) {
        this.logger.warn('Circuit breaker is open, attempting fallback', {
          circuit: this.name,
          state: this.state,
          retryInMs: this.nextAttemptTime - Date.now(),
          registeredFallbacks: this.fallbackStrategies.length,
        });

        if (this.fallbackStrategies.length > 0) {
          const error = new Error('Circuit breaker is OPEN');
          return (await this.executeFallbacks(error)) as T;
        }

        if (fallback) {
          this.fallbackUsageCount++;
          return fallback();
        }

        throw new CircuitBreakerError(
          `Circuit breaker [${this.name}] is OPEN`,
          this.name,
          this.nextAttemptTime
        );
      }

      this.transitionTo('half_open');
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);

      if (this.fallbackStrategies.length > 0) {
        return (await this.executeFallbacks(
          error instanceof Error ? error : new Error(String(error))
        )) as T;
      }

      if (this.state === 'open' && fallback) {
        this.logger.info('Circuit opened, using legacy fallback', { circuit: this.name });
        this.fallbackUsageCount++;
        return fallback();
      }

      throw error;
    }
  }

  private async executeFallbacks(error: Error): Promise<unknown> {
    for (const strategy of this.fallbackStrategies) {
      if (!strategy.shouldUse(error)) {
        this.logger.debug('Skipping fallback strategy (shouldUse=false)', {
          circuit: this.name, strategy: strategy.name, error: error.message,
        });
        continue;
      }

      try {
        this.logger.info('Attempting fallback strategy', {
          circuit: this.name, strategy: strategy.name, priority: strategy.priority ?? 0,
        });
        const result = await strategy.execute();
        this.fallbackUsageCount++;
        this.logger.info('Fallback strategy succeeded', { circuit: this.name, strategy: strategy.name });
        return result;
      } catch (fallbackError) {
        this.logger.warn('Fallback strategy failed', {
          circuit: this.name, strategy: strategy.name,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    this.logger.error('All fallback strategies exhausted', {
      circuit: this.name, strategiesTried: this.fallbackStrategies.length,
    });
    throw error;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'half_open') {
      this.successCount++;
      this.logger.debug('Circuit breaker success in half-open', {
        circuit: this.name, successCount: this.successCount, threshold: this.config.successThreshold,
      });
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }
  }

  private onFailure(error: unknown): void {
    this.successCount = 0;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.logger.warn('Circuit breaker failure', {
      circuit: this.name, failureCount: this.failureCount,
      threshold: this.config.failureThreshold,
      error: error instanceof Error ? error.message : String(error),
    });

    if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === 'open') {
      const jitter = Math.random() * this.config.timeout * 0.3;
      this.nextAttemptTime = Date.now() + this.config.timeout + jitter;
    } else if (newState === 'half_open') {
      this.failureCount = 0;
    } else if (newState === 'closed') {
      this.successCount = 0;
      this.failureCount = 0;
    }

    recordCircuitBreakerTransition(this.name, oldState, newState);
    try {
      updateCircuitBreakerMetric(this.name, newState);
    } catch {
      // Metrics recording is non-critical
    }

    this.logger.info('Circuit breaker state transition', {
      circuit: this.name, from: oldState, to: newState,
      nextAttempt: newState === 'open' ? new Date(this.nextAttemptTime).toISOString() : undefined,
    });
  }

  getStats(): CircuitBreakerStats & { fallbackUsageCount: number; registeredFallbacks: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      lastFailure: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : undefined,
      nextAttempt: this.state === 'open' ? new Date(this.nextAttemptTime).toISOString() : undefined,
      fallbackUsageCount: this.fallbackUsageCount,
      registeredFallbacks: this.fallbackStrategies.length,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.logger.info('Circuit breaker manually reset', { circuit: this.name });
  }

  getState(): CircuitState { return this.state; }
  isOpen(): boolean { return this.state === 'open' && Date.now() < this.nextAttemptTime; }
}

/**
 * Common fallback strategy implementations
 */
export const FallbackStrategies = {
  cachedData: <T>(cache: Map<string, T>, key: string, priority = 100): FallbackStrategy<T> => ({
    name: 'cached-data',
    priority,
    execute: async () => {
      const cached = cache.get(key);
      if (!cached) throw new Error(`No cached data available for key: ${key}`);
      return cached;
    },
    shouldUse: (error) => {
      const errorMsg = error.message.toLowerCase();
      return !errorMsg.includes('auth') && !errorMsg.includes('permission') && !errorMsg.includes('forbidden');
    },
  }),

  degradedMode: <T>(degradedData: T, priority = 50): FallbackStrategy<T> => ({
    name: 'degraded-mode',
    priority,
    execute: async () => degradedData,
    shouldUse: () => true,
  }),

  safeDefault: <T>(defaultValue: T, priority = 10): FallbackStrategy<T> => ({
    name: 'safe-default',
    priority,
    execute: async () => defaultValue,
    shouldUse: () => true,
  }),

  retryWithBackoff: <T>(operation: () => Promise<T>, maxRetries = 3, baseDelayMs = 1000, priority = 80): FallbackStrategy<T> => ({
    name: 'retry-with-backoff',
    priority,
    execute: async () => {
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < maxRetries) {
            const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }
      throw lastError || new Error('All retry attempts failed');
    },
    shouldUse: (error) => {
      const errorMsg = error.message.toLowerCase();
      return errorMsg.includes('timeout') || errorMsg.includes('network') ||
        errorMsg.includes('temporary') || error.message.includes('503') || error.message.includes('429');
    },
  }),

  alternateSource: <T>(alternateOperation: () => Promise<T>, priority = 90): FallbackStrategy<T> => ({
    name: 'alternate-source',
    priority,
    execute: async () => await alternateOperation(),
    shouldUse: () => true,
  }),
};
