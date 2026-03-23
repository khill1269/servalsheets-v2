/**
 * Tests for UserRateLimiter service
 *
 * Covers: rate limit enforcement, sliding window, burst allowance,
 * graceful degradation without Redis, fail-open on errors, and reset.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserRateLimiter } from '../../src/services/user-rate-limiter.js';

/**
 * Creates a minimal mock Redis client with in-memory storage.
 */
function createMockRedis() {
  const store = new Map<string, number>();
  const ttls = new Map<string, number>();

  return {
    store,
    ttls,
    incr: vi.fn(async (key: string) => {
      const val = (store.get(key) ?? 0) + 1;
      store.set(key, val);
      return val;
    }),
    get: vi.fn(async (key: string) => {
      const val = store.get(key);
      return val !== undefined ? String(val) : null;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      ttls.set(key, seconds);
      return 1;
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      ttls.delete(key);
      return 1;
    }),
    keys: vi.fn(async (pattern: string) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return [...store.keys()].filter((k) => regex.test(k));
    }),
    scan: vi.fn(async (_cursor: number, opts: { MATCH: string; COUNT: number }) => {
      const regex = new RegExp('^' + opts.MATCH.replace(/\*/g, '.*') + '$');
      const matchedKeys = [...store.keys()].filter((k) => regex.test(k));
      return { cursor: 0, keys: matchedKeys };
    }),
  };
}

describe('UserRateLimiter', () => {
  const defaultConfig = {
    requestsPerMinute: 5,
    requestsPerHour: 20,
    burstAllowance: 2,
  };

  describe('with Redis', () => {
    let redis: ReturnType<typeof createMockRedis>;
    let limiter: UserRateLimiter;

    beforeEach(() => {
      redis = createMockRedis();
      limiter = new UserRateLimiter(redis, defaultConfig);
    });

    it('should allow requests within limit', async () => {
      const result = await limiter.checkLimit('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.minuteUsage).toBe(1);
      expect(result.hourUsage).toBe(1);
    });

    it('should track minute usage across calls', async () => {
      for (let i = 0; i < 3; i++) {
        await limiter.checkLimit('user-1');
      }

      const result = await limiter.checkLimit('user-1');
      expect(result.minuteUsage).toBe(4);
      expect(result.hourUsage).toBe(4);
    });

    it('should deny requests exceeding minute limit + burst', async () => {
      // Limit is 5 + 2 burst = 7 allowed
      for (let i = 0; i < 7; i++) {
        const result = await limiter.checkLimit('user-1');
        expect(result.allowed).toBe(true);
      }

      // 8th request should be denied
      const denied = await limiter.checkLimit('user-1');
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
    });

    it('should deny requests exceeding hour limit', async () => {
      // Set hour limit very low for testing
      const limiterLowHour = new UserRateLimiter(redis, {
        requestsPerMinute: 100,
        requestsPerHour: 3,
        burstAllowance: 0,
      });

      for (let i = 0; i < 3; i++) {
        const result = await limiterLowHour.checkLimit('user-2');
        expect(result.allowed).toBe(true);
      }

      const denied = await limiterLowHour.checkLimit('user-2');
      expect(denied.allowed).toBe(false);
    });

    it('should set TTL on first increment', async () => {
      await limiter.checkLimit('user-1');
      expect(redis.expire).toHaveBeenCalledWith(expect.stringContaining(':minute:'), 120);
      expect(redis.expire).toHaveBeenCalledWith(expect.stringContaining(':hour:'), 7200);
    });

    it('should track separate users independently', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('user-1');
      }

      const user2Result = await limiter.checkLimit('user-2');
      expect(user2Result.minuteUsage).toBe(1);
    });

    it('should provide resetAt time', async () => {
      const result = await limiter.checkLimit('user-1');
      expect(result.resetAt).toBeInstanceOf(Date);
      expect(result.resetAt.getTime()).toBeGreaterThan(Date.now() - 60000);
    });
  });

  describe('getUsage', () => {
    it('should return current usage stats', async () => {
      const redis = createMockRedis();
      const limiter = new UserRateLimiter(redis, defaultConfig);

      await limiter.checkLimit('user-1');
      await limiter.checkLimit('user-1');
      await limiter.checkLimit('user-1');

      const usage = await limiter.getUsage('user-1');
      expect(usage.minuteUsage).toBe(3);
      expect(usage.minuteLimit).toBe(5);
      expect(usage.hourUsage).toBe(3);
      expect(usage.hourLimit).toBe(20);
      expect(usage.minuteRemaining).toBe(2);
      expect(usage.hourRemaining).toBe(17);
    });
  });

  describe('resetUser', () => {
    it('should reset user counters', async () => {
      const redis = createMockRedis();
      const limiter = new UserRateLimiter(redis, defaultConfig);

      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('user-1');
      }

      await limiter.resetUser('user-1');

      const usage = await limiter.getUsage('user-1');
      expect(usage.minuteUsage).toBe(0);
      expect(usage.hourUsage).toBe(0);
    });
  });

  describe('without Redis (graceful degradation)', () => {
    let limiter: UserRateLimiter;

    beforeEach(() => {
      limiter = new UserRateLimiter(null, defaultConfig);
    });

    it('should allow all requests when no Redis', async () => {
      const result = await limiter.checkLimit('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it('should return zero usage without Redis', async () => {
      const usage = await limiter.getUsage('user-1');
      expect(usage.minuteUsage).toBe(0);
      expect(usage.hourUsage).toBe(0);
      expect(usage.minuteRemaining).toBe(5);
      expect(usage.hourRemaining).toBe(20);
    });

    it('should handle resetUser without Redis', async () => {
      // Should not throw
      await limiter.resetUser('user-1');
    });

    it('should return empty global stats without Redis', async () => {
      const stats = await limiter.getGlobalStats();
      expect(stats.totalUsers).toBe(0);
      expect(stats.activeUsers).toBe(0);
    });
  });

  describe('fail-open on Redis errors', () => {
    it('should allow requests when Redis throws (using local fallback)', async () => {
      const failingRedis = {
        incr: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
        get: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
        expire: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
        del: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
        keys: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      };

      const limiter = new UserRateLimiter(failingRedis, defaultConfig);
      const result = await limiter.checkLimit('user-1');

      // Falls back to in-memory local limiter (not fail-open with Infinity)
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(defaultConfig.requestsPerMinute - 1);
    });
  });
});
