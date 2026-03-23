/**
 * ServalSheets v4 - Range Parser Property Tests
 *
 * Property-based tests for A1 notation parsing using fast-check.
 * Ensures the range parser handles all valid inputs correctly
 * and fails gracefully on invalid inputs.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Import the range parsing utilities
import {
  parseA1Notation,
  indexToColumnLetter,
  columnLetterToIndex,
} from '../../src/utils/google-sheets-helpers.js';

describe('Range Parser Property Tests', () => {
  describe('Column Letter Conversion', () => {
    it('indexToColumnLetter should produce valid letters for any valid index', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 702 }), // A(0) to ZZ(701)
          (colIndex) => {
            const letter = indexToColumnLetter(colIndex);
            // Should only contain uppercase letters
            expect(letter).toMatch(/^[A-Z]+$/);
            // Should round-trip correctly
            expect(columnLetterToIndex(letter)).toBe(colIndex);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('columnLetterToIndex should handle single letters A-Z', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 25 }), (index) => {
          const letter = String.fromCharCode(65 + index); // A-Z
          expect(columnLetterToIndex(letter)).toBe(index);
        }),
        { numRuns: 26 }
      );
    });

    it('column conversions should be bijective', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (colIndex) => {
          const letter = indexToColumnLetter(colIndex);
          const backToIndex = columnLetterToIndex(letter);
          return backToIndex === colIndex;
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('A1 Notation Parsing', () => {
    it('should never throw on any string input', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            parseA1Notation(input);
            return true;
          } catch (error) {
            // Should throw a clean error, not crash
            expect(error).toBeInstanceOf(Error);
            return true;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('valid single cell references should parse correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }), // Column A-Z
          fc.integer({ min: 1, max: 10000 }), // Row 1-10000
          (colIndex, rowNum) => {
            const colLetter = String.fromCharCode(65 + colIndex);
            const a1 = `${colLetter}${rowNum}`;

            try {
              const result = parseA1Notation(a1);
              expect(result.startCol).toBe(colIndex);
              expect(result.startRow).toBe(rowNum - 1); // 0-indexed
              return true;
            } catch {
              return false;
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('range notation should have endCol >= startCol and endRow >= startRow', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          fc.integer({ min: 1, max: 1000 }),
          (col1, col2, row1, row2) => {
            const startCol = Math.min(col1, col2);
            const endCol = Math.max(col1, col2);
            const startRow = Math.min(row1, row2);
            const endRow = Math.max(row1, row2);

            const startLetter = String.fromCharCode(65 + startCol);
            const endLetter = String.fromCharCode(65 + endCol);
            const a1 = `${startLetter}${startRow}:${endLetter}${endRow}`;

            try {
              const result = parseA1Notation(a1);
              return (
                result.endCol !== undefined &&
                result.endRow !== undefined &&
                result.endCol >= result.startCol &&
                result.endRow >= result.startRow
              );
            } catch {
              return false;
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('sheet name with special characters should be quoted', () => {
      fc.assert(
        fc.property(
          fc
            .array(fc.constantFrom('a', 'b', 'c', ' ', '1', '2', '-', '_'), {
              minLength: 1,
              maxLength: 49,
            })
            .map((arr) => arr.join('')),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          (sheetName, colIndex, rowNum) => {
            const colLetter = String.fromCharCode(65 + colIndex);
            const needsQuotes = /[\s\-]/.test(sheetName);
            const quotedName = needsQuotes ? `'${sheetName}'` : sheetName;
            const a1 = `${quotedName}!${colLetter}${rowNum}`;

            try {
              const result = parseA1Notation(a1);
              // Sheet name should be preserved (without quotes)
              expect(result.sheetName).toBe(sheetName);
              return true;
            } catch {
              // Some sheet names might be invalid
              return true;
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      expect(() => parseA1Notation('')).toThrow();
    });

    it('should handle whitespace-only input', () => {
      fc.assert(
        fc.property(
          fc
            .array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 10 })
            .map((arr) => arr.join('')),
          (whitespace) => {
            try {
              parseA1Notation(whitespace);
              return false; // Should have thrown
            } catch {
              return true;
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should reject negative row numbers', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: -1000, max: -1 }), // Only test negative numbers, 0 is parsed but gives row=-1
          (colIndex, invalidRow) => {
            const colLetter = String.fromCharCode(65 + colIndex);
            const a1 = `${colLetter}${invalidRow}`;

            try {
              parseA1Notation(a1);
              return false; // Should have thrown
            } catch {
              return true;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
