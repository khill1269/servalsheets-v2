/**
 * Cache Invalidation Tests
 * Tests for precise A1 notation range intersection algorithm
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CacheManager } from '../../src/utils/cache-manager.js';

describe('Range Intersection - Basic Intersection', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ enabled: true });
  });

  it('A1:A10 intersects A5:A15 (overlapping same column)', () => {
    // Setup: Cache A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');

    // Action: Invalidate A5:A15 (should overlap with A1:A10)
    const invalidated = cache.invalidateRange('sheet1', 'A5:A15');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('A1:B10 does not intersect C1:D10 (different columns)', () => {
    // Setup: Cache A1:B10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:B10', 'test:key1');

    // Action: Invalidate C1:D10 (should NOT overlap)
    const invalidated = cache.invalidateRange('sheet1', 'C1:D10');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('A1:B10 intersects B5:C15 (partial column overlap)', () => {
    // Setup: Cache A1:B10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:B10', 'test:key1');

    // Action: Invalidate B5:C15 (column B overlaps)
    const invalidated = cache.invalidateRange('sheet1', 'B5:C15');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('A1:D10 does not intersect A11:D20 (different rows)', () => {
    // Setup: Cache A1:D10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:D10', 'test:key1');

    // Action: Invalidate A11:D20 (adjacent rows, no overlap)
    const invalidated = cache.invalidateRange('sheet1', 'A11:D20');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('A1:D10 intersects C8:F12 (corner overlap)', () => {
    // Setup: Cache A1:D10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:D10', 'test:key1');

    // Action: Invalidate C8:F12 (overlaps bottom-right corner)
    const invalidated = cache.invalidateRange('sheet1', 'C8:F12');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });
});

describe('Range Intersection - Sheet Names', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ enabled: true });
  });

  it('Sheet1!A1:A10 does not intersect Sheet2!A1:A10 (different sheets)', () => {
    // Setup: Cache Sheet1!A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'Sheet1!A1:A10', 'test:key1');

    // Action: Invalidate Sheet2!A1:A10 (different sheet)
    const invalidated = cache.invalidateRange('sheet1', 'Sheet2!A1:A10');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('Sheet1!A1:B10 intersects Sheet1!B5:C15 (same sheet, overlaps)', () => {
    // Setup: Cache Sheet1!A1:B10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'Sheet1!A1:B10', 'test:key1');

    // Action: Invalidate Sheet1!B5:C15 (same sheet, column B overlaps)
    const invalidated = cache.invalidateRange('sheet1', 'Sheet1!B5:C15');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it("handles sheet names with spaces ('My Sheet'!A1:A10)", () => {
    // Setup: Cache 'My Sheet'!A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', "'My Sheet'!A1:A10", 'test:key1');

    // Action: Invalidate 'My Sheet'!A5:A15 (overlaps)
    const invalidated = cache.invalidateRange('sheet1', "'My Sheet'!A5:A15");

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('handles sheet names with special characters', () => {
    // Setup: Cache 'Q1-2024 (Draft)'!A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', "'Q1-2024 (Draft)'!A1:A10", 'test:key1');

    // Action: Invalidate 'Q1-2024 (Draft)'!A5:A15 (overlaps)
    const invalidated = cache.invalidateRange('sheet1', "'Q1-2024 (Draft)'!A5:A15");

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('sheet name only range invalidates all ranges on that sheet', () => {
    // Setup: Cache Sheet1!A1:A10 and Sheet1!B1:B10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.set('key2', 'data2', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'Sheet1!A1:A10', 'test:key1');
    cache.trackRangeDependency('sheet1', 'Sheet1!B1:B10', 'test:key2');

    // Action: Invalidate Sheet1 (entire sheet)
    const invalidated = cache.invalidateRange('sheet1', 'Sheet1');

    // Assertion: Both should be invalidated
    expect(invalidated).toBeGreaterThanOrEqual(2);
    expect(cache.has('key1', 'test')).toBe(false);
    expect(cache.has('key2', 'test')).toBe(false);
  });
});

describe('Range Intersection - Open-Ended Ranges', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ enabled: true });
  });

  it('A:A intersects A1:A10 (entire column A)', () => {
    // Setup: Cache A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');

    // Action: Invalidate A:A (entire column A)
    const invalidated = cache.invalidateRange('sheet1', 'A:A');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('B:B does not intersect A1:A10 (different column)', () => {
    // Setup: Cache A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');

    // Action: Invalidate B:B (entire column B)
    const invalidated = cache.invalidateRange('sheet1', 'B:B');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('1:1 intersects A1:Z1 (entire row 1)', () => {
    // Setup: Cache A1:Z1
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:Z1', 'test:key1');

    // Action: Invalidate 1:1 (entire row 1)
    const invalidated = cache.invalidateRange('sheet1', '1:1');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('2:2 does not intersect A1:Z1 (different row)', () => {
    // Setup: Cache A1:Z1
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:Z1', 'test:key1');

    // Action: Invalidate 2:2 (entire row 2)
    const invalidated = cache.invalidateRange('sheet1', '2:2');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('A:C intersects B1:D10 (overlapping columns)', () => {
    // Setup: Cache B1:D10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'B1:D10', 'test:key1');

    // Action: Invalidate A:C (columns A-C)
    const invalidated = cache.invalidateRange('sheet1', 'A:C');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('1:5 intersects A3:Z10 (overlapping rows)', () => {
    // Setup: Cache A3:Z10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A3:Z10', 'test:key1');

    // Action: Invalidate 1:5 (rows 1-5)
    const invalidated = cache.invalidateRange('sheet1', '1:5');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });
});

describe('Range Intersection - Edge Cases', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ enabled: true });
  });

  it('single cell A1 intersects range A1:A10', () => {
    // Setup: Cache A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');

    // Action: Invalidate A1 (single cell)
    const invalidated = cache.invalidateRange('sheet1', 'A1');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('single cell B5 does not intersect range A1:A10', () => {
    // Setup: Cache A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');

    // Action: Invalidate B5 (single cell outside range)
    const invalidated = cache.invalidateRange('sheet1', 'B5');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('adjacent ranges do not intersect (A1:B10 vs C1:D10)', () => {
    // Setup: Cache A1:B10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:B10', 'test:key1');

    // Action: Invalidate C1:D10 (adjacent columns)
    const invalidated = cache.invalidateRange('sheet1', 'C1:D10');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('adjacent ranges do not intersect (A1:A10 vs A11:A20)', () => {
    // Setup: Cache A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');

    // Action: Invalidate A11:A20 (adjacent rows)
    const invalidated = cache.invalidateRange('sheet1', 'A11:A20');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('nested ranges intersect (A1:D10 contains B2:C5)', () => {
    // Setup: Cache A1:D10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:D10', 'test:key1');

    // Action: Invalidate B2:C5 (nested inside)
    const invalidated = cache.invalidateRange('sheet1', 'B2:C5');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('nested ranges intersect (B2:C5 is contained by A1:D10)', () => {
    // Setup: Cache B2:C5
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'B2:C5', 'test:key1');

    // Action: Invalidate A1:D10 (contains B2:C5)
    const invalidated = cache.invalidateRange('sheet1', 'A1:D10');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('equal ranges intersect', () => {
    // Setup: Cache A1:B10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:B10', 'test:key1');

    // Action: Invalidate A1:B10 (exact same range)
    const invalidated = cache.invalidateRange('sheet1', 'A1:B10');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('reversed range notation A10:A1 is normalized and intersects', () => {
    // Setup: Cache A1:A10 (normal order)
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');

    // Action: Invalidate A10:A1 (reversed notation)
    const invalidated = cache.invalidateRange('sheet1', 'A10:A1');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });
});

describe('Range Intersection - Column Letter Conversion', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ enabled: true });
  });

  it('handles single letter columns (A-Z)', () => {
    // Setup: Cache A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');

    // Action: Invalidate Z1:Z10 (should not overlap)
    const invalidated = cache.invalidateRange('sheet1', 'Z1:Z10');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('handles double letter columns (AA, AB, etc.)', () => {
    // Setup: Cache AA1:AA10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'AA1:AA10', 'test:key1');

    // Action: Invalidate AA5:AA15 (should overlap)
    const invalidated = cache.invalidateRange('sheet1', 'AA5:AA15');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('AA1:AB10 does not intersect Z1:Z10 (AA is column 27, Z is 26)', () => {
    // Setup: Cache Z1:Z10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'Z1:Z10', 'test:key1');

    // Action: Invalidate AA1:AB10 (adjacent column, no overlap)
    const invalidated = cache.invalidateRange('sheet1', 'AA1:AB10');

    // Assertion
    expect(invalidated).toBe(0);
    expect(cache.has('key1', 'test')).toBe(true);
  });

  it('handles triple letter columns (AAA)', () => {
    // Setup: Cache AAA1:AAA10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'AAA1:AAA10', 'test:key1');

    // Action: Invalidate AAA5:AAA15 (should overlap)
    const invalidated = cache.invalidateRange('sheet1', 'AAA5:AAA15');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });
});

describe('Cache Invalidation Integration', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ enabled: true });
  });

  it('Write A1:A10, cache B1:B10 remains', () => {
    // Setup: Cache both A1:A10 and B1:B10
    cache.set('keyA', 'dataA', { namespace: 'test' });
    cache.set('keyB', 'dataB', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:keyA');
    cache.trackRangeDependency('sheet1', 'B1:B10', 'test:keyB');

    // Action: Write to A1:A10
    const invalidated = cache.invalidateRange('sheet1', 'A1:A10');

    // Assertion: Only A invalidated, B remains
    expect(invalidated).toBe(1);
    expect(cache.has('keyA', 'test')).toBe(false);
    expect(cache.has('keyB', 'test')).toBe(true);
  });

  it('Write A1:A10, cache A5:A15 invalidated', () => {
    // Setup: Cache A5:A15
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A5:A15', 'test:key1');

    // Action: Write to A1:A10 (overlaps with A5:A15)
    const invalidated = cache.invalidateRange('sheet1', 'A1:A10');

    // Assertion: Cache invalidated
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('Multiple writes to non-overlapping ranges preserve cache', () => {
    // Setup: Cache A1:A10, C1:C10, E1:E10
    cache.set('keyA', 'dataA', { namespace: 'test' });
    cache.set('keyC', 'dataC', { namespace: 'test' });
    cache.set('keyE', 'dataE', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:keyA');
    cache.trackRangeDependency('sheet1', 'C1:C10', 'test:keyC');
    cache.trackRangeDependency('sheet1', 'E1:E10', 'test:keyE');

    // Action: Write to B1:B10 (doesn't overlap any cached ranges)
    const invalidated = cache.invalidateRange('sheet1', 'B1:B10');

    // Assertion: No cache invalidated
    expect(invalidated).toBe(0);
    expect(cache.has('keyA', 'test')).toBe(true);
    expect(cache.has('keyC', 'test')).toBe(true);
    expect(cache.has('keyE', 'test')).toBe(true);
  });

  it('Write to large range invalidates multiple overlapping caches', () => {
    // Setup: Cache A1:A10, B5:B15, C1:C10
    cache.set('keyA', 'dataA', { namespace: 'test' });
    cache.set('keyB', 'dataB', { namespace: 'test' });
    cache.set('keyC', 'dataC', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:keyA');
    cache.trackRangeDependency('sheet1', 'B5:B15', 'test:keyB');
    cache.trackRangeDependency('sheet1', 'C1:C10', 'test:keyC');

    // Action: Write to A1:C10 (overlaps all three)
    const invalidated = cache.invalidateRange('sheet1', 'A1:C10');

    // Assertion: All three invalidated
    expect(invalidated).toBe(3);
    expect(cache.has('keyA', 'test')).toBe(false);
    expect(cache.has('keyB', 'test')).toBe(false);
    expect(cache.has('keyC', 'test')).toBe(false);
  });

  it('Partial overlap only invalidates overlapping ranges', () => {
    // Setup: Cache A1:B10, C1:D10, E1:F10
    cache.set('keyAB', 'dataAB', { namespace: 'test' });
    cache.set('keyCD', 'dataCD', { namespace: 'test' });
    cache.set('keyEF', 'dataEF', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:B10', 'test:keyAB');
    cache.trackRangeDependency('sheet1', 'C1:D10', 'test:keyCD');
    cache.trackRangeDependency('sheet1', 'E1:F10', 'test:keyEF');

    // Action: Write to B5:C15 (overlaps AB and CD, not EF)
    const invalidated = cache.invalidateRange('sheet1', 'B5:C15');

    // Assertion: Only AB and CD invalidated, EF remains
    expect(invalidated).toBe(2);
    expect(cache.has('keyAB', 'test')).toBe(false);
    expect(cache.has('keyCD', 'test')).toBe(false);
    expect(cache.has('keyEF', 'test')).toBe(true);
  });

  it('Different spreadsheets with same ranges are independent', () => {
    // Setup: Cache sheet1 A1:A10 and sheet2 A1:A10
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.set('key2', 'data2', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:A10', 'test:key1');
    cache.trackRangeDependency('sheet2', 'A1:A10', 'test:key2');

    // Action: Write to sheet1 A1:A10
    const invalidated = cache.invalidateRange('sheet1', 'A1:A10');

    // Assertion: Only sheet1 invalidated, sheet2 remains
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
    expect(cache.has('key2', 'test')).toBe(true);
  });
});

describe('Range Intersection - Performance Edge Cases', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ enabled: true });
  });

  it('handles very large ranges efficiently', () => {
    // Setup: Cache A1:ZZ1000
    cache.set('key1', 'data1', { namespace: 'test' });
    cache.trackRangeDependency('sheet1', 'A1:ZZ1000', 'test:key1');

    // Action: Invalidate single cell within range
    const invalidated = cache.invalidateRange('sheet1', 'B500');

    // Assertion
    expect(invalidated).toBe(1);
    expect(cache.has('key1', 'test')).toBe(false);
  });

  it('handles 100+ cached ranges with precise invalidation', () => {
    // Setup: Cache 100 non-overlapping 10x10 ranges
    for (let i = 0; i < 100; i++) {
      const row = Math.floor(i / 10) * 20 + 1;
      const col = String.fromCharCode(65 + (i % 10)); // A-J
      const range = `${col}${row}:${col}${row + 9}`;
      cache.set(`key${i}`, `data${i}`, { namespace: 'test' });
      cache.trackRangeDependency('sheet1', range, `test:key${i}`);
    }

    // Action: Invalidate B21:B30 (should only affect one range)
    const invalidated = cache.invalidateRange('sheet1', 'B21:B30');

    // Assertion: Only 1 range invalidated, 99 remain
    expect(invalidated).toBe(1);
    let remainingCount = 0;
    for (let i = 0; i < 100; i++) {
      if (cache.has(`key${i}`, 'test')) {
        remainingCount++;
      }
    }
    expect(remainingCount).toBe(99);
  });
});
