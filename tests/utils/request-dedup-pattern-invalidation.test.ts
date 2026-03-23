/**
 * Tests for pattern-based cache invalidation fix in RequestDeduplicator.
 *
 * Verifies that invalidateCache() matches patterns against original
 * request keys (not SHA-256 hashes), and that invalidateSpreadsheet()
 * correctly targets entries for a specific spreadsheet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RequestDeduplicator } from '../../src/utils/request-deduplication.js';

describe('RequestDeduplicator - Pattern-based Cache Invalidation', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    deduplicator = new RequestDeduplicator({
      enabled: true,
      resultCacheEnabled: true,
      resultCacheTTL: 60000, // 1 minute
      resultCacheMaxSize: 100,
    });
  });

  afterEach(() => {
    deduplicator.destroy();
  });

  it('should invalidate cache entries by pattern matching against original request keys', async () => {
    // Populate cache with entries for different spreadsheets
    await deduplicator.deduplicate('spreadsheet:abc123:values:Sheet1!A1:Z100', async () => ({
      values: [['a']],
    }));
    await deduplicator.deduplicate('spreadsheet:abc123:values:Sheet2!A1:Z100', async () => ({
      values: [['b']],
    }));
    await deduplicator.deduplicate('spreadsheet:xyz789:values:Sheet1!A1:Z100', async () => ({
      values: [['c']],
    }));

    const stats = deduplicator.getStats();
    expect(stats.resultCacheSize).toBe(3);

    // Invalidate entries for spreadsheet abc123
    const invalidated = deduplicator.invalidateCache(/^spreadsheet:abc123:/);
    expect(invalidated).toBe(2);

    // Only xyz789 entry should remain
    const afterStats = deduplicator.getStats();
    expect(afterStats.resultCacheSize).toBe(1);
  });

  it('should invalidate entries by string pattern', async () => {
    await deduplicator.deduplicate('op:read:id:sheet1', async () => 'data1');
    await deduplicator.deduplicate('op:write:id:sheet1', async () => 'data2');
    await deduplicator.deduplicate('op:read:id:sheet2', async () => 'data3');

    // Invalidate all read operations
    const invalidated = deduplicator.invalidateCache('op:read');
    expect(invalidated).toBe(2);
    expect(deduplicator.getStats().resultCacheSize).toBe(1);
  });

  it('should invalidateSpreadsheet using targeted key matching', async () => {
    const ssId = '1Sz5aRCE1D17NI4BT6KGiGCA7cSpbQ1vPM5BoskkzrM4';
    const otherId = '2Tz6bSDf2E28OJ5CU7LHhHDB8dTqcR2wQN6CptllasN5';

    await deduplicator.deduplicate(`get:${ssId}:Sheet1!A1:Z100`, async () => 'data1');
    await deduplicator.deduplicate(`get:${ssId}:Sheet2!A1:B10`, async () => 'data2');
    await deduplicator.deduplicate(`get:${otherId}:Sheet1!A1:Z100`, async () => 'data3');

    expect(deduplicator.getStats().resultCacheSize).toBe(3);

    // Should only remove entries for the targeted spreadsheet
    const invalidated = deduplicator.invalidateSpreadsheet(ssId);
    expect(invalidated).toBe(2);
    expect(deduplicator.getStats().resultCacheSize).toBe(1);
  });

  it('should return cached result after initial call and miss after invalidation', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return { result: callCount };
    };

    // First call — populates cache
    const first = await deduplicator.deduplicate('spreadsheet:abc:values:A1', fetcher);
    expect(first).toEqual({ result: 1 });
    expect(callCount).toBe(1);

    // Second call — cache hit, no API call
    const second = await deduplicator.deduplicate('spreadsheet:abc:values:A1', fetcher);
    expect(second).toEqual({ result: 1 });
    expect(callCount).toBe(1);

    // Invalidate
    deduplicator.invalidateCache(/spreadsheet:abc/);

    // Third call — cache miss, new API call
    const third = await deduplicator.deduplicate('spreadsheet:abc:values:A1', fetcher);
    expect(third).toEqual({ result: 2 });
    expect(callCount).toBe(2);
  });
});
