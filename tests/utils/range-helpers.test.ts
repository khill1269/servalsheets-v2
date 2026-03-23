/**
 * Tests for range-helpers utility
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseRange,
  extractSheetName,
  getRangeParseStats,
  clearRangeParseCache,
} from '../../src/utils/range-helpers.js';

describe('range-helpers', () => {
  beforeEach(() => {
    clearRangeParseCache();
  });

  describe('parseRange', () => {
    it('should parse unquoted sheet name with cell reference', () => {
      const result = parseRange('Sheet1!A1:B10');
      expect(result).toEqual({
        sheetName: 'Sheet1',
        cellRef: 'A1:B10',
        original: 'Sheet1!A1:B10',
      });
    });

    it('should parse quoted sheet name with cell reference', () => {
      const result = parseRange("'Sales Data'!A1:B10");
      expect(result).toEqual({
        sheetName: 'Sales Data',
        cellRef: 'A1:B10',
        original: "'Sales Data'!A1:B10",
      });
    });

    it('should parse quoted sheet name with escaped quotes', () => {
      const result = parseRange("'Sales''s Data'!A1");
      expect(result).toEqual({
        sheetName: "Sales's Data",
        cellRef: 'A1',
        original: "'Sales''s Data'!A1",
      });
    });

    it('should parse unquoted sheet name without cell reference', () => {
      const result = parseRange('Sheet1');
      expect(result).toEqual({
        sheetName: 'Sheet1',
        cellRef: undefined,
        original: 'Sheet1',
      });
    });

    it('should parse quoted sheet name without cell reference', () => {
      const result = parseRange("'Sales Data'");
      expect(result).toEqual({
        sheetName: 'Sales Data',
        cellRef: undefined,
        original: "'Sales Data'",
      });
    });

    it('should parse sheet name with special characters', () => {
      const result = parseRange("'2024-Q1 (Final)'!A1");
      expect(result).toEqual({
        sheetName: '2024-Q1 (Final)',
        cellRef: 'A1',
        original: "'2024-Q1 (Final)'!A1",
      });
    });

    it('should parse sheet name with numbers', () => {
      const result = parseRange('123!A1');
      expect(result).toEqual({
        sheetName: '123',
        cellRef: 'A1',
        original: '123!A1',
      });
    });

    it('should parse single cell reference', () => {
      const result = parseRange('Sheet1!A1');
      expect(result).toEqual({
        sheetName: 'Sheet1',
        cellRef: 'A1',
        original: 'Sheet1!A1',
      });
    });

    it('should parse entire column reference', () => {
      const result = parseRange('Sheet1!A:A');
      expect(result).toEqual({
        sheetName: 'Sheet1',
        cellRef: 'A:A',
        original: 'Sheet1!A:A',
      });
    });

    it('should parse entire row reference', () => {
      const result = parseRange('Sheet1!1:1');
      expect(result).toEqual({
        sheetName: 'Sheet1',
        cellRef: '1:1',
        original: 'Sheet1!1:1',
      });
    });

    it('should handle cache hits for repeated ranges', () => {
      // First call - cache miss
      const result1 = parseRange('Sheet1!A1:B10');
      const stats1 = getRangeParseStats();
      expect(stats1.size).toBe(1);

      // Second call - cache hit
      const result2 = parseRange('Sheet1!A1:B10');
      expect(result2).toEqual(result1);
      expect(result2).toBe(result1); // Same object reference (cached)

      const stats2 = getRangeParseStats();
      expect(stats2.size).toBe(1); // No new entries
    });

    it('should cache multiple different ranges', () => {
      parseRange('Sheet1!A1');
      parseRange('Sheet2!B1');
      parseRange("'Sales Data'!C1");

      const stats = getRangeParseStats();
      expect(stats.size).toBe(3);
    });
  });

  describe('extractSheetName', () => {
    it('should extract sheet name from unquoted range', () => {
      expect(extractSheetName('Sheet1!A1:B10')).toBe('Sheet1');
    });

    it('should extract sheet name from quoted range', () => {
      expect(extractSheetName("'Sales Data'!A1:B10")).toBe('Sales Data');
    });

    it('should extract sheet name with escaped quotes', () => {
      expect(extractSheetName("'Sales''s Data'!A1")).toBe("Sales's Data");
    });

    it('should extract sheet name without cell reference', () => {
      expect(extractSheetName('Sheet1')).toBe('Sheet1');
    });

    it('should handle empty cell reference', () => {
      expect(extractSheetName('Sheet1!')).toBe('Sheet1');
    });
  });

  describe('cache statistics', () => {
    it('should report correct cache size', () => {
      expect(getRangeParseStats().size).toBe(0);

      parseRange('Sheet1!A1');
      expect(getRangeParseStats().size).toBe(1);

      parseRange('Sheet2!B1');
      expect(getRangeParseStats().size).toBe(2);
    });

    it('should report max size', () => {
      const stats = getRangeParseStats();
      expect(stats.maxSize).toBe(500);
    });
  });

  describe('clearRangeParseCache', () => {
    it('should clear all cached entries', () => {
      parseRange('Sheet1!A1');
      parseRange('Sheet2!B1');
      expect(getRangeParseStats().size).toBe(2);

      clearRangeParseCache();
      expect(getRangeParseStats().size).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle sheet names with exclamation marks in quotes', () => {
      const result = parseRange("'Sheet!Name'!A1");
      expect(result.sheetName).toBe('Sheet!Name');
      expect(result.cellRef).toBe('A1');
    });

    it('should handle sheet names with single quotes at start', () => {
      const result = parseRange("'''Sheet'!A1");
      expect(result.sheetName).toBe("'Sheet");
      expect(result.cellRef).toBe('A1');
    });

    it('should handle sheet names with single quotes at end', () => {
      const result = parseRange("'Sheet'''!A1");
      expect(result.sheetName).toBe("Sheet'");
      expect(result.cellRef).toBe('A1');
    });

    it('should handle very long sheet names', () => {
      const longName = 'A'.repeat(200);
      const result = parseRange(`'${longName}'!A1`);
      expect(result.sheetName).toBe(longName);
      expect(result.cellRef).toBe('A1');
    });

    it('should handle ranges without sheet names (fallback)', () => {
      const result = parseRange('A1:B10');
      expect(result.sheetName).toBe('A1:B10');
      expect(result.cellRef).toBeUndefined();
    });

    it('should handle Unicode characters in sheet names', () => {
      const result = parseRange("'日本語シート'!A1");
      expect(result.sheetName).toBe('日本語シート');
      expect(result.cellRef).toBe('A1');
    });

    it('should handle emoji in sheet names', () => {
      const result = parseRange("'📊 Sales Data'!A1");
      expect(result.sheetName).toBe('📊 Sales Data');
      expect(result.cellRef).toBe('A1');
    });
  });

  describe('performance', () => {
    it('should handle high-volume parsing efficiently', () => {
      const ranges = Array.from({ length: 100 }, (_, i) => `Sheet${i}!A1:B10`);

      const start = Date.now();
      ranges.forEach((range) => parseRange(range));
      const duration = Date.now() - start;

      // Should complete in <50ms (uncached)
      expect(duration).toBeLessThan(50);

      // Cache should contain all unique ranges
      expect(getRangeParseStats().size).toBe(100);
    });

    it('should have high cache hit rate for repeated ranges', () => {
      const range = 'Sheet1!A1:B10';

      // Parse same range 1000 times
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        parseRange(range);
      }
      const duration = Date.now() - start;

      // Should complete in <10ms (cached after first)
      expect(duration).toBeLessThan(10);

      // Only 1 entry in cache
      expect(getRangeParseStats().size).toBe(1);
    });
  });
});
