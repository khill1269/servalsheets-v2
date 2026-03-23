/**
 * ServalSheets - Test Rate Limiter
 *
 * Test-specific rate limiting with lower limits than production.
 * Extends production patterns with pre-test verification and token reservation.
 *
 * Key differences from production (src/core/rate-limiter.ts):
 * - Lower limits: 200 reads/min, 40 writes/min (vs 300/60)
 * - Token reservation before async operations
 * - Pre-test quota verification
 * - Integration with QuotaManager for coordinated delays
 */

import PQueue from 'p-queue';
import { TEST_CONFIG } from './config.js';
import { getQuotaManager } from './quota-manager.js';

/**
 * Rate limits for test environment
 */
export interface TestRateLimits {
  readsPerMinute: number;
  writesPerMinute: number;
  readsPerSecond: number;
  writesPerSecond: number;
}

/**
 * Token reservation handle
 */
export interface TokenReservation {
  id: string;
  reads: number;
  writes: number;
  timestamp: number;
  released: boolean;
}

/**
 * Token bucket for rate limiting
 */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per second
  reserved: number; // reserved but not yet consumed
}

/**
 * Test Rate Limiter using token bucket algorithm
 * More conservative than production for live API testing
 */
export class TestRateLimiter {
  private readBucket: TokenBucket;
  private writeBucket: TokenBucket;
  private queue: PQueue;
  private baseReadRate: number;
  private baseWriteRate: number;
  private throttleUntil: number = 0;

  // Reservation tracking
  private reservations: Map<string, TokenReservation> = new Map();
  private reservationCounter: number = 0;

  // Metrics
  private totalReadsAcquired: number = 0;
  private totalWritesAcquired: number = 0;
  private totalWaitTimeMs: number = 0;
  private acquireCalls: number = 0;

  constructor(limits?: Partial<TestRateLimits>) {
    const config = TEST_CONFIG.quota;

    const readsPerMinute = limits?.readsPerMinute ?? config.maxReadsPerMinute;
    const writesPerMinute = limits?.writesPerMinute ?? config.maxWritesPerMinute;
    const readsPerSecond = limits?.readsPerSecond ?? Math.ceil(readsPerMinute / 60);
    const writesPerSecond = limits?.writesPerSecond ?? Math.ceil(writesPerMinute / 60);

    this.baseReadRate = readsPerSecond;
    this.baseWriteRate = writesPerSecond;

    this.readBucket = {
      tokens: readsPerSecond,
      lastRefill: Date.now(),
      capacity: readsPerSecond * 2,
      refillRate: readsPerSecond,
      reserved: 0,
    };

    this.writeBucket = {
      tokens: writesPerSecond,
      lastRefill: Date.now(),
      capacity: writesPerSecond * 2,
      refillRate: writesPerSecond,
      reserved: 0,
    };

    this.queue = new PQueue({ concurrency: 1 });
  }

  /**
   * Acquire tokens for an operation
   * Blocks until tokens are available
   */
  async acquire(type: 'read' | 'write', count: number = 1): Promise<void> {
    const startTime = Date.now();
    this.acquireCalls++;

    return this.queue.add(async () => {
      const bucket = type === 'read' ? this.readBucket : this.writeBucket;

      // Refill bucket
      this.refillBucket(bucket);

      // Account for reserved tokens
      const availableTokens = bucket.tokens - bucket.reserved;

      // Wait if not enough tokens
      if (availableTokens < count) {
        const tokensNeeded = count - availableTokens;
        const waitTime = (tokensNeeded / bucket.refillRate) * 1000;
        await this.sleep(waitTime);

        // Refill tokens after waiting
        this.refillBucket(bucket);
      }

      // Consume tokens
      bucket.tokens -= count;

      // Track metrics
      if (type === 'read') {
        this.totalReadsAcquired += count;
      } else {
        this.totalWritesAcquired += count;
      }

      this.totalWaitTimeMs += Date.now() - startTime;

      // Report to quota manager
      getQuotaManager().recordOperations(type === 'read' ? count : 0, type === 'write' ? count : 0);
    });
  }

  /**
   * Reserve tokens before starting an async operation
   * Returns a handle that must be released when operation completes
   */
  reserveTokens(reads: number, writes: number): TokenReservation | null {
    // Refill buckets first
    this.refillBucket(this.readBucket);
    this.refillBucket(this.writeBucket);

    // Check if we can reserve
    const availableReads = this.readBucket.tokens - this.readBucket.reserved;
    const availableWrites = this.writeBucket.tokens - this.writeBucket.reserved;

    if (reads > availableReads || writes > availableWrites) {
      return null;
    }

    // Create reservation
    const id = `res_${++this.reservationCounter}_${Date.now()}`;
    const reservation: TokenReservation = {
      id,
      reads,
      writes,
      timestamp: Date.now(),
      released: false,
    };

    this.reservations.set(id, reservation);
    this.readBucket.reserved += reads;
    this.writeBucket.reserved += writes;

    return reservation;
  }

  /**
   * Release a token reservation
   * Call with actual usage to release unused tokens
   */
  releaseReservation(
    reservation: TokenReservation,
    actualReads?: number,
    actualWrites?: number
  ): void {
    if (reservation.released) {
      return;
    }

    const stored = this.reservations.get(reservation.id);
    if (!stored) {
      return;
    }

    // Calculate actual usage (default to reserved if not specified)
    const usedReads = actualReads ?? reservation.reads;
    const usedWrites = actualWrites ?? reservation.writes;

    // Release reserved tokens
    this.readBucket.reserved -= reservation.reads;
    this.writeBucket.reserved -= reservation.writes;

    // Consume actually used tokens
    this.readBucket.tokens -= usedReads;
    this.writeBucket.tokens -= usedWrites;

    // Track metrics
    this.totalReadsAcquired += usedReads;
    this.totalWritesAcquired += usedWrites;

    // Report to quota manager
    getQuotaManager().recordOperations(usedReads, usedWrites);

    // Mark as released
    stored.released = true;
    reservation.released = true;
    this.reservations.delete(reservation.id);
  }

  /**
   * Check if tokens are available without acquiring
   */
  hasTokens(type: 'read' | 'write', count: number = 1): boolean {
    const bucket = type === 'read' ? this.readBucket : this.writeBucket;
    this.refillBucket(bucket);
    return bucket.tokens - bucket.reserved >= count;
  }

  /**
   * Get current token counts
   */
  getStatus(): {
    readTokens: number;
    writeTokens: number;
    readReserved: number;
    writeReserved: number;
    availableReads: number;
    availableWrites: number;
    isThrottled: boolean;
  } {
    this.refillBucket(this.readBucket);
    this.refillBucket(this.writeBucket);

    return {
      readTokens: this.readBucket.tokens,
      writeTokens: this.writeBucket.tokens,
      readReserved: this.readBucket.reserved,
      writeReserved: this.writeBucket.reserved,
      availableReads: this.readBucket.tokens - this.readBucket.reserved,
      availableWrites: this.writeBucket.tokens - this.writeBucket.reserved,
      isThrottled: this.isThrottled(),
    };
  }

  /**
   * Get quota status as percentage
   */
  getQuotaPercentage(): { reads: number; writes: number } {
    const status = this.getStatus();
    return {
      reads: (status.availableReads / this.readBucket.capacity) * 100,
      writes: (status.availableWrites / this.writeBucket.capacity) * 100,
    };
  }

  /**
   * Pre-test verification - checks if enough quota for estimated operations
   */
  verifyPreTestQuota(
    estimatedReads: number,
    estimatedWrites: number
  ): {
    canProceed: boolean;
    availableReads: number;
    availableWrites: number;
    waitTimeMs?: number;
    message?: string;
  } {
    this.refillBucket(this.readBucket);
    this.refillBucket(this.writeBucket);

    const availableReads = this.readBucket.tokens - this.readBucket.reserved;
    const availableWrites = this.writeBucket.tokens - this.writeBucket.reserved;

    if (estimatedReads <= availableReads && estimatedWrites <= availableWrites) {
      return { canProceed: true, availableReads, availableWrites };
    }

    // Calculate wait time
    let waitTimeMs = 0;
    const messages: string[] = [];

    if (estimatedReads > availableReads) {
      const needed = estimatedReads - availableReads;
      const readWait = (needed / this.readBucket.refillRate) * 1000;
      waitTimeMs = Math.max(waitTimeMs, readWait);
      messages.push(`Need ${needed} more read tokens`);
    }

    if (estimatedWrites > availableWrites) {
      const needed = estimatedWrites - availableWrites;
      const writeWait = (needed / this.writeBucket.refillRate) * 1000;
      waitTimeMs = Math.max(waitTimeMs, writeWait);
      messages.push(`Need ${needed} more write tokens`);
    }

    return {
      canProceed: false,
      availableReads,
      availableWrites,
      waitTimeMs,
      message: messages.join('; '),
    };
  }

  /**
   * Reset the limiter
   */
  reset(): void {
    this.readBucket.tokens = this.readBucket.capacity;
    this.writeBucket.tokens = this.writeBucket.capacity;
    this.readBucket.lastRefill = Date.now();
    this.writeBucket.lastRefill = Date.now();
    this.readBucket.reserved = 0;
    this.writeBucket.reserved = 0;
    this.reservations.clear();
    this.throttleUntil = 0;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalReadsAcquired = 0;
    this.totalWritesAcquired = 0;
    this.totalWaitTimeMs = 0;
    this.acquireCalls = 0;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalReadsAcquired: number;
    totalWritesAcquired: number;
    totalWaitTimeMs: number;
    acquireCalls: number;
    avgWaitTimeMs: number;
    activeReservations: number;
  } {
    return {
      totalReadsAcquired: this.totalReadsAcquired,
      totalWritesAcquired: this.totalWritesAcquired,
      totalWaitTimeMs: this.totalWaitTimeMs,
      acquireCalls: this.acquireCalls,
      avgWaitTimeMs: this.acquireCalls > 0 ? this.totalWaitTimeMs / this.acquireCalls : 0,
      activeReservations: this.reservations.size,
    };
  }

  /**
   * Temporarily throttle rate limits after receiving a 429 error
   */
  throttle(durationMs: number = 60000): void {
    this.throttleUntil = Date.now() + durationMs;

    // Reduce refill rates by 50%
    this.readBucket.refillRate = this.baseReadRate * 0.5;
    this.writeBucket.refillRate = this.baseWriteRate * 0.5;

    // Also reduce capacity temporarily
    this.readBucket.capacity = this.baseReadRate;
    this.writeBucket.capacity = this.baseWriteRate;

    // Notify quota manager
    getQuotaManager().enterThrottle(durationMs);
  }

  /**
   * Restore normal rate limits
   */
  restoreNormalLimits(): void {
    if (Date.now() >= this.throttleUntil) {
      this.readBucket.refillRate = this.baseReadRate;
      this.writeBucket.refillRate = this.baseWriteRate;
      this.readBucket.capacity = this.baseReadRate * 2;
      this.writeBucket.capacity = this.baseWriteRate * 2;
      this.throttleUntil = 0;

      getQuotaManager().exitThrottle();
    }
  }

  /**
   * Check if currently throttled
   */
  isThrottled(): boolean {
    return Date.now() < this.throttleUntil;
  }

  /**
   * Refill a bucket based on elapsed time
   */
  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;
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
let _instance: TestRateLimiter | null = null;

/**
 * Get the singleton test rate limiter
 */
export function getTestRateLimiter(): TestRateLimiter {
  if (!_instance) {
    _instance = new TestRateLimiter();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetTestRateLimiter(): void {
  if (_instance) {
    _instance.reset();
    _instance.resetStats();
  }
  _instance = null;
}

/**
 * Convenience function to acquire read tokens
 */
export async function acquireReadTokens(count: number = 1): Promise<void> {
  await getTestRateLimiter().acquire('read', count);
}

/**
 * Convenience function to acquire write tokens
 */
export async function acquireWriteTokens(count: number = 1): Promise<void> {
  await getTestRateLimiter().acquire('write', count);
}

/**
 * Convenience function to check quota before test
 */
export function checkTestQuota(estimatedReads: number, estimatedWrites: number): boolean {
  const result = getTestRateLimiter().verifyPreTestQuota(estimatedReads, estimatedWrites);
  return result.canProceed;
}
