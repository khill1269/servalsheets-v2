/**
 * ServalSheets - Cache Adapter
 *
 * Backward compatibility adapter that wraps cache-manager with a simplified API.
 * Provides namespace-based caching with TTL support.
 *
 * Usage:
 * ```typescript
 * import { getCacheAdapter } from './cache-adapter.js';
 * const cache = getCacheAdapter('namespace');
 * cache.set('key', value, 300000); // TTL in ms
 * const result = cache.get('key');
 * ```
 */

import { cacheManager } from './cache-manager.js';

/**
 * Cache statistics (compatible with former HotCache interface)
 */
export interface HotCacheStats {
  hotTierSize: number;
  warmTierSize: number;
  hotHits: number;
  warmHits: number;
  misses: number;
  hitRate: number;
  promotions: number;
  demotions: number;
  evictions: number;
  totalMemoryBytes: number;
}

/**
 * Minimal cache interface required by analysis modules
 */
export interface ICache<T = unknown> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttl?: number): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  clear(): void;
  getStats(): HotCacheStats;
}

/**
 * Adapter that wraps CacheManager with HotCache-compatible API
 */
export class CacheAdapter<T = unknown> implements ICache<T> {
  constructor(private readonly namespace: string) {}

  /**
   * Get value from cache
   */
  get(key: string): T | undefined {
    return cacheManager.get<T>(key, this.namespace);
  }

  /**
   * Set value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in milliseconds (default: 5 minutes)
   */
  set(key: string, value: T, ttl?: number): void {
    cacheManager.set(key, value, {
      ttl: ttl ?? 300000, // Default 5 minutes
      namespace: this.namespace,
    });
  }

  /**
   * Delete value from cache
   */
  delete(key: string): boolean {
    return cacheManager.delete(key, this.namespace);
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    return cacheManager.has(key, this.namespace);
  }

  /**
   * Clear all entries in this namespace
   */
  clear(): void {
    cacheManager.clearNamespace(this.namespace);
  }

  /**
   * Get cache statistics
   * Note: Returns stats for the entire cache-manager, not just this namespace
   */
  getStats(): HotCacheStats {
    const stats = cacheManager.getStats();

    // Map CacheManager stats to HotCacheStats format
    return {
      hotTierSize: stats.byNamespace[this.namespace] ?? 0,
      warmTierSize: 0, // Not applicable for single-tier cache
      hotHits: stats.hits,
      warmHits: 0,
      misses: stats.misses,
      hitRate: stats.hitRate,
      promotions: 0, // Not applicable
      demotions: 0, // Not applicable
      evictions: 0, // Not tracked in cache-manager
      totalMemoryBytes: stats.totalSize,
    };
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    return cacheManager.invalidatePattern(pattern, this.namespace);
  }

  /**
   * Invalidate entries by prefix
   */
  invalidatePrefix(prefix: string): number {
    // Convert prefix to regex pattern: "foo" -> "^foo"
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    return cacheManager.invalidatePattern(pattern, this.namespace);
  }
}

/**
 * Namespace-specific cache adapter instances
 */
const cacheAdapters = new Map<string, CacheAdapter>();

/**
 * Get a cache adapter for a specific namespace
 *
 * @param namespace - Cache namespace (e.g., 'analysis', 'scout', 'tiered-retrieval')
 * @returns Cache adapter with HotCache-compatible API
 *
 * @example
 * ```typescript
 * const cache = getCacheAdapter('scout');
 * cache.set('key', value, 300000);
 * const result = cache.get('key');
 * ```
 */
export function getCacheAdapter<T = unknown>(namespace: string): CacheAdapter<T> {
  let adapter = cacheAdapters.get(namespace);
  if (!adapter) {
    adapter = new CacheAdapter<T>(namespace);
    cacheAdapters.set(namespace, adapter);
  }
  return adapter as CacheAdapter<T>;
}

/**
 * Default adapter for backward compatibility with getHotCache()
 *
 * @deprecated Use getCacheAdapter('namespace') with explicit namespace instead
 */
export function getDefaultCacheAdapter<T = unknown>(): CacheAdapter<T> {
  return getCacheAdapter<T>('default');
}

/**
 * Reset all cache adapters (for testing)
 */
export function resetCacheAdapters(): void {
  cacheAdapters.clear();
}
