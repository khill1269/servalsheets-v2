/**
 * Tests for Storage - Session Store
 *
 * Tests session storage with TTL, memory backend, and optional Redis.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '../helpers/wait-for.js';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { SessionStore, MemorySessionStore } from '../../src/storage/session-store.js';

describe('MemorySessionStore', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore({
      defaultTtlMs: 60000, // 1 minute
      maxEntries: 100,
    });
  });

  afterEach(async () => {
    await store.clear();
  });

  describe('set and get', () => {
    it('should store and retrieve a value', async () => {
      await store.set('test-key', { value: 'test-data' });

      const result = await store.get('test-key');

      expect(result).toEqual({ value: 'test-data' });
    });

    it('should return undefined for non-existent key', async () => {
      const result = await store.get('non-existent');

      expect(result).toBeUndefined();
    });

    it('should store complex objects', async () => {
      const complexData = {
        user: { id: '123', name: 'Test User' },
        tokens: { access: 'abc', refresh: 'xyz' },
        metadata: { created: new Date().toISOString() },
      };

      await store.set('complex-key', complexData);
      const result = await store.get('complex-key');

      expect(result).toEqual(complexData);
    });

    it('should handle null values', async () => {
      await store.set('null-key', null);

      const result = await store.get('null-key');

      expect(result).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTtlStore = new MemorySessionStore({
        defaultTtlMs: 50, // 50ms TTL
      });

      await shortTtlStore.set('expiring-key', { data: 'will-expire' });

      // Verify it exists immediately
      const immediate = await shortTtlStore.get('expiring-key');
      expect(immediate).toBeDefined();

      // Wait for expiration
      await waitFor(100);

      const expired = await shortTtlStore.get('expiring-key');
      expect(expired).toBeUndefined();

      await shortTtlStore.clear();
    });

    it('should accept custom TTL per entry', async () => {
      await store.set('custom-ttl', { data: 'test' }, { ttlMs: 100 });

      const immediate = await store.get('custom-ttl');
      expect(immediate).toBeDefined();

      await waitFor(150);

      const expired = await store.get('custom-ttl');
      expect(expired).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete existing entry', async () => {
      await store.set('to-delete', { data: 'test' });

      const deleted = await store.delete('to-delete');

      expect(deleted).toBe(true);
      expect(await store.get('to-delete')).toBeUndefined();
    });

    it('should return false for non-existent key', async () => {
      const deleted = await store.delete('non-existent');

      expect(deleted).toBe(false);
    });
  });

  describe('has', () => {
    it('should return true for existing key', async () => {
      await store.set('existing', { data: 'test' });

      const exists = await store.has('existing');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const exists = await store.has('non-existent');

      expect(exists).toBe(false);
    });

    it('should return false for expired key', async () => {
      const shortTtlStore = new MemorySessionStore({ defaultTtlMs: 50 });

      await shortTtlStore.set('expiring', { data: 'test' });

      await waitFor(100);

      const exists = await shortTtlStore.has('expiring');
      expect(exists).toBe(false);

      await shortTtlStore.clear();
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      await store.set('key1', { data: '1' });
      await store.set('key2', { data: '2' });
      await store.set('key3', { data: '3' });

      await store.clear();

      expect(await store.has('key1')).toBe(false);
      expect(await store.has('key2')).toBe(false);
      expect(await store.has('key3')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return number of entries', async () => {
      await store.set('key1', { data: '1' });
      await store.set('key2', { data: '2' });

      const size = await store.size();

      expect(size).toBe(2);
    });

    it('should return 0 for empty store', async () => {
      const size = await store.size();

      expect(size).toBe(0);
    });

    it('should not count expired entries', async () => {
      const shortTtlStore = new MemorySessionStore({ defaultTtlMs: 50 });

      await shortTtlStore.set('expiring', { data: 'test' });
      await shortTtlStore.set('not-expiring', { data: 'test' }, { ttlMs: 60000 });

      await waitFor(100);

      // Trigger cleanup
      await shortTtlStore.cleanup();

      const size = await shortTtlStore.size();
      expect(size).toBe(1);

      await shortTtlStore.clear();
    });
  });

  describe('keys', () => {
    it('should return all keys', async () => {
      await store.set('key1', { data: '1' });
      await store.set('key2', { data: '2' });
      await store.set('key3', { data: '3' });

      const keys = await store.keys();

      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
      expect(keys.length).toBe(3);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const shortTtlStore = new MemorySessionStore({ defaultTtlMs: 50 });

      await shortTtlStore.set('expiring1', { data: '1' });
      await shortTtlStore.set('expiring2', { data: '2' });
      await shortTtlStore.set('not-expiring', { data: '3' }, { ttlMs: 60000 });

      await waitFor(100);

      const removedCount = await shortTtlStore.cleanup();

      expect(removedCount).toBe(2);
      expect(await shortTtlStore.size()).toBe(1);

      await shortTtlStore.clear();
    });
  });

  describe('max entries enforcement', () => {
    it('should evict oldest entries when max reached', async () => {
      const limitedStore = new MemorySessionStore({
        defaultTtlMs: 60000,
        maxEntries: 3,
      });

      await limitedStore.set('key1', { data: '1' });
      await limitedStore.set('key2', { data: '2' });
      await limitedStore.set('key3', { data: '3' });
      await limitedStore.set('key4', { data: '4' }); // Should evict key1

      const size = await limitedStore.size();
      expect(size).toBe(3);

      // key1 should be evicted
      expect(await limitedStore.has('key1')).toBe(false);
      expect(await limitedStore.has('key4')).toBe(true);

      await limitedStore.clear();
    });
  });

  describe('update (set existing)', () => {
    it('should update existing entry', async () => {
      await store.set('update-key', { data: 'original' });
      await store.set('update-key', { data: 'updated' });

      const result = await store.get('update-key');

      expect(result).toEqual({ data: 'updated' });
    });

    it('should reset TTL on update', async () => {
      const shortTtlStore = new MemorySessionStore({ defaultTtlMs: 100 });

      await shortTtlStore.set('refresh-key', { data: '1' });

      await waitFor(50);

      // Update the entry (should reset TTL)
      await shortTtlStore.set('refresh-key', { data: '2' });

      await waitFor(75);

      // Should still exist because TTL was reset
      const result = await shortTtlStore.get('refresh-key');
      expect(result).toBeDefined();

      await shortTtlStore.clear();
    });
  });
});

describe('SessionStore Interface', () => {
  it('should implement SessionStore interface', () => {
    const store = new MemorySessionStore();

    expect(typeof store.get).toBe('function');
    expect(typeof store.set).toBe('function');
    expect(typeof store.delete).toBe('function');
    expect(typeof store.has).toBe('function');
    expect(typeof store.clear).toBe('function');
    expect(typeof store.size).toBe('function');
    expect(typeof store.keys).toBe('function');
    expect(typeof store.cleanup).toBe('function');
  });
});
