/**
 * SchemaCache
 *
 * @purpose Persistent file-based cache for Google API Discovery schemas to reduce Discovery API calls and improve startup (30-day TTL)
 * @category Performance
 * @usage Use for schema validation and API discovery; caches sheets/drive schemas locally, automatic invalidation after 30 days
 * @dependencies fs (node:fs/promises), path, logger, DiscoverySchema
 * @stateful Yes - maintains file-based cache in ~/.servalsheets/cache/, tracks schema age and hit/miss stats
 * @singleton Yes - one instance per process to coordinate cache access
 *
 * @example
 * const cache = new SchemaCache({ cacheDir: '~/.servalsheets/cache', ttlDays: 30 });
 * const schema = await cache.get('sheets', 'v4'); // Returns cached or null
 * await cache.set('sheets', 'v4', discoveredSchema);
 * await cache.cleanup(); // Remove expired schemas
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import type { DiscoverySchema } from './discovery-client.js';

/**
 * Cached schema with metadata
 */
export interface CachedSchema {
  api: 'sheets' | 'drive';
  version: string;
  schema: DiscoverySchema;
  fetchedAt: number;
  expiresAt: number;
}

/**
 * Schema Cache Configuration
 */
export interface SchemaCacheConfig {
  cacheDir?: string;
  defaultTTL?: number;
}

/**
 * Schema Cache Layer
 *
 * Provides persistent file-based caching for Discovery API schemas.
 */
export class SchemaCache {
  private readonly cacheDir: string;
  private readonly defaultTTL: number;
  private initialized: boolean = false;

  constructor(config: SchemaCacheConfig = {}) {
    this.cacheDir =
      config.cacheDir ?? process.env['SERVALSHEETS_SCHEMA_CACHE_DIR'] ?? '.discovery-cache';
    this.defaultTTL = config.defaultTTL ?? 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Ensure cache directory exists (lazy initialization)
   */
  private async ensureCacheDir(): Promise<void> {
    if (this.initialized) return;

    if (!existsSync(this.cacheDir)) {
      await fs.mkdir(this.cacheDir, { recursive: true });
      logger.info('Created schema cache directory', { cacheDir: this.cacheDir });
    }
    this.initialized = true;
  }

  /**
   * Get cached schema if available and not expired
   */
  async get(api: string, version: string): Promise<DiscoverySchema | null> {
    const cacheFile = this.getCacheFilePath(api, version);

    if (!existsSync(cacheFile)) {
      logger.debug('Cache miss: file not found', { api, version });
      return null;
    }

    try {
      const content = await fs.readFile(cacheFile, 'utf-8');
      const cached = JSON.parse(content) as CachedSchema;

      // Check if expired
      if (Date.now() > cached.expiresAt) {
        logger.debug('Cache miss: schema expired', {
          api,
          version,
          expiresAt: new Date(cached.expiresAt).toISOString(),
        });
        // Clean up expired cache
        await this.invalidate(api, version);
        return null;
      }

      logger.debug('Cache hit: schema found and valid', {
        api,
        version,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });

      return cached.schema;
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.warn('Failed to read cached schema', {
        api,
        version,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Store schema in cache
   */
  async set(api: string, version: string, schema: DiscoverySchema, ttl?: number): Promise<void> {
    await this.ensureCacheDir();

    const cacheFile = this.getCacheFilePath(api, version);
    const now = Date.now();
    const cacheTTL = ttl ?? this.defaultTTL;

    const cached: CachedSchema = {
      api: api as 'sheets' | 'drive',
      version,
      schema,
      fetchedAt: now,
      expiresAt: now + cacheTTL,
    };

    try {
      await fs.writeFile(cacheFile, JSON.stringify(cached, null, 2), 'utf-8');
      logger.info('Cached schema', {
        api,
        version,
        expiresAt: new Date(cached.expiresAt).toISOString(),
        size: Buffer.byteLength(JSON.stringify(cached)),
      });
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error('Failed to cache schema', {
        api,
        version,
        error: err.message,
      });
    }
  }

  /**
   * Invalidate (delete) a cached schema
   */
  async invalidate(api: string, version: string): Promise<void> {
    const cacheFile = this.getCacheFilePath(api, version);

    if (existsSync(cacheFile)) {
      try {
        await fs.unlink(cacheFile);
        logger.info('Invalidated cached schema', { api, version });
      } catch (error: unknown) {
        const err = error as { message?: string };
        logger.warn('Failed to invalidate cached schema', {
          api,
          version,
          error: err.message,
        });
      }
    }
  }

  /**
   * Invalidate all cached schemas
   */
  async invalidateAll(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      return;
    }

    try {
      const files = await fs.readdir(this.cacheDir);
      let deleted = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(join(this.cacheDir, file));
          deleted++;
        }
      }

      logger.info('Invalidated all cached schemas', { count: deleted });
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error('Failed to invalidate all cached schemas', {
        error: err.message,
      });
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpired(): Promise<number> {
    if (!existsSync(this.cacheDir)) {
      return 0;
    }

    const now = Date.now();
    let cleaned = 0;

    try {
      const files = await fs.readdir(this.cacheDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = join(this.cacheDir, file);

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const cached = JSON.parse(content) as CachedSchema;

          if (now > cached.expiresAt) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch {
          // Skip invalid files
        }
      }

      if (cleaned > 0) {
        logger.info('Cleaned up expired cache entries', { count: cleaned });
      }

      return cleaned;
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error('Failed to cleanup expired cache', { error: err.message });
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    entries: number;
    totalSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    expiredEntries: number;
  }> {
    if (!existsSync(this.cacheDir)) {
      return {
        entries: 0,
        totalSize: 0,
        oldestEntry: null,
        newestEntry: null,
        expiredEntries: 0,
      };
    }

    const now = Date.now();
    let entries = 0;
    let totalSize = 0;
    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;
    let expiredEntries = 0;

    try {
      const files = await fs.readdir(this.cacheDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = join(this.cacheDir, file);

        try {
          const stats = await fs.stat(filePath);
          totalSize += stats.size;

          const content = await fs.readFile(filePath, 'utf-8');
          const cached = JSON.parse(content) as CachedSchema;

          entries++;

          if (now > cached.expiresAt) {
            expiredEntries++;
          }

          if (oldestEntry === null || cached.fetchedAt < oldestEntry) {
            oldestEntry = cached.fetchedAt;
          }

          if (newestEntry === null || cached.fetchedAt > newestEntry) {
            newestEntry = cached.fetchedAt;
          }
        } catch {
          // Skip invalid files
        }
      }

      return {
        entries,
        totalSize,
        oldestEntry,
        newestEntry,
        expiredEntries,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error('Failed to get cache stats', { error: err.message });
      return {
        entries: 0,
        totalSize: 0,
        oldestEntry: null,
        newestEntry: null,
        expiredEntries: 0,
      };
    }
  }

  /**
   * List all cached schemas
   */
  async list(): Promise<
    Array<{ api: string; version: string; fetchedAt: number; expiresAt: number; expired: boolean }>
  > {
    if (!existsSync(this.cacheDir)) {
      return [];
    }

    const now = Date.now();
    const cached: Array<{
      api: string;
      version: string;
      fetchedAt: number;
      expiresAt: number;
      expired: boolean;
    }> = [];

    try {
      const files = await fs.readdir(this.cacheDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = join(this.cacheDir, file);

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const schema = JSON.parse(content) as CachedSchema;

          cached.push({
            api: schema.api,
            version: schema.version,
            fetchedAt: schema.fetchedAt,
            expiresAt: schema.expiresAt,
            expired: now > schema.expiresAt,
          });
        } catch {
          // Skip invalid files
        }
      }

      return cached.sort((a, b) => b.fetchedAt - a.fetchedAt);
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error('Failed to list cached schemas', { error: err.message });
      return [];
    }
  }

  /**
   * Get cache file path for an API schema
   */
  private getCacheFilePath(api: string, version: string): string {
    return join(this.cacheDir, `${api}-${version}.json`);
  }
}

/**
 * Global schema cache instance
 */
let globalSchemaCache: SchemaCache | null = null;

/**
 * Get or create global schema cache
 */
export function getSchemaCache(): SchemaCache {
  if (!globalSchemaCache) {
    globalSchemaCache = new SchemaCache();
  }
  return globalSchemaCache;
}

/**
 * Reset global schema cache
 */
export function resetSchemaCache(): void {
  globalSchemaCache = null;
}
