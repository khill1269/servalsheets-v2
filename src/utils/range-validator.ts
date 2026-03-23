/**
 * Range Pre-Flight Validation Utility (P1-5)
 *
 * Validates A1 ranges against actual sheet grid dimensions BEFORE making Google API write calls.
 * This prevents unnecessary API failures and provides helpful error messages with recovery hints.
 *
 * Performance: CachedSheetsApi handles ETag caching, so the metadata fetch is free after first call.
 *
 * @category Utils
 */

import type { sheets_v4 } from 'googleapis';
import type { CachedSheetsApi } from '../services/cached-sheets-api.js';
import { parseA1Notation } from './google-sheets-helpers.js';
import { logger } from './logger.js';
import { RangeResolutionError } from '../core/errors.js';

export interface RangeValidationResult {
  valid: boolean;
  error?: string;
  hint?: string;
  details?: {
    range: string;
    sheetName: string;
    requestedRows?: { start: number; end: number };
    requestedCols?: { start: number; end: number };
    gridRows?: number;
    gridCols?: number;
  };
}

/**
 * Validate that an A1 range fits within actual sheet grid dimensions.
 *
 * This catches common errors like:
 * - Writing beyond sheet row/column limits
 * - Referencing sheets with quoted names that don't exist
 * - Using auto-expanding ranges in contexts where they fail
 *
 * @param cachedApi - CachedSheetsApi instance for metadata fetch
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param range - A1 notation range (e.g., "Sheet1!A1:Z1000")
 * @returns Validation result with error details and hints if invalid
 *
 * @example
 * ```typescript
 * const result = await validateRangeWithinGrid(cachedApi, spreadsheetId, 'Sheet1!A1:Z1000');
 * if (!result.valid) {
 *   throw new RangeResolutionError(result.error, 'RANGE_OUT_OF_BOUNDS', result.details);
 * }
 * ```
 */
export async function validateRangeWithinGrid(
  cachedApi: CachedSheetsApi,
  spreadsheetId: string,
  range: string
): Promise<RangeValidationResult> {
  try {
    // Parse the range to extract sheet name and coordinates
    const parsed = parseA1Notation(range);
    const requestedSheetName =
      parsed.sheetName || (await getDefaultSheetName(cachedApi, spreadsheetId));

    // Fetch spreadsheet metadata to get sheet grid dimensions
    const spreadsheet = await cachedApi.getSpreadsheet(spreadsheetId, {
      fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
    });

    if (!spreadsheet.sheets || spreadsheet.sheets.length === 0) {
      return {
        valid: false,
        error: `No sheets found in spreadsheet ${spreadsheetId}`,
        hint: 'Spreadsheet appears to be empty. Create at least one sheet before writing.',
      };
    }

    // Find the target sheet by name
    const targetSheet = findSheetByName(spreadsheet.sheets, requestedSheetName);
    if (!targetSheet) {
      const availableSheets = (spreadsheet.sheets || [])
        .map((s) => s.properties?.title)
        .filter((name) => name !== undefined)
        .join(', ');

      return {
        valid: false,
        error: `Sheet "${requestedSheetName}" not found in spreadsheet`,
        hint: `Available sheets: ${availableSheets || 'none'}. Check sheet name spelling and quoting.`,
        details: {
          range,
          sheetName: requestedSheetName,
          gridRows: undefined,
          gridCols: undefined,
        },
      };
    }

    // Get grid dimensions from the sheet
    const gridProps = targetSheet.properties?.gridProperties;
    if (!gridProps) {
      return {
        valid: false,
        error: `Cannot determine grid dimensions for sheet "${requestedSheetName}"`,
        hint: 'Sheet properties are unavailable. Try again or contact support.',
      };
    }

    const gridRows = gridProps.rowCount ?? 1000;
    const gridCols = gridProps.columnCount ?? 26;

    // Check if requested range fits within grid dimensions
    // Note: parseA1Notation returns endRow/endCol as exclusive bounds (0-based indexing)
    const requestedEndRow = parsed.endRow; // Exclusive end row (0-based)
    const requestedEndCol = parsed.endCol; // Exclusive end column (0-based)

    // Full-column notation (A:A) uses endRow=1000000; that's OK, we just check if it exceeds grid
    const rowsOutOfBounds = requestedEndRow > gridRows;
    const colsOutOfBounds = requestedEndCol > gridCols;

    if (rowsOutOfBounds || colsOutOfBounds) {
      const hints: string[] = [];

      if (rowsOutOfBounds) {
        hints.push(
          `Range requests rows up to ${parsed.endRow}, but sheet has only ${gridRows} rows. ` +
            `Try using A1:${indexToColumnLetter(parsed.endCol - 1)}${gridRows} instead.`
        );
      }

      if (colsOutOfBounds) {
        const lastValidCol = indexToColumnLetter(gridCols - 1);
        hints.push(
          `Range requests column ${indexToColumnLetter(parsed.endCol - 1)}, ` +
            `but sheet has only ${gridCols} columns (up to ${lastValidCol}). ` +
            `Consider using a narrower range like A1:${lastValidCol}100.`
        );
      }

      const errorMsg = `Range ${range} extends beyond sheet grid dimensions (${gridRows}×${gridCols})`;

      logger.warn('Range validation failed', {
        spreadsheetId,
        range,
        sheetName: requestedSheetName,
        gridRows,
        gridCols,
        requestedEndRow,
        requestedEndCol,
      });

      return {
        valid: false,
        error: errorMsg,
        hint: hints.join(' '),
        details: {
          range,
          sheetName: requestedSheetName,
          requestedRows: { start: parsed.startRow, end: parsed.endRow },
          requestedCols: { start: parsed.startCol, end: parsed.endCol },
          gridRows,
          gridCols,
        },
      };
    }

    // Range is valid
    logger.debug('Range validation passed', {
      spreadsheetId,
      range,
      sheetName: requestedSheetName,
      gridRows,
      gridCols,
    });

    return {
      valid: true,
      details: {
        range,
        sheetName: requestedSheetName,
        requestedRows: { start: parsed.startRow, end: parsed.endRow },
        requestedCols: { start: parsed.startCol, end: parsed.endCol },
        gridRows,
        gridCols,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Range validation encountered an error', {
      range,
      spreadsheetId,
      error: message,
    });

    // Non-blocking: validation errors should not fail the operation
    // (the Google API will catch actual range errors)
    return {
      valid: true,
      hint: 'Range validation was skipped due to an error. The Google Sheets API will validate on write.',
    };
  }
}

/**
 * Helper: Get default sheet name (first sheet in spreadsheet)
 */
async function getDefaultSheetName(
  cachedApi: CachedSheetsApi,
  spreadsheetId: string
): Promise<string> {
  const spreadsheet = await cachedApi.getSpreadsheet(spreadsheetId, {
    fields: 'sheets(properties(title))',
  });

  const firstName = spreadsheet.sheets?.[0]?.properties?.title;
  if (!firstName) {
    throw new RangeResolutionError(
      `Cannot determine default sheet name for spreadsheet ${spreadsheetId}`,
      'SHEET_NOT_FOUND',
      { spreadsheetId }
    );
  }

  return firstName;
}

/**
 * Helper: Find sheet by name (case-insensitive, handles quoted names)
 */
function findSheetByName(
  sheets: sheets_v4.Schema$Sheet[],
  nameToFind: string
): sheets_v4.Schema$Sheet | undefined {
  // First try exact match
  const exact = sheets.find((s) => s.properties?.title === nameToFind);
  if (exact) return exact;

  // Try case-insensitive match
  const caseInsensitive = sheets.find(
    (s) => s.properties?.title?.toLowerCase() === nameToFind.toLowerCase()
  );
  if (caseInsensitive) return caseInsensitive;

  return undefined; // Explicit: no sheet matched by exact or case-insensitive title
}

/**
 * Helper: Convert 0-based column index to letter (A=0, B=1, Z=25, AA=26)
 * Uses the canonical implementation from google-sheets-helpers.ts
 */
function indexToColumnLetter(index: number): string {
  let letter = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}
