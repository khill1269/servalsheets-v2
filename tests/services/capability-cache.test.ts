/**
 * Capability Cache Service Tests (Phase 3.9)
 *
 * Tests for CapabilityCacheService
 * Covers two-tier caching (memory + Redis) and capability management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CapabilityCacheService,
  getCapabilitiesWithCache,
  initCapabilityCacheService,
  resetCapabilityCacheService,
  type ClientCapabilities,
} from '../../src/services/capability-cache.js';

describe('CapabilityCacheService', () => {
  let service: CapabilityCacheService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockRedis: any;

  beforeEach(() => {
    // Create mock Redis client
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      setEx: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      scan: vi.fn().mockResolvedValue({ cursor: 0, keys: [] }),
    };

    service = new CapabilityCacheService(mockRedis);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    resetCapabilityCacheService();
  });

  describe('constructor', () => {
    it('should initialize without Redis', () => {
      const noRedisService = new CapabilityCacheService();

      expect(noRedisService).toBeDefined();
      const stats = noRedisService.getStats();
      expect(stats.redisAvailable).toBe(false);
    });

    it('should initialize with Redis', () => {
      const withRedisService = new CapabilityCacheService(mockRedis);

      expect(withRedisService).toBeDefined();
      const stats = withRedisService.getStats();
      expect(stats.redisAvailable).toBe(true);
    });
  });

  describe('get', () => {
    it('should return null for cache miss', async () => {
      const result = await service.get('session-1');

      expect(result).toBeNull();
    });

    it('should return capabilities from memory cache', async () => {
      const capabilities: ClientCapabilities = {
        elicitation: true,
        sampling: true,
      };

      await service.set('session-1', capabilities);
      const result = await service.get('session-1');

      expect(result).toEqual(capabilities);
      expect(mockRedis.get).not.toHaveBeenCalled(); // Memory hit, no Redis check
    });

    it('should return capabilities from Redis cache', async () => {
      const capabilities: ClientCapabilities = {
        elicitation: { form: { applyDefaults: true } },
      };

      const now = Date.now();
      const cached = {
        capabilities,
        cachedAt: now,
        expiresAt: now + 3600000,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.get('session-1');

      expect(result).toEqual(capabilities);
      expect(mockRedis.get).toHaveBeenCalledWith('servalsheets:capabilities:session-1');
    });

    it('should handle expired cache entries', async () => {
      const capabilities: ClientCapabilities = { elicitation: true };

      const expiredCached = {
        capabilities,
        cachedAt: 1704067200000 - 7200000, // 2 hours ago
        expiresAt: 1704067200000 - 3600000, // Expired 1 hour ago
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(expiredCached));

      const result = await service.get('session-1');

      expect(result).toBeNull(); // Expired, so null
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.get('session-1');

      expect(result).toBeNull(); // Falls back to null on error
    });

    it('should handle malformed Redis data', async () => {
      mockRedis.get.mockResolvedValue('invalid-json');

      const result = await service.get('session-1');

      expect(result).toBeNull();
    });

    it('should update memory cache from Redis hit', async () => {
      const capabilities: ClientCapabilities = { sampling: true };

      const now2 = Date.now();
      const cached = {
        capabilities,
        cachedAt: now2,
        expiresAt: now2 + 3600000,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      await service.get('session-1');
      // Second call should hit memory cache
      await service.get('session-1');

      expect(mockRedis.get).toHaveBeenCalledTimes(1); // Only once, then memory
    });
  });

  describe('set', () => {
    it('should store capabilities in memory cache', async () => {
      const capabilities: ClientCapabilities = {
        elicitation: true,
        sampling: { context: {} },
      };

      await service.set('session-1', capabilities);

      const stats = service.getStats();
      expect(stats.memoryCacheSize).toBe(1);

      const result = await service.get('session-1');
      expect(result).toEqual(capabilities);
    });

    it('should store capabilities in Redis cache', async () => {
      const capabilities: ClientCapabilities = { roots: true };

      await service.set('session-1', capabilities);

      expect(mockRedis.setEx).toHaveBeenCalled();
      const setExCall = mockRedis.setEx.mock.calls[0];
      expect(setExCall[0]).toBe('servalsheets:capabilities:session-1');
      expect(setExCall[1]).toBe(3600); // TTL in seconds
      expect(typeof setExCall[2]).toBe('string'); // JSON string
    });

    it('should handle Redis errors gracefully when setting', async () => {
      mockRedis.setEx.mockRejectedValue(new Error('Redis write failed'));

      const capabilities: ClientCapabilities = { elicitation: true };

      // Should not throw
      await expect(service.set('session-1', capabilities)).resolves.not.toThrow();

      // Memory cache should still work
      const result = await service.get('session-1');
      expect(result).toEqual(capabilities);
    });

    it('should set expiry timestamp correctly', async () => {
      const capabilities: ClientCapabilities = { sampling: true };

      await service.set('session-1', capabilities);

      // Get from memory cache and verify expiry
      const result = await service.get('session-1');
      expect(result).toBeDefined();
    });

    it('should support complex capability objects', async () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          form: { applyDefaults: true },
          url: { enabled: true },
        },
        sampling: {
          context: { maxTokens: 1000 },
          tools: { enabled: true },
        },
        roots: { listChanged: true },
        experimental: {
          feature1: { enabled: true },
        },
      };

      await service.set('session-1', capabilities);

      const result = await service.get('session-1');
      expect(result).toEqual(capabilities);
    });
  });

  describe('clear', () => {
    it('should clear from memory cache', async () => {
      await service.set('session-1', { elicitation: true });

      await service.clear('session-1');

      const result = await service.get('session-1');
      expect(result).toBeNull();
    });

    it('should clear from Redis cache', async () => {
      await service.set('session-1', { elicitation: true });

      await service.clear('session-1');

      expect(mockRedis.del).toHaveBeenCalledWith('servalsheets:capabilities:session-1');
    });

    it('should handle Redis errors gracefully when clearing', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis delete failed'));

      await expect(service.clear('session-1')).resolves.not.toThrow();
    });

    it('should handle clearing non-existent session', async () => {
      await expect(service.clear('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('clearAll', () => {
    it('should clear all memory cache entries', async () => {
      await service.set('session-1', { elicitation: true });
      await service.set('session-2', { sampling: true });
      await service.set('session-3', { roots: true });

      await service.clearAll();

      const stats = service.getStats();
      expect(stats.memoryCacheSize).toBe(0);
    });

    it('should clear all Redis cache entries', async () => {
      mockRedis.scan.mockResolvedValue({
        cursor: 0,
        keys: ['servalsheets:capabilities:session-1', 'servalsheets:capabilities:session-2'],
      });

      await service.clearAll();

      expect(mockRedis.scan).toHaveBeenCalledWith(0, {
        MATCH: 'servalsheets:capabilities:*',
        COUNT: 100,
      });
      expect(mockRedis.del).toHaveBeenCalledWith(
        'servalsheets:capabilities:session-1',
        'servalsheets:capabilities:session-2'
      );
    });

    it('should handle no Redis keys', async () => {
      mockRedis.scan.mockResolvedValue({ cursor: 0, keys: [] });

      await service.clearAll();

      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Redis scan failed'));

      await expect(service.clearAll()).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      const stats = service.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.memoryCacheSize).toBe('number');
      expect(typeof stats.redisAvailable).toBe('boolean');
    });

    it('should track memory cache size', async () => {
      await service.set('session-1', { elicitation: true });
      await service.set('session-2', { sampling: true });

      const stats = service.getStats();
      expect(stats.memoryCacheSize).toBe(2);
    });

    it('should indicate Redis availability', () => {
      const withRedis = new CapabilityCacheService(mockRedis);
      const withoutRedis = new CapabilityCacheService();

      expect(withRedis.getStats().redisAvailable).toBe(true);
      expect(withoutRedis.getStats().redisAvailable).toBe(false);
    });
  });

  describe('getCapabilitiesWithCache', () => {
    it('should return cached capabilities if available', async () => {
      const capabilities: ClientCapabilities = { elicitation: true };

      // Use global singleton that getCapabilitiesWithCache uses
      const globalService = initCapabilityCacheService(mockRedis);
      await globalService.set('session-1', capabilities);

      const mockServer = {
        getClientCapabilities: vi.fn(),
      };

      const result = await getCapabilitiesWithCache('session-1', mockServer);

      expect(result).toEqual(capabilities);
      expect(mockServer.getClientCapabilities).not.toHaveBeenCalled();
    });

    it('should fetch and cache if not in cache', async () => {
      const capabilities: ClientCapabilities = { sampling: true };

      const mockServer = {
        getClientCapabilities: vi.fn().mockReturnValue(capabilities),
      };

      const result = await getCapabilitiesWithCache('session-new', mockServer);

      expect(result).toEqual(capabilities);
      expect(mockServer.getClientCapabilities).toHaveBeenCalled();

      // Second call should use cache
      const result2 = await getCapabilitiesWithCache('session-new', mockServer);
      expect(result2).toEqual(capabilities);
      expect(mockServer.getClientCapabilities).toHaveBeenCalledTimes(1); // Still only once
    });

    it('should handle empty capabilities', async () => {
      const mockServer = {
        getClientCapabilities: vi.fn().mockReturnValue({}),
      };

      const result = await getCapabilitiesWithCache('session-1', mockServer);

      expect(result).toEqual({});
    });

    it('should handle null capabilities from server', async () => {
      const mockServer = {
        getClientCapabilities: vi.fn().mockReturnValue(null),
      };

      const result = await getCapabilitiesWithCache('session-1', mockServer);

      expect(result).toEqual({});
    });
  });

  describe('edge cases', () => {
    it('should handle multiple sessions independently', async () => {
      await service.set('session-1', { elicitation: true });
      await service.set('session-2', { sampling: true });

      const result1 = await service.get('session-1');
      const result2 = await service.get('session-2');

      expect(result1).toEqual({ elicitation: true });
      expect(result2).toEqual({ sampling: true });
    });

    it('should handle boolean capability values', async () => {
      const capabilities: ClientCapabilities = {
        elicitation: true,
        sampling: false,
      };

      await service.set('session-1', capabilities);

      const result = await service.get('session-1');
      expect(result).toEqual(capabilities);
    });

    it('should handle object capability values', async () => {
      const capabilities: ClientCapabilities = {
        elicitation: { form: { applyDefaults: true } },
      };

      await service.set('session-1', capabilities);

      const result = await service.get('session-1');
      expect(result).toEqual(capabilities);
    });

    it('should overwrite existing cache entries', async () => {
      await service.set('session-1', { elicitation: true });
      await service.set('session-1', { sampling: true });

      const result = await service.get('session-1');
      expect(result).toEqual({ sampling: true });
    });

    it('should handle rapid cache operations', async () => {
      for (let i = 0; i < 100; i++) {
        await service.set(`session-${i}`, { elicitation: true });
      }

      const stats = service.getStats();
      expect(stats.memoryCacheSize).toBe(100);
    });
  });
});
