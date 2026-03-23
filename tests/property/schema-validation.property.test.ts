/**
 * ServalSheets v4 - Schema Validation Property Tests
 *
 * Property-based tests for Zod schema validation.
 * Ensures schemas accept valid inputs and reject invalid inputs consistently.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Import schemas - adjust paths as needed
import { SheetsDataInputSchema, ColorSchema, RangeInputSchema } from '../../src/schemas/index.js';

describe('Schema Validation Property Tests', () => {
  describe('ColorSchema', () => {
    it('should accept valid RGB values in 0-1 range', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 1, noNaN: true }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (red, green, blue, alpha) => {
            const result = ColorSchema.safeParse({ red, green, blue, alpha });
            return result.success === true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should reject RGB values outside 0-1 range', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(1.01), max: Math.fround(255), noNaN: true }),
          (invalidValue) => {
            const result = ColorSchema.safeParse({ red: invalidValue });
            return result.success === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject negative RGB values', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(-255), max: Math.fround(-0.01), noNaN: true }),
          (negativeValue) => {
            const result = ColorSchema.safeParse({ red: negativeValue });
            return result.success === false;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('RangeInputSchema', () => {
    it('should accept valid A1 notation strings', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 10000 }),
          (colIndex, rowNum) => {
            const colLetter = String.fromCharCode(65 + colIndex);
            const a1 = `${colLetter}${rowNum}`;

            const result = RangeInputSchema.safeParse({ a1 });
            return result.success === true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should accept grid coordinate format', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }), // sheetId
          fc.integer({ min: 0, max: 100 }), // startCol
          fc.integer({ min: 0, max: 10000 }), // startRow
          fc.integer({ min: 1, max: 101 }), // Ensure at least 1 column width
          fc.integer({ min: 1, max: 10001 }), // Ensure at least 1 row height
          (sheetId, startCol, startRow, endColOffset, endRowOffset) => {
            const endCol = startCol + endColOffset;
            const endRow = startRow + endRowOffset;

            const result = RangeInputSchema.safeParse({
              grid: {
                sheetId, // Required!
                startRowIndex: startRow,
                startColumnIndex: startCol,
                endRowIndex: endRow,
                endColumnIndex: endCol,
              },
            });
            return result.success === true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('SheetsDataInputSchema - Read Action', () => {
    it('should accept valid read action inputs', () => {
      fc.assert(
        fc.property(
          fc.string({
            minLength: 10,
            maxLength: 50,
            unit: fc.constantFrom(
              ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')
            ),
          }),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          (spreadsheetId, colIndex, rowNum) => {
            const colLetter = String.fromCharCode(65 + colIndex);
            // Schema uses discriminated union wrapped in 'request' field
            const input = {
              request: {
                action: 'read' as const,
                spreadsheetId,
                range: { a1: `${colLetter}${rowNum}` },
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject read action without spreadsheetId', () => {
      const input = {
        request: {
          action: 'read' as const,
          range: { a1: 'A1:B10' },
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('SheetsDataInputSchema - Write Action', () => {
    it('should accept valid write action inputs', () => {
      fc.assert(
        fc.property(
          fc.string({
            minLength: 10,
            maxLength: 50,
            unit: fc.constantFrom(
              ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')
            ),
          }),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          // Use noNaN and noDefaultInfinity because Zod's z.number() rejects NaN and Infinity
          fc.array(
            fc.array(
              fc.oneof(
                fc.string({ minLength: 1 }),
                fc.integer(),
                fc.double({ noNaN: true, noDefaultInfinity: true }),
                fc.boolean()
              ),
              { minLength: 1, maxLength: 10 }
            ),
            { minLength: 1, maxLength: 10 }
          ),
          (spreadsheetId, colIndex, rowNum, values) => {
            const colLetter = String.fromCharCode(65 + colIndex);
            // Schema uses discriminated union wrapped in 'request' field
            const input = {
              request: {
                action: 'write' as const,
                spreadsheetId,
                range: { a1: `${colLetter}${rowNum}` },
                values,
              },
            };

            const result = SheetsDataInputSchema.safeParse(input);
            return result.success === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject write action without values', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: 'test-id',
          range: { a1: 'A1:B10' },
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Safety Options', () => {
    it('should accept valid effect scope limits', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (maxCells) => {
          // Schema uses discriminated union wrapped in 'request' field
          const input = {
            request: {
              action: 'write' as const,
              spreadsheetId: 'test-id',
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
        }),
        { numRuns: 50 }
      );
    });

    it('should accept dryRun flag', () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: 'test-id',
          range: { a1: 'A1:B10' },
          values: [['test']],
          safety: {
            dryRun: true,
          },
        },
      };

      const result = SheetsDataInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('Discriminated Union Consistency', () => {
    it('action field should determine required fields', () => {
      const actions = ['read', 'write', 'append', 'clear'] as const;

      for (const action of actions) {
        // Schema uses discriminated union wrapped in 'request' field
        const baseInput = {
          request: {
            action,
            spreadsheetId: 'test-id',
            range: { a1: 'A1:B10' },
          },
        };

        // Write and append require values
        if (action === 'write' || action === 'append') {
          const withoutValues = SheetsDataInputSchema.safeParse(baseInput);
          expect(withoutValues.success).toBe(false);

          const withValues = SheetsDataInputSchema.safeParse({
            request: {
              ...baseInput.request,
              values: [['test']],
            },
          });
          expect(withValues.success).toBe(true);
        } else {
          // Read and clear don't require values
          const result = SheetsDataInputSchema.safeParse(baseInput);
          expect(result.success).toBe(true);
        }
      }
    });
  });
});
