/**
 * Boundary Value Contract Tests
 *
 * Tests edge cases and boundary conditions for schema validation.
 * Ensures schemas handle extremes correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  SheetsDataInputSchema,
  SheetsCoreInputSchema,
  SheetsFormatInputSchema,
  SheetsDimensionsInputSchema,
  SheetsVisualizeInputSchema,
  SheetsAdvancedInputSchema,
  SheetsCollaborateInputSchema,
} from '../../src/schemas/index.js';

describe('Boundary Value Tests', () => {
  const validSpreadsheetId = 'abc123def456ghi789jkl012mno345pqr678stu901';

  describe('Spreadsheet ID Validation', () => {
    it('should accept valid 44-character spreadsheet ID', () => {
      const input = {
        request: {
          action: 'get' as const,
          spreadsheetId: validSpreadsheetId,
        },
      };
      expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept shorter spreadsheet IDs', () => {
      const input = {
        request: {
          action: 'get' as const,
          spreadsheetId: 'short-id',
        },
      };
      // IDs can vary in length
      expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
    });

    it('should reject empty spreadsheet ID', () => {
      const input = {
        request: {
          action: 'get' as const,
          spreadsheetId: '',
        },
      };
      expect(SheetsCoreInputSchema.safeParse(input).success).toBe(false);
    });

    it('should accept spreadsheet ID with special characters', () => {
      const input = {
        request: {
          action: 'get' as const,
          spreadsheetId: '1abc-123_XYZ',
        },
      };
      expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('Range Notation Boundaries', () => {
    const validRanges = [
      'A1',
      'Sheet1!A1',
      'Sheet1!A1:B2',
      'Sheet1!1:1',
      'Sheet1!A1:ZZ1000',
      "'Sheet With Spaces'!A1:B2",
      "'Sheet''s Name'!A1",
      'Sheet1!$A$1:$B$2',
      'A1:ZZZ10000',
    ];

    for (const range of validRanges) {
      it(`should accept range: ${range}`, () => {
        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: validSpreadsheetId,
            range: { a1: range },
          },
        };
        expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
      });
    }

    it('should accept very long sheet names', () => {
      const longName = 'A'.repeat(100);
      const input = {
        request: {
          action: 'read' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: `'${longName}'!A1:B2` },
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('Values Array Boundaries', () => {
    it('should accept empty values array', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          values: [],
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept single cell value', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          values: [['single']],
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept empty row', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1:C1' },
          values: [[]],
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept null values in array', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1:C1' },
          values: [[null, 'value', null]],
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept very long string values', () => {
      const longString = 'x'.repeat(50000);
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          values: [[longString]],
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept unicode values', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1:D1' },
          values: [['日本語', '中文', '한국어', '🎉']],
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept large 2D array', () => {
      const largeArray = Array(1000)
        .fill(null)
        .map(() => Array(26).fill('data'));
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1:Z1000' },
          values: largeArray,
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept mixed types in values', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1:F1' },
          values: [['string', 123, 45.67, true, false, null]],
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept formula strings', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1:C1' },
          values: [['=SUM(A1:A10)', '=VLOOKUP(A1,B:C,2)', '=IF(A1>0,"Yes","No")']],
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('Numeric Boundaries', () => {
    describe('Sheet ID', () => {
      it('should accept sheetId 0', () => {
        const input = {
          request: {
            action: 'delete_sheet' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
          },
        };
        expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
      });

      it('should accept large sheetId', () => {
        const input = {
          request: {
            action: 'delete_sheet' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 2147483647, // Max 32-bit int
          },
        };
        expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
      });

      it('should reject negative sheetId', () => {
        const input = {
          request: {
            action: 'delete_sheet' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: -1,
          },
        };
        expect(SheetsCoreInputSchema.safeParse(input).success).toBe(false);
      });
    });

    describe('Row/Column Indices', () => {
      it('should accept startIndex 0', () => {
        const input = {
          request: {
            action: 'insert' as const,
            dimension: 'ROWS' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
            startIndex: 0,
          },
        };
        expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
      });

      it('should accept large indices', () => {
        const input = {
          request: {
            action: 'delete' as const,
            dimension: 'ROWS' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
            startIndex: 999999,
            endIndex: 1000000,
          },
        };
        expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
      });

      it('should reject negative indices', () => {
        const input = {
          request: {
            action: 'delete' as const,
            dimension: 'ROWS' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
            startIndex: -1,
            endIndex: 5,
          },
        };
        expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(false);
      });
    });

    describe('Pixel Sizes', () => {
      it('should accept pixelSize 1', () => {
        const input = {
          request: {
            action: 'resize' as const,
            dimension: 'COLUMNS' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
            startIndex: 0,
            endIndex: 1,
            pixelSize: 1,
          },
        };
        expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
      });

      it('should accept large pixelSize', () => {
        const input = {
          request: {
            action: 'resize' as const,
            dimension: 'COLUMNS' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
            startIndex: 0,
            endIndex: 1,
            pixelSize: 10000,
          },
        };
        expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
      });
    });

    describe('Count Values', () => {
      it('should accept count 1', () => {
        const input = {
          request: {
            action: 'insert' as const,
            dimension: 'ROWS' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
            startIndex: 0,
            count: 1,
          },
        };
        expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
      });

      it('should accept large count', () => {
        const input = {
          request: {
            action: 'insert' as const,
            dimension: 'ROWS' as const,
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
            startIndex: 0,
            count: 10000,
          },
        };
        expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
      });
    });
  });

  describe('Color Value Boundaries', () => {
    it('should accept color values at 0', () => {
      const input = {
        request: {
          action: 'set_background' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          color: { red: 0, green: 0, blue: 0 },
        },
      };
      expect(SheetsFormatInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept color values at 1', () => {
      const input = {
        request: {
          action: 'set_background' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          color: { red: 1, green: 1, blue: 1 },
        },
      };
      expect(SheetsFormatInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept fractional color values', () => {
      const input = {
        request: {
          action: 'set_background' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          color: { red: 0.5, green: 0.25, blue: 0.75 },
        },
      };
      expect(SheetsFormatInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept color with alpha', () => {
      const input = {
        request: {
          action: 'set_background' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          color: { red: 1, green: 0, blue: 0, alpha: 0.5 },
        },
      };
      expect(SheetsFormatInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('Chart Dimension Boundaries', () => {
    it('should accept minimum chart dimensions', () => {
      const input = {
        request: {
          action: 'chart_create' as const,
          spreadsheetId: validSpreadsheetId,
          sheetId: 0,
          chartType: 'BAR' as const,
          data: { sourceRange: { a1: 'Sheet1!A1:B10' } },
          position: { anchorCell: 'E1' },
          size: { width: 100, height: 100 },
        },
      };
      expect(SheetsVisualizeInputSchema.safeParse(input).success).toBe(true);
    });

    it('should accept large chart dimensions', () => {
      const input = {
        request: {
          action: 'chart_create' as const,
          spreadsheetId: validSpreadsheetId,
          sheetId: 0,
          chartType: 'LINE' as const,
          data: { sourceRange: { a1: 'Sheet1!A1:Z1000' } },
          position: { anchorCell: 'A1' },
          size: { width: 2000, height: 1500 },
        },
      };
      expect(SheetsVisualizeInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('String Length Boundaries', () => {
    describe('Sheet Title', () => {
      it('should accept single character title', () => {
        const input = {
          request: {
            action: 'add_sheet' as const,
            spreadsheetId: validSpreadsheetId,
            title: 'A',
          },
        };
        expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
      });

      it('should accept long title', () => {
        const input = {
          request: {
            action: 'add_sheet' as const,
            spreadsheetId: validSpreadsheetId,
            title: 'A'.repeat(200),
          },
        };
        // May be accepted by schema but rejected by API
        expect(SheetsCoreInputSchema.safeParse(input).success).toBe(true);
      });

      it('should reject empty title', () => {
        const input = {
          request: {
            action: 'add_sheet' as const,
            spreadsheetId: validSpreadsheetId,
            title: '',
          },
        };
        expect(SheetsCoreInputSchema.safeParse(input).success).toBe(false);
      });
    });

    describe('Named Range Name', () => {
      it('should accept valid named range', () => {
        const input = {
          request: {
            action: 'add_named_range' as const,
            spreadsheetId: validSpreadsheetId,
            name: 'MyRange',
            range: { a1: 'Sheet1!A1:B10' },
          },
        };
        expect(SheetsAdvancedInputSchema.safeParse(input).success).toBe(true);
      });

      it('should accept named range with underscores', () => {
        const input = {
          request: {
            action: 'add_named_range' as const,
            spreadsheetId: validSpreadsheetId,
            name: 'My_Named_Range_123',
            range: { a1: 'Sheet1!A1:B10' },
          },
        };
        expect(SheetsAdvancedInputSchema.safeParse(input).success).toBe(true);
      });
    });
  });

  describe('Email Address Boundaries', () => {
    const validEmails = [
      'user@example.com',
      'user.name@example.com',
      'user+tag@example.com',
      'user@subdomain.example.com',
      'a@b.co',
    ];

    for (const email of validEmails) {
      it(`should accept email: ${email}`, () => {
        const input = {
          request: {
            action: 'share_add' as const,
            spreadsheetId: validSpreadsheetId,
            type: 'user' as const,
            role: 'reader' as const,
            emailAddress: email,
          },
        };
        expect(SheetsCollaborateInputSchema.safeParse(input).success).toBe(true);
      });
    }
  });

  describe('Boolean and Enum Boundaries', () => {
    describe('Boolean fields', () => {
      it('should accept true', () => {
        const input = {
          request: {
            action: 'find_replace' as const,
            spreadsheetId: validSpreadsheetId,
            find: 'old',
            replacement: 'new',
            includeFormulas: true,
          },
        };
        expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
      });

      it('should accept false', () => {
        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: validSpreadsheetId,
            range: { a1: 'Sheet1!A1:B10' },
          },
        };
        expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
      });
    });

    describe('Enum fields', () => {
      const dimensions = ['ROWS', 'COLUMNS'] as const;
      for (const dim of dimensions) {
        it(`should accept dimension: ${dim}`, () => {
          const input = {
            request: {
              action: 'insert' as const,
              dimension: dim,
              spreadsheetId: validSpreadsheetId,
              sheetId: 0,
              startIndex: 0,
            },
          };
          expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(true);
        });
      }

      it('should reject invalid dimension', () => {
        const input = {
          request: {
            action: 'insert' as const,
            dimension: 'INVALID',
            spreadsheetId: validSpreadsheetId,
            sheetId: 0,
            startIndex: 0,
          },
        };
        expect(SheetsDimensionsInputSchema.safeParse(input).success).toBe(false);
      });
    });
  });

  describe('Null and Undefined Handling', () => {
    it('should handle missing optional fields', () => {
      const input = {
        request: {
          action: 'read' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          // All optional fields omitted
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });

    it('should handle explicit undefined for optional fields', () => {
      const input = {
        request: {
          action: 'read' as const,
          spreadsheetId: validSpreadsheetId,
          range: { a1: 'Sheet1!A1' },
          valueRenderOption: undefined,
        },
      };
      expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe('Array Boundaries', () => {
    describe('Multiple ranges in batch operations', () => {
      it('should accept single range in batch_read', () => {
        const input = {
          request: {
            action: 'batch_read' as const,
            spreadsheetId: validSpreadsheetId,
            ranges: [{ a1: 'Sheet1!A1:B10' }],
          },
        };
        expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
      });

      it('should accept many ranges in batch_read', () => {
        const ranges = Array(50)
          .fill(null)
          .map((_, i) => ({ a1: `Sheet1!A${i + 1}:B${i + 1}` }));
        const input = {
          request: {
            action: 'batch_read' as const,
            spreadsheetId: validSpreadsheetId,
            ranges,
          },
        };
        expect(SheetsDataInputSchema.safeParse(input).success).toBe(true);
      });

      it('should reject empty ranges array in batch_read', () => {
        const input = {
          request: {
            action: 'batch_read' as const,
            spreadsheetId: validSpreadsheetId,
            ranges: [],
          },
        };
        expect(SheetsDataInputSchema.safeParse(input).success).toBe(false);
      });
    });
  });
});
