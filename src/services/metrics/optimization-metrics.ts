/**
 * Optimization Metrics
 *
 * Tracks optimization features: batching, rate limiting, circuit breaker.
 *
 * @category Metrics
 */

// ==================== Types ====================

export interface BatchOperationData {
  /** Total requests in batch */
  requestCount: number;
  /** Actual API calls executed */
  executedCount: number;
  /** API calls saved by batching */
  savedApiCalls: number;
  /** Duration in milliseconds */
  duration: number;
}

export interface BatchMetrics {
  /** Total batches executed */
  totalBatches: number;
  /** Total API calls saved */
  totalSavedCalls: number;
  /** Average efficiency (savedCalls / requestCount) */
  avgEfficiency: number;
}

export interface RateLimitMetrics {
  /** Read rate limit hits */
  readLimits: number;
  /** Write rate limit hits */
  writeLimits: number;
  /** Total rate limit hits */
  totalLimits: number;
}

export interface CircuitBreakerMetrics {
  /** Open state events */
  openEvents: number;
  /** Half-open state events */
  halfOpenEvents: number;
  /** Closed state events */
  closedEvents: number;
}

// ==================== Optimization Metrics Service ====================

export class OptimizationMetricsService {
  private batchOperations: {
    totalBatches: number;
    totalRequestCount: number;
    totalSavedCalls: number;
  } = {
    totalBatches: 0,
    totalRequestCount: 0,
    totalSavedCalls: 0,
  };

  private rateLimits: {
    readLimits: number;
    writeLimits: number;
  } = {
    readLimits: 0,
    writeLimits: 0,
  };

  private circuitBreakerEvents: {
    openEvents: number;
    halfOpenEvents: number;
    closedEvents: number;
    currentState: string;
  } = {
    openEvents: 0,
    halfOpenEvents: 0,
    closedEvents: 0,
    currentState: 'closed',
  };

  private enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Record batch operation
   */
  recordBatchOperation(data: BatchOperationData): void {
    if (!this.enabled) return;

    this.batchOperations.totalBatches++;
    this.batchOperations.totalRequestCount += data.requestCount;
    this.batchOperations.totalSavedCalls += data.savedApiCalls;
  }

  /**
   * Get batch operation metrics
   */
  getBatchMetrics(): BatchMetrics {
    const avgEfficiency =
      this.batchOperations.totalRequestCount > 0
        ? this.batchOperations.totalSavedCalls / this.batchOperations.totalRequestCount
        : 0;

    return {
      totalBatches: this.batchOperations.totalBatches,
      totalSavedCalls: this.batchOperations.totalSavedCalls,
      avgEfficiency,
    };
  }

  /**
   * Record rate limit hit
   */
  recordRateLimitHit(type: 'read' | 'write'): void {
    if (!this.enabled) return;

    if (type === 'read') {
      this.rateLimits.readLimits++;
    } else {
      this.rateLimits.writeLimits++;
    }
  }

  /**
   * Get rate limit metrics
   */
  getRateLimitMetrics(): RateLimitMetrics {
    return {
      readLimits: this.rateLimits.readLimits,
      writeLimits: this.rateLimits.writeLimits,
      totalLimits: this.rateLimits.readLimits + this.rateLimits.writeLimits,
    };
  }

  /**
   * Record circuit breaker state change
   */
  recordCircuitBreakerEvent(state: 'open' | 'half-open' | 'closed'): void {
    if (!this.enabled) return;

    if (state === 'open') {
      this.circuitBreakerEvents.openEvents++;
    } else if (state === 'half-open') {
      this.circuitBreakerEvents.halfOpenEvents++;
    } else if (state === 'closed') {
      this.circuitBreakerEvents.closedEvents++;
    }
    this.circuitBreakerEvents.currentState = state;
  }

  /**
   * Get circuit breaker metrics
   */
  getCircuitBreakerMetrics(): CircuitBreakerMetrics {
    return {
      openEvents: this.circuitBreakerEvents.openEvents,
      halfOpenEvents: this.circuitBreakerEvents.halfOpenEvents,
      closedEvents: this.circuitBreakerEvents.closedEvents,
    };
  }

  /**
   * Get current circuit breaker state
   */
  getCircuitBreakerState(): string {
    return this.circuitBreakerEvents.currentState;
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.batchOperations = {
      totalBatches: 0,
      totalRequestCount: 0,
      totalSavedCalls: 0,
    };
    this.rateLimits = {
      readLimits: 0,
      writeLimits: 0,
    };
    this.circuitBreakerEvents = {
      openEvents: 0,
      halfOpenEvents: 0,
      closedEvents: 0,
      currentState: 'closed',
    };
  }
}
