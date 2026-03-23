/**
 * Tests for BoundedCache (Phase 1.4: Fix Unbounded Caches)
 *
 * Validates LRU eviction, TTL expiration, and memory safety.
 */

import { describe, it, expect } from 'vitest';
import { BoundedCache } from '../../src/utils/bounded-cache.js';

describe('BoundedCache', () => {
  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      cache.set('key1', 100);
      cache.set('key2', 200);

      expect(cache.get('key1')).toBe(100);
      expect(cache.get('key2')).toBe(200);
    });

    it('should return undefined for non-existent keys', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      cache.set('key', 1);

      expect(cache.has('key')).toBe(true);
      expect(cache.has('missing')).toBe(false);
    });

    it('should delete specific keys', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      cache.set('key', 1);
      expect(cache.has('key')).toBe(true);

      const deleted = cache.delete('key');
      expect(deleted).toBe(true);
      expect(cache.has('key')).toBe(false);
    });

    it('should clear all entries', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      cache.set('key1', 1);
      cache.set('key2', 2);
      cache.set('key3', 3);

      expect(cache.size()).toBe(3);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has('key1')).toBe(false);
    });

    it('should report correct size', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      expect(cache.size()).toBe(0);

      cache.set('key1', 1);
      expect(cache.size()).toBe(1);

      cache.set('key2', 2);
      expect(cache.size()).toBe(2);

      cache.delete('key1');
      expect(cache.size()).toBe(1);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entry when max size reached', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // Should evict 'a' (oldest)

      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.size()).toBe(3);
    });

    it('should update LRU order on get', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' to make it recently used
      cache.get('a');

      cache.set('d', 4); // Should evict 'b' (now oldest)

      expect(cache.has('a')).toBe(true); // Recently accessed
      expect(cache.has('b')).toBe(false); // Evicted
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('should update LRU order on set', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Update 'a' to make it recently used
      cache.set('a', 10);

      cache.set('d', 4); // Should evict 'b' (oldest)

      expect(cache.get('a')).toBe(10); // Recently updated
      expect(cache.has('b')).toBe(false); // Evicted
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('should handle eviction with complex values', () => {
      interface CacheValue {
        data: string;
        timestamp: number;
      }

      const cache = new BoundedCache<string, CacheValue>({ maxSize: 2 });

      cache.set('key1', { data: 'value1', timestamp: Date.now() });
      cache.set('key2', { data: 'value2', timestamp: Date.now() });
      cache.set('key3', { data: 'value3', timestamp: Date.now() }); // Evicts key1

      expect(cache.has('key1')).toBe(false);
      expect(cache.get('key2')?.data).toBe('value2');
      expect(cache.get('key3')?.data).toBe('value3');
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const cache = new BoundedCache<string, number>({
        maxSize: 10,
        ttl: 50, // 50ms
      });

      cache.set('key', 1);
      expect(cache.get('key')).toBe(1);

      // Wait for TTL expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(cache.get('key')).toBeUndefined();
    });

    it('should not expire entries before TTL', async () => {
      const cache = new BoundedCache<string, number>({
        maxSize: 10,
        ttl: 100, // 100ms
      });

      cache.set('key', 1);

      // Wait less than TTL
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cache.get('key')).toBe(1);
    });

    it('should handle TTL with LRU eviction', async () => {
      const cache = new BoundedCache<string, number>({
        maxSize: 2,
        ttl: 100, // 100ms
      });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // Evicts 'a' via LRU

      expect(cache.has('a')).toBe(false); // LRU evicted
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);

      // Wait for TTL expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cache.has('b')).toBe(false); // TTL expired
      expect(cache.has('c')).toBe(false); // TTL expired
    });
  });

  describe('Eviction Callback', () => {
    it('should call onEviction when entry is evicted', () => {
      const evicted: Array<{ key: string; value: number }> = [];

      const cache = new BoundedCache<string, number>({
        maxSize: 2,
        onEviction: (key, value) => {
          evicted.push({ key, value: value as number });
        },
      });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // Should evict 'a'

      expect(evicted).toHaveLength(1);
      expect(evicted[0]).toEqual({ key: 'a', value: 1 });
    });

    it('should call onEviction when entry is deleted', () => {
      const evicted: string[] = [];

      const cache = new BoundedCache<string, number>({
        maxSize: 10,
        onEviction: (key) => {
          evicted.push(key);
        },
      });

      cache.set('key', 1);
      cache.delete('key');

      expect(evicted).toContain('key');
    });

    it('should call onEviction when cache is cleared', () => {
      const evicted: string[] = [];

      const cache = new BoundedCache<string, number>({
        maxSize: 10,
        onEviction: (key) => {
          evicted.push(key);
        },
      });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      cache.clear();

      expect(evicted).toHaveLength(3);
      expect(evicted).toContain('a');
      expect(evicted).toContain('b');
      expect(evicted).toContain('c');
    });
  });

  describe('Iteration', () => {
    it('should iterate over keys', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const keys = Array.from(cache.keys());
      expect(keys).toHaveLength(3);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).toContain('c');
    });

    it('should iterate over values', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const values = Array.from(cache.values());
      expect(values).toHaveLength(3);
      expect(values).toContain(1);
      expect(values).toContain(2);
      expect(values).toContain(3);
    });

    it('should iterate over entries', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      cache.set('a', 1);
      cache.set('b', 2);

      const entries = Array.from(cache.entries());
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(['a', 1]);
      expect(entries).toContainEqual(['b', 2]);
    });
  });

  describe('Statistics', () => {
    it('should report cache statistics', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      const emptyStats = cache.getStats();
      expect(emptyStats.size).toBe(0);
      expect(emptyStats.maxSize).toBe(10);
      expect(emptyStats.utilization).toBe(0);

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);
      cache.set('e', 5); // 5/10 = 50%

      const stats = cache.getStats();
      expect(stats.size).toBe(5);
      expect(stats.maxSize).toBe(10);
      expect(stats.utilization).toBe(50);
    });

    it('should report 100% utilization when full', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 3 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const stats = cache.getStats();
      expect(stats.size).toBe(3);
      expect(stats.utilization).toBe(100);
    });

    it('should maintain correct stats after eviction', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 2 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // Evicts 'a'

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.utilization).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle maxSize of 1', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 1 });

      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);

      cache.set('b', 2); // Should evict 'a'
      expect(cache.has('a')).toBe(false);
      expect(cache.get('b')).toBe(2);
      expect(cache.size()).toBe(1);
    });

    it('should handle rapid insertions at max capacity', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 100 });

      // Insert 1000 entries (10x max size)
      for (let i = 0; i < 1000; i++) {
        cache.set(`key${i}`, i);
      }

      // Should never exceed max size
      expect(cache.size()).toBe(100);

      // Only most recent 100 entries should exist
      expect(cache.has('key900')).toBe(true);
      expect(cache.has('key999')).toBe(true);
      expect(cache.has('key0')).toBe(false);
      expect(cache.has('key100')).toBe(false);
    });

    it('should handle setting same key multiple times', () => {
      const cache = new BoundedCache<string, number>({ maxSize: 10 });

      cache.set('key', 1);
      cache.set('key', 2);
      cache.set('key', 3);

      expect(cache.get('key')).toBe(3);
      expect(cache.size()).toBe(1); // Only one entry
    });

    it('should handle undefined values', () => {
      const cache = new BoundedCache<string, number | undefined>({ maxSize: 10 });

      cache.set('key', undefined);

      // LRU cache treats undefined as "not found", so this is expected behavior
      expect(cache.has('key')).toBe(false);
    });
  });
});
