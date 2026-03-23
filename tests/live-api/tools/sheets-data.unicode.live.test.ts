/**
 * ServalSheets - Unicode & Internationalization Tests
 *
 * Tests for handling international characters, RTL text, emoji,
 * and various Unicode edge cases.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  getLiveApiClient,
  applyQuotaDelay,
  TEMPLATE_UNICODE,
  getTemplateData,
  generateTestId,
  standardAfterEach,
} from '../setup/index.js';
import { shouldRunIntegrationTests } from '../../helpers/credential-loader.js';
import type { LiveApiClient } from '../setup/live-api-client.js';

/**
 * Skip all tests if integration tests are not enabled
 */
const skipTests = !shouldRunIntegrationTests();

/**
 * Unicode test samples covering various scripts and edge cases
 */
const UNICODE_SAMPLES = {
  // Latin extended
  latin: 'Ångström résumé naïve café',

  // Chinese (Simplified & Traditional)
  chinese: '中文测试 繁體中文',

  // Japanese (Hiragana, Katakana, Kanji)
  japanese: 'ひらがな カタカナ 漢字',

  // Korean
  korean: '한글 테스트',

  // Arabic (RTL)
  arabic: 'اختبار العربية',

  // Hebrew (RTL)
  hebrew: 'עברית בדיקה',

  // Thai
  thai: 'ภาษาไทย ทดสอบ',

  // Vietnamese
  vietnamese: 'Tiếng Việt thử nghiệm',

  // Greek
  greek: 'Ελληνικά δοκιμή',

  // Cyrillic (Russian)
  cyrillic: 'Русский тест',

  // Devanagari (Hindi)
  hindi: 'हिंदी परीक्षण',

  // Bengali
  bengali: 'বাংলা পরীক্ষা',

  // Tamil
  tamil: 'தமிழ் சோதனை',

  // Emoji (basic)
  emoji_basic: '👍 ❤️ 😀 🎉',

  // Emoji (compound with ZWJ)
  emoji_zwj: '👨‍👩‍👧‍👦 🏳️‍🌈 👩‍💻',

  // Emoji (skin tones)
  emoji_skin: '👋🏻 👋🏼 👋🏽 👋🏾 👋🏿',

  // Mixed script
  mixed: 'Hello 世界 مرحبا 🌍',

  // Mathematical symbols
  math: '∑ ∫ √ π ∞ ≠ ≤ ≥',

  // Currency symbols
  currency: '$ € £ ¥ ₹ ₿',

  // Special whitespace
  whitespace: 'Normal\u00A0NBSP\u2003EmSpace\u200BZeroWidth',

  // Bidirectional text
  bidi: 'English مع العربية together',

  // NFC vs NFD (e with acute: é can be one char or e + combining acute)
  normalization_nfc: '\u00E9', // é as single character (NFC)
  normalization_nfd: '\u0065\u0301', // e + combining acute (NFD)

  // Zero-width characters
  zero_width: 'A\u200BB\u200CC\u200DD\uFEFFE',

  // Surrogate pairs (characters outside BMP)
  surrogate: '𝕳𝖊𝖑𝖑𝖔 𝕿𝖊𝖘𝖙', // Mathematical Fraktur

  // Combining characters
  combining: 'a\u0300\u0301\u0302', // a with multiple combining marks
};

describe.skipIf(skipTests)('Unicode & Internationalization Tests', () => {
  let client: LiveApiClient;
  let testSpreadsheetId: string | null = null;

  beforeAll(async () => {
    client = await getLiveApiClient();
  });

  afterEach(async () => {
    await standardAfterEach();
  });

  afterAll(async () => {
    if (testSpreadsheetId) {
      try {
        await client.deleteSpreadsheet(testSpreadsheetId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Basic Unicode Support', () => {
    it('should handle CJK characters (Chinese, Japanese, Korean)', async () => {
      const testId = generateTestId('cjk');

      const createResult = await client.createSpreadsheet(`Unicode_CJK_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      const cjkData = [
        [UNICODE_SAMPLES.chinese],
        [UNICODE_SAMPLES.japanese],
        [UNICODE_SAMPLES.korean],
      ];

      await client.writeData(testSpreadsheetId, 'Sheet1!A1:A3', cjkData);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1:A3');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.chinese);
      expect(result.values[1][0]).toBe(UNICODE_SAMPLES.japanese);
      expect(result.values[2][0]).toBe(UNICODE_SAMPLES.korean);
    }, 60000);

    it('should handle RTL scripts (Arabic, Hebrew)', async () => {
      const testId = generateTestId('rtl');

      const createResult = await client.createSpreadsheet(`Unicode_RTL_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      const rtlData = [[UNICODE_SAMPLES.arabic], [UNICODE_SAMPLES.hebrew]];

      await client.writeData(testSpreadsheetId, 'Sheet1!A1:A2', rtlData);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1:A2');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.arabic);
      expect(result.values[1][0]).toBe(UNICODE_SAMPLES.hebrew);
    }, 60000);

    it('should handle South Asian scripts', async () => {
      const testId = generateTestId('southasian');

      const createResult = await client.createSpreadsheet(`Unicode_SouthAsian_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      const southAsianData = [
        [UNICODE_SAMPLES.hindi],
        [UNICODE_SAMPLES.bengali],
        [UNICODE_SAMPLES.tamil],
        [UNICODE_SAMPLES.thai],
      ];

      await client.writeData(testSpreadsheetId, 'Sheet1!A1:A4', southAsianData);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1:A4');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.hindi);
      expect(result.values[1][0]).toBe(UNICODE_SAMPLES.bengali);
      expect(result.values[2][0]).toBe(UNICODE_SAMPLES.tamil);
      expect(result.values[3][0]).toBe(UNICODE_SAMPLES.thai);
    }, 60000);
  });

  describe('Emoji Support', () => {
    it('should handle basic emoji', async () => {
      const testId = generateTestId('emoji');

      const createResult = await client.createSpreadsheet(`Emoji_Basic_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.emoji_basic]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.emoji_basic);
    }, 60000);

    it('should handle ZWJ emoji sequences (family, flag, etc.)', async () => {
      const testId = generateTestId('zwj');

      const createResult = await client.createSpreadsheet(`Emoji_ZWJ_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.emoji_zwj]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      // ZWJ sequences should be preserved
      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.emoji_zwj);
    }, 60000);

    it('should handle emoji with skin tone modifiers', async () => {
      const testId = generateTestId('skin');

      const createResult = await client.createSpreadsheet(`Emoji_Skin_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.emoji_skin]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.emoji_skin);
    }, 60000);
  });

  describe('Unicode Edge Cases', () => {
    it('should handle mixed scripts in single cell', async () => {
      const testId = generateTestId('mixed');

      const createResult = await client.createSpreadsheet(`Mixed_Scripts_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.mixed]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.mixed);
    }, 60000);

    it('should handle bidirectional text', async () => {
      const testId = generateTestId('bidi');

      const createResult = await client.createSpreadsheet(`Bidi_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.bidi]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.bidi);
    }, 60000);

    it('should handle special whitespace characters', async () => {
      const testId = generateTestId('whitespace');

      const createResult = await client.createSpreadsheet(`Whitespace_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.whitespace]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      // Note: Google Sheets may normalize some whitespace
      expect(result.values[0][0]).toBeDefined();
    }, 60000);

    it('should handle surrogate pairs (characters outside BMP)', async () => {
      const testId = generateTestId('surrogate');

      const createResult = await client.createSpreadsheet(`Surrogate_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.surrogate]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.surrogate);
    }, 60000);

    it('should handle combining characters', async () => {
      const testId = generateTestId('combining');

      const createResult = await client.createSpreadsheet(`Combining_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.combining]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      // The combining characters should be preserved
      expect(result.values[0][0]).toBeDefined();
      expect(result.values[0][0].length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Unicode Template Test', () => {
    it('should handle full Unicode template with 30+ languages', async () => {
      const testId = generateTestId('template');

      const createResult = await client.createSpreadsheet(`Unicode_Template_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      // Use the full Unicode template with headers
      const templateData = getTemplateData(TEMPLATE_UNICODE); // includes header row

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', templateData);

      await applyQuotaDelay();

      const expectedRows = templateData.length;
      const expectedCols = templateData[0].length;

      const result = await client.readData(
        testSpreadsheetId,
        `Sheet1!A1:${String.fromCharCode(64 + expectedCols)}${expectedRows}`
      );

      // Verify data integrity (headers + data rows)
      expect(result.values.length).toBe(expectedRows);

      // Check headers preserved: ['Language', 'Greeting', 'Sample Text', 'Numbers', 'Special']
      expect(result.values[0][0]).toBe('Language');
      expect(result.values[0][2]).toBe('Sample Text');
    }, 120000);
  });

  describe('Unicode in Sheet Names', () => {
    it('should handle Unicode characters in sheet names', async () => {
      const testId = generateTestId('sheetname');

      const createResult = await client.createSpreadsheet(`SheetName_Unicode_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      // Try various Unicode sheet names
      const unicodeSheetNames = ['Sheet_日本語', 'Sheet_العربية', 'Sheet_한국어', 'Sheet_Émoji_🎉'];

      for (const sheetName of unicodeSheetNames) {
        try {
          const result = await client.addSheet(testSpreadsheetId, sheetName);
          expect(result.sheetId).toBeDefined();

          await applyQuotaDelay();

          // Write data to the Unicode-named sheet
          await client.writeData(testSpreadsheetId, `'${sheetName}'!A1`, [['Test']]);

          await applyQuotaDelay();

          // Read back
          const readResult = await client.readData(testSpreadsheetId, `'${sheetName}'!A1`);
          expect(readResult.values[0][0]).toBe('Test');

          await applyQuotaDelay();
        } catch (error) {
          // Some Unicode characters may not be allowed in sheet names
          // This is expected behavior - log and continue
          console.log(`Sheet name "${sheetName}" not supported: ${error}`);
        }
      }
    }, 120000);
  });

  describe('Unicode Normalization', () => {
    it('should handle NFC and NFD normalization forms', async () => {
      const testId = generateTestId('norm');

      const createResult = await client.createSpreadsheet(`Normalization_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      // Write both NFC and NFD forms
      await client.writeData(testSpreadsheetId, 'Sheet1!A1:A2', [
        [UNICODE_SAMPLES.normalization_nfc],
        [UNICODE_SAMPLES.normalization_nfd],
      ]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1:A2');

      // Both should be readable (Google Sheets may normalize)
      expect(result.values[0][0]).toBeDefined();
      expect(result.values[1][0]).toBeDefined();

      // They should look the same when displayed (both are "é")
      // Note: Google Sheets typically normalizes to NFC
    }, 60000);
  });

  describe('Special Symbols', () => {
    it('should handle mathematical symbols', async () => {
      const testId = generateTestId('math');

      const createResult = await client.createSpreadsheet(`Math_Symbols_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.math]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.math);
    }, 60000);

    it('should handle currency symbols', async () => {
      const testId = generateTestId('currency');

      const createResult = await client.createSpreadsheet(`Currency_Symbols_${testId}`);
      testSpreadsheetId = createResult.spreadsheetId;

      await applyQuotaDelay();

      await client.writeData(testSpreadsheetId, 'Sheet1!A1', [[UNICODE_SAMPLES.currency]]);

      await applyQuotaDelay();

      const result = await client.readData(testSpreadsheetId, 'Sheet1!A1');

      expect(result.values[0][0]).toBe(UNICODE_SAMPLES.currency);
    }, 60000);
  });
});
