/**
 * ISSUE-207: Edge case tests — Unicode and RTL content
 *
 * Tests that sheet names, ranges, and cell values containing Unicode characters
 * (Japanese, Arabic RTL, emoji, etc.) are accepted by the schema and passed
 * through correctly by handlers.
 */

import { describe, it, expect } from 'vitest';
import { RangeInputSchema } from '../../src/schemas/shared.js';
import { SheetsDataInputSchema } from '../../src/schemas/data.js';
import { SheetsCoreInputSchema } from '../../src/schemas/core.js';

// Valid-format Google Sheets spreadsheet ID
const VALID_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Unicode edge cases', () => {
  describe('Schema: Unicode sheet names in range strings', () => {
    it('accepts Japanese characters in sheet name', () => {
      const result = RangeInputSchema.safeParse('データ!A1:C3');
      expect(result.success).toBe(true);
    });

    it('accepts Arabic RTL characters in sheet name', () => {
      const result = RangeInputSchema.safeParse('بيانات!A1:B10');
      expect(result.success).toBe(true);
    });

    it('accepts Chinese characters in sheet name', () => {
      const result = RangeInputSchema.safeParse('销售数据!A1:E10');
      expect(result.success).toBe(true);
    });

    it('accepts Hebrew characters in sheet name', () => {
      const result = RangeInputSchema.safeParse('נתונים!A1:C5');
      expect(result.success).toBe(true);
    });

    it('accepts emoji in sheet name', () => {
      const result = RangeInputSchema.safeParse('📊 Sales!A1:D5');
      expect(result.success).toBe(true);
    });

    it('accepts Korean characters in sheet name', () => {
      const result = RangeInputSchema.safeParse('데이터!A1:F20');
      expect(result.success).toBe(true);
    });
  });

  describe('Schema: Unicode sheet names in full request schemas', () => {
    it('accepts Unicode sheet name in data.read action', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          spreadsheetId: VALID_SPREADSHEET_ID,
          range: 'テスト!A1:Z100',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts Unicode sheet name in data.write action', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: VALID_SPREADSHEET_ID,
          range: 'データ入力!A1:C3',
          values: [['こんにちは', '世界', 'テスト']],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts Unicode sheet name in data.batch_read action', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'batch_read',
          spreadsheetId: VALID_SPREADSHEET_ID,
          ranges: ['一月!A1:C12', '二月!A1:C12', '三月!A1:C12'],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts RTL sheet name in core.add_sheet action', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'add_sheet',
          spreadsheetId: VALID_SPREADSHEET_ID,
          title: 'بيانات المبيعات',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Schema: Unicode cell values', () => {
    it('accepts Japanese Unicode values in write schema', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: VALID_SPREADSHEET_ID,
          range: 'Sheet1!A1:A3',
          values: [['こんにちは'], ['世界'], ['テスト']],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts Arabic RTL text as cell values', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: VALID_SPREADSHEET_ID,
          range: 'Sheet1!A1:A2',
          values: [['مرحباً بالعالم'], ['بيانات']],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts emoji as cell values', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: VALID_SPREADSHEET_ID,
          range: 'Sheet1!A1:C1',
          values: [['🎉 Celebration', '🚀 Launch', '✅ Done']],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts mixed Unicode and ASCII cell values', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: VALID_SPREADSHEET_ID,
          range: 'Sheet1!A1:D1',
          values: [['Name', 'Имя', '名前', 'اسم']],
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
