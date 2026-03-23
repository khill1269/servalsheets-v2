import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveRateLimiter } from '../../src/utils/drive-rate-limiter.js';

describe('DriveRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows first three acquires without waiting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const limiter = new DriveRateLimiter();

    await expect(limiter.acquire()).resolves.toBeUndefined();
    await expect(limiter.acquire()).resolves.toBeUndefined();
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });

  it('throttles the fourth acquire until token refill', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const limiter = new DriveRateLimiter();

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    let resolved = false;
    const fourth = limiter.acquire().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await fourth;
    expect(resolved).toBe(true);
  });

  it('refills to three tokens per second window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const limiter = new DriveRateLimiter();

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    await vi.advanceTimersByTimeAsync(1000);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    let blocked = true;
    const seventh = limiter.acquire().then(() => {
      blocked = false;
    });
    await Promise.resolve();
    expect(blocked).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await seventh;
    expect(blocked).toBe(false);
  });
});
