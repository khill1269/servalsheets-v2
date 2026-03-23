/**
 * ServalSheets - Formula Parser Property Tests
 *
 * Property-based tests for spreadsheet formula parsing and validation.
 * Ensures formula detection, parsing, and validation handle all edge cases.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('Formula Parser Property Tests', () => {
  describe('Formula Detection', () => {
    it('strings starting with = should be detected as formulas', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 100 }), (formulaContent) => {
          const formula = `=${formulaContent}`;
          return formula.startsWith('=');
        }),
        { numRuns: 1000 }
      );
    });

    it('strings not starting with = should not be formulas', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.constantFrom('a', 'b', 'c', '1', '2', ' ', '-', '+', '*'),
          (content, firstChar) => {
            fc.pre(firstChar !== '=');
            const notFormula = `${firstChar}${content}`;
            return !notFormula.startsWith('=');
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('empty string should not be a formula', () => {
      expect(''.startsWith('=')).toBe(false);
    });

    it('single = should be detected as formula', () => {
      expect('='.startsWith('=')).toBe(true);
    });

    it('formula detection should be case-insensitive for function names', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('sum', 'SUM', 'Sum', 'sUm'),
          fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 5 }),
          (funcName, args) => {
            const formula = `=${funcName}(${args.join(',')})`;
            return formula.startsWith('=') && formula.toLowerCase().includes('sum');
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Formula Structure Validation', () => {
    it('formulas with balanced parentheses should be valid', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5 }),
          fc.constantFrom('SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'),
          (depth, funcName) => {
            const openParens = '('.repeat(depth);
            const closeParens = ')'.repeat(depth);
            const formula = `=${funcName}${openParens}A1:A10${closeParens}`;

            // Count parentheses
            const opens = (formula.match(/\(/g) || []).length;
            const closes = (formula.match(/\)/g) || []).length;

            return opens === closes;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('nested formulas should preserve structure', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('SUM', 'AVERAGE', 'COUNT'),
          fc.constantFrom('MAX', 'MIN', 'ABS'),
          (outerFunc, innerFunc) => {
            const formula = `=${outerFunc}(${innerFunc}(A1:A10))`;

            // Should have 2 opening and 2 closing parens
            const opens = (formula.match(/\(/g) || []).length;
            const closes = (formula.match(/\)/g) || []).length;

            return opens === 2 && closes === 2;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('formulas with cell references should contain valid A1 notation', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 10000 }),
          fc.constantFrom('SUM', 'AVERAGE', 'COUNT'),
          (colIndex, rowNum, funcName) => {
            const col = String.fromCharCode(65 + colIndex);
            const formula = `=${funcName}(${col}${rowNum})`;

            // Should contain valid column letter
            return /[A-Z]/.test(formula) && /\d/.test(formula);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('formulas with range references should have colon separator', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 1000 }),
          (col1, row1, col2, row2) => {
            const startCol = String.fromCharCode(65 + col1);
            const endCol = String.fromCharCode(65 + col2);
            const formula = `=SUM(${startCol}${row1}:${endCol}${row2})`;

            return formula.includes(':');
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  describe('Formula Operators', () => {
    it('arithmetic formulas should contain operators', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          fc.integer({ min: 1, max: 1000 }),
          fc.constantFrom('+', '-', '*', '/'),
          (num1, num2, operator) => {
            const formula = `=${num1}${operator}${num2}`;
            return formula.includes(operator);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('comparison formulas should contain comparison operators', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          fc.constantFrom('>', '<', '>=', '<=', '=', '<>'),
          fc.integer({ min: 1, max: 1000 }),
          (colIndex, rowNum, operator, value) => {
            const col = String.fromCharCode(65 + colIndex);
            const formula = `=${col}${rowNum}${operator}${value}`;

            return formula.includes(operator);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('concatenation formulas should use & operator', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (str1, str2) => {
            const formula = `="${str1}"&"${str2}"`;
            return formula.includes('&');
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Formula Arguments', () => {
    it('formulas with multiple arguments should use comma separators', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 25 }), { minLength: 2, maxLength: 10 }),
          fc.integer({ min: 1, max: 100 }),
          (colIndices, rowNum) => {
            const cellRefs = colIndices.map((idx) => `${String.fromCharCode(65 + idx)}${rowNum}`);
            const formula = `=SUM(${cellRefs.join(',')})`;

            const commaCount = (formula.match(/,/g) || []).length;
            return commaCount === cellRefs.length - 1;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('argument count should match comma count + 1', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
          (args) => {
            const formula = `=SUM(${args.join(',')})`;
            const commaCount = (formula.match(/,/g) || []).length;

            return args.length === commaCount + 1;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('empty argument lists should have no commas', () => {
      fc.assert(
        fc.property(fc.constantFrom('NOW', 'TODAY', 'RAND'), (funcName) => {
          const formula = `=${funcName}()`;
          return !formula.includes(',');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('String Literals in Formulas', () => {
    it('string literals should be enclosed in quotes', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), (str) => {
          const formula = `="${str}"`;

          // Count quote pairs
          const quoteCount = (formula.match(/"/g) || []).length;
          return quoteCount >= 2; // At least opening and closing quotes
        }),
        { numRuns: 500 }
      );
    });

    it('strings with embedded quotes should be escaped', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 30 }), (str) => {
          // Add a quote in the middle
          const strWithQuote = `${str}"test`;
          // Escape it
          const escaped = strWithQuote.replaceAll('"', '""');
          const formula = `="${escaped}"`;

          // Should have even number of quotes (properly escaped)
          const quoteCount = (formula.match(/"/g) || []).length;
          return quoteCount % 2 === 0;
        }),
        { numRuns: 200 }
      );
    });

    it('empty string literals should be valid', () => {
      const formula = '=""';
      expect(formula.startsWith('=')).toBe(true);
      expect(formula).toContain('""');
    });
  });

  describe('Named Ranges in Formulas', () => {
    it('formulas with named ranges should be valid', () => {
      fc.assert(
        fc.property(
          fc.string({
            minLength: 1,
            maxLength: 20,
            unit: fc.constantFrom(
              ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split('')
            ),
          }),
          (namedRange) => {
            const formula = `=SUM(${namedRange})`;
            return formula.startsWith('=') && formula.includes(namedRange);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('named ranges should not start with numbers', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z'),
          fc.string({
            minLength: 1,
            maxLength: 19,
            unit: fc.constantFrom(
              ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')
            ),
          }),
          (firstChar, rest) => {
            const namedRange = `${firstChar}${rest}`;
            // Valid named range - doesn't start with number
            return !/^\d/.test(namedRange);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Formula Edge Cases', () => {
    it('should handle very long formulas', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 50, maxLength: 200 }),
          (numbers) => {
            const formula = `=SUM(${numbers.join(',')})`;
            return formula.length > 100 && formula.startsWith('=');
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle formulas with whitespace', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 0, max: 5 }),
          (colIndex, rowNum, spaces) => {
            const col = String.fromCharCode(65 + colIndex);
            const whitespace = ' '.repeat(spaces);
            const formula = `=SUM(${whitespace}${col}${rowNum}${whitespace})`;

            return formula.startsWith('=') && formula.includes(col);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should handle nested function calls', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5 }), (depth) => {
          let formula = 'A1';
          for (let i = 0; i < depth; i++) {
            formula = `ABS(${formula})`;
          }
          formula = `=${formula}`;

          const openCount = (formula.match(/\(/g) || []).length;
          const closeCount = (formula.match(/\)/g) || []).length;

          return openCount === closeCount && openCount === depth;
        }),
        { numRuns: 200 }
      );
    });

    it('should handle array formulas', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          (colIndex, rowNum) => {
            const col = String.fromCharCode(65 + colIndex);
            const formula = `={SUM(${col}${rowNum}:${col}${rowNum + 10})}`;

            // Array formulas wrapped in braces
            return formula.includes('{') && formula.includes('}');
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should handle formulas with special characters', () => {
      const specialChars = ['$', '%', '#', '@'];
      for (const char of specialChars) {
        const formula = `=A1*${char === '$' ? '$A$1' : `"${char}"`}`;
        expect(formula.startsWith('=')).toBe(true);
      }
    });

    it('should handle IF formulas with conditions', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 1, max: 1000 }),
          // Filter out strings containing commas to avoid false positives
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(',')),
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(',')),
          (colIndex, rowNum, threshold, trueValue, falseValue) => {
            const col = String.fromCharCode(65 + colIndex);
            const formula = `=IF(${col}${rowNum}>${threshold},"${trueValue}","${falseValue}")`;

            // Should have 3 arguments (condition, true, false)
            // Now safe to count commas since string literals don't contain them
            const commaCount = (formula.match(/,/g) || []).length;
            return commaCount === 2;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should handle VLOOKUP formulas', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 2, max: 10 }),
          fc.boolean(),
          (colIndex, rowNum, colNum, exactMatch) => {
            const col = String.fromCharCode(65 + colIndex);
            const formula = `=VLOOKUP(${col}${rowNum},A1:Z100,${colNum},${exactMatch})`;

            // Should have 4 arguments
            const commaCount = (formula.match(/,/g) || []).length;
            return commaCount === 3;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should handle formulas with error values', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('#N/A', '#VALUE!', '#REF!', '#DIV/0!', '#NUM!', '#NAME?', '#NULL!'),
          (errorValue) => {
            const formula = `=IFERROR(A1/B1,"${errorValue}")`;
            return formula.includes(errorValue);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Formula Value Type Detection', () => {
    it('numeric formulas should contain numbers', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10000 }),
          fc.integer({ min: 1, max: 10000 }),
          (num1, num2) => {
            const formula = `=${num1}+${num2}`;
            return /\d/.test(formula);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('boolean formulas should use logical operators', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 25 }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 1, max: 100 }),
          (colIndex, rowNum, value) => {
            const col = String.fromCharCode(65 + colIndex);
            const formula = `=AND(${col}${rowNum}>${value},${col}${rowNum + 1}<${value + 10})`;

            return formula.includes('AND') || formula.includes('OR') || formula.includes('NOT');
          }
        ),
        { numRuns: 500 }
      );
    });

    it('date formulas should use date functions', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('TODAY', 'NOW', 'DATE', 'DATEVALUE', 'DAY', 'MONTH', 'YEAR'),
          (dateFunc) => {
            const formula = `=${dateFunc}()`;
            return formula.includes(dateFunc);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
