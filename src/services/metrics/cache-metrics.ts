/**
 * Cache Metrics
 *
 * Tracks cache hit/miss rates overall and by category.
 *
 * @category Metrics
 */

import { logger } from '../../utils/logger.js';

// ==================== Types ====================

export interface CacheMetrics {
  /** Total cache requests */
  requests: number;
  /** Cache hits */
  hits: number;
  /** Cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
}

export interface CategoryCacheMetrics {
  /** Cache hits */
  hits: number;
  /** Cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
}

// ==================== Constants ====================

/**
 * Maximum cardinality for cache categories
 * Prevents unbounded memory growth from high-cardinality labels
 */
const MAX_CACHE_CATEGORIES = 10000;

// ==================== Cache Metrics Service ====================

export class CacheMetricsService {
  private cacheRequests = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  private categoryCacheMetrics: Map<
    string,
    {
      hits: number;
      misses: number;
    }
  > = new Map();

  private enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Record cache access (overall)
   */
  recordCacheAccess(hit: boolean): void {
    if (!this.enabled) return;

    this.cacheRequests++;
    if (hit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
  }

  /**
   * Record cache hit/miss for a specific category
   */
  recordCacheHit(category: string, hit: boolean): void {
    if (!this.enabled) return;

    // Update category-specific metrics
    let stats = this.categoryCacheMetrics.get(category);
    if (!stats) {
      // CARDINALITY LIMIT: Prevent unbounded growth from many cache categories
      if (this.categoryCacheMetrics.size >= MAX_CACHE_CATEGORIES) {
        logger.warn('Cache category metrics cardinality limit reached', {
          limit: MAX_CACHE_CATEGORIES,
          droppedCategory: category,
        });
        return; // Drop metric to prevent unbounded growth
      }
      stats = { hits: 0, misses: 0 };
      this.categoryCacheMetrics.set(category, stats);
    }

    if (hit) {
      stats.hits++;
    } else {
      stats.misses++;
    }

    // Also update overall cache metrics
    this.cacheRequests++;
    if (hit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
  }

  /**
   * Get cache metrics (overall)
   */
  getCacheMetrics(): CacheMetrics;
  /**
   * Get cache metrics for a specific category
   */
  getCacheMetrics(category: string): CategoryCacheMetrics;
  getCacheMetrics(category?: string): CacheMetrics | CategoryCacheMetrics {
    if (category) {
      // Return category-specific metrics
      const stats = this.categoryCacheMetrics.get(category);
      if (!stats) {
        return { hits: 0, misses: 0, hitRate: 0 };
      }
      const total = stats.hits + stats.misses;
      return {
        hits: stats.hits,
        misses: stats.misses,
        hitRate: total > 0 ? stats.hits / total : 0,
      };
    }

    // Return overall cache metrics
    return {
      requests: this.cacheRequests,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: this.cacheRequests > 0 ? this.cacheHits / this.cacheRequests : 0,
    };
  }

  /**
   * Get cache metrics for a specific category (explicit method)
   */
  getCategoryCacheMetrics(category: string): CategoryCacheMetrics {
    const stats = this.categoryCacheMetrics.get(category);
    if (!stats) {
      return { hits: 0, misses: 0, hitRate: 0 };
    }
    const total = stats.hits + stats.misses;
    return {
      hits: stats.hits,
      misses: stats.misses,
      hitRate: total > 0 ? stats.hits / total : 0,
    };
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.cacheRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.categoryCacheMetrics.clear();
  }
}
