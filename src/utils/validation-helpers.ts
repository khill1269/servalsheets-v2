/**
 * Validation Helper Utilities
 *
 * Provides safe validation and assertion functions to replace
 * non-null assertions and improve type safety throughout the codebase.
 *
 * @module utils/validation-helpers
 */

import { ValidationError } from '../core/errors.js';

/**
 * Assert that regex match groups exist at specified indices
 *
 * Replaces unsafe pattern:
 *   const col = match[1]!;
 *
 * With safe pattern:
 *   assertRegexGroups(match, 2);
 *   const col = match[1];
 *
 * @param match - Regex match result
 * @param requiredGroups - Number of capture groups required (excluding group 0)
 * @param context - Optional context for error message
 * @throws {ValidationError} if match is null or groups are missing
 */
export function assertRegexGroups(
  match: RegExpMatchArray | null,
  requiredGroups: number,
  context?: string
): asserts match is RegExpMatchArray & { [key: number]: string } {
  if (!match) {
    const message = context ? `${context}: Regex match failed` : 'Regex match failed';
    throw new ValidationError(message, 'input');
  }

  // Check that all required groups exist (groups start at index 1)
  for (let i = 1; i <= requiredGroups; i++) {
    if (match[i] === undefined) {
      const message = context
        ? `${context}: Missing regex capture group ${i} (expected ${requiredGroups} groups)`
        : `Missing regex capture group ${i} (expected ${requiredGroups} groups)`;
      throw new ValidationError(message, 'input');
    }
  }
}

/**
 * Assert that a value is defined (not null or undefined)
 *
 * TypeScript type guard that narrows type from T | null | undefined to T
 *
 * @param value - Value to check
 * @param name - Name of the value for error message
 * @throws {ValidationError} if value is null or undefined
 */
export function assertDefined<T>(value: T | null | undefined, name: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new ValidationError(`${name} is required but was ${value}`, name);
  }
}

/**
 * Assert that a string is non-empty
 *
 * @param value - String to check
 * @param name - Name of the string for error message
 * @throws {ValidationError} if string is empty
 */
export function assertNonEmpty(value: string, name: string): asserts value is string {
  assertDefined(value, name);
  if (value.trim() === '') {
    throw new ValidationError(`${name} cannot be empty`, name);
  }
}

/**
 * Safe parse of A1 notation range (e.g., "A1:B10")
 *
 * Returns parsed components or throws ValidationError if invalid
 *
 * @param range - A1 notation range string
 * @returns Parsed range components
 * @throws {ValidationError} if range format is invalid
 */
export function parseA1Range(range: string): {
  startCol: string;
  startRow: number;
  endCol: string;
  endRow: number;
  sheetPrefix?: string;
} {
  assertNonEmpty(range, 'range');

  // Match: [Sheet1!]A1:B10
  const match = range.match(/^(?:(.+?)!)?([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  assertRegexGroups(match, 5, 'A1 range format');

  const startCol = match[2] as string;
  const startRow = parseInt(match[3] as string, 10);
  const endCol = match[4] as string;
  const endRow = parseInt(match[5] as string, 10);
  const sheetPrefix = match[1] as string | undefined;

  // Validate row numbers
  if (startRow < 1 || endRow < 1) {
    throw new ValidationError(`Row numbers must be positive (got ${startRow}:${endRow})`, 'range');
  }

  if (startRow > endRow) {
    throw new ValidationError(
      `Start row (${startRow}) cannot be greater than end row (${endRow})`,
      'range'
    );
  }

  return {
    startCol,
    startRow,
    endCol,
    endRow,
    sheetPrefix,
  };
}

/**
 * Safe parse of single cell reference (e.g., "A1")
 *
 * @param cell - A1 notation cell reference
 * @returns Parsed cell components
 * @throws {ValidationError} if cell format is invalid
 */
export function parseA1Cell(cell: string): {
  col: string;
  row: number;
  sheetPrefix?: string;
} {
  assertNonEmpty(cell, 'cell');

  // Match: [Sheet1!]A1
  const match = cell.match(/^(?:(.+?)!)?([A-Z]+)(\d+)$/);
  assertRegexGroups(match, 3, 'A1 cell format');

  const col = match[2] as string;
  const row = parseInt(match[3] as string, 10);
  const sheetPrefix = match[1] as string | undefined;

  if (row < 1) {
    throw new ValidationError(`Row number must be positive (got ${row})`, 'cell');
  }

  return {
    col,
    row,
    sheetPrefix,
  };
}
