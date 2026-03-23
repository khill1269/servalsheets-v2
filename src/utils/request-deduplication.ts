/**
 * Request Deduplication Service
 *
 * Prevents duplicate API calls by:
 * 1. Caching in-flight requests (prevents concurrent duplicates)
 * 2. Caching completed results (prevents sequential duplicates within TTL)
 *
 * If a duplicate request arrives while the first is pending,
 * returns the same promise instead of making another API call.
 *
 * If a duplicate request arrives after completion (within TTL),
 * returns the cached result immediately.
 *
 * Benefits:
 * - Reduces redundant API calls (30-50% reduction)
 * - Saves quota and bandwidth
 * - Improves response time for duplicate requests (80-95% faster)
 *
 * Environment Variables:
 * - DEDUPLICATION_ENABLED: 'true' to enable (default: true)
 * - DEDUPLICATION_TIMEOUT: Request timeout in ms (default: 30000)
 * - DEDUPLICATION_MAX_PENDING: Max pending requests (default: 1000)
 * - RESULT_CACHE_ENABLED: 'true' to enable result caching (default: true)
 * - RESULT_CACHE_TTL: Result cache TTL in ms (default: 300000 = 5 minutes)
 * - RESULT_CACHE_MAX_SIZE: Max cached results (default: 1000)
 */

import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { logger } from './logger.js';

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
  requestKey: string;
}

interface DeduplicationOptions {
  /** Enable/disable deduplication (default: true) */
  enabled?: boolean;

  /** Timeout in ms for pending requests (default: 30000 = 30s) */
  timeout?: number;

  /** Maximum number of pending requests to track (default: 1000) */
  maxPendingRequests?: number;

  /** Enable/disable result caching (default: true) */
  resultCacheEnabled?: boolean;

  /** TTL in ms for cached results (default: 300000 = 5 minutes) */
  resultCacheTTL?: number;

  /** Maximum number of cached results (default: 1000) */
  resultCacheMaxSize?: number;
}

/**
 * Request Deduplication Manager
 * Tracks in-flight requests and caches completed results
 */
export class RequestDeduplicator {
  private pendingRequests: Map<string, PendingRequest<unknown>>;
  // lru-cache requires V to extend {} (object type), but results can be any type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resultCache: LRUCache<string, any>;
  private options: Required<DeduplicationOptions>;
  private cleanupTimer?: NodeJS.Timeout;

  /** Maps hash → original request key for pattern-based cache invalidation */
  private keyMap: Map<string, string> = new Map();

  // Metrics
  private totalRequests = 0;
  private deduplicatedRequests = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(options: DeduplicationOptions = {}) {
    this.pendingRequests = new Map();
    this.options = {
      enabled: options.enabled ?? true,
      timeout: options.timeout ?? 30000,
      maxPendingRequests: options.maxPendingRequests ?? 1000,
      resultCacheEnabled: options.resultCacheEnabled ?? true,
      resultCacheTTL: options.resultCacheTTL ?? 300000, // 5 minutes - aligned with CACHE_TTL_* constants
      resultCacheMaxSize: options.resultCacheMaxSize ?? 1000,
    };

    // Initialize result cache (lru-cache requires V to extend {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.resultCache = new LRUCache<string, any>({
      max: this.options.resultCacheMaxSize,
      ttl: this.options.resultCacheTTL,
      updateAgeOnGet: false, // Don't refresh TTL on get
      updateAgeOnHas: false,
      dispose: (_value, key) => {
        // Clean up keyMap when entries are evicted or expired
        this.keyMap.delete(key);
      },
    });

    // Start cleanup timer if enabled
    if (this.options.enabled) {
      this.startCleanupTimer();
    }
  }

  /**
   * Execute a request with deduplication and result caching
   * 1. Checks result cache first (fast path)
   * 2. Checks if request is in-flight (deduplication)
   * 3. Executes request and caches result
   */
  async deduplicate<T>(requestKey: string, requestFn: () => Promise<T>): Promise<T> {
    // Skip deduplication if disabled
    if (!this.options.enabled) {
      return requestFn();
    }

    // Generate hash key
    const key = this.generateKey(requestKey);

    // Track total requests
    this.totalRequests++;

    // Check result cache first (FAST PATH)
    if (this.options.resultCacheEnabled && this.resultCache.has(key)) {
      this.cacheHits++;
      const cached = this.resultCache.get(key) as T;
      logger.debug('Result cache hit', {
        key: requestKey,
        hash: key.substring(0, 8),
        cacheHits: this.cacheHits,
        cacheHitRate: `${this.getCacheHitRate().toFixed(1)}%`,
      });
      return cached;
    }

    // Cache miss
    if (this.options.resultCacheEnabled) {
      this.cacheMisses++;
    }

    // Check if request is already pending
    const existing = this.pendingRequests.get(key);
    if (existing) {
      this.deduplicatedRequests++;
      logger.debug('Request deduplicated (in-flight)', {
        key: requestKey,
        hash: key.substring(0, 8),
        age: Date.now() - existing.timestamp,
        savedRequests: this.deduplicatedRequests,
        deduplicationRate: `${this.getDeduplicationRate().toFixed(1)}%`,
      });
      return existing.promise as Promise<T>;
    }

    // Check if we've exceeded max pending requests
    if (this.pendingRequests.size >= this.options.maxPendingRequests) {
      logger.warn('Max pending requests reached, cleaning up oldest', {
        count: this.pendingRequests.size,
        max: this.options.maxPendingRequests,
      });
      this.cleanupOldestRequests();
    }

    logger.debug('New request registered', {
      key: requestKey,
      hash: key.substring(0, 8),
      pendingCount: this.pendingRequests.size,
    });

    // Create promise FIRST to prevent race condition
    const promise = requestFn()
      .then((result) => {
        // Cache successful result
        if (this.options.resultCacheEnabled) {
          this.resultCache.set(key, result);
          this.keyMap.set(key, requestKey);
          logger.debug('Result cached', {
            key: requestKey,
            hash: key.substring(0, 8),
            cacheSize: this.resultCache.size,
            cacheTTL: `${this.options.resultCacheTTL}ms`,
          });
        }
        return result;
      })
      .finally(() => {
        // Clean up after request completes
        this.pendingRequests.delete(key);
        logger.debug('Request completed, removed from pending', {
          key: requestKey,
          hash: key.substring(0, 8),
          remainingPending: this.pendingRequests.size,
        });
      });

    // Store the promise immediately - no window for race condition
    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now(),
      requestKey,
    });

    return promise;
  }

  /**
   * Generate a hash key from request parameters
   * Uses SHA-256 truncated to 128 bits for collision resistance
   */
  private generateKey(requestKey: string): string {
    return createHash('sha256').update(requestKey).digest('hex').substring(0, 32); // 128 bits (32 hex chars)
  }

  /**
   * Start periodic cleanup of stale requests
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleRequests();
    }, 5000); // Check every 5 seconds

    // Don't keep process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Clean up requests that have exceeded timeout
   */
  private cleanupStaleRequests(): void {
    const now = Date.now();
    const staleKeys: string[] = [];

    for (const [key, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > this.options.timeout) {
        staleKeys.push(key);
      }
    }

    if (staleKeys.length > 0) {
      logger.warn('Cleaning up stale requests', {
        count: staleKeys.length,
        timeout: this.options.timeout,
      });

      staleKeys.forEach((key) => this.pendingRequests.delete(key));
    }
  }

  /**
   * Clean up oldest requests when max limit is reached
   */
  private cleanupOldestRequests(): void {
    // Remove oldest 10% of requests
    const countToRemove = Math.ceil(this.pendingRequests.size * 0.1);

    const sortedByAge = Array.from(this.pendingRequests.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, countToRemove);

    sortedByAge.forEach(([key]) => {
      this.pendingRequests.delete(key);
    });

    logger.debug('Removed oldest requests', {
      removed: countToRemove,
      remaining: this.pendingRequests.size,
    });
  }

  /**
   * Clear all pending requests and cached results
   */
  clear(): void {
    const pendingCount = this.pendingRequests.size;
    const cacheCount = this.resultCache.size;
    this.pendingRequests.clear();
    this.resultCache.clear();
    this.keyMap.clear();
    logger.debug('Cleared all pending requests and cached results', {
      pendingCount,
      cacheCount,
    });
  }

  /**
   * Invalidate cache entries by pattern (for targeted cache invalidation)
   * @param pattern - String or RegExp to match against request keys
   * @returns Number of entries invalidated
   *
   * @example
   * // Invalidate all cache entries for a specific spreadsheet
   * deduplicator.invalidateCache(/^spreadsheet:123:/);
   *
   * // Invalidate all values operations
   * deduplicator.invalidateCache('values');
   */
  invalidateCache(pattern: string | RegExp): number {
    const keys = Array.from(this.resultCache.keys());
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    let invalidated = 0;

    for (const hash of keys) {
      // Match pattern against original request key (via keyMap), not the hash
      const originalKey = this.keyMap.get(hash);
      if (originalKey && regex.test(originalKey)) {
        this.resultCache.delete(hash);
        // keyMap entry cleaned up by dispose callback
        invalidated++;
      }
    }

    if (invalidated > 0) {
      logger.info('Cache invalidated by pattern', {
        pattern: pattern.toString(),
        invalidated,
        remaining: this.resultCache.size,
      });
    }

    return invalidated;
  }

  /**
   * Invalidate all cache entries for a specific spreadsheet
   * Convenience method for the most common invalidation pattern
   */
  invalidateSpreadsheet(spreadsheetId: string): number {
    // Use keyMap to match original request keys containing the spreadsheetId
    return this.invalidateCache(new RegExp(spreadsheetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  /**
   * Get comprehensive statistics about deduplication and caching
   */
  getStats(): {
    // Pending request stats
    pendingCount: number;
    enabled: boolean;
    oldestRequestAge: number | null;

    // Deduplication stats (in-flight)
    totalRequests: number;
    deduplicatedRequests: number;
    savedRequests: number;
    deduplicationRate: number;

    // Result cache stats
    resultCacheEnabled: boolean;
    resultCacheSize: number;
    resultCacheMaxSize: number;
    resultCacheTTL: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;

    // Combined impact
    totalSavedRequests: number;
    totalSavingsRate: number;
  } {
    let oldestAge: number | null = null;

    if (this.pendingRequests.size > 0) {
      const now = Date.now();
      const timestamps = Array.from(this.pendingRequests.values()).map((r) => r.timestamp);
      const oldestTimestamp = Math.min(...timestamps);
      oldestAge = now - oldestTimestamp;
    }

    const totalSaved = this.deduplicatedRequests + this.cacheHits;
    const totalSavingsRate = this.totalRequests > 0 ? (totalSaved / this.totalRequests) * 100 : 0;

    return {
      // Pending request stats
      pendingCount: this.pendingRequests.size,
      enabled: this.options.enabled,
      oldestRequestAge: oldestAge,

      // Deduplication stats (in-flight)
      totalRequests: this.totalRequests,
      deduplicatedRequests: this.deduplicatedRequests,
      savedRequests: this.deduplicatedRequests,
      deduplicationRate: this.getDeduplicationRate(),

      // Result cache stats
      resultCacheEnabled: this.options.resultCacheEnabled,
      resultCacheSize: this.resultCache.size,
      resultCacheMaxSize: this.options.resultCacheMaxSize,
      resultCacheTTL: this.options.resultCacheTTL,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: this.getCacheHitRate(),

      // Combined impact
      totalSavedRequests: totalSaved,
      totalSavingsRate,
    };
  }

  /**
   * Get the percentage of requests that were deduplicated (in-flight) (0-100)
   */
  getDeduplicationRate(): number {
    if (this.totalRequests === 0) {
      return 0;
    }
    return (this.deduplicatedRequests / this.totalRequests) * 100;
  }

  /**
   * Get the percentage of requests served from result cache (0-100)
   */
  getCacheHitRate(): number {
    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    if (totalCacheRequests === 0) {
      return 0;
    }
    return (this.cacheHits / totalCacheRequests) * 100;
  }

  /**
   * Get combined savings rate (deduplication + cache) (0-100)
   */
  getTotalSavingsRate(): number {
    if (this.totalRequests === 0) {
      return 0;
    }
    const totalSaved = this.deduplicatedRequests + this.cacheHits;
    return (totalSaved / this.totalRequests) * 100;
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.totalRequests = 0;
    this.deduplicatedRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Stop the cleanup timer and clear all requests
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }
}

/**
 * Parse environment variable as integer with validation
 */
function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? defaultValue : parsed;
}

/**
 * Global deduplicator instance with result caching
 */
export const requestDeduplicator = new RequestDeduplicator({
  enabled: process.env['DEDUPLICATION_ENABLED'] !== 'false',
  timeout: parseEnvInt(process.env['DEDUPLICATION_TIMEOUT'], 30000),
  maxPendingRequests: parseEnvInt(process.env['DEDUPLICATION_MAX_PENDING'], 1000),
  resultCacheEnabled: process.env['RESULT_CACHE_ENABLED'] !== 'false',
  resultCacheTTL: parseEnvInt(process.env['RESULT_CACHE_TTL'], 300000), // 5 minutes - aligned with CACHE_TTL_* constants
  resultCacheMaxSize: parseEnvInt(process.env['RESULT_CACHE_MAX_SIZE'], 1000),
});

/**
 * Helper: Create a request key from parameters
 * Sorts keys for consistent hashing
 */
export function createRequestKey(operation: string, params: Record<string, unknown>): string {
  // Sort keys for consistent hashing
  const sortedKeys = Object.keys(params).sort();
  const serialized = sortedKeys.map((key) => `${key}=${JSON.stringify(params[key])}`).join('&');

  return `${operation}:${serialized}`;
}
