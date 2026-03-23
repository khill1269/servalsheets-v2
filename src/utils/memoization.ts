/**
 * Memoization Utilities
 *
 * Provides performance optimization through function result caching.
 * Use for expensive, pure functions with predictable inputs.
 *
 * @module utils/memoization
 */

import { LRUCache } from './cache.js';

/**
 * Memoize a function with a single argument
 *
 * Best for pure functions with expensive computations:
 * - Column letter to number conversion
 * - Range parsing
 * - Complex calculations
 *
 * @param fn - Function to memoize
 * @param options - Cache configuration
 * @returns Memoized function with cache
 *
 * @example
 * ```typescript
 * const expensiveCalc = memoize((x: number) => {
 *   // Complex calculation
 *   return result;
 * });
 *
 * expensiveCalc(5); // Calculated
 * expensiveCalc(5); // Cached (fast!)
 * ```
 */
export function memoize<T, R>(
  fn: (arg: T) => R,
  options: { maxSize?: number; ttl?: number; keyFn?: (arg: T) => string } = {}
): ((arg: T) => R) & {
  cache: { clear: () => void; stats: () => { size: number; hits?: number } };
} {
  const { maxSize = 100, ttl = 60000, keyFn = (arg: T) => JSON.stringify(arg) } = options;

  const cache = new LRUCache<string, R>({ maxSize, ttl, trackHits: true });

  const memoized = (arg: T): R => {
    const key = keyFn(arg);
    const cached = cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const result = fn(arg);
    cache.set(key, result);
    return result;
  };

  // Attach cache control methods
  return Object.assign(memoized, {
    cache: {
      clear: () => cache.clear(),
      stats: () => cache.getStats(),
    },
  });
}

/**
 * Statistics for memoization performance monitoring
 */
export interface MemoStats {
  hits: number;
  misses: number;
  hitRate: number;
  cacheSize: number;
}

/**
 * Create a memoized function with statistics tracking
 *
 * @param fn - Function to memoize
 * @param options - Cache options
 * @returns Memoized function with stats
 */
export function memoizeWithStats<T, R>(
  fn: (arg: T) => R,
  options: { maxSize?: number; ttl?: number } = {}
): ((arg: T) => R) & { getStats: () => MemoStats; clearCache: () => void } {
  const memoized = memoize(fn, options);
  let hits = 0;
  let misses = 0;

  const wrapper = (arg: T): R => {
    const stats = memoized.cache.stats();
    const prevHits = stats.hits ?? 0;

    const result = memoized(arg);

    const newStats = memoized.cache.stats();
    const currentHits = newStats.hits ?? 0;
    if (currentHits > prevHits) {
      hits++;
    } else {
      misses++;
    }

    return result;
  };

  return Object.assign(wrapper, {
    getStats: (): MemoStats => {
      const cacheStats = memoized.cache.stats();
      const total = hits + misses;
      return {
        hits,
        misses,
        hitRate: total > 0 ? hits / total : 0,
        cacheSize: cacheStats.size,
      };
    },
    clearCache: () => {
      memoized.cache.clear();
      hits = 0;
      misses = 0;
    },
  });
}
