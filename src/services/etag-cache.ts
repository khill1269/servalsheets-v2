/**
 * ServalSheets - ETag Cache Service
 *
 * Implements Google API ETag caching for conditional requests with optional Redis L2 cache.
 * Reduces bandwidth and quota usage with 304 Not Modified responses.
 *
 * Benefits:
 * - 304 responses don't count against quota
 * - Saves bandwidth (no response body)
 * - Faster response times
 * - L1 (memory) + L2 (Redis) for distributed caching across replicas
 *
 * @category Services
 */

import { logger } from '../utils/logger.js';
import { LRUCache } from 'lru-cache';
import { recordCacheEviction } from '../observability/metrics.js';
import { getEnv } from '../config/env.js';

// Use generic Redis client type to avoid complex type compatibility issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisClient = any;

/** Non-blocking SCAN replacement for redis.keys() */
async function scanRedisKeys(redis: RedisClient, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    keys.push(...result.keys);
  } while (cursor !== 0);
  return keys;
}

/**
 * Cached ETag entry
 */
interface ETagEntry {
  etag: string;
  cachedAt: number;
  cachedData?: unknown; // Optional cached response data
}

/**
 * ETag cache key components
 */
interface CacheKey {
  spreadsheetId: string;
  endpoint: 'metadata' | 'values' | 'properties' | 'sheets';
  range?: string;
  params?: Record<string, unknown>;
}

const REDIS_KEY_PREFIX = 'servalsheets:etag:';
const REDIS_TTL_SECONDS = 600; // 10 minutes (longer than L1)

function getDefaultMaxEntries(): number {
  return getEnv().ETAG_CACHE_MAX_ENTRIES;
}

/**
 * ETag Cache Service
 *
 * Caches ETags from Google API responses to enable conditional requests.
 * Uses If-None-Match header to get 304 Not Modified when data hasn't changed.
 *
 * Architecture:
 * - L1 (memory): Fast, 5min TTL, limited to 1000 entries
 * - L2 (Redis): Distributed, 10min TTL, survives pod restarts
 */
export class ETagCache {
  private cache: LRUCache<string, ETagEntry>;
  private readonly maxAge: number; // milliseconds
  private readonly maxSize: number;
  private readonly redis?: RedisClient;

  constructor(options: { maxAge?: number; maxSize?: number; redis?: RedisClient } = {}) {
    this.maxAge = options.maxAge ?? 5 * 60 * 1000; // 5 minutes default
    this.maxSize = options.maxSize ?? getDefaultMaxEntries();
    this.redis = options.redis;
    this.cache = new LRUCache<string, ETagEntry>({
      max: this.maxSize,
      ttl: this.maxAge,
      updateAgeOnGet: true,
      dispose: (_value, key, reason) => {
        const evictionReason =
          reason === 'evict' ? 'lru_evict' : reason === 'expire' ? 'ttl_expire' : reason;
        recordCacheEviction(evictionReason);
        logger.debug('ETag cache entry evicted', { key, reason: evictionReason });
      },
    });

    if (this.redis) {
      logger.info('ETag cache initialized with Redis L2', {
        l1Ttl: this.maxAge / 1000,
        l2Ttl: REDIS_TTL_SECONDS,
      });
    }
  }

  /**
   * Generate cache key from request parameters
   */
  private getCacheKey(key: CacheKey): string {
    const parts = [key.spreadsheetId, key.endpoint];

    if (key.range) {
      parts.push(key.range);
    }

    if (key.params) {
      // Sort keys for consistent hashing
      const sortedParams = Object.keys(key.params)
        .sort()
        .map((k) => `${k}=${JSON.stringify(key.params![k])}`)
        .join('&');
      parts.push(sortedParams);
    }

    return parts.join(':');
  }

  /**
   * Get cached ETag for request
   *
   * Returns ETag if:
   * - Entry exists
   * - Entry is not expired
   * - Entry has valid ETag
   *
   * @returns ETag string or null if not cached/expired
   */
  getETag(key: CacheKey): string | null {
    const cacheKey = this.getCacheKey(key);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.cachedAt;
    logger.debug('ETag cache hit', {
      key: cacheKey,
      etag: entry.etag.substring(0, 16),
      ageMs: age,
    });

    return entry.etag;
  }

  /**
   * Get cached data (if available)
   *
   * Returns cached response data if:
   * - Entry exists and is not expired
   * - Entry has cached data
   *
   * Checks L1 (memory) first, then L2 (Redis) on miss
   */
  async getCachedData(key: CacheKey): Promise<unknown | null> {
    const cacheKey = this.getCacheKey(key);

    // Check L1 cache (memory) first
    const entry = this.cache.get(cacheKey);
    if (entry && entry.cachedData) {
      logger.debug('ETag data cache hit (L1)', { key: cacheKey });
      return entry.cachedData;
    }

    // Check L2 cache (Redis) if available
    if (this.redis) {
      try {
        const redisKey = `${REDIS_KEY_PREFIX}${cacheKey}`;
        const cached = await this.redis.get(redisKey);
        if (cached) {
          const parsed: ETagEntry = JSON.parse(cached);
          // Update L1 cache from L2
          this.cache.set(cacheKey, parsed);
          logger.debug('ETag data cache hit (L2 Redis)', { key: cacheKey });
          return parsed.cachedData;
        }
      } catch (error) {
        logger.warn('Failed to get ETag from Redis', {
          key: cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  /**
   * Store ETag from response
   *
   * Extracts ETag from response headers and stores it for future requests.
   * Writes to both L1 (memory) and L2 (Redis) if available.
   *
   * @param key - Request parameters
   * @param etag - ETag from response headers
   * @param data - Optional response data to cache
   */
  async setETag(key: CacheKey, etag: string, data?: unknown): Promise<void> {
    if (!etag) {
      logger.warn('Attempted to cache empty ETag', { key });
      return;
    }

    const cacheKey = this.getCacheKey(key);
    const now = Date.now();

    const entry: ETagEntry = {
      etag,
      cachedAt: now,
      cachedData: data,
    };

    // Store in L1 cache (memory)
    this.cache.set(cacheKey, entry);

    // Store in L2 cache (Redis) for distributed access
    if (this.redis && data) {
      try {
        const redisKey = `${REDIS_KEY_PREFIX}${cacheKey}`;
        await this.redis.setEx(redisKey, REDIS_TTL_SECONDS, JSON.stringify(entry));
        logger.debug('ETag cached (L1+L2)', {
          key: cacheKey,
          etag: etag.substring(0, 16),
          ttl: REDIS_TTL_SECONDS,
        });
      } catch (error) {
        logger.warn('Failed to cache ETag in Redis', {
          key: cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      logger.debug('ETag cached (L1 only)', {
        key: cacheKey,
        etag: etag.substring(0, 16),
        hasCachedData: !!data,
      });
    }
  }

  /**
   * Invalidate cache entry (e.g., after mutation)
   *
   * Clears from both L1 (memory) and L2 (Redis)
   *
   * @param key - Request parameters to invalidate
   */
  async invalidate(key: CacheKey): Promise<void> {
    const cacheKey = this.getCacheKey(key);

    // Invalidate L1 (memory)
    const deleted = this.cache.delete(cacheKey);

    // Invalidate L2 (Redis)
    if (this.redis) {
      try {
        const redisKey = `${REDIS_KEY_PREFIX}${cacheKey}`;
        await this.redis.del(redisKey);
      } catch (error) {
        logger.warn('Failed to invalidate ETag from Redis', {
          key: cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (deleted) {
      logger.debug('ETag invalidated', { key: cacheKey });
    }
  }

  /**
   * Invalidate all entries for a spreadsheet
   *
   * Called after mutations to ensure fresh data on next read.
   * Clears from both L1 (memory) and L2 (Redis)
   */
  async invalidateSpreadsheet(spreadsheetId: string): Promise<void> {
    let count = 0;

    // Invalidate L1 (memory)
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${spreadsheetId}:`)) {
        this.cache.delete(key);
        count++;
      }
    }

    // Invalidate L2 (Redis)
    if (this.redis) {
      try {
        const pattern = `${REDIS_KEY_PREFIX}${spreadsheetId}:*`;
        const keys = await scanRedisKeys(this.redis, pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          logger.debug('Invalidated spreadsheet ETags from Redis', {
            spreadsheetId,
            redisCount: keys.length,
          });
        }
      } catch (error) {
        logger.warn('Failed to invalidate spreadsheet ETags from Redis', {
          spreadsheetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (count > 0) {
      logger.debug('Invalidated spreadsheet ETags', { spreadsheetId, count });
    }
  }

  /**
   * Get all cache keys for a spreadsheet
   *
   * Returns array of cache key strings that can be used with selective invalidation.
   *
   * @param spreadsheetId - Spreadsheet ID
   * @returns Array of cache keys (e.g., ['spreadsheetId:metadata', 'spreadsheetId:values:A1:B10'])
   */
  async getKeysForSpreadsheet(spreadsheetId: string): Promise<string[]> {
    const keys: string[] = [];

    // Get from L1 (memory)
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${spreadsheetId}:`)) {
        keys.push(key);
      }
    }

    // Get from L2 (Redis) if available
    if (this.redis) {
      try {
        const pattern = `${REDIS_KEY_PREFIX}${spreadsheetId}:*`;
        const redisKeys = await scanRedisKeys(this.redis, pattern);
        // Strip Redis prefix to get actual cache keys
        const cacheKeys = redisKeys.map((k: string) => k.replace(REDIS_KEY_PREFIX, ''));
        // Merge with L1 keys (deduplicate)
        for (const key of cacheKeys) {
          if (!keys.includes(key)) {
            keys.push(key);
          }
        }
      } catch (error) {
        logger.warn('Failed to get keys from Redis', {
          spreadsheetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return keys;
  }

  /**
   * Invalidate a specific cache key by string
   *
   * Used by selective cache invalidation to invalidate matched keys.
   *
   * @param cacheKey - Full cache key string (e.g., 'spreadsheetId:metadata')
   */
  async invalidateKey(cacheKey: string): Promise<void> {
    // Invalidate L1 (memory)
    this.cache.delete(cacheKey);

    // Invalidate L2 (Redis)
    if (this.redis) {
      try {
        const redisKey = `${REDIS_KEY_PREFIX}${cacheKey}`;
        await this.redis.del(redisKey);
      } catch (error) {
        logger.warn('Failed to invalidate key from Redis', {
          key: cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.debug('Cache key invalidated', { key: cacheKey });
  }

  /**
   * Clear all cached ETags
   */
  clear(): void {
    this.cache.clear();
    logger.debug('ETag cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    maxAge: number;
    redisAvailable: boolean;
    entries: Array<{ key: string; age: number }>;
  } {
    const now = Date.now();
    const entries: Array<{ key: string; age: number }> = [];
    for (const key of this.cache.keys()) {
      const entry = this.cache.peek(key);
      if (entry) {
        entries.push({ key, age: now - entry.cachedAt });
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      maxAge: this.maxAge,
      redisAvailable: !!this.redis,
      entries,
    };
  }
}

// Singleton instance
let instance: ETagCache | null = null;

/**
 * Get ETag cache singleton
 */
export function getETagCache(): ETagCache {
  if (!instance) {
    instance = new ETagCache({
      maxAge: 5 * 60 * 1000, // 5 minutes
      maxSize: getDefaultMaxEntries(),
      // Redis initialized via initETagCache() if needed
    });
  }
  return instance;
}

/**
 * Initialize ETag cache with Redis support
 *
 * Call this during server startup to enable distributed caching.
 * Must be called before getETagCache() to take effect.
 */
export function initETagCache(redis?: RedisClient): ETagCache {
  instance = new ETagCache({
    maxAge: 5 * 60 * 1000, // 5 minutes
    maxSize: getDefaultMaxEntries(),
    redis,
  });
  return instance;
}

/**
 * Reset ETag cache (for testing)
 */
export function resetETagCache(): void {
  instance = null;
}
