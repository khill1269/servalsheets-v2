/**
 * ServalSheets - Range Operations Property Tests
 *
 * Extended property-based tests for range parsing, normalization, and manipulation.
 * Builds on existing range-parser.property.test.ts with additional edge cases.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseRange,
  extractSheetName,
  normalizeSheetReference,
  clearRangeParseCache,
} from '../../src/utils/range-helpers.js';

describe('Range Operations Property Tests', () => {
  describe('Sheet Name Extraction', () => {
    it('extractSheetName should never return empty string for valid input', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((s) => s.trim().length > 0 && !s.startsWith('!') && !s.startsWith("'")),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          (sheetName, colIndex, rowNum) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}${rowNum}`;

            const extracted = extractSheetName(range);
            return extracted.length > 0;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('extractSheetName should handle quoted sheet names', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((s) => s.trim().length > 0 && !s.includes('!') && !s.includes("'")),
          fc.integer({ min: 0, max: 25 }),
          (sheetName, colIndex) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `'${sheetName}'!${col}1`;

            const extracted = extractSheetName(range);
            // Should extract without quotes
            return extracted === sheetName;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('extractSheetName should handle sheet-only references', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((s) => s.trim().length > 0 && !s.startsWith('!') && !s.startsWith("'")),
          (sheetName) => {
            const extracted = extractSheetName(sheetName);
            return extracted.length > 0;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('extractSheetName should be idempotent', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((s) => s.trim().length > 0 && !s.startsWith('!') && !s.startsWith("'")),
          fc.integer({ min: 0, max: 25 }),
          (sheetName, colIndex) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}1`;

            const extracted1 = extractSheetName(range);
            const extracted2 = extractSheetName(range);

            return extracted1 === extracted2;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Range Parsing Invariants', () => {
    it('parseRange should preserve original input', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 100 })
            .filter((s) => s.trim().length > 0 && !s.startsWith('!') && !s.startsWith("'")),
          fc.integer({ min: 0, max: 25 }),
          (sheetName, colIndex) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}1`;

            const parsed = parseRange(range);
            return parsed.original === range;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('parseRange should split sheet and cell consistently', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((s) => s.trim().length > 0 && !s.includes('!') && !s.includes("'")),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          (sheetName, colIndex, rowNum) => {
            const col = String.fromCharCode(65 + colIndex);
            const cellRef = `${col}${rowNum}`;
            const range = `${sheetName}!${cellRef}`;

            const parsed = parseRange(range);

            return parsed.sheetName === sheetName && parsed.cellRef === cellRef;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('parseRange should handle ranges without cell reference', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('!')),
          (sheetName) => {
            const parsed = parseRange(sheetName);

            return parsed.original === sheetName;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('parseRange should unescape doubled quotes in sheet names', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 30 }), (baseName) => {
          // Create sheet name with embedded quote
          const sheetNameWithQuote = `${baseName}'s Sheet`;
          // Properly escaped version
          const escaped = sheetNameWithQuote.replaceAll("'", "''");
          const range = `'${escaped}'!A1`;

          const parsed = parseRange(range);

          // Should unescape back to original
          return parsed.sheetName === sheetNameWithQuote;
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('Sheet Reference Normalization', () => {
    it('normalizeSheetReference should preserve already quoted names', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((s) => s.trim().length > 0 && !s.startsWith('!') && !s.startsWith("'")),
          fc.integer({ min: 0, max: 25 }),
          (sheetName, colIndex) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `'${sheetName}'!${col}1`;

            const normalized = normalizeSheetReference(range);

            // Should still be quoted
            return normalized.startsWith("'") && normalized.includes('!');
          }
        ),
        { numRuns: 500 }
      );
    });

    it('normalizeSheetReference should quote names with spaces', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => s.trim().length > 0 && !s.includes('!') && !s.includes("'")),
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => s.trim().length > 0 && !s.includes('!') && !s.includes("'")),
          fc.integer({ min: 0, max: 25 }),
          (part1, part2, colIndex) => {
            const sheetName = `${part1} ${part2}`;
            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}1`;

            const normalized = normalizeSheetReference(range);

            // Should be quoted because of space
            return normalized.startsWith("'");
          }
        ),
        { numRuns: 500 }
      );
    });

    it('normalizeSheetReference should handle emoji in sheet names', () => {
      const range = '📊 Dashboard!A1:B10';
      const normalized = normalizeSheetReference(range);

      // Should be quoted
      expect(normalized).toMatch(/^'/);
      expect(normalized).toContain('📊 Dashboard');
    });

    it('normalizeSheetReference should preserve simple sheet names', () => {
      fc.assert(
        fc.property(
          fc.string({
            minLength: 1,
            maxLength: 30,
            unit: fc.constantFrom(
              ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
            ),
          }),
          fc.integer({ min: 0, max: 25 }),
          (sheetName, colIndex) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}1`;

            const normalized = normalizeSheetReference(range);

            // Simple names shouldn't be quoted
            return normalized === range;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('normalizeSheetReference should not modify ranges without sheet names', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          (colIndex, rowNum) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${col}${rowNum}`;

            const normalized = normalizeSheetReference(range);

            // No ! separator, should be unchanged
            return normalized === range;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Range Cache Behavior', () => {
    it('cache should return same object for repeated parses', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 25 }),
          (sheetName, colIndex) => {
            clearRangeParseCache(); // Start fresh

            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}1`;

            const parsed1 = parseRange(range);
            const parsed2 = parseRange(range);

            // Should be same cached object
            return parsed1 === parsed2;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('different ranges should produce different cache entries', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('!')),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 0, max: 25 }),
          (sheetName, col1Index, col2Index) => {
            fc.pre(col1Index !== col2Index); // Only test different columns

            clearRangeParseCache();

            const col1 = String.fromCharCode(65 + col1Index);
            const col2 = String.fromCharCode(65 + col2Index);
            const range1 = `${sheetName}!${col1}1`;
            const range2 = `${sheetName}!${col2}1`;

            const parsed1 = parseRange(range1);
            const parsed2 = parseRange(range2);

            // Different ranges should have different originals
            return parsed1.original !== parsed2.original;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle very long sheet names', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 100, maxLength: 200 })
            .filter((s) => s.trim().length > 0 && !s.includes('!') && !s.includes("'")),
          fc.integer({ min: 0, max: 25 }),
          (longSheetName, colIndex) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${longSheetName}!${col}1`;

            const parsed = parseRange(range);
            return parsed.sheetName.length >= 100;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle sheet names with multiple special characters', () => {
      const testCases = [
        'Sheet-Name-With-Hyphens!A1',
        'Sheet With Spaces!A1',
        'Sheet_With_Underscores!A1',
        'Sheet.With.Dots!A1',
        'Sheet (With Parens)!A1',
      ];

      for (const testCase of testCases) {
        const parsed = parseRange(testCase);
        expect(parsed.sheetName.length).toBeGreaterThan(0);
      }
    });

    it('should handle ranges with multiple colon separators', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          (sheetName, colIndex, rowNum) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}${rowNum}:${col}${rowNum + 10}`;

            const parsed = parseRange(range);
            return parsed.cellRef?.includes(':');
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should handle empty string gracefully', () => {
      const parsed = parseRange('');
      expect(parsed.sheetName).toBe('');
      expect(parsed.original).toBe('');
    });

    it('should handle single quote character', () => {
      const parsed = parseRange("'");
      expect(parsed.original).toBe("'");
    });

    it('should handle exclamation point only', () => {
      const parsed = parseRange('!');
      expect(parsed.original).toBe('!');
    });

    it('should handle unicode characters in sheet names', () => {
      const testCases = ['日本語シート!A1', 'Русский лист!A1', 'العربية!A1', '한국어 시트!A1'];

      for (const testCase of testCases) {
        const parsed = parseRange(testCase);
        expect(parsed.sheetName.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Parse-Serialize Roundtrip', () => {
    it('parse then reconstruct should yield equivalent range', () => {
      fc.assert(
        fc.property(
          fc.string({
            minLength: 1,
            maxLength: 30,
            unit: fc.constantFrom(
              ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
            ),
          }),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          (sheetName, colIndex, rowNum) => {
            const col = String.fromCharCode(65 + colIndex);
            const originalRange = `${sheetName}!${col}${rowNum}`;

            const parsed = parseRange(originalRange);

            // Reconstruct
            const reconstructed = parsed.cellRef
              ? `${parsed.sheetName}!${parsed.cellRef}`
              : parsed.sheetName;

            return reconstructed === originalRange;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('normalize then parse should preserve sheet name', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.integer({ min: 0, max: 25 }),
          (sheetName, colIndex) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}1`;

            const normalized = normalizeSheetReference(range);
            const parsed = parseRange(normalized);

            // Sheet name should be preserved (possibly unquoted)
            return parsed.sheetName.length > 0;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Cell Reference Extraction', () => {
    it('cellRef should be undefined for sheet-only references', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('!')),
          (sheetName) => {
            const parsed = parseRange(sheetName);
            return parsed.cellRef === undefined;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('cellRef should contain colon for range references', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 30 })
            .filter((s) => s.trim().length > 0 && !s.includes('!') && !s.includes("'")),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          (sheetName, col1, row1, col2, row2) => {
            const startCol = String.fromCharCode(65 + col1);
            const endCol = String.fromCharCode(65 + col2);
            const range = `${sheetName}!${startCol}${row1}:${endCol}${row2}`;

            const parsed = parseRange(range);
            return parsed.cellRef?.includes(':') ?? false;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('cellRef should not contain colon for single cell references', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 30 })
            .filter((s) => !s.includes(':') && !s.includes('!')),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          (sheetName, colIndex, rowNum) => {
            const col = String.fromCharCode(65 + colIndex);
            const range = `${sheetName}!${col}${rowNum}`;

            const parsed = parseRange(range);
            return !parsed.cellRef?.includes(':');
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
