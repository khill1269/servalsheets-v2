import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaCache, getSchemaCache, resetSchemaCache } from '../src/services/schema-cache.js';
import type { DiscoverySchema } from '../src/services/discovery-client.js';
import { waitFor } from './helpers/wait-for.js';

// Detect sandboxed environments where unlink/rmSync fails with EPERM
let canDeleteFiles = true;
try {
  const probeDir = mkdtempSync(join(tmpdir(), 'servalsheets-probe-delete-'));
  const probeFile = join(probeDir, 'test');
  writeFileSync(probeFile, 'x');
  rmSync(probeFile, { force: true });
  rmSync(probeDir, { recursive: true, force: true });
} catch {
  canDeleteFiles = false;
}

describe('SchemaCache', () => {
  // Use a unique dir per test run so EPERM cleanup failures don't cause stale data
  let testCacheDir: string;
  let cache: SchemaCache;

  const mockSchema: DiscoverySchema = {
    id: 'sheets:v4',
    name: 'sheets',
    version: 'v4',
    title: 'Google Sheets API',
    description: 'Test schema',
    documentationLink: 'https://example.com',
    schemas: {
      Spreadsheet: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string' },
        },
      },
    },
    resources: {},
  };

  beforeEach(() => {
    testCacheDir = mkdtempSync(join(tmpdir(), 'servalsheets-test-discovery-cache-'));
    resetSchemaCache();
    cache = new SchemaCache({ cacheDir: testCacheDir, defaultTTL: 60000 });
  });

  afterEach(() => {
    resetSchemaCache();
    try {
      if (existsSync(testCacheDir)) {
        rmSync(testCacheDir, { recursive: true, force: true });
      }
    } catch {
      // EPERM in sandboxed environments — safe to ignore
    }
  });

  describe('set and get', () => {
    it('should store and retrieve a schema', async () => {
      await cache.set('sheets', 'v4', mockSchema);

      const retrieved = await cache.get('sheets', 'v4');

      expect(retrieved).toEqual(mockSchema);
    });

    it('should return null for non-existent schema', async () => {
      const retrieved = await cache.get('sheets', 'v4');

      expect(retrieved).toBeNull();
    });

    it('should handle different API/version combinations', async () => {
      await cache.set('sheets', 'v4', mockSchema);
      await cache.set('drive', 'v3', { ...mockSchema, id: 'drive:v3', name: 'drive' });

      const sheets = await cache.get('sheets', 'v4');
      const drive = await cache.get('drive', 'v3');

      expect(sheets?.id).toBe('sheets:v4');
      expect(drive?.id).toBe('drive:v3');
    });

    it('should respect custom TTL', async () => {
      // Set with 1ms TTL
      await cache.set('sheets', 'v4', mockSchema, 1);

      // Wait for expiration
      await waitFor(10);

      const retrieved = await cache.get('sheets', 'v4');

      expect(retrieved).toBeNull();
    });

    it('should return null for expired schema', async () => {
      const shortTTLCache = new SchemaCache({ cacheDir: testCacheDir, defaultTTL: 1 });

      await shortTTLCache.set('sheets', 'v4', mockSchema);

      // Wait for expiration
      await waitFor(10);

      const retrieved = await shortTTLCache.get('sheets', 'v4');

      expect(retrieved).toBeNull();
    });
  });

  describe('invalidate', () => {
    it.skipIf(!canDeleteFiles)('should invalidate a single schema', async () => {
      await cache.set('sheets', 'v4', mockSchema);

      expect(await cache.get('sheets', 'v4')).not.toBeNull();

      await cache.invalidate('sheets', 'v4');

      expect(await cache.get('sheets', 'v4')).toBeNull();
    });

    it('should not error when invalidating non-existent schema', async () => {
      await expect(cache.invalidate('sheets', 'v4')).resolves.not.toThrow();
    });
  });

  describe('invalidateAll', () => {
    it.skipIf(!canDeleteFiles)('should invalidate all cached schemas', async () => {
      await cache.set('sheets', 'v4', mockSchema);
      await cache.set('drive', 'v3', { ...mockSchema, id: 'drive:v3' });

      await cache.invalidateAll();

      expect(await cache.get('sheets', 'v4')).toBeNull();
      expect(await cache.get('drive', 'v3')).toBeNull();
    });

    it('should handle empty cache directory', async () => {
      await expect(cache.invalidateAll()).resolves.not.toThrow();
    });
  });

  describe('cleanupExpired', () => {
    it.skipIf(!canDeleteFiles)('should clean up expired entries', async () => {
      const shortTTLCache = new SchemaCache({ cacheDir: testCacheDir, defaultTTL: 1 });

      // Add schemas with short TTL
      await shortTTLCache.set('sheets', 'v4', mockSchema);
      await shortTTLCache.set('drive', 'v3', { ...mockSchema, id: 'drive:v3' });

      // Wait for expiration
      await waitFor(10);

      const cleaned = await cache.cleanupExpired();

      expect(cleaned).toBe(2);
      expect(await cache.get('sheets', 'v4')).toBeNull();
      expect(await cache.get('drive', 'v3')).toBeNull();
    });

    it('should not clean up valid entries', async () => {
      await cache.set('sheets', 'v4', mockSchema, 60000);

      const cleaned = await cache.cleanupExpired();

      expect(cleaned).toBe(0);
      expect(await cache.get('sheets', 'v4')).not.toBeNull();
    });

    it('should return 0 when cache is empty', async () => {
      const cleaned = await cache.cleanupExpired();

      expect(cleaned).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return correct statistics', async () => {
      await cache.set('sheets', 'v4', mockSchema);
      await cache.set('drive', 'v3', { ...mockSchema, id: 'drive:v3' });

      const stats = await cache.getCacheStats();

      expect(stats.entries).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.oldestEntry).toBeGreaterThan(0);
      expect(stats.newestEntry).toBeGreaterThan(0);
      expect(stats.expiredEntries).toBe(0);
    });

    it('should count expired entries', async () => {
      const shortTTLCache = new SchemaCache({ cacheDir: testCacheDir, defaultTTL: 1 });

      await shortTTLCache.set('sheets', 'v4', mockSchema);

      // Wait for expiration
      await waitFor(10);

      const stats = await cache.getCacheStats();

      expect(stats.entries).toBe(1);
      expect(stats.expiredEntries).toBe(1);
    });

    it('should return zeros for empty cache', async () => {
      const stats = await cache.getCacheStats();

      expect(stats.entries).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
      expect(stats.expiredEntries).toBe(0);
    });

    it('should handle multiple schemas with different timestamps', async () => {
      await cache.set('sheets', 'v4', mockSchema);

      // Wait a bit
      await waitFor(10);

      await cache.set('drive', 'v3', { ...mockSchema, id: 'drive:v3' });

      const stats = await cache.getCacheStats();

      expect(stats.entries).toBe(2);
      expect(stats.newestEntry).toBeGreaterThan(stats.oldestEntry!);
    });
  });

  describe('list', () => {
    it('should list all cached schemas', async () => {
      await cache.set('sheets', 'v4', mockSchema);
      await cache.set('drive', 'v3', { ...mockSchema, id: 'drive:v3' });

      const list = await cache.list();

      expect(list).toHaveLength(2);
      expect(list.some((item) => item.api === 'sheets' && item.version === 'v4')).toBe(true);
      expect(list.some((item) => item.api === 'drive' && item.version === 'v3')).toBe(true);
    });

    it('should mark expired schemas', async () => {
      const shortTTLCache = new SchemaCache({ cacheDir: testCacheDir, defaultTTL: 1 });

      await shortTTLCache.set('sheets', 'v4', mockSchema);

      // Wait for expiration
      await waitFor(10);

      const list = await cache.list();

      expect(list).toHaveLength(1);
      expect(list[0]?.expired).toBe(true);
    });

    it('should sort by fetchedAt descending', async () => {
      await cache.set('sheets', 'v4', mockSchema);

      // Wait a bit
      await waitFor(10);

      await cache.set('drive', 'v3', { ...mockSchema, id: 'drive:v3' });

      const list = await cache.list();

      expect(list).toHaveLength(2);
      expect(list[0]?.fetchedAt).toBeGreaterThan(list[1]!.fetchedAt);
    });

    it('should return empty array for empty cache', async () => {
      const list = await cache.list();

      expect(list).toEqual([]);
    });
  });

  describe('cache directory creation', () => {
    it('should create cache directory on first operation', async () => {
      const customCacheRoot = mkdtempSync(join(tmpdir(), 'servalsheets-test-custom-cache-'));
      const customDir = join(customCacheRoot, 'cache');

      try {
        const customCache = new SchemaCache({ cacheDir: customDir });
        // Directory is created lazily on first operation
        await customCache.set('test', 'v1', mockSchema);

        expect(existsSync(customDir)).toBe(true);
      } finally {
        try {
          if (existsSync(customCacheRoot)) {
            rmSync(customCacheRoot, { recursive: true, force: true });
          }
        } catch {
          // EPERM in sandboxed environments — safe to ignore
        }
      }
    });
  });

  describe('error handling', () => {
    it('should handle corrupted cache files gracefully', async () => {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');

      // Trigger lazy directory creation first
      await cache.set('temp', 'v1', mockSchema);

      // Write invalid JSON
      writeFileSync(join(testCacheDir, 'sheets-v4.json'), 'invalid json', 'utf-8');

      const retrieved = await cache.get('sheets', 'v4');

      expect(retrieved).toBeNull();
    });

    it('should skip corrupted files during stats', async () => {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');

      // Write valid schema
      await cache.set('drive', 'v3', mockSchema);

      // Write invalid JSON
      writeFileSync(join(testCacheDir, 'sheets-v4.json'), 'invalid json', 'utf-8');

      const stats = await cache.getCacheStats();

      expect(stats.entries).toBe(1); // Only counts valid file
    });

    it('should skip corrupted files during list', async () => {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');

      // Write valid schema
      await cache.set('drive', 'v3', mockSchema);

      // Write invalid JSON
      writeFileSync(join(testCacheDir, 'sheets-v4.json'), 'invalid json', 'utf-8');

      const list = await cache.list();

      expect(list).toHaveLength(1);
      expect(list[0]?.api).toBe('drive');
    });
  });

  describe('global instance', () => {
    beforeEach(() => {
      resetSchemaCache();
    });

    afterEach(() => {
      resetSchemaCache();
      try {
        if (existsSync('.discovery-cache')) {
          rmSync('.discovery-cache', { recursive: true, force: true });
        }
      } catch {
        // EPERM in sandboxed environments — safe to ignore
      }
    });

    it('should create global instance', () => {
      const globalCache = getSchemaCache();

      expect(globalCache).toBeDefined();
    });

    it('should reuse existing global instance', () => {
      const cache1 = getSchemaCache();
      const cache2 = getSchemaCache();

      expect(cache1).toBe(cache2);
    });

    it('should reset global instance', () => {
      const cache1 = getSchemaCache();
      resetSchemaCache();
      const cache2 = getSchemaCache();

      expect(cache1).not.toBe(cache2);
    });
  });
});
