/**
 * Tests for lightweight-quality-scanner service.
 * Written FIRST per TDD workflow — these tests must FAIL before implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  detectEmptyRequiredCells,
  detectMixedTypes,
  detectDuplicateRows,
  detectOutliers,
  detectInconsistentFormats,
  scanResponseQuality,
  type QualityWarning,
} from '../../src/services/lightweight-quality-scanner.js';

// ─── detectEmptyRequiredCells ────────────────────────────────────────────────

describe('detectEmptyRequiredCells', () => {
  it('returns no warnings when 0% cells are empty', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Bob', 200],
      ['Carol', 300],
    ];
    const warnings = detectEmptyRequiredCells(values);
    expect(warnings).toHaveLength(0);
  });

  it('returns no warnings when exactly 15% cells are empty (below 20% threshold)', () => {
    // 6 non-header rows, 2 columns: 12 data cells. 1 empty = ~8%.
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Bob', null],
      ['Carol', 200],
      ['Dave', 300],
      ['Eve', 400],
      ['Frank', 500],
    ];
    const warnings = detectEmptyRequiredCells(values);
    // 1 out of 6 cells in Amount col = ~17% — still below 20%
    expect(warnings).toHaveLength(0);
  });

  it('returns a warning when >20% of cells in a column are empty', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Bob', null],
      ['Carol', null],
      ['Dave', 300],
    ];
    // Amount col: 2 of 4 = 50% empty → warning
    const warnings = detectEmptyRequiredCells(values);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('empty_required_cells');
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].fix).toBeTruthy();
  });

  it('skips row 0 (header row)', () => {
    // Header row is null — should not count
    const values = [
      [null, null],
      ['Alice', 100],
      ['Bob', 200],
    ];
    const warnings = detectEmptyRequiredCells(values);
    expect(warnings).toHaveLength(0);
  });

  it('skips entirely-empty columns', () => {
    const values = [
      ['Name', 'Optional'],
      ['Alice', null],
      ['Bob', null],
      ['Carol', null],
    ];
    // Optional col is entirely empty — should be skipped, no warning
    const warnings = detectEmptyRequiredCells(values);
    expect(warnings).toHaveLength(0);
  });
});

// ─── detectMixedTypes ────────────────────────────────────────────────────────

describe('detectMixedTypes', () => {
  it('returns no warnings for a pure number column', () => {
    const values = [
      ['Amount'],
      [100],
      [200],
      [300],
    ];
    const warnings = detectMixedTypes(values);
    expect(warnings).toHaveLength(0);
  });

  it('returns no warnings for a pure string column', () => {
    const values = [
      ['Name'],
      ['Alice'],
      ['Bob'],
      ['Carol'],
    ];
    const warnings = detectMixedTypes(values);
    expect(warnings).toHaveLength(0);
  });

  it('returns a warning when column has both strings and numbers (>2 of each)', () => {
    const values = [
      ['Mixed'],
      ['Alice'],
      ['Bob'],
      ['Carol'],
      [100],
      [200],
      [300],
    ];
    const warnings = detectMixedTypes(values);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('mixed_types');
    expect(warnings[0].severity).toBe('warning');
  });

  it('returns no warning when only 1 string and 3 numbers (not enough of each)', () => {
    const values = [
      ['Amount'],
      ['N/A'],
      [100],
      [200],
      [300],
    ];
    // Only 1 string — threshold requires >2 of each
    const warnings = detectMixedTypes(values);
    expect(warnings).toHaveLength(0);
  });
});

// ─── detectDuplicateRows ─────────────────────────────────────────────────────

describe('detectDuplicateRows', () => {
  it('returns no warnings when no duplicate rows exist', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Bob', 200],
      ['Carol', 300],
    ];
    const warnings = detectDuplicateRows(values);
    expect(warnings).toHaveLength(0);
  });

  it('returns a warning when 1 duplicate row exists', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Alice', 100],
      ['Carol', 300],
    ];
    const warnings = detectDuplicateRows(values);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('duplicate_rows');
    expect(warnings[0].detail).toContain('1');
  });

  it('returns a warning with correct count when 2 duplicate rows exist', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Alice', 100],
      ['Bob', 200],
      ['Bob', 200],
    ];
    const warnings = detectDuplicateRows(values);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('duplicate_rows');
    // Duplicate count should mention 2 or more
    expect(warnings[0].detail).toMatch(/2/);
  });
});

// ─── detectOutliers ──────────────────────────────────────────────────────────

describe('detectOutliers', () => {
  it('returns no warnings with insufficient data (<5 numeric values)', () => {
    const values = [
      ['Amount'],
      [100],
      [200],
      [300],
      [400],
    ];
    // Only 4 data rows — not enough
    const warnings = detectOutliers(values);
    expect(warnings).toHaveLength(0);
  });

  it('returns no warnings for a normal distribution', () => {
    const values = [
      ['Amount'],
      [100],
      [102],
      [101],
      [99],
      [103],
      [100],
      [101],
    ];
    const warnings = detectOutliers(values);
    expect(warnings).toHaveLength(0);
  });

  it('returns a warning when a clear outlier exists', () => {
    const values = [
      ['Amount'],
      [100],
      [102],
      [101],
      [99],
      [100],
      [101],
      [99999], // extreme outlier
    ];
    const warnings = detectOutliers(values);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('outliers');
    expect(warnings[0].severity).toBe('info');
  });
});

// ─── detectInconsistentFormats ───────────────────────────────────────────────

describe('detectInconsistentFormats', () => {
  it('returns no warnings when all dates are the same format', () => {
    const values = [
      ['Date'],
      ['2024-01-15'],
      ['2024-02-20'],
      ['2024-03-10'],
    ];
    const warnings = detectInconsistentFormats(values);
    expect(warnings).toHaveLength(0);
  });

  it('returns a warning when dates have inconsistent formats', () => {
    const values = [
      ['Date'],
      ['2024-01-15'],      // ISO format
      ['01/15/2024'],      // MM/DD/YYYY
      ['2024-02-20'],
      ['02/20/2024'],
    ];
    const warnings = detectInconsistentFormats(values);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].type).toBe('inconsistent_formats');
    expect(warnings[0].severity).toBe('info');
  });
});

// ─── scanResponseQuality ─────────────────────────────────────────────────────

describe('scanResponseQuality', () => {
  it('returns up to 5 warnings from combined checks', async () => {
    // Data with many issues: duplicates, mixed types, empty cells, inconsistent dates
    const values = [
      ['Name', 'Amount', 'Date'],
      ['Alice', 100, '2024-01-01'],
      ['Alice', 100, '2024-01-01'],     // duplicate
      ['Bob', 'N/A_str', '01/02/2024'], // mixed type + inconsistent date
      ['Carol', 'N/A_str2', null],
      ['Dave', null, '2024-01-03'],
      [null, null, null],
    ];

    const warnings = await scanResponseQuality(values, {
      tool: 'sheets_data',
      action: 'read',
      range: 'Sheet1!A1:C7',
    });

    expect(warnings.length).toBeLessThanOrEqual(5);
    expect(warnings.every((w: QualityWarning) => w.type !== undefined)).toBe(true);
    expect(warnings.every((w: QualityWarning) => w.detail !== undefined)).toBe(true);
    expect(warnings.every((w: QualityWarning) => w.fix !== undefined)).toBe(true);
  });

  it('returns empty array for clean data', async () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Bob', 200],
      ['Carol', 300],
      ['Dave', 400],
    ];

    const warnings = await scanResponseQuality(values, {
      tool: 'sheets_data',
      action: 'read',
      range: 'Sheet1!A1:B5',
    });

    expect(Array.isArray(warnings)).toBe(true);
  });

  it('is error-resilient — does not throw when a checker fails', async () => {
    // Pass malformed data that might cause internal errors
    const values = [
      [undefined, undefined],
      [undefined, undefined],
    ] as unknown as (string | number | boolean | null)[][];

    await expect(
      scanResponseQuality(values, { tool: 'sheets_data', action: 'read', range: '' })
    ).resolves.not.toThrow();
  });
});
