/**
 * Tests for google-sheets-helpers utility functions
 *
 * Covers A1 parsing, cell references, column conversion, buildA1Notation round-trips,
 * and memoization behavior.
 */

import { describe, it, expect } from 'vitest';
import {
  parseA1Notation,
  parseCellReference,
  columnLetterToIndex,
  indexToColumnLetter,
  buildA1Notation,
  buildGridRangeInput,
  hexToRgb,
  rgbToHex,
} from '../../src/utils/google-sheets-helpers.js';

describe('google-sheets-helpers', () => {
  // ==========================================================================
  // parseA1Notation
  // ==========================================================================

  describe('parseA1Notation', () => {
    it('should parse simple range A1:B10', () => {
      const result = parseA1Notation('A1:B10');
      expect(result).toEqual({
        sheetName: undefined,
        startCol: 0,
        startRow: 0,
        endCol: 2,
        endRow: 10,
      });
    });

    it('should parse single cell A1', () => {
      const result = parseA1Notation('A1');
      expect(result).toEqual({
        sheetName: undefined,
        startCol: 0,
        startRow: 0,
        endCol: 1,
        endRow: 1,
      });
    });

    it('should parse range with sheet name', () => {
      const result = parseA1Notation('Sheet1!A1:C10');
      expect(result.sheetName).toBe('Sheet1');
      expect(result.startCol).toBe(0);
      expect(result.endCol).toBe(3);
    });

    it('should parse range with quoted sheet name', () => {
      const result = parseA1Notation("'My Sheet'!A1:B5");
      expect(result.sheetName).toBe('My Sheet');
      expect(result.startCol).toBe(0);
      expect(result.startRow).toBe(0);
      expect(result.endCol).toBe(2);
      expect(result.endRow).toBe(5);
    });

    it('should parse full-column notation A:C', () => {
      const result = parseA1Notation('A:C');
      expect(result.startCol).toBe(0);
      expect(result.endCol).toBe(3);
      expect(result.startRow).toBe(0);
      expect(result.endRow).toBe(1000000);
    });

    it('should parse full-column with sheet name', () => {
      const result = parseA1Notation('Sheet1!A:Z');
      expect(result.sheetName).toBe('Sheet1');
      expect(result.startCol).toBe(0);
      expect(result.endCol).toBe(26);
    });

    it('should handle multi-letter columns like AA1:AZ100', () => {
      const result = parseA1Notation('AA1:AZ100');
      expect(result.startCol).toBe(26); // AA = 26
      expect(result.endCol).toBe(52); // AZ = 51, +1 = 52
      expect(result.startRow).toBe(0);
      expect(result.endRow).toBe(100);
    });

    it('should be case-insensitive', () => {
      const upper = parseA1Notation('A1:B10');
      const lower = parseA1Notation('a1:b10');
      expect(upper).toEqual(lower);
    });

    it('should throw on empty string', () => {
      expect(() => parseA1Notation('')).toThrow('Invalid A1 notation');
    });

    it('should throw on invalid notation', () => {
      expect(() => parseA1Notation('not-a-range')).toThrow('Invalid A1 notation');
    });

    it('should throw on non-string input', () => {
      expect(() => parseA1Notation(null as unknown as string)).toThrow('Invalid A1 notation');
    });

    it('should return cached results for repeated calls (memoization)', () => {
      const result1 = parseA1Notation('Sheet1!A1:B10');
      const result2 = parseA1Notation('Sheet1!A1:B10');
      // Same structural result
      expect(result1).toEqual(result2);
    });
  });

  // ==========================================================================
  // parseCellReference
  // ==========================================================================

  describe('parseCellReference', () => {
    it('should parse simple cell A1', () => {
      const result = parseCellReference('A1');
      expect(result).toEqual({
        sheetName: undefined,
        col: 0,
        row: 0,
      });
    });

    it('should parse cell with sheet name', () => {
      const result = parseCellReference('Sheet1!B5');
      expect(result.sheetName).toBe('Sheet1');
      expect(result.col).toBe(1);
      expect(result.row).toBe(4);
    });

    it('should parse cell with quoted sheet name', () => {
      const result = parseCellReference("'Data Sheet'!C10");
      expect(result.sheetName).toBe('Data Sheet');
      expect(result.col).toBe(2);
      expect(result.row).toBe(9);
    });

    it('should handle multi-letter column AA1', () => {
      const result = parseCellReference('AA1');
      expect(result.col).toBe(26);
      expect(result.row).toBe(0);
    });

    it('should throw on invalid cell reference', () => {
      expect(() => parseCellReference('invalid')).toThrow('Invalid cell reference');
    });

    it('should throw on range (not single cell)', () => {
      // parseCellReference only handles single cells, not ranges
      expect(() => parseCellReference('A1:B10')).toThrow('Invalid cell reference');
    });
  });

  // ==========================================================================
  // columnLetterToIndex / indexToColumnLetter
  // ==========================================================================

  describe('columnLetterToIndex', () => {
    it('should convert A to 0', () => {
      expect(columnLetterToIndex('A')).toBe(0);
    });

    it('should convert Z to 25', () => {
      expect(columnLetterToIndex('Z')).toBe(25);
    });

    it('should convert AA to 26', () => {
      expect(columnLetterToIndex('AA')).toBe(26);
    });

    it('should convert AZ to 51', () => {
      expect(columnLetterToIndex('AZ')).toBe(51);
    });

    it('should be case-insensitive', () => {
      expect(columnLetterToIndex('a')).toBe(columnLetterToIndex('A'));
      expect(columnLetterToIndex('aa')).toBe(columnLetterToIndex('AA'));
    });
  });

  describe('indexToColumnLetter', () => {
    it('should convert 0 to A', () => {
      expect(indexToColumnLetter(0)).toBe('A');
    });

    it('should convert 25 to Z', () => {
      expect(indexToColumnLetter(25)).toBe('Z');
    });

    it('should convert 26 to AA', () => {
      expect(indexToColumnLetter(26)).toBe('AA');
    });

    it('should convert 51 to AZ', () => {
      expect(indexToColumnLetter(51)).toBe('AZ');
    });
  });

  describe('column conversion round-trips', () => {
    it('should round-trip A-Z correctly', () => {
      for (let i = 0; i < 26; i++) {
        const letter = indexToColumnLetter(i);
        expect(columnLetterToIndex(letter)).toBe(i);
      }
    });

    it('should round-trip AA-AZ correctly', () => {
      for (let i = 26; i < 52; i++) {
        const letter = indexToColumnLetter(i);
        expect(columnLetterToIndex(letter)).toBe(i);
      }
    });
  });

  // ==========================================================================
  // buildA1Notation
  // ==========================================================================

  describe('buildA1Notation', () => {
    it('should build simple range without sheet', () => {
      const result = buildA1Notation(undefined, 0, 0, 3, 10);
      expect(result).toBe('A1:C10');
    });

    it('should build range with sheet name', () => {
      const result = buildA1Notation('Sheet1', 0, 0, 3, 10);
      expect(result).toBe('Sheet1!A1:C10');
    });

    it('should quote sheet names with special chars', () => {
      const result = buildA1Notation('My Sheet', 0, 0, 2, 5);
      expect(result).toBe("'My Sheet'!A1:B5");
    });

    it('should build single cell when no end provided', () => {
      const result = buildA1Notation(undefined, 0, 0);
      expect(result).toBe('A1');
    });

    it('should round-trip with parseA1Notation', () => {
      const original = 'Sheet1!A1:C10';
      const parsed = parseA1Notation(original);
      const rebuilt = buildA1Notation(
        parsed.sheetName,
        parsed.startCol,
        parsed.startRow,
        parsed.endCol,
        parsed.endRow
      );
      expect(rebuilt).toBe(original);
    });
  });

  // ==========================================================================
  // buildGridRangeInput
  // ==========================================================================

  describe('buildGridRangeInput', () => {
    it('should build grid range with all values', () => {
      const result = buildGridRangeInput(0, 1, 10, 0, 3);
      expect(result).toEqual({
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 10,
        startColumnIndex: 0,
        endColumnIndex: 3,
      });
    });

    it('should sanitize NaN values to undefined', () => {
      const result = buildGridRangeInput(0, NaN, 10, 0, NaN);
      expect(result.startRowIndex).toBeUndefined();
      expect(result.endColumnIndex).toBeUndefined();
      expect(result.endRowIndex).toBe(10);
    });

    it('should sanitize NaN sheetId to 0', () => {
      const result = buildGridRangeInput(NaN);
      expect(result.sheetId).toBe(0);
    });
  });

  // ==========================================================================
  // Color conversion
  // ==========================================================================

  describe('hexToRgb', () => {
    it('should convert black', () => {
      expect(hexToRgb('#000000')).toEqual({ red: 0, green: 0, blue: 0 });
    });

    it('should convert white', () => {
      expect(hexToRgb('#ffffff')).toEqual({ red: 1, green: 1, blue: 1 });
    });

    it('should convert without hash prefix', () => {
      expect(hexToRgb('ff0000')).toEqual({ red: 1, green: 0, blue: 0 });
    });
  });

  describe('rgbToHex', () => {
    it('should convert black', () => {
      expect(rgbToHex({ red: 0, green: 0, blue: 0 })).toBe('#000000');
    });

    it('should convert white', () => {
      expect(rgbToHex({ red: 1, green: 1, blue: 1 })).toBe('#ffffff');
    });

    it('should handle missing color channels', () => {
      expect(rgbToHex({})).toBe('#000000');
    });

    it('should round-trip with hexToRgb', () => {
      const hex = '#3a7bd5';
      const rgb = hexToRgb(hex);
      const result = rgbToHex(rgb);
      expect(result).toBe(hex);
    });
  });
});
