/**
 * Unified Cache Utilities
 *
 * Provides a consistent LRU cache implementation across the codebase.
 * Uses the battle-tested `lru-cache` npm package under the hood.
 *
 * Consolidates 3 previous implementations:
 * - src/utils/memoization.ts (custom LRUCache)
 * - src/utils/bounded-cache.ts (BoundedCache)
 * - src/services/error-pattern-learner.ts (SimpleBoundedCache)
 *
 * @module utils/cache
 */

import { LRUCache as LRU } from 'lru-cache';

/**
 * Configuration options for LRU cache
 */
export interface CacheOptions<K, V> {
  /** Maximum number of entries before LRU eviction */
  maxSize: number;
  /** Time to live in milliseconds (optional) */
  ttl?: number;
  /** Callback when entry is evicted (optional) */
  onEviction?: (key: K, value: V) => void;
  /** Custom size calculation (optional, for memory-based limits) */
  sizeCalculation?: (value: V, key: K) => number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Current number of entries */
  size: number;
  /** Maximum capacity */
  maxSize: number;
  /** Cache utilization (0-100%) */
  utilization: number;
  /** Total cache hits (if hit tracking enabled) */
  hits?: number;
}

/**
 * Unified LRU Cache implementation
 *
 * Features:
 * - Automatic LRU eviction when full
 * - Optional TTL for automatic expiration
 * - Eviction callbacks for cleanup
 * - Memory-based or count-based limits
 * - Statistics tracking
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<string, User>({
 *   maxSize: 1000,
 *   ttl: 60000, // 1 minute
 *   onEviction: (key, user) => logger.debug(`Evicted ${user.name}`)
 * });
 *
 * cache.set('user1', { name: 'Alice' });
 * const user = cache.get('user1');
 * ```
 */
export class LRUCache<K, V> {
  // lru-cache requires K,V to extend {} (object types), but we support all types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cache: LRU<any, any>;
  private hitCount = 0;
  private missCount = 0;
  private trackHits: boolean;

  constructor(options: CacheOptions<K, V> & { trackHits?: boolean }) {
    const { maxSize, ttl, onEviction, sizeCalculation, trackHits = false } = options;

    this.trackHits = trackHits;
    // lru-cache requires K,V to extend {} (object types)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.cache = new LRU<any, any>({
      max: maxSize,
      ttl,
      sizeCalculation,
      dispose: onEviction
        ? (value, key) => {
            onEviction(key, value);
          }
        : undefined,
    });
  }

  /**
   * Get value from cache (updates LRU position)
   * Returns undefined if key not found or expired
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);

    if (this.trackHits) {
      if (value !== undefined) {
        this.hitCount++;
      } else {
        this.missCount++;
      }
    }

    return value;
  }

  /**
   * Set value in cache (may trigger LRU eviction if full)
   */
  set(key: K, value: V): void {
    this.cache.set(key, value);
  }

  /**
   * Check if key exists in cache (does not update LRU position)
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete specific key from cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
    if (this.trackHits) {
      this.hitCount = 0;
      this.missCount = 0;
    }
  }

  /**
   * Get current number of entries in cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Iterate over all keys in cache (in LRU order)
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Iterate over all values in cache (in LRU order)
   */
  values(): IterableIterator<V> {
    return this.cache.values();
  }

  /**
   * Iterate over all entries in cache (in LRU order)
   */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const stats: CacheStats = {
      size: this.cache.size,
      maxSize: this.cache.max,
      utilization: (this.cache.size / this.cache.max) * 100,
    };

    if (this.trackHits) {
      stats.hits = this.hitCount;
    }

    return stats;
  }

  /**
   * Get hit rate (only available if trackHits enabled)
   */
  getHitRate(): number | undefined {
    if (!this.trackHits) {
      return undefined;
    }

    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }
}
