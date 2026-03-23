/**
 * ServalSheets - Request Validation Property Tests
 *
 * Property-based tests for input validation and schema parsing.
 * Ensures all input permutations are handled correctly.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  SheetsDataInputSchema,
  SheetsCoreInputSchema,
  RangeInputSchema,
} from '../../src/schemas/index.js';

// Valid spreadsheet ID generator (matches /^[a-zA-Z0-9-_]+$/)
const validSpreadsheetId = fc.string({
  minLength: 20,
  maxLength: 60,
  unit: fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')
  ),
});

describe('Request Validation Property Tests', () => {
  describe('SpreadsheetId Validation', () => {
    it('should accept valid spreadsheetId formats', () => {
      fc.assert(
        fc.property(
          fc.string({
            minLength: 20,
            maxLength: 60,
            unit: fc.constantFrom(
              ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')
            ),
          }),
          (spreadsheetId) => {
            const input = {
              request: {
                action: 'read' as const,
                spreadsheetId,
                range: { a1: 'A1:B10' },
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('should reject empty spreadsheetId', () => {
      const input = {
        request: {
          action: 'read' as const,
          spreadsheetId: '',
          range: { a1: 'A1:B10' },
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject undefined spreadsheetId', () => {
      const input = {
        request: {
          action: 'read' as const,
          range: { a1: 'A1:B10' },
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject null spreadsheetId', () => {
      const input = {
        request: {
          action: 'read' as const,
          spreadsheetId: null,
          range: { a1: 'A1:B10' },
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Range Input Validation', () => {
    it('should accept valid A1 notation ranges', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 10000 }),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 10000 }),
          (col1, row1, col2, row2) => {
            const startCol = String.fromCharCode(65 + Math.min(col1, col2));
            const endCol = String.fromCharCode(65 + Math.max(col1, col2));
            const startRow = Math.min(row1, row2);
            const endRow = Math.max(row1, row2);
            const a1 = `${startCol}${startRow}:${endCol}${endRow}`;

            const result = RangeInputSchema.safeParse({ a1 });
            return result.success === true;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('should accept single cell A1 notation', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 10000 }),
          (colIndex, rowNum) => {
            const col = String.fromCharCode(65 + colIndex);
            const a1 = `${col}${rowNum}`;

            const result = RangeInputSchema.safeParse({ a1 });
            return result.success === true;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('should accept grid coordinate format', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          (sheetId, startRow, startCol) => {
            const result = RangeInputSchema.safeParse({
              grid: {
                sheetId,
                startRowIndex: startRow,
                startColumnIndex: startCol,
                endRowIndex: startRow + 10,
                endColumnIndex: startCol + 10,
              },
            });

            return result.success === true;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('should reject grid coordinates without sheetId', () => {
      const result = RangeInputSchema.safeParse({
        grid: {
          startRowIndex: 0,
          startColumnIndex: 0,
          endRowIndex: 10,
          endColumnIndex: 10,
        },
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty range objects', () => {
      const input = {
        request: {
          action: 'read' as const,
          spreadsheetId: 'test-id',
          range: {},
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Action Discriminated Union', () => {
    it('read action should not require values', () => {
      fc.assert(
        fc.property(validSpreadsheetId, (spreadsheetId) => {
          const input = {
            request: {
              action: 'read' as const,
              spreadsheetId,
              range: { a1: 'A1:B10' },
            },
          };

          const result = SheetsDataInputSchema.safeParse(input);
          return result.success === true;
        }),
        { numRuns: 500 }
      );
    });

    it('write action should require values', () => {
      fc.assert(
        fc.property(validSpreadsheetId, (spreadsheetId) => {
          const withoutValues = {
            request: {
              action: 'write' as const,
              spreadsheetId,
              range: { a1: 'A1:B10' },
            },
          };

          const withValues = {
            request: {
              action: 'write' as const,
              spreadsheetId,
              range: { a1: 'A1:B10' },
              values: [['test']],
            },
          };

          const resultWithout = SheetsDataInputSchema.safeParse(withoutValues);
          const resultWith = SheetsDataInputSchema.safeParse(withValues);

          return resultWithout.success === false && resultWith.success === true;
        }),
        { numRuns: 500 }
      );
    });

    it('append action should require values', () => {
      fc.assert(
        fc.property(validSpreadsheetId, (spreadsheetId) => {
          const withoutValues = {
            request: {
              action: 'append' as const,
              spreadsheetId,
              range: { a1: 'A1:B10' },
            },
          };

          const resultWithout = SheetsDataInputSchema.safeParse(withoutValues);
          return resultWithout.success === false;
        }),
        { numRuns: 500 }
      );
    });

    it('clear action should not require values', () => {
      fc.assert(
        fc.property(validSpreadsheetId, (spreadsheetId) => {
          const input = {
            request: {
              action: 'clear' as const,
              spreadsheetId,
              range: { a1: 'A1:B10' },
            },
          };

          const result = SheetsDataInputSchema.safeParse(input);
          return result.success === true;
        }),
        { numRuns: 500 }
      );
    });

    it('unknown actions should be rejected', () => {
      const input = {
        request: {
          action: 'invalid_action',
          spreadsheetId: 'test-id',
          range: { a1: 'A1:B10' },
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Values Array Validation', () => {
    it('should accept 2D arrays of strings', () => {
      fc.assert(
        fc.property(
          validSpreadsheetId,
          fc.array(fc.array(fc.string(), { minLength: 1, maxLength: 10 }), {
            minLength: 1,
            maxLength: 10,
          }),
          (spreadsheetId, values) => {
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: 'A1:B10' },
                values,
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should accept 2D arrays of numbers', () => {
      fc.assert(
        fc.property(
          validSpreadsheetId,
          fc.array(fc.array(fc.integer(), { minLength: 1, maxLength: 10 }), {
            minLength: 1,
            maxLength: 10,
          }),
          (spreadsheetId, values) => {
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: 'A1:B10' },
                values,
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should accept 2D arrays of booleans', () => {
      fc.assert(
        fc.property(
          validSpreadsheetId,
          fc.array(fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }), {
            minLength: 1,
            maxLength: 10,
          }),
          (spreadsheetId, values) => {
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: 'A1:B10' },
                values,
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should accept mixed type 2D arrays', () => {
      fc.assert(
        fc.property(
          validSpreadsheetId,
          fc.array(
            fc.array(
              fc.oneof(
                fc.string(),
                fc.integer(),
                fc.boolean(),
                fc.double({ noNaN: true, noDefaultInfinity: true })
              ),
              { minLength: 1, maxLength: 5 }
            ),
            { minLength: 1, maxLength: 5 }
          ),
          (spreadsheetId, values) => {
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: 'A1:B10' },
                values,
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should accept empty values array for write (API handles validation)', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: 'test-id',
          range: { a1: 'A1:B10' },
          values: [],
        },
      };

      // Schema allows empty arrays; the Google API will reject at runtime
      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject 1D arrays', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: 'test-id',
          range: { a1: 'A1:B10' },
          values: ['not', 'a', '2d', 'array'],
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Safety Options Validation', () => {
    it('should accept valid maxCellsAffected', () => {
      fc.assert(
        fc.property(
          validSpreadsheetId,
          fc.integer({ min: 1, max: 1000000 }),
          (spreadsheetId, maxCells) => {
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: 'A1:B10' },
                values: [['test']],
                safety: {
                  effectScope: {
                    maxCellsAffected: maxCells,
                  },
                },
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should accept dryRun boolean', () => {
      fc.assert(
        fc.property(validSpreadsheetId, fc.boolean(), (spreadsheetId, dryRun) => {
          const input = {
            request: {
              action: 'write' as const,
              spreadsheetId,
              range: { a1: 'A1:B10' },
              values: [['test']],
              safety: {
                dryRun,
              },
            },
          };

          const result = SheetsDataInputSchema.safeParse(input);
          return result.success === true;
        }),
        { numRuns: 500 }
      );
    });

    it('should reject negative maxCellsAffected', () => {
      fc.assert(
        fc.property(
          validSpreadsheetId,
          fc.integer({ min: -1000000, max: -1 }),
          (spreadsheetId, negativeCells) => {
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: 'A1:B10' },
                values: [['test']],
                safety: {
                  effectScope: {
                    maxCellsAffected: negativeCells,
                  },
                },
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === false;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should reject zero maxCellsAffected', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: 'test-id',
          range: { a1: 'A1:B10' },
          values: [['test']],
          safety: {
            effectScope: {
              maxCellsAffected: 0,
            },
          },
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle very large values arrays', () => {
      fc.assert(
        fc.property(
          validSpreadsheetId,
          fc.array(fc.array(fc.string({ maxLength: 10 }), { minLength: 1, maxLength: 20 }), {
            minLength: 100,
            maxLength: 200,
          }),
          (spreadsheetId, largeValues) => {
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: 'A1:Z1000' },
                values: largeValues,
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle special characters in string values', () => {
      fc.assert(
        fc.property(
          validSpreadsheetId,
          fc.array(fc.array(fc.string(), { minLength: 1 }), { minLength: 1, maxLength: 5 }),
          (spreadsheetId, values) => {
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: 'A1:B10' },
                values,
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should handle unicode characters in values', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: 'test-id',
          range: { a1: 'A1:B2' },
          values: [
            ['Hello', '世界'],
            ['🌍', 'emoji'],
          ],
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should handle very long strings in values', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1000, maxLength: 5000 }), (longString) => {
          const input = {
            request: {
              action: 'write' as const,
              spreadsheetId: 'test-id',
              range: { a1: 'A1' },
              values: [[longString]],
            },
          };

          const result = SheetsDataInputSchema.safeParse(input);
          return result.success === true;
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Request Envelope Wrapper', () => {
    it('should accept requests wrapped in request envelope', () => {
      fc.assert(
        fc.property(validSpreadsheetId, (spreadsheetId) => {
          const input = {
            request: {
              action: 'read' as const,
              spreadsheetId,
              range: { a1: 'A1:B10' },
            },
          };

          const result = SheetsDataInputSchema.safeParse(input);
          return result.success === true;
        }),
        { numRuns: 500 }
      );
    });

    it('should reject unwrapped requests', () => {
      const input = {
        action: 'read' as const,
        spreadsheetId: 'test-id',
        range: { a1: 'A1:B10' },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
