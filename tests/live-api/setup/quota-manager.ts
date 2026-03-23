/**
 * ServalSheets - Test Quota Manager
 *
 * Centralized quota delay coordination for afterEach hooks and between-test delays.
 * Prevents quota exhaustion during live API test runs.
 *
 * Features:
 * - Dynamic delay calculation based on API call count
 * - Tracks current rate limiter state
 * - Adaptive formula for throttling
 * - Pre-test quota verification
 */

import { TEST_CONFIG } from './config.js';

/**
 * Current quota state snapshot
 */
export interface QuotaState {
  /** Current read operations this minute */
  estimatedReadsCurrent: number;
  /** Current write operations this minute */
  estimatedWritesCurrent: number;
  /** Timestamp when quota window resets */
  windowResetTime: number;
  /** Time remaining until reset in ms */
  resetTimeRemainingMs: number;
  /** Read operations limit per minute */
  maxReadsPerMinute: number;
  /** Write operations limit per minute */
  maxWritesPerMinute: number;
  /** Read quota percentage used */
  readPercentageUsed: number;
  /** Write quota percentage used */
  writePercentageUsed: number;
  /** Whether we're in a throttled state */
  isThrottled: boolean;
}

/**
 * Quota verification result
 */
export interface QuotaVerification {
  /** Whether enough quota is available */
  hasQuota: boolean;
  /** Available read operations */
  availableReads: number;
  /** Available write operations */
  availableWrites: number;
  /** Recommended delay before starting in ms */
  recommendedDelayMs: number;
  /** Warning message if near limits */
  warning?: string;
}

/**
 * Test operation estimate
 */
export interface OperationEstimate {
  /** Expected read operations */
  reads: number;
  /** Expected write operations */
  writes: number;
}

/**
 * Quota Manager for coordinating test delays
 */
export class QuotaManager {
  private config = TEST_CONFIG.quota;

  // Tracking state
  private readCount: number = 0;
  private writeCount: number = 0;
  private windowStart: number = Date.now();
  private isThrottled: boolean = false;
  private throttleMultiplier: number = 1.0;

  // Metrics
  private totalReads: number = 0;
  private totalWrites: number = 0;
  private quotaViolations: number = 0;
  private delaysApplied: number = 0;
  private totalDelayMs: number = 0;

  constructor() {
    this.reset();
  }

  /**
   * Get current quota state
   */
  getState(): QuotaState {
    this.maybeResetWindow();

    const now = Date.now();
    const resetTimeRemainingMs = Math.max(0, this.windowStart + 60000 - now);

    return {
      estimatedReadsCurrent: this.readCount,
      estimatedWritesCurrent: this.writeCount,
      windowResetTime: this.windowStart + 60000,
      resetTimeRemainingMs,
      maxReadsPerMinute: this.config.maxReadsPerMinute,
      maxWritesPerMinute: this.config.maxWritesPerMinute,
      readPercentageUsed: (this.readCount / this.config.maxReadsPerMinute) * 100,
      writePercentageUsed: (this.writeCount / this.config.maxWritesPerMinute) * 100,
      isThrottled: this.isThrottled,
    };
  }

  /**
   * Record API operations
   */
  recordOperations(reads: number, writes: number): void {
    this.maybeResetWindow();

    this.readCount += reads;
    this.writeCount += writes;
    this.totalReads += reads;
    this.totalWrites += writes;

    // Check if we've exceeded limits
    if (
      this.readCount > this.config.maxReadsPerMinute ||
      this.writeCount > this.config.maxWritesPerMinute
    ) {
      this.quotaViolations++;
      this.isThrottled = true;
      this.throttleMultiplier = Math.min(this.throttleMultiplier * 1.5, 5.0);
    }
  }

  /**
   * Calculate required delay based on current quota state
   * Uses adaptive formula that increases delay as quota depletes
   */
  calculateRequiredDelay(): number {
    this.maybeResetWindow();

    const state = this.getState();

    // Base delay from config
    let delay = this.config.delayBetweenTestsMs;

    // Calculate pressure based on higher of read/write usage
    const maxPercentage = Math.max(state.readPercentageUsed, state.writePercentageUsed);

    // Scale delay based on quota pressure
    // At 50% usage, multiply by 1.5
    // At 75% usage, multiply by 2.5
    // At 90% usage, multiply by 4
    if (maxPercentage > 50) {
      const pressure = (maxPercentage - 50) / 50; // 0 to 1 as we go from 50% to 100%
      const scaleFactor = 1 + pressure * 3; // 1 to 4
      delay *= scaleFactor;
    }

    // Apply throttle multiplier if we've had violations
    delay *= this.throttleMultiplier;

    // If near window reset, might be worth waiting for it
    if (state.resetTimeRemainingMs < delay && state.resetTimeRemainingMs > 0) {
      delay = state.resetTimeRemainingMs + 100; // Wait for reset plus small buffer
    }

    // Cap at max delay
    delay = Math.min(delay, this.config.maxQuotaDelayMs);

    // Ensure minimum delay
    delay = Math.max(delay, this.config.delayBetweenTestsMs);

    return Math.round(delay);
  }

  /**
   * Verify quota is available for expected operations
   */
  verifyQuota(estimate: OperationEstimate): QuotaVerification {
    this.maybeResetWindow();

    const state = this.getState();
    const bufferRatio = this.config.quotaBufferRatio;

    // Calculate available quota with buffer
    const availableReads = Math.floor(
      this.config.maxReadsPerMinute * (1 - bufferRatio) - this.readCount
    );
    const availableWrites = Math.floor(
      this.config.maxWritesPerMinute * (1 - bufferRatio) - this.writeCount
    );

    const hasQuota = estimate.reads <= availableReads && estimate.writes <= availableWrites;

    let recommendedDelayMs = 0;
    let warning: string | undefined;

    if (!hasQuota) {
      // Calculate how long to wait for quota recovery
      if (estimate.reads > availableReads) {
        const readsNeeded = estimate.reads - availableReads;
        const readsPerSecond = this.config.maxReadsPerMinute / 60;
        recommendedDelayMs = Math.max(recommendedDelayMs, (readsNeeded / readsPerSecond) * 1000);
        warning = `Need ${readsNeeded} more read quota (have ${availableReads})`;
      }

      if (estimate.writes > availableWrites) {
        const writesNeeded = estimate.writes - availableWrites;
        const writesPerSecond = this.config.maxWritesPerMinute / 60;
        recommendedDelayMs = Math.max(recommendedDelayMs, (writesNeeded / writesPerSecond) * 1000);
        warning = warning
          ? `${warning}; need ${writesNeeded} more write quota`
          : `Need ${writesNeeded} more write quota (have ${availableWrites})`;
      }

      // Cap at window reset time
      recommendedDelayMs = Math.min(recommendedDelayMs, state.resetTimeRemainingMs + 100);
    } else if (state.readPercentageUsed > 70 || state.writePercentageUsed > 70) {
      warning = `Quota usage high: ${state.readPercentageUsed.toFixed(0)}% reads, ${state.writePercentageUsed.toFixed(0)}% writes`;
    }

    return {
      hasQuota,
      availableReads: Math.max(0, availableReads),
      availableWrites: Math.max(0, availableWrites),
      recommendedDelayMs,
      warning,
    };
  }

  /**
   * Wait for quota recovery if needed
   */
  async waitForQuotaRecovery(estimate: OperationEstimate = { reads: 1, writes: 1 }): Promise<void> {
    const verification = this.verifyQuota(estimate);

    if (!verification.hasQuota && verification.recommendedDelayMs > 0) {
      this.delaysApplied++;
      this.totalDelayMs += verification.recommendedDelayMs;
      await this.sleep(verification.recommendedDelayMs);
    }
  }

  /**
   * Apply inter-test delay
   * Call this in afterEach hooks
   */
  async applyTestDelay(): Promise<number> {
    const delay = this.calculateRequiredDelay();

    if (delay > 0) {
      this.delaysApplied++;
      this.totalDelayMs += delay;
      await this.sleep(delay);
    }

    return delay;
  }

  /**
   * Mark start of throttle period
   */
  enterThrottle(durationMs: number = 60000): void {
    this.isThrottled = true;
    this.throttleMultiplier = Math.min(this.throttleMultiplier * 1.5, 5.0);

    // Schedule exit from throttle
    setTimeout(() => {
      this.exitThrottle();
    }, durationMs);
  }

  /**
   * Exit throttle mode
   */
  exitThrottle(): void {
    this.isThrottled = false;
    this.throttleMultiplier = Math.max(1.0, this.throttleMultiplier * 0.8);
  }

  /**
   * Get quota manager statistics
   */
  getStats(): {
    totalReads: number;
    totalWrites: number;
    quotaViolations: number;
    delaysApplied: number;
    totalDelayMs: number;
    avgDelayMs: number;
    throttleMultiplier: number;
    isThrottled: boolean;
  } {
    return {
      totalReads: this.totalReads,
      totalWrites: this.totalWrites,
      quotaViolations: this.quotaViolations,
      delaysApplied: this.delaysApplied,
      totalDelayMs: this.totalDelayMs,
      avgDelayMs: this.delaysApplied > 0 ? this.totalDelayMs / this.delaysApplied : 0,
      throttleMultiplier: this.throttleMultiplier,
      isThrottled: this.isThrottled,
    };
  }

  /**
   * Reset all tracking state
   */
  reset(): void {
    this.readCount = 0;
    this.writeCount = 0;
    this.windowStart = Date.now();
    this.isThrottled = false;
    this.throttleMultiplier = 1.0;
  }

  /**
   * Reset statistics (keeps tracking state)
   */
  resetStats(): void {
    this.totalReads = 0;
    this.totalWrites = 0;
    this.quotaViolations = 0;
    this.delaysApplied = 0;
    this.totalDelayMs = 0;
  }

  /**
   * Check if minute window has passed and reset if so
   */
  private maybeResetWindow(): void {
    const now = Date.now();
    if (now - this.windowStart >= 60000) {
      this.windowStart = now;
      this.readCount = 0;
      this.writeCount = 0;

      // Gradually reduce throttle multiplier
      if (this.throttleMultiplier > 1.0) {
        this.throttleMultiplier = Math.max(1.0, this.throttleMultiplier * 0.8);
      }
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Singleton instance
 */
let _instance: QuotaManager | null = null;

/**
 * Get the singleton quota manager
 */
export function getQuotaManager(): QuotaManager {
  if (!_instance) {
    _instance = new QuotaManager();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetQuotaManager(): void {
  if (_instance) {
    _instance.reset();
    _instance.resetStats();
  }
  _instance = null;
}

/**
 * Convenience function for afterEach hooks
 *
 * Usage:
 * ```typescript
 * afterEach(async () => {
 *   await applyQuotaDelay();
 * });
 * ```
 */
export async function applyQuotaDelay(): Promise<number> {
  return getQuotaManager().applyTestDelay();
}

/**
 * Convenience function to record operations
 */
export function recordQuotaUsage(reads: number, writes: number): void {
  getQuotaManager().recordOperations(reads, writes);
}

/**
 * Convenience function to check quota before test
 */
export function checkQuotaAvailable(estimate: OperationEstimate): QuotaVerification {
  return getQuotaManager().verifyQuota(estimate);
}

/**
 * Convenience function to wait for quota
 */
export async function waitForQuota(estimate: OperationEstimate): Promise<void> {
  await getQuotaManager().waitForQuotaRecovery(estimate);
}
