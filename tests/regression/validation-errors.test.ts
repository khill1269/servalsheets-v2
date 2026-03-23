/**
 * Regression Tests: Validation Error Fixes
 *
 * Tests for the 59 validation errors identified in the analysis.
 * Each test documents the original error and validates the fix.
 *
 * Error breakdown:
 * - sheets_advanced: 7 errors
 * - sheets_bigquery: 10 errors
 * - sheets_composite: 3 errors
 * - sheets_confirm: 3 errors
 * - sheets_data: 7 errors
 * - sheets_dimensions: 12 errors
 * - sheets_format: 8 errors
 * - sheets_visualize: 8 errors
 */

import { describe, it, expect } from 'vitest';
import {
  SheetsAdvancedInputSchema,
  SheetsDataInputSchema,
  SheetsDimensionsInputSchema,
  SheetsFormatInputSchema,
  SheetsVisualizeInputSchema,
} from '../../src/schemas/index.js';

// Test spreadsheet ID for all tests
const TEST_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const TEST_SHEET_ID = 0;

describe('Regression: Validation Error Fixes', () => {
  // =========================================================================
  // sheets_advanced - 7 errors
  // =========================================================================
  describe('sheets_advanced (7 errors)', () => {
    const schema = SheetsAdvancedInputSchema;

    describe('update_protected_range - protectedRangeId required', () => {
      it('should accept valid input with protectedRangeId', () => {
        const input = {
          request: {
            action: 'update_protected_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            protectedRangeId: 123,
            description: 'Updated description',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should coerce string protectedRangeId to number', () => {
        const input = {
          request: {
            action: 'update_protected_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            protectedRangeId: '123', // String instead of number
            description: 'Updated description',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.request.protectedRangeId).toBe(123);
        }
      });

      it('should reject NaN protectedRangeId with clear error', () => {
        const input = {
          request: {
            action: 'update_protected_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            protectedRangeId: NaN,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          const flatErrors = result.error.flatten();
          expect(flatErrors.fieldErrors).toBeDefined();
        }
      });
    });

    describe('delete_protected_range - protectedRangeId required', () => {
      it('should accept valid input with protectedRangeId', () => {
        const input = {
          request: {
            action: 'delete_protected_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            protectedRangeId: 456,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('set_metadata - metadataKey and metadataValue required', () => {
      it('should accept valid input with all required fields', () => {
        const input = {
          request: {
            action: 'set_metadata',
            spreadsheetId: TEST_SPREADSHEET_ID,
            metadataKey: 'testKey',
            metadataValue: 'testValue',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject missing metadataKey', () => {
        const input = {
          request: {
            action: 'set_metadata',
            spreadsheetId: TEST_SPREADSHEET_ID,
            metadataValue: 'testValue',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject missing metadataValue', () => {
        const input = {
          request: {
            action: 'set_metadata',
            spreadsheetId: TEST_SPREADSHEET_ID,
            metadataKey: 'testKey',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('delete_metadata - metadataId required', () => {
      it('should accept valid input with metadataId', () => {
        const input = {
          request: {
            action: 'delete_metadata',
            spreadsheetId: TEST_SPREADSHEET_ID,
            metadataId: 789,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should coerce string metadataId to number', () => {
        const input = {
          request: {
            action: 'delete_metadata',
            spreadsheetId: TEST_SPREADSHEET_ID,
            metadataId: '789',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.request.metadataId).toBe(789);
        }
      });
    });

    describe('update_banding - bandedRangeId required', () => {
      it('should accept valid input with bandedRangeId', () => {
        const input = {
          request: {
            action: 'update_banding',
            spreadsheetId: TEST_SPREADSHEET_ID,
            bandedRangeId: 101,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('delete_banding - bandedRangeId required', () => {
      it('should accept valid input with bandedRangeId', () => {
        const input = {
          request: {
            action: 'delete_banding',
            spreadsheetId: TEST_SPREADSHEET_ID,
            bandedRangeId: 102,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('list actions - should work with minimal input', () => {
      it('list_named_ranges with only spreadsheetId', () => {
        const input = {
          request: {
            action: 'list_named_ranges',
            spreadsheetId: TEST_SPREADSHEET_ID,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('list_protected_ranges with only spreadsheetId', () => {
        const input = {
          request: {
            action: 'list_protected_ranges',
            spreadsheetId: TEST_SPREADSHEET_ID,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('list_banding with only spreadsheetId', () => {
        const input = {
          request: {
            action: 'list_banding',
            spreadsheetId: TEST_SPREADSHEET_ID,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  // =========================================================================
  // sheets_dimensions - 12 errors
  // =========================================================================
  describe('sheets_dimensions (12 errors)', () => {
    const schema = SheetsDimensionsInputSchema;

    describe('insert - startIndex and count handling', () => {
      it('should accept valid insert with defaults', () => {
        const input = {
          request: {
            action: 'insert',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            startIndex: 5,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          // Count should default to 1
          expect(result.data.request.count).toBe(1);
        }
      });

      it('should accept sheetName when sheetId is omitted', () => {
        const input = {
          request: {
            action: 'insert',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetName: 'Sheet1',
            startIndex: 5,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should coerce string startIndex to number', () => {
        const input = {
          request: {
            action: 'insert',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            startIndex: '5',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('delete - startIndex and endIndex required', () => {
      it('should accept valid delete', () => {
        const input = {
          request: {
            action: 'delete',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            startIndex: 5,
            endIndex: 10,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject missing endIndex', () => {
        const input = {
          request: {
            action: 'delete',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            startIndex: 5,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('move - destinationIndex required', () => {
      it('should accept valid move', () => {
        const input = {
          request: {
            action: 'move',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            startIndex: 5,
            endIndex: 10,
            destinationIndex: 20,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject missing destinationIndex', () => {
        const input = {
          request: {
            action: 'move',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            startIndex: 5,
            endIndex: 10,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('resize - pixelSize required', () => {
      it('should accept valid resize', () => {
        const input = {
          request: {
            action: 'resize',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            startIndex: 0,
            endIndex: 5,
            pixelSize: 50,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject invalid pixelSize (too large)', () => {
        const input = {
          request: {
            action: 'resize',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            startIndex: 0,
            endIndex: 5,
            pixelSize: 20000, // Exceeds 10000 limit
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('freeze - count handling', () => {
      it('should accept valid freeze', () => {
        const input = {
          request: {
            action: 'freeze',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            count: 1,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  // =========================================================================
  // sheets_data - 7 errors
  // =========================================================================
  describe('sheets_data (7 errors)', () => {
    const schema = SheetsDataInputSchema;

    describe('read - range required', () => {
      it('should accept valid read with range', () => {
        const input = {
          request: {
            action: 'read',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'Sheet1!A1:D10',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept various range formats', () => {
        // Note: Full column refs (A:A, B:B) and full row refs (1:1) are intentionally
        // blocked by A1NotationSchema to prevent unbounded API fetches.
        const ranges = ['A1:B10', 'Sheet1!A1:D10', 'A1:A1000', 'A1:Z1', "'Sheet Name'!A1:B5"];

        for (const range of ranges) {
          const input = {
            request: {
              action: 'read',
              spreadsheetId: TEST_SPREADSHEET_ID,
              range,
            },
          };
          const result = schema.safeParse(input);
          expect(result.success, `Range "${range}" should be valid`).toBe(true);
        }
      });
    });

    describe('write - range and values required', () => {
      it('should accept valid write', () => {
        const input = {
          request: {
            action: 'write',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'Sheet1!A1',
            values: [['Hello', 'World']],
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject missing values', () => {
        const input = {
          request: {
            action: 'write',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'Sheet1!A1',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('add_note - cell required', () => {
      it('should accept valid add_note', () => {
        const input = {
          request: {
            action: 'add_note',
            spreadsheetId: TEST_SPREADSHEET_ID,
            cell: 'A1',
            note: 'This is a note',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('set_hyperlink - cell required', () => {
      it('should accept valid set_hyperlink', () => {
        const input = {
          request: {
            action: 'set_hyperlink',
            spreadsheetId: TEST_SPREADSHEET_ID,
            cell: 'A1',
            url: 'https://example.com',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept range alias for set_hyperlink and normalize to cell', () => {
        const input = {
          request: {
            action: 'set_hyperlink',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'A1',
            url: 'https://example.com',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect((result.data.request as any).cell).toBe('A1');
        }
      });
    });

    describe('clear_hyperlink - cell required', () => {
      it('should accept range alias for clear_hyperlink and normalize to cell', () => {
        const input = {
          request: {
            action: 'clear_hyperlink',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'A1',
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect((result.data.request as any).cell).toBe('A1');
        }
      });
    });
  });

  // =========================================================================
  // sheets_format - 8 errors
  // =========================================================================
  describe('sheets_format (8 errors)', () => {
    const schema = SheetsFormatInputSchema;

    describe('set_format - format object handling', () => {
      it('should accept valid set_format', () => {
        const input = {
          request: {
            action: 'set_format',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'A1:D1',
            format: {
              textFormat: { bold: true },
            },
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('set_number_format - numberFormat required', () => {
      it('should accept valid set_number_format', () => {
        const input = {
          request: {
            action: 'set_number_format',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'B1:B1000',
            numberFormat: {
              type: 'CURRENCY',
              pattern: '$#,##0.00',
            },
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  // =========================================================================
  // sheets_visualize - 8 errors
  // =========================================================================
  describe('sheets_visualize (8 errors)', () => {
    const schema = SheetsVisualizeInputSchema;

    describe('chart_create - data and position required', () => {
      it('should accept valid chart_create', () => {
        const input = {
          request: {
            action: 'chart_create',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: TEST_SHEET_ID,
            chartType: 'LINE',
            data: {
              sourceRange: 'A1:B10',
            },
            position: {
              anchorCell: 'E2',
            },
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('pivot_create - source and config required', () => {
      it('should accept valid pivot_create', () => {
        const input = {
          request: {
            action: 'pivot_create',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sourceRange: 'A1:D100',
            rows: [{ sourceColumnOffset: 0 }],
            values: [{ sourceColumnOffset: 3, summarizeFunction: 'SUM' }],
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  // =========================================================================
  // LLM Compatibility: Common Patterns
  // =========================================================================
  describe('LLM Compatibility: Common Input Patterns', () => {
    describe('Default values should be applied', () => {
      it('verbosity defaults to "standard"', () => {
        const schema = SheetsAdvancedInputSchema;
        const input = {
          request: {
            action: 'list_named_ranges',
            spreadsheetId: TEST_SPREADSHEET_ID,
            // verbosity not specified
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.request.verbosity).toBe('standard');
        }
      });
    });

    describe('String-to-number coercion', () => {
      it('coerces string sheetId to number', () => {
        const schema = SheetsDimensionsInputSchema;
        const input = {
          request: {
            action: 'insert',
            dimension: 'ROWS',
            spreadsheetId: TEST_SPREADSHEET_ID,
            sheetId: '0', // String instead of number
            startIndex: '5', // Also string
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(typeof result.data.request.sheetId).toBe('number');
          expect(typeof result.data.request.startIndex).toBe('number');
        }
      });
    });

    describe('Empty optional fields', () => {
      it('handles undefined optional fields', () => {
        const schema = SheetsAdvancedInputSchema;
        const input = {
          request: {
            action: 'add_named_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            name: 'TestRange',
            range: 'A1:B10',
            verbosity: undefined,
            safety: undefined,
          },
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });
});
