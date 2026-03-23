/**
 * Serval Core - Bounded Cache with LRU Eviction
 *
 * Memory-safe cache with configurable size limits and TTL support.
 * Uses LRU eviction to prevent unbounded memory growth.
 */

import { LRUCache } from 'lru-cache';

export interface BoundedCacheOptions {
  /** Maximum number of entries before LRU eviction */
  maxSize: number;
  /** Time to live in milliseconds (optional) */
  ttl?: number;
  /** Callback when entry is evicted (optional) */
  onEviction?: (key: string, value: unknown) => void;
}

export class BoundedCache<K extends string, V extends object> {
  private cache: LRUCache<K, V>;

  constructor(options: BoundedCacheOptions) {
    this.cache = new LRUCache<K, V>({
      max: options.maxSize,
      ttl: options.ttl,
      dispose: (value, key) => {
        if (options.onEviction) {
          options.onEviction(key, value);
        }
      },
    });
  }

  get(key: K): V | undefined { return this.cache.get(key); }
  set(key: K, value: V): void { this.cache.set(key, value); }
  has(key: K): boolean { return this.cache.has(key); }
  delete(key: K): boolean { return this.cache.delete(key); }
  clear(): void { this.cache.clear(); }
  size(): number { return this.cache.size; }
  keys(): IterableIterator<K> { return this.cache.keys(); }
  values(): IterableIterator<V> { return this.cache.values(); }
  entries(): IterableIterator<[K, V]> { return this.cache.entries(); }

  getStats(): { size: number; maxSize: number; utilization: number } {
    return {
      size: this.cache.size,
      maxSize: this.cache.max,
      utilization: (this.cache.size / this.cache.max) * 100,
    };
  }
}
