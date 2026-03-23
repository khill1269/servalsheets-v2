/**
 * Temporary Resource Store (Phase 1.3: Resource URI Fallback)
 *
 * Stores large responses (>10MB after pagination) as temporary resources
 * with automatic expiration and LRU eviction.
 *
 * Use case: Edge case when even paginated responses exceed transport limits
 * Estimated frequency: <0.1% of requests
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

interface StoredResource {
  data: unknown;
  expiresAt: number;
  sizeBytes: number;
  createdAt: number;
}

export class TemporaryResourceStore {
  private resources = new Map<string, StoredResource>();
  private maxTotalSizeBytes: number;
  private defaultTtlMs: number;
  /** @internal Exposed for factory function to set cleanup interval */
  cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { maxSizeMB?: number; defaultTtlSeconds?: number }) {
    this.maxTotalSizeBytes = (options?.maxSizeMB ?? 100) * 1024 * 1024; // Default: 100MB
    this.defaultTtlMs = (options?.defaultTtlSeconds ?? 1800) * 1000; // Default: 30 minutes
  }

  /**
   * Dispose the store, clearing cleanup interval and stored resources
   */
  dispose(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.resources.clear();
  }

  /**
   * Store data as a temporary resource and return its URI
   */
  store(data: unknown, ttlSeconds?: number): string {
    const id = randomUUID();
    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtlMs;
    const expiresAt = Date.now() + ttlMs;
    const sizeBytes = this.estimateSize(data);

    // Evict if needed to make room
    this.evictIfNeeded(sizeBytes);

    // Store the resource
    this.resources.set(id, {
      data,
      expiresAt,
      sizeBytes,
      createdAt: Date.now(),
    });

    logger.info('Stored temporary resource', {
      id,
      sizeBytes,
      ttlSeconds: ttlSeconds ?? this.defaultTtlMs / 1000,
      totalResources: this.resources.size,
    });

    return `temporary://large-response/${id}`;
  }

  /**
   * Retrieve data by URI
   */
  get(uri: string): unknown | null {
    const id = this.parseUri(uri);
    if (!id) {
      return null;
    }

    const resource = this.resources.get(id);
    if (!resource) {
      return null;
    }

    // Check if expired
    if (Date.now() > resource.expiresAt) {
      this.resources.delete(id);
      logger.debug('Retrieved expired resource', { id });
      return null;
    }

    return resource.data;
  }

  /**
   * Delete a resource by URI
   */
  delete(uri: string): boolean {
    const id = this.parseUri(uri);
    if (!id) {
      return false;
    }

    const deleted = this.resources.delete(id);
    if (deleted) {
      logger.debug('Deleted temporary resource', { id });
    }
    return deleted;
  }

  /**
   * Clean up expired resources
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, resource] of this.resources.entries()) {
      if (now > resource.expiresAt) {
        this.resources.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired resources', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * Get current storage statistics
   */
  getStats(): {
    totalResources: number;
    totalSizeBytes: number;
    maxSizeBytes: number;
    utilizationPercent: number;
  } {
    let totalSizeBytes = 0;
    for (const resource of this.resources.values()) {
      totalSizeBytes += resource.sizeBytes;
    }

    return {
      totalResources: this.resources.size,
      totalSizeBytes,
      maxSizeBytes: this.maxTotalSizeBytes,
      utilizationPercent: (totalSizeBytes / this.maxTotalSizeBytes) * 100,
    };
  }

  /**
   * Evict resources using LRU strategy if needed
   */
  private evictIfNeeded(newResourceSize: number): void {
    const stats = this.getStats();
    const spaceNeeded = newResourceSize;
    const availableSpace = this.maxTotalSizeBytes - stats.totalSizeBytes;

    if (availableSpace >= spaceNeeded) {
      return; // Enough space
    }

    // Sort by creation time (oldest first - LRU)
    const entries = Array.from(this.resources.entries()).sort(
      ([, a], [, b]) => a.createdAt - b.createdAt
    );

    let freedSpace = 0;
    let evicted = 0;

    for (const [id, resource] of entries) {
      this.resources.delete(id);
      freedSpace += resource.sizeBytes;
      evicted++;

      if (freedSpace >= spaceNeeded) {
        break;
      }
    }

    logger.info('Evicted resources to make space', {
      evicted,
      freedBytes: freedSpace,
      neededBytes: spaceNeeded,
    });
  }

  /**
   * Parse URI to extract resource ID
   */
  private parseUri(uri: string): string | null {
    const match = uri.match(/^temporary:\/\/large-response\/([a-f0-9-]+)$/);
    return match?.[1] ?? null;
  }

  /**
   * Estimate size of data in bytes (rough approximation)
   */
  private estimateSize(data: unknown): number {
    try {
      const jsonString = JSON.stringify(data);
      return jsonString.length * 2; // Approximate bytes (UTF-16)
    } catch {
      // If can't stringify, use rough estimate
      return 1024 * 1024; // 1MB default
    }
  }
}

// Global singleton instance
let globalStore: TemporaryResourceStore | null = null;

/**
 * Get or create the global temporary resource store
 */
export function getTemporaryResourceStore(): TemporaryResourceStore {
  if (!globalStore) {
    globalStore = new TemporaryResourceStore({
      maxSizeMB: 100,
      defaultTtlSeconds: 1800, // 30 minutes
    });

    // Schedule periodic cleanup every 5 minutes (handle stored for dispose)
    globalStore.cleanupIntervalId = setInterval(
      () => {
        globalStore?.cleanup();
      },
      5 * 60 * 1000
    );
  }
  return globalStore;
}

/**
 * Dispose the global temporary resource store and clear its cleanup interval.
 * Called during server shutdown.
 */
export function disposeTemporaryResourceStore(): void {
  if (globalStore) {
    globalStore.dispose();
    globalStore = null;
  }
}
