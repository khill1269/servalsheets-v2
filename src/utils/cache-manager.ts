/**
 * Cache Manager Service
 *
 * Provides intelligent caching for frequently accessed data
 * to reduce API calls and improve response times.
 *
 * Features:
 * - TTL-based expiration (configurable per entry)
 * - Automatic cache invalidation
 * - Memory-efficient storage with size limits
 * - Namespace support for organization
 * - Cache statistics and monitoring
 *
 * Environment Variables:
 * - CACHE_ENABLED: 'true' to enable caching (default: true)
 * - CACHE_DEFAULT_TTL: Default TTL in ms (default: 300000 = 5min)
 * - CACHE_MAX_SIZE: Max cache size in MB (default: 100)
 * - CACHE_CLEANUP_INTERVAL: Cleanup interval in ms (default: 300000 = 5min)
 *
 * Note: For multi-instance Redis caching, use cache-store.ts and cache-factory.ts
 */

import { logger } from './logger.js';
import { ValidationError } from '../core/errors.js';

// Minimal structural interface — avoids importing from services/ which creates
// a circular dependency chain through the observability layer (G3 fix).
interface RequestMerger {
  readonly enabled: boolean;
}

export interface CacheEntry<T = unknown> {
  value: T;
  expires: number;
  size: number;
  namespace?: string;
}

export interface ParsedRange {
  sheetName: string | null;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface CacheOptions {
  /** TTL in milliseconds (default: 5 minutes) */
  ttl?: number;

  /** Namespace for organizing cache entries */
  namespace?: string;
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  oldestEntry: number | null;
  newestEntry: number | null;
  byNamespace: Record<string, number>;
}

/**
 * Cache Manager
 * Manages cache with TTL, size limits, and multi-instance support
 */
export class CacheManager {
  private cache: Map<string, CacheEntry>;
  private cleanupTimer?: NodeJS.Timeout;
  private rangeDependencies: Map<string, Set<string>>; // spreadsheetId:range -> cache keys
  private requestMerger?: RequestMerger;

  // Configuration
  private readonly enabled: boolean;
  private readonly defaultTTL: number;
  private readonly maxSizeBytes: number;
  private readonly cleanupInterval: number;

  // Statistics
  private hits = 0;
  private misses = 0;
  private _totalSizeBytes = 0; // Running counter — avoids O(N) full-scan on every set()

  constructor(
    options: {
      enabled?: boolean;
      defaultTTL?: number;
      maxSizeMB?: number;
      cleanupInterval?: number;
    } = {}
  ) {
    this.cache = new Map();
    this.rangeDependencies = new Map();

    const envEnabled = process.env['CACHE_ENABLED'];
    const isTestEnv = process.env['NODE_ENV'] === 'test';
    this.enabled =
      options.enabled ?? (envEnabled !== undefined ? envEnabled !== 'false' : !isTestEnv);
    this.defaultTTL =
      options.defaultTTL ?? parseInt(process.env['CACHE_DEFAULT_TTL'] || '300000', 10);
    this.maxSizeBytes =
      (options.maxSizeMB ?? parseInt(process.env['CACHE_MAX_SIZE'] || '100', 10)) * 1024 * 1024;
    this.cleanupInterval =
      options.cleanupInterval ?? parseInt(process.env['CACHE_CLEANUP_INTERVAL'] || '300000', 10);

    if (this.enabled) {
      logger.info('Cache manager initialized', {
        defaultTTL: `${this.defaultTTL}ms`,
        maxSize: `${(this.maxSizeBytes / 1024 / 1024).toFixed(0)}MB`,
        cleanupInterval: `${this.cleanupInterval}ms`,
      });
    } else {
      logger.info('Cache manager disabled');
    }
  }

  /**
   * Start periodic cleanup task
   */
  startCleanupTask(): void {
    if (this.cleanupTimer || !this.enabled) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    // Don't keep process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    logger.debug('Cache cleanup task started', {
      intervalMs: this.cleanupInterval,
    });
  }

  /**
   * Stop periodic cleanup task
   */
  stopCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      logger.debug('Cache cleanup task stopped');
    }
  }

  /**
   * Get a value from cache
   */
  get<T>(key: string, namespace?: string): T | undefined {
    if (!this.enabled) {
      this.misses++;
      // OK: Explicit empty - typed as optional, cache disabled
      return undefined;
    }

    const cacheKey = this.buildKey(key, namespace);
    const entry = this.cache.get(cacheKey) as CacheEntry<T> | undefined;

    if (!entry) {
      this.misses++;
      // OK: Explicit empty - typed as optional, cache miss
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expires) {
      this._totalSizeBytes -= entry.size;
      this.cache.delete(cacheKey);
      this.misses++;
      logger.debug('Cache entry expired', { key, namespace });
      return undefined;
    }

    this.hits++;
    logger.debug('Cache hit', { key, namespace });
    return entry.value;
  }

  /**
   * Set a value in cache
   */
  set<T>(key: string, value: T, options: CacheOptions = {}): void {
    if (!this.enabled) {
      return;
    }

    const cacheKey = this.buildKey(key, options.namespace);
    const ttl = options.ttl ?? this.defaultTTL;
    const size = this.estimateSize(value);

    // Check if adding this entry would exceed max size
    const currentSize = this.getTotalSize();
    if (currentSize + size > this.maxSizeBytes) {
      logger.warn('Cache size limit approaching, cleaning up', {
        currentSize: `${(currentSize / 1024 / 1024).toFixed(2)}MB`,
        maxSize: `${(this.maxSizeBytes / 1024 / 1024).toFixed(0)}MB`,
      });
      this.evictOldest();
    }

    // Subtract existing entry size if overwriting
    const existing = this.cache.get(cacheKey);
    if (existing) {
      this._totalSizeBytes -= existing.size;
    }

    const entry: CacheEntry<T> = {
      value,
      expires: Date.now() + ttl,
      size,
      namespace: options.namespace,
    };

    this.cache.set(cacheKey, entry);
    this._totalSizeBytes += size;
    logger.debug('Cache entry set', {
      key,
      namespace: options.namespace,
      ttl,
      size: `${(size / 1024).toFixed(2)}KB`,
    });
  }

  /**
   * Delete a value from cache
   */
  delete(key: string, namespace?: string): boolean {
    const cacheKey = this.buildKey(key, namespace);
    const entry = this.cache.get(cacheKey);
    const deleted = this.cache.delete(cacheKey);

    if (deleted && entry) {
      this._totalSizeBytes -= entry.size;
      logger.debug('Cache entry deleted', { key, namespace });
    }

    return deleted;
  }

  /**
   * Check if a key exists in cache
   */
  has(key: string, namespace?: string): boolean {
    const cacheKey = this.buildKey(key, namespace);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expires) {
      this.cache.delete(cacheKey);
      return false;
    }

    return true;
  }

  /**
   * Get or set a value in cache
   * If the key exists and is not expired, returns the cached value
   * Otherwise, calls the factory function and caches the result
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = this.get<T>(key, options.namespace);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, options);
    return value;
  }

  /**
   * Invalidate all entries matching a pattern
   */
  invalidatePattern(pattern: RegExp | string, namespace?: string): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const [key, entry] of this.cache) {
      const matches = regex.test(key);
      const inNamespace = !namespace || key.startsWith(`${namespace}:`);

      if (matches && inNamespace) {
        this._totalSizeBytes -= entry.size;
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      logger.debug('Cache pattern invalidated', {
        pattern: pattern.toString(),
        namespace,
        count,
      });
    }

    return count;
  }

  /**
   * Clear all cache entries in a namespace
   */
  clearNamespace(namespace: string): number {
    let count = 0;
    const prefix = `${namespace}:`;

    for (const [key, entry] of this.cache) {
      if (key.startsWith(prefix)) {
        this._totalSizeBytes -= entry.size;
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      logger.debug('Cache namespace cleared', { namespace, count });
    }

    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const count = this.cache.size;
    this.cache.clear();
    this._totalSizeBytes = 0;
    logger.debug('Cache cleared', { entriesCleared: count });
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    let expired = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expires) {
        this._totalSizeBytes -= entry.size;
        this.cache.delete(key);
        expired++;
      }
    }

    if (expired > 0) {
      logger.debug('Cache cleanup completed', {
        expired,
        remaining: this.cache.size,
      });
    }
  }

  /**
   * Get cache entries that are expiring soon
   * @param thresholdMs Time threshold in milliseconds (entries expiring within this time)
   * @param namespace Optional namespace filter
   * @returns Array of cache keys that are expiring soon
   */
  getExpiringEntries(
    thresholdMs: number,
    namespace?: string
  ): Array<{ key: string; expiresIn: number }> {
    const now = Date.now();
    const expiringThreshold = now + thresholdMs;
    const expiring: Array<{ key: string; expiresIn: number }> = [];

    for (const [key, entry] of this.cache) {
      // Skip if namespace filter provided and doesn't match
      if (namespace && entry.namespace !== namespace) {
        continue;
      }

      // Check if entry is expiring soon (but not already expired)
      if (entry.expires > now && entry.expires <= expiringThreshold) {
        expiring.push({
          key,
          expiresIn: entry.expires - now,
        });
      }
    }

    return expiring;
  }

  /**
   * Evict oldest entries to free up space
   */
  private evictOldest(): void {
    // Remove oldest 10% of entries
    const countToRemove = Math.max(1, Math.ceil(this.cache.size * 0.1));

    const sortedByExpiry = Array.from(this.cache.entries())
      .sort((a, b) => a[1].expires - b[1].expires)
      .slice(0, countToRemove);

    sortedByExpiry.forEach(([key, entry]) => {
      this._totalSizeBytes -= entry.size;
      this.cache.delete(key);
    });

    logger.debug('Evicted oldest cache entries', {
      removed: countToRemove,
      remaining: this.cache.size,
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalSize = this._totalSizeBytes;
    let oldestExpiry: number | null = null;
    let newestExpiry: number | null = null;
    const byNamespace: Record<string, number> = {};

    for (const [, entry] of this.cache) {
      if (oldestExpiry === null || entry.expires < oldestExpiry) {
        oldestExpiry = entry.expires;
      }
      if (newestExpiry === null || entry.expires > newestExpiry) {
        newestExpiry = entry.expires;
      }

      const ns = entry.namespace || 'default';
      byNamespace[ns] = (byNamespace[ns] || 0) + 1;
    }

    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0;

    return {
      totalEntries: this.cache.size,
      totalSize,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      oldestEntry: oldestExpiry,
      newestEntry: newestExpiry,
      byNamespace,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Set request merger for read optimization
   * @param merger RequestMerger instance
   */
  setRequestMerger(merger: RequestMerger): void {
    this.requestMerger = merger;
    logger.info('RequestMerger attached to CacheManager');
  }

  /**
   * Get request merger if configured
   */
  getRequestMerger(): RequestMerger | undefined {
    return this.requestMerger;
  }

  /**
   * Build a cache key with optional namespace
   */
  private buildKey(key: string, namespace?: string): string {
    return namespace ? `${namespace}:${key}` : key;
  }

  /**
   * Estimate the size of a value in bytes
   */
  private estimateSize(value: unknown): number {
    try {
      // Accurate UTF-8 byte length calculation
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch (error) {
      logger.warn('Failed to estimate cache entry size, using default', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback to a conservative estimate
      return 1024; // 1KB default
    }
  }

  /**
   * Get total cache size in bytes (O(1) via running counter)
   */
  private getTotalSize(): number {
    return this._totalSizeBytes;
  }

  /**
   * Track range dependency for cache invalidation
   * Associates a cache key with a spreadsheet range
   */
  trackRangeDependency(spreadsheetId: string, range: string, cacheKey: string): void {
    // Cap total tracked range dependencies to prevent unbounded memory growth
    const MAX_RANGE_DEPENDENCIES = 10_000;
    if (this.rangeDependencies.size >= MAX_RANGE_DEPENDENCIES) {
      // Evict oldest entries (Maps iterate in insertion order)
      const toEvict = Math.floor(MAX_RANGE_DEPENDENCIES * 0.1); // evict 10%
      let evicted = 0;
      for (const key of this.rangeDependencies.keys()) {
        if (evicted >= toEvict) break;
        this.rangeDependencies.delete(key);
        evicted++;
      }
    }
    const depKey = `${spreadsheetId}:${range}`;
    if (!this.rangeDependencies.has(depKey)) {
      this.rangeDependencies.set(depKey, new Set());
    }
    this.rangeDependencies.get(depKey)!.add(cacheKey);
  }

  /**
   * Invalidate cache entries for a specific range
   * Only invalidates overlapping ranges, not the entire spreadsheet
   */
  invalidateRange(spreadsheetId: string, range: string): number {
    const affected = this.findOverlappingRanges(spreadsheetId, range);
    let count = 0;

    const invalidatedRanges: string[] = [];

    for (const affectedRange of affected) {
      const depKey = `${spreadsheetId}:${affectedRange}`;
      const deps = this.rangeDependencies.get(depKey);
      if (deps) {
        const keysInvalidated = deps.size;
        for (const cacheKey of deps) {
          const cacheEntry = this.cache.get(cacheKey);
          if (this.cache.delete(cacheKey)) {
            if (cacheEntry) this._totalSizeBytes -= cacheEntry.size;
            count++;
          }
        }
        this.rangeDependencies.delete(depKey);
        if (keysInvalidated > 0) {
          invalidatedRanges.push(`${affectedRange} (${keysInvalidated} keys)`);
        }
      }
    }

    if (count > 0) {
      logger.debug('Range-specific cache invalidation', {
        spreadsheetId,
        writeRange: range,
        keysInvalidated: count,
        rangesAffected: affected.length,
        invalidatedRanges,
      });
    } else {
      logger.debug('No cache entries to invalidate', {
        spreadsheetId,
        writeRange: range,
        checkedRanges: affected.length,
      });
    }

    return count;
  }

  /**
   * Find ranges that overlap with the given range
   * Uses precise intersection algorithm to minimize false positives
   */
  private findOverlappingRanges(spreadsheetId: string, range: string): string[] {
    const overlapping: string[] = [];

    // Check all tracked ranges for overlaps
    for (const depKey of this.rangeDependencies.keys()) {
      // Parse depKey format: "spreadsheetId:range"
      const parts = depKey.split(':');
      if (parts.length < 2) continue;

      const depSpreadsheetId = parts[0];
      if (depSpreadsheetId !== spreadsheetId) continue;

      // Reconstruct the range (handle cases where range contains ":")
      const existingRange = parts.slice(1).join(':');

      // Check if ranges overlap using precise intersection
      if (this.rangesOverlap(range, existingRange)) {
        overlapping.push(existingRange);
      }
    }

    // If no specific overlaps found but range has exact match, include it
    if (overlapping.length === 0) {
      const exactMatchKey = `${spreadsheetId}:${range}`;
      if (this.rangeDependencies.has(exactMatchKey)) {
        overlapping.push(range);
      }
    }

    return overlapping;
  }

  /**
   * Check if two A1 ranges overlap
   * Uses precise range intersection algorithm
   */
  private rangesOverlap(range1: string, range2: string): boolean {
    if (range1 === range2) return true;

    try {
      const parsed1 = this.parseA1Notation(range1);
      const parsed2 = this.parseA1Notation(range2);

      return this.rangesIntersect(parsed1, parsed2);
    } catch (error) {
      // Fallback to conservative behavior if parsing fails
      logger.warn('Failed to parse A1 notation for overlap check', {
        range1,
        range2,
        error,
      });
      return true; // Conservative: assume overlap if can't parse
    }
  }

  /**
   * Parse A1 notation into structured range
   * Handles: A1, A:A, 1:1, A1:B10, Sheet!A1:B10, 'Sheet Name'!A1:B10
   */
  private parseA1Notation(range: string): ParsedRange {
    let sheetName: string | null = null;
    let cellRange = range;

    // Extract sheet name if present
    if (range.includes('!')) {
      const parts = range.split('!');
      if (parts.length === 2 && parts[0] && parts[1]) {
        sheetName = parts[0];
        cellRange = parts[1];
        // Remove quotes from sheet name if present
        if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
          sheetName = sheetName.slice(1, -1);
        }
      }
    }

    // Handle special cases
    if (!cellRange || cellRange.trim() === '') {
      // Just sheet name - entire sheet
      return {
        sheetName,
        startRow: 1,
        startCol: 1,
        endRow: Infinity,
        endCol: Infinity,
      };
    }

    // Check for column range (A:A or A:Z)
    const colRangeMatch = cellRange.match(/^([A-Z]+):([A-Z]+)$/);
    if (colRangeMatch) {
      const startCol = this.columnToNumber(colRangeMatch[1]!);
      const endCol = this.columnToNumber(colRangeMatch[2]!);
      return {
        sheetName,
        startRow: 1,
        startCol,
        endRow: Infinity,
        endCol,
      };
    }

    // Check for row range (1:1 or 1:100)
    const rowRangeMatch = cellRange.match(/^(\d+):(\d+)$/);
    if (rowRangeMatch) {
      return {
        sheetName,
        startRow: parseInt(rowRangeMatch[1]!, 10),
        startCol: 1,
        endRow: parseInt(rowRangeMatch[2]!, 10),
        endCol: Infinity,
      };
    }

    // Parse cell range (A1 or A1:B10)
    const rangeParts = cellRange.split(':');
    if (rangeParts.length === 1) {
      // Single cell
      const cell = this.parseCell(rangeParts[0]!);
      return {
        sheetName,
        startRow: cell.row,
        startCol: cell.col,
        endRow: cell.row,
        endCol: cell.col,
      };
    } else if (rangeParts.length === 2) {
      // Range
      const start = this.parseCell(rangeParts[0]!);
      const end = this.parseCell(rangeParts[1]!);
      return {
        sheetName,
        startRow: Math.min(start.row, end.row),
        startCol: Math.min(start.col, end.col),
        endRow: Math.max(start.row, end.row),
        endCol: Math.max(start.col, end.col),
      };
    }

    throw new ValidationError(`Invalid A1 notation: ${range}`, 'range', 'Sheet1!A1:B10');
  }

  /**
   * Parse a single cell reference like "A1" into row and column numbers
   */
  private parseCell(cell: string): { row: number; col: number } {
    const match = cell.match(/^([A-Z]+)(\d+)$/);
    if (!match) {
      throw new ValidationError(`Invalid cell reference: ${cell}`, 'cell', 'A1');
    }

    const col = this.columnToNumber(match[1]!);
    const row = parseInt(match[2]!, 10);

    return { row, col };
  }

  /**
   * Convert column letter(s) to number (A=1, B=2, ..., Z=26, AA=27, etc.)
   */
  private columnToNumber(col: string): number {
    let result = 0;
    for (let i = 0; i < col.length; i++) {
      result = result * 26 + (col.charCodeAt(i) - 64);
    }
    return result;
  }

  /**
   * Check if two parsed ranges intersect
   */
  private rangesIntersect(range1: ParsedRange, range2: ParsedRange): boolean {
    // Different sheets never intersect
    if (range1.sheetName !== range2.sheetName) {
      return false;
    }

    // Check row intersection
    const rowsIntersect = range1.startRow <= range2.endRow && range1.endRow >= range2.startRow;

    // Check column intersection
    const colsIntersect = range1.startCol <= range2.endCol && range1.endCol >= range2.startCol;

    return rowsIntersect && colsIntersect;
  }
}

/**
 * Global cache manager instance
 */
export const cacheManager = new CacheManager();

/**
 * Helper: Create a cache key for API operations
 */
export function createCacheKey(operation: string, params: Record<string, unknown>): string {
  // Sort keys for consistent hashing
  const sortedKeys = Object.keys(params).sort();
  const serialized = sortedKeys.map((key) => `${key}=${JSON.stringify(params[key])}`).join('&');

  return `${operation}:${serialized}`;
}
