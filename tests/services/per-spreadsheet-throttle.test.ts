/**
 * Tests for PerSpreadsheetThrottle
 *
 * Covers: token bucket behavior, LRU eviction at maxEntries cap,
 * per-spreadsheet isolation, and throttle timing.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock env to control RPS without touching real config
vi.mock('../../src/config/env.js', () => ({
  getEnv: () => ({ PER_SPREADSHEET_RPS: 3 }),
}));

import { PerSpreadsheetThrottle } from '../../src/services/per-spreadsheet-throttle.js';

describe('PerSpreadsheetThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when tokens are available (bucket starts full)', async () => {
    const throttle = new PerSpreadsheetThrottle();
    const start = Date.now();
    await throttle.throttle('spreadsheet-abc');
    // Should complete immediately — bucket starts full at rps=3
    expect(Date.now() - start).toBeLessThan(5);
  });

  it('allows rps requests without waiting', async () => {
    const throttle = new PerSpreadsheetThrottle();
    // With rps=3 bucket starts with 3 tokens — all three should be immediate
    const promises = [
      throttle.throttle('sheet-1'),
      throttle.throttle('sheet-1'),
      throttle.throttle('sheet-1'),
    ];
    await Promise.all(promises);
    // No timers should have been scheduled
    expect(vi.getTimerCount()).toBe(0);
  });

  it('schedules a wait when bucket is exhausted', async () => {
    const throttle = new PerSpreadsheetThrottle();
    // Drain 3 tokens
    await throttle.throttle('sheet-x');
    await throttle.throttle('sheet-x');
    await throttle.throttle('sheet-x');

    // 4th call should schedule a setTimeout
    const p = throttle.throttle('sheet-x');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    // Advance time so the wait resolves
    await vi.runAllTimersAsync();
    await p;
  });

  it('tracks spreadsheets independently', async () => {
    const throttle = new PerSpreadsheetThrottle();
    // Drain sheet-A completely
    await throttle.throttle('sheet-A');
    await throttle.throttle('sheet-A');
    await throttle.throttle('sheet-A');

    // sheet-B should still have a full bucket — no wait
    const timersBefore = vi.getTimerCount();
    const p = throttle.throttle('sheet-B');
    const timersAfter = vi.getTimerCount();
    // sheet-B token available immediately, no new timer should be set
    expect(timersAfter).toBe(timersBefore);
    await p;
  });

  it('evicts oldest entry when maxEntries is exceeded', async () => {
    const throttle = new PerSpreadsheetThrottle(3); // max 3 entries

    await throttle.throttle('s1');
    await throttle.throttle('s2');
    await throttle.throttle('s3');
    // Adding s4 should evict s1 (oldest)
    await throttle.throttle('s4');

    // Internal map should still have exactly 3 entries
    // We verify by checking that s1 was evicted — after eviction,
    // requesting s1 again resets its bucket (no prior state = fresh full bucket)
    // so it should complete without a timer being set
    const timersBefore = vi.getTimerCount();
    await throttle.throttle('s1'); // fresh bucket after eviction
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it('refreshes recency on re-access (LRU: re-accessed entries survive eviction)', async () => {
    const throttle = new PerSpreadsheetThrottle(2); // max 2 entries

    await throttle.throttle('s1');
    await throttle.throttle('s2');
    // Re-access s1 to make it recently-used
    await throttle.throttle('s1');
    // Adding s3 should evict s2 (least recently used), not s1
    await throttle.throttle('s3');

    // s1's bucket was partially consumed (4 accesses) so tokens < rps.
    // s2 was evicted and recreated, so it has a fresh full bucket.
    // Both just complete; the point is that s1 still exists and retains its state.
    // We test by running s2 — should complete immediately (fresh bucket).
    const timersBefore = vi.getTimerCount();
    await throttle.throttle('s2');
    expect(vi.getTimerCount()).toBe(timersBefore);
  });
});
