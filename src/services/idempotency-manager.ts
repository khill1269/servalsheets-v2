/**
 * Idempotency Manager
 *
 * Prevents duplicate execution of non-idempotent operations during retries.
 * Uses in-memory LRU cache with TTL for storing operation results.
 *
 * Design:
 * - Client sends X-Idempotency-Key header OR auto-generated for non-idempotent ops
 * - Before execution, check if key was already used
 * - Store result with key + TTL (default 24 hours)
 * - If key exists, return cached result instead of re-executing
 *
 * @category Services
 */

import fs from 'node:fs';
import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger.js';
import { ACTION_METADATA } from '../schemas/action-metadata.js';
import { sanitizeTokenStorePath } from '../utils/auth-paths.js';

/**
 * Path to persist idempotency keys across restarts.
 * When set, entries are loaded on startup and saved on each store.
 * For stateless deployments, use Redis instead (document only).
 * ISSUE-094: prevents duplicate execution after server restart.
 */
const IDEMPOTENCY_STORE_PATH = process.env['IDEMPOTENCY_STORE_PATH'] ?? '';

/**
 * Idempotency key configuration
 */
export interface IdempotencyConfig {
  /** Maximum number of cached results (default: 10000) */
  maxSize?: number;

  /** TTL for cached results in milliseconds (default: 24 hours) */
  ttl?: number;

  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Cached operation result
 */
interface CachedResult {
  /** Operation result (success or error) */
  result: unknown;

  /** Timestamp when cached */
  timestamp: number;

  /** Tool name */
  tool: string;

  /** Action name */
  action: string;

  /** Request fingerprint (for verification) */
  fingerprint: string;
}

/**
 * Idempotency Manager
 *
 * Thread-safe operation result caching to prevent duplicate executions.
 */
export class IdempotencyManager {
  private cache: LRUCache<string, CachedResult>;
  private config: Required<IdempotencyConfig>;

  constructor(config: IdempotencyConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 10000,
      ttl: config.ttl ?? 24 * 60 * 60 * 1000, // 24 hours
      verbose: config.verbose ?? false,
    };

    this.cache = new LRUCache<string, CachedResult>({
      max: this.config.maxSize,
      ttl: this.config.ttl,
      updateAgeOnGet: false,
      updateAgeOnHas: false,
    });

    logger.info('Idempotency Manager initialized', {
      maxSize: this.config.maxSize,
      ttlHours: this.config.ttl / (60 * 60 * 1000),
      persistPath: IDEMPOTENCY_STORE_PATH || '(in-memory only)',
    });

    // ISSUE-094: load persisted keys from disk if IDEMPOTENCY_STORE_PATH is configured
    if (IDEMPOTENCY_STORE_PATH) {
      this.loadFromDisk();
    }
  }

  /** Persist cache snapshot to disk (fire-and-forget, non-blocking). */
  private saveToDisk(): void {
    if (!IDEMPOTENCY_STORE_PATH) return;
    const storePath = sanitizeTokenStorePath(IDEMPOTENCY_STORE_PATH);
    const now = Date.now();
    const entries: Record<string, CachedResult & { expiresAt: number }> = {};
    for (const [key, value] of this.cache.entries()) {
      // Only persist entries that haven't expired
      const age = now - value.timestamp;
      if (age < this.config.ttl) {
        entries[key] = { ...value, expiresAt: value.timestamp + this.config.ttl };
      }
    }
    const data = JSON.stringify(entries);
    fs.writeFile(storePath, data, 'utf8', (err) => {
      if (err) {
        logger.warn('Failed to persist idempotency keys to disk', {
          path: storePath,
          error: err.message,
        });
      }
    });
  }

  /** Load previously persisted keys from disk, evicting any that have expired. */
  private loadFromDisk(): void {
    const storePath = sanitizeTokenStorePath(IDEMPOTENCY_STORE_PATH);
    try {
      if (!fs.existsSync(storePath)) return;
      const raw = fs.readFileSync(storePath, 'utf8');
      const entries = JSON.parse(raw) as Record<string, CachedResult & { expiresAt: number }>;
      const now = Date.now();
      let loaded = 0;
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.expiresAt > now) {
          const { expiresAt: _, ...cached } = entry;
          // Use remaining TTL so the cache entry expires at the right time
          const remainingTtl = entry.expiresAt - now;
          this.cache.set(key, cached, { ttl: remainingTtl });
          loaded++;
        }
      }
      logger.info('Loaded persisted idempotency keys', {
        loaded,
        total: Object.keys(entries).length,
        path: storePath,
      });
    } catch (err) {
      logger.warn('Failed to load persisted idempotency keys', {
        path: storePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Check if operation is idempotent
   *
   * @param tool - Tool name
   * @param action - Action name
   * @returns True if operation is safe to retry without side effects
   */
  isIdempotent(tool: string, action: string): boolean {
    const metadata = ACTION_METADATA[tool]?.[action];
    return metadata?.idempotent ?? false;
  }

  /**
   * Check if idempotency key exists and return cached result
   *
   * @param key - Idempotency key
   * @param tool - Tool name (for logging)
   * @param action - Action name (for logging)
   * @param fingerprint - Request fingerprint (for verification)
   * @returns Cached result if exists and fingerprint matches, undefined otherwise
   */
  getCachedResult(
    key: string,
    tool: string,
    action: string,
    fingerprint: string
  ): unknown | undefined {
    const cached = this.cache.get(key);

    if (!cached) {
      return undefined;
    }

    // Verify fingerprint to prevent key collision attacks
    if (cached.fingerprint !== fingerprint) {
      logger.warn('Idempotency key collision detected', {
        key: key.substring(0, 16) + '...',
        tool,
        action,
        cachedTool: cached.tool,
        cachedAction: cached.action,
      });
      return undefined; // key mismatch — not a cache hit
    }

    if (this.config.verbose) {
      logger.debug('Idempotency key cache hit', {
        key: key.substring(0, 16) + '...',
        tool,
        action,
        age: Date.now() - cached.timestamp,
      });
    }

    return cached.result;
  }

  /**
   * Store operation result with idempotency key
   *
   * @param key - Idempotency key
   * @param tool - Tool name
   * @param action - Action name
   * @param fingerprint - Request fingerprint
   * @param result - Operation result to cache
   */
  storeResult(
    key: string,
    tool: string,
    action: string,
    fingerprint: string,
    result: unknown
  ): void {
    const cached: CachedResult = {
      result,
      timestamp: Date.now(),
      tool,
      action,
      fingerprint,
    };

    this.cache.set(key, cached);

    if (this.config.verbose) {
      logger.debug('Idempotency key stored', {
        key: key.substring(0, 16) + '...',
        tool,
        action,
        cacheSize: this.cache.size,
      });
    }

    // ISSUE-094: persist to disk so keys survive server restarts
    this.saveToDisk();
  }

  /**
   * Clear all cached results (for testing)
   */
  clear(): void {
    this.cache.clear();
    logger.info('Idempotency cache cleared');
  }

  /**
   * Get cache statistics
   *
   * @returns Cache size and hit rate metrics
   */
  getStats(): {
    size: number;
    maxSize: number;
    utilizationPercent: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      utilizationPercent: Math.round((this.cache.size / this.config.maxSize) * 100),
    };
  }

  /**
   * Check if key exists in cache
   *
   * @param key - Idempotency key
   * @returns True if key exists
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove specific key from cache
   *
   * @param key - Idempotency key to delete
   */
  delete(key: string): void {
    this.cache.delete(key);
  }
}

/**
 * Global idempotency manager instance
 */
export const idempotencyManager = new IdempotencyManager();

/**
 * Enable verbose idempotency logging
 */
export function enableIdempotencyLogging(): void {
  idempotencyManager['config'].verbose = true;
  logger.info('Idempotency verbose logging enabled');
}

/**
 * Disable verbose idempotency logging
 */
export function disableIdempotencyLogging(): void {
  idempotencyManager['config'].verbose = false;
  logger.info('Idempotency verbose logging disabled');
}
