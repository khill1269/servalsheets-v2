/**
 * Session Store Interface
 *
 * Provides abstraction for session/token storage with TTL support.
 * Implementations: in-memory (development), Redis (production)
 */

import type { RedisClientType } from 'redis';
import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';
import { LRUCache } from 'lru-cache';

/**
 * Session store interface for storing temporary data with TTL
 */
export interface SessionStore {
  /**
   * Store a value with TTL (time-to-live)
   * @param key Unique identifier for the value
   * @param value Value to store (will be JSON serialized)
   * @param options TTL options - can be number (seconds) or object with ttlMs
   */
  set(key: string, value: unknown, options?: number | { ttlMs: number }): Promise<void>;

  /**
   * Retrieve a value by key
   * @param key Unique identifier
   * @returns Value if found and not expired, undefined otherwise
   */
  get(key: string): Promise<unknown | undefined>;

  /**
   * Delete a value by key
   * @param key Unique identifier
   * @returns true if deleted, false if key didn't exist
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists
   * @param key Unique identifier
   * @returns true if key exists and not expired
   */
  has(key: string): Promise<boolean>;

  /**
   * Get all keys matching a pattern (optional, for debugging)
   * @param pattern Optional glob pattern (e.g., "session:*")
   */
  keys?(pattern?: string): Promise<string[]>;

  /**
   * Clean up expired entries (for in-memory implementations)
   * Returns number of entries removed (optional)
   */
  cleanup(): Promise<void | number>;

  /**
   * Get store statistics (optional, for monitoring)
   */
  stats?(): Promise<{
    totalKeys: number;
    memoryUsage?: number;
  }>;
}

/**
 * In-memory session store with TTL and LRU eviction
 * Suitable for development and single-instance deployments
 * Uses LRU cache to prevent unbounded memory growth
 */
export class InMemorySessionStore implements SessionStore {
  private store: LRUCache<string, { value: unknown; expires: number }>;
  private cleanupInterval: NodeJS.Timeout;

  constructor(cleanupIntervalMs: number = 60000) {
    // Initialize LRU cache with bounded size (prevents memory leaks)
    // Note: LRU provides max size enforcement, but we still track custom expires per entry
    this.store = new LRUCache<string, { value: unknown; expires: number }>({
      max: 10000, // Maximum 10000 session entries (prevents unbounded growth)
      ttl: undefined, // Don't use LRU TTL (we manage expires manually)
      updateAgeOnGet: true, // LRU behavior: refresh access time
      noUpdateTTL: true, // Don't auto-update TTL on set
    });

    // Cleanup expired entries every minute by default
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch(console.error);
    }, cleanupIntervalMs);
  }

  async set(key: string, value: unknown, options?: number | { ttlMs: number }): Promise<void> {
    // Handle both number (seconds) and object ({ ttlMs }) formats
    let ttlMs: number;
    if (typeof options === 'number') {
      ttlMs = options * 1000; // Convert seconds to milliseconds
    } else if (options && typeof options === 'object' && 'ttlMs' in options) {
      ttlMs = options.ttlMs;
    } else {
      ttlMs = 3600000; // 1 hour default
    }

    this.store.set(key, {
      value,
      expires: Date.now() + ttlMs,
    });
  }

  async get(key: string): Promise<unknown | undefined> {
    const entry = this.store.get(key);

    if (!entry) {
      // OK: Explicit empty - typed as optional, cache miss
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      // OK: Explicit empty - typed as optional, expired entry
      return undefined;
    }

    return entry.value;
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed;
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());

    if (!pattern) {
      return allKeys;
    }

    // Simple glob pattern matching (supports * wildcard)
    // Escape regex special chars before converting glob * to .*
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    return allKeys.filter((key) => regex.test(key));
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expires) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.store.delete(key);
    }

    if (keysToDelete.length > 0) {
      logger.info('Session store cleanup completed', {
        expiredEntries: keysToDelete.length,
        remainingKeys: this.store.size,
        cleanupTimestamp: new Date().toISOString(),
      });
    }

    return keysToDelete.length;
  }

  async stats(): Promise<{ totalKeys: number; memoryUsage?: number }> {
    // Rough estimate of memory usage
    let memoryBytes = 0;

    for (const [key, entry] of this.store.entries()) {
      memoryBytes += key.length * 2; // UTF-16 characters
      memoryBytes += JSON.stringify(entry.value).length * 2;
      memoryBytes += 24; // Overhead for Map entry and metadata
    }

    return {
      totalKeys: this.store.size,
      memoryUsage: memoryBytes,
    };
  }

  /**
   * Destroy the store and clean up resources
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

/**
 * Redis-backed session store
 * Suitable for production and multi-instance deployments
 * Requires Redis to be installed and running
 */
export class RedisSessionStore implements SessionStore {
  private client: RedisClientType | null = null;
  private connected: boolean = false;

  constructor(private redisUrl: string) {
    // We'll initialize lazily to avoid requiring Redis in development
  }

  /**
   * Initialize Redis connection (lazy)
   */
  private async ensureConnected(): Promise<RedisClientType> {
    if (this.connected && this.client) {
      return this.client;
    }

    try {
      // Dynamic import to make Redis optional
      // @ts-ignore - Redis is an optional peer dependency
      const { createClient } = await import('redis');

      this.client = createClient({
        url: this.redisUrl,
      });

      this.client.on('error', (err: Error) => {
        console.error('[RedisSessionStore] Redis error:', err);
      });

      await this.client.connect();
      this.connected = true;
      console.error('[RedisSessionStore] Connected to Redis');
      return this.client;
    } catch (error) {
      throw new ServiceError(
        `Failed to connect to Redis at ${this.redisUrl}. ` +
          `Make sure Redis is installed (npm install redis) and running. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        'INTERNAL_ERROR',
        'session-store',
        false
      );
    }
  }

  async set(key: string, value: unknown, options?: number | { ttlMs: number }): Promise<void> {
    const client = await this.ensureConnected();

    // Handle both number (seconds) and object ({ ttlMs }) formats
    let ttlSeconds: number;
    if (typeof options === 'number') {
      ttlSeconds = options;
    } else if (options && typeof options === 'object' && 'ttlMs' in options) {
      ttlSeconds = Math.floor(options.ttlMs / 1000);
    } else {
      ttlSeconds = 3600; // 1 hour default
    }

    const serialized = JSON.stringify(value);
    await client.setEx(key, ttlSeconds, serialized);
  }

  async get(key: string): Promise<unknown | undefined> {
    const client = await this.ensureConnected();

    const data = await client.get(key);

    if (!data) {
      // OK: Explicit empty - typed as optional, cache miss (Redis)
      return undefined;
    }

    try {
      return JSON.parse(data);
    } catch {
      // If parsing fails, return the raw string
      return data;
    }
  }

  async delete(key: string): Promise<boolean> {
    const client = await this.ensureConnected();
    const result = await client.del(key);
    return result > 0; // Redis returns number of keys deleted
  }

  async has(key: string): Promise<boolean> {
    const client = await this.ensureConnected();
    const exists = await client.exists(key);
    return exists === 1;
  }

  async keys(pattern?: string): Promise<string[]> {
    const client = await this.ensureConnected();
    return await client.keys(pattern || '*');
  }

  async cleanup(): Promise<void> {
    // Redis handles TTL automatically, no cleanup needed
  }

  async stats(): Promise<{ totalKeys: number }> {
    const client = await this.ensureConnected();
    const dbSize = await client.dbSize();

    return {
      totalKeys: dbSize,
    };
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.connected && this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }
}

/**
 * Factory function to create appropriate session store
 * @param redisUrl Optional Redis URL. If provided, uses Redis; otherwise in-memory
 */
export function createSessionStore(redisUrl?: string): SessionStore {
  if (redisUrl) {
    console.error('[SessionStore] Using Redis session store');
    return new RedisSessionStore(redisUrl);
  }

  console.error('[SessionStore] Using in-memory session store');
  return new InMemorySessionStore();
}

/**
 * Options for MemorySessionStore (test-compatible interface)
 */
export interface MemorySessionStoreOptions {
  defaultTtlMs?: number;
  maxEntries?: number;
  cleanupIntervalMs?: number;
}

/**
 * Memory-based session store with configurable TTL
 * Compatible with test expectations for defaultTtlMs option
 */
export class MemorySessionStore implements SessionStore {
  private store = new Map<string, { value: unknown; expires: number }>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private defaultTtlMs: number;
  private maxEntries: number;

  constructor(options: MemorySessionStoreOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 3600000; // 1 hour default
    this.maxEntries = options.maxEntries ?? 10000;
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch(console.error);
    }, cleanupIntervalMs);
  }

  async set(key: string, value: unknown, options?: number | { ttlMs: number }): Promise<void> {
    // Enforce max entries limit
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      // Remove oldest entry
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    // Handle both number (seconds) and object ({ ttlMs }) formats
    let ttlMs: number;
    if (typeof options === 'number') {
      ttlMs = options * 1000; // Convert seconds to milliseconds
    } else if (options && typeof options === 'object' && 'ttlMs' in options) {
      ttlMs = options.ttlMs;
    } else {
      ttlMs = this.defaultTtlMs;
    }

    this.store.set(key, {
      value,
      expires: Date.now() + ttlMs,
    });
  }

  async get(key: string): Promise<unknown | undefined> {
    const entry = this.store.get(key);

    if (!entry) {
      // OK: Explicit empty - typed as optional, cache miss
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      // OK: Explicit empty - typed as optional, expired entry
      return undefined;
    }

    return entry.value;
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed;
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());

    if (!pattern) {
      return allKeys;
    }

    // Simple glob pattern matching (supports * wildcard)
    // Escape regex special chars before converting glob * to .*
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    return allKeys.filter((key) => regex.test(key));
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expires) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.store.delete(key);
    }

    return keysToDelete.length;
  }

  async stats(): Promise<{ totalKeys: number; memoryUsage?: number }> {
    let memoryBytes = 0;

    for (const [key, entry] of this.store.entries()) {
      memoryBytes += key.length * 2;
      memoryBytes += JSON.stringify(entry.value).length * 2;
      memoryBytes += 24;
    }

    return {
      totalKeys: this.store.size,
      memoryUsage: memoryBytes,
    };
  }

  /**
   * Get size of the store (method for test compatibility)
   */
  async size(): Promise<number> {
    return this.store.size;
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    this.store.clear();
  }

  /**
   * Destroy the store and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}
