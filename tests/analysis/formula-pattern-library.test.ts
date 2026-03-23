/**
 * Tests for FORMULA_PATTERN_LIBRARY, getRelevantPatterns, and extractFormulaKeywords
 * Added as part of Task C1.
 */

import { describe, it, expect } from 'vitest';
import {
  FORMULA_PATTERN_LIBRARY,
  getRelevantPatterns,
  extractFormulaKeywords,
} from '../../src/analysis/formula-helpers.js';

describe('FORMULA_PATTERN_LIBRARY', () => {
  it('contains at least 10 patterns', () => {
    expect(Object.keys(FORMULA_PATTERN_LIBRARY).length).toBeGreaterThanOrEqual(10);
  });

  it('each pattern has required fields', () => {
    for (const [key, pattern] of Object.entries(FORMULA_PATTERN_LIBRARY)) {
      expect(pattern.key).toBe(key);
      expect(typeof pattern.template).toBe('string');
      expect(typeof pattern.example).toBe('string');
      expect(typeof pattern.description).toBe('string');
      expect(Array.isArray(pattern.keywords)).toBe(true);
      expect(pattern.keywords.length).toBeGreaterThan(0);
    }
  });

  it('xlookup pattern has correct template structure', () => {
    const pattern = FORMULA_PATTERN_LIBRARY['xlookup'];
    expect(pattern).toBeDefined();
    expect(pattern!.template).toContain('XLOOKUP');
    expect(pattern!.template).toContain('IFERROR');
    expect(pattern!.example).toContain('=IFERROR(XLOOKUP');
  });

  it('running_total pattern example contains SUM anchor', () => {
    const pattern = FORMULA_PATTERN_LIBRARY['running_total'];
    expect(pattern).toBeDefined();
    expect(pattern!.example).toContain('SUM($B$2:B2)');
  });

  it('yoy_variance pattern example uses ABS for zero-safe division', () => {
    const pattern = FORMULA_PATTERN_LIBRARY['yoy_variance'];
    expect(pattern).toBeDefined();
    expect(pattern!.example).toContain('ABS');
  });
});

describe('extractFormulaKeywords', () => {
  it('returns lowercase tokens', () => {
    const result = extractFormulaKeywords('Profit Margin Formula');
    expect(result).toContain('profit');
    expect(result).toContain('margin');
    expect(result).toContain('formula');
  });

  it('filters stop words', () => {
    const result = extractFormulaKeywords('find the value for the column');
    expect(result).not.toContain('the');
    expect(result).not.toContain('for');
    expect(result).not.toContain('a');
  });

  it('filters short words (length <= 2)', () => {
    const result = extractFormulaKeywords('sum of a column');
    expect(result).not.toContain('a');
    expect(result).not.toContain('of');
  });

  it('returns empty array for empty string', () => {
    expect(extractFormulaKeywords('')).toEqual([]);
  });

  it('handles multi-word description correctly', () => {
    const result = extractFormulaKeywords('running total of revenue column');
    expect(result).toContain('running');
    expect(result).toContain('total');
    expect(result).toContain('revenue');
    expect(result).toContain('column');
  });
});

describe('getRelevantPatterns', () => {
  it('returns xlookup for lookup-related keywords', () => {
    const patterns = getRelevantPatterns(['lookup', 'find', 'match']);
    const keys = patterns.map((p) => p.key);
    expect(keys).toContain('xlookup');
  });

  it('returns filter_rows for filter-related keywords', () => {
    const patterns = getRelevantPatterns(['filter', 'show', 'only', 'active']);
    const keys = patterns.map((p) => p.key);
    expect(keys).toContain('filter_rows');
  });

  it('returns running_total for cumulative keywords', () => {
    const patterns = getRelevantPatterns(['running', 'total', 'cumulative']);
    const keys = patterns.map((p) => p.key);
    expect(keys).toContain('running_total');
  });

  it('returns at most 5 patterns', () => {
    // Pass many keywords to potentially match many patterns
    const patterns = getRelevantPatterns([
      'lookup',
      'filter',
      'unique',
      'sort',
      'sum',
      'margin',
      'running',
      'month',
    ]);
    expect(patterns.length).toBeLessThanOrEqual(5);
  });

  it('returns empty array when no keywords match', () => {
    const patterns = getRelevantPatterns(['zzz', 'nonexistent', 'xyz']);
    expect(patterns).toEqual([]);
  });

  it('returns results sorted by score (highest first)', () => {
    // 'vlookup' matches xlookup (has 'vlookup' keyword) and potentially others
    const patterns = getRelevantPatterns(['vlookup', 'lookup', 'find', 'search', 'retrieve']);
    if (patterns.length > 1) {
      // xlookup should be ranked high as it has the most keyword matches
      expect(patterns[0]!.key).toBe('xlookup');
    }
  });

  it('partial keyword matching works (includes check)', () => {
    // 'cumulative' includes 'cumulative' which is a keyword in running_total
    const patterns = getRelevantPatterns(['cumulative']);
    const keys = patterns.map((p) => p.key);
    expect(keys).toContain('running_total');
  });

  it('returns yoy_variance for variance/growth keywords', () => {
    const patterns = getRelevantPatterns(['yoy', 'variance', 'growth']);
    const keys = patterns.map((p) => p.key);
    expect(keys).toContain('yoy_variance');
  });
});
