/**
 * ServalSheets - Google API Utilities
 *
 * Clean helpers for common operations.
 */

import type { sheets_v4 } from 'googleapis';
import { memoize } from './memoization.js';
import { ValidationError } from '../core/errors.js';

// ============================================================================
// PRE-COMPILED REGEX PATTERNS (hot path — avoid recompilation per call)
// ============================================================================

/** Matches full-column A1 notation like "Sheet1!A:C" or "A:Z" */
const A1_FULL_COL_RE = /^(?:'([^']+)'!|([^!]+)!)?([A-Z]+):([A-Z]+)$/i;

/** Matches standard A1 range notation like "Sheet1!A1:C10" or "B5" */
const A1_RANGE_RE = /^(?:'([^']+)'!|([^!]+)!)?([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i;

/** Matches single cell reference like "Sheet1!A1" or "B5" */
const CELL_REF_RE = /^(?:'([^']+)'!|([^!]+)!)?([A-Z]+)(\d+)$/i;

// ============================================================================
// COLOR CONVERSION
// ============================================================================

/**
 * Convert hex color to Google Sheets RGB (0-1 scale)
 */
export function hexToRgb(hex: string): {
  red: number;
  green: number;
  blue: number;
} {
  const clean = hex.replace('#', '');
  return {
    red: parseInt(clean.substring(0, 2), 16) / 255,
    green: parseInt(clean.substring(2, 4), 16) / 255,
    blue: parseInt(clean.substring(4, 6), 16) / 255,
  };
}

/**
 * Convert Google Sheets RGB to hex
 */
export function rgbToHex(color: { red?: number; green?: number; blue?: number }): string {
  const r = Math.round((color.red ?? 0) * 255)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round((color.green ?? 0) * 255)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round((color.blue ?? 0) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

// ============================================================================
// A1 NOTATION PARSING
// ============================================================================

export interface ParsedA1 {
  sheetName?: string;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export interface ParsedCell {
  sheetName?: string;
  col: number;
  row: number;
}

/**
 * Parse A1 notation range (e.g., "Sheet1!A1:C10" or "A1:B5")
 * Supports emoji sheet names and special characters when properly quoted.
 */
function _parseA1Notation(a1: string): ParsedA1 {
  // Defensive: ensure input is a string
  if (typeof a1 !== 'string' || !a1.trim()) {
    throw new ValidationError(
      `Invalid A1 notation: expected non-empty string, got ${typeof a1}`,
      'range',
      'Sheet1!A1:D10'
    );
  }

  // Handle full column notation (A:A, A:C)
  const fullColMatch = a1.match(A1_FULL_COL_RE);
  if (fullColMatch) {
    const sheetName = fullColMatch[1] ?? fullColMatch[2];
    const startColLetter = fullColMatch[3];
    const endColLetter = fullColMatch[4];
    if (!startColLetter || !endColLetter) {
      throw new ValidationError(
        `Invalid A1 notation (full column): ${a1}`,
        'range',
        'Sheet1!A1:D10'
      );
    }
    return {
      sheetName,
      startCol: columnLetterToIndex(startColLetter),
      startRow: 0,
      endCol: columnLetterToIndex(endColLetter) + 1,
      endRow: 1000000, // Full column
    };
  }

  // Standard range notation - supports emoji sheet names in quotes
  const match = a1.match(A1_RANGE_RE);
  if (!match) {
    throw new ValidationError(
      `Invalid A1 notation: ${a1}. Expected format: "A1", "A1:B10", "Sheet1!A1:B10", or "'Sheet Name'!A1:B10"`,
      'range',
      'Sheet1!A1:D10'
    );
  }

  const sheetName = match[1] ?? match[2];
  const startColLetter = match[3];
  const startRowStr = match[4];
  const endColLetter = match[5];
  const endRowStr = match[6];

  // Defensive: ensure required capture groups are present
  if (!startColLetter || !startRowStr) {
    throw new ValidationError(
      `Invalid A1 notation (missing cell reference): ${a1}`,
      'range',
      'Sheet1!A1:D10'
    );
  }

  const startCol = columnLetterToIndex(startColLetter);
  const startRow = parseInt(startRowStr, 10) - 1;
  const endCol = endColLetter ? columnLetterToIndex(endColLetter) + 1 : startCol + 1;
  const endRow = endRowStr ? parseInt(endRowStr, 10) : startRow + 1;

  // Defensive: check for NaN (shouldn't happen with valid regex match, but be safe)
  if (
    Number.isNaN(startRow) ||
    Number.isNaN(endRow) ||
    Number.isNaN(startCol) ||
    Number.isNaN(endCol)
  ) {
    throw new ValidationError(`Invalid A1 notation (parse error): ${a1}`, 'range', 'Sheet1!A1:D10');
  }

  return { sheetName, startCol, startRow, endCol, endRow };
}

/**
 * Memoized A1 notation parser — caches results for repeated range lookups.
 * Uses string identity as cache key (no JSON.stringify overhead).
 */
export const parseA1Notation = memoize(_parseA1Notation, {
  maxSize: 500,
  ttl: 60_000,
  keyFn: (a1: string) => a1,
});

/**
 * Parse single cell reference (e.g., "Sheet1!A1" or "B5")
 */
function _parseCellReference(cell: string): ParsedCell {
  const match = cell.match(CELL_REF_RE);
  if (!match) {
    throw new ValidationError(`Invalid cell reference: ${cell}`, 'range', 'Sheet1!A1');
  }

  const sheetName = match[1] ?? match[2];
  const colLetter = match[3]!;
  const rowStr = match[4]!;

  return {
    sheetName,
    col: columnLetterToIndex(colLetter),
    row: parseInt(rowStr, 10) - 1,
  };
}

/**
 * Memoized cell reference parser — caches results for repeated lookups.
 */
export const parseCellReference = memoize(_parseCellReference, {
  maxSize: 500,
  ttl: 60_000,
  keyFn: (cell: string) => cell,
});

/**
 * Pre-computed column index cache for fast repeated lookups.
 * Canonical implementation — all column letter/index conversions should use this file.
 * See also: indexToColumnLetter() below for the reverse conversion.
 */
const COLUMN_INDEX_CACHE = new Map<string, number>();

/**
 * Convert column letter to 0-based index (A=0, B=1, Z=25, AA=26)
 * Uses Map caching for O(1) repeated lookups.
 */
export function columnLetterToIndex(letter: string): number {
  const upper = letter.toUpperCase();
  const cached = COLUMN_INDEX_CACHE.get(upper);
  if (cached !== undefined) return cached;

  let index = 0;
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  index -= 1; // Convert to 0-based

  COLUMN_INDEX_CACHE.set(upper, index);
  return index;
}

/**
 * Convert 0-based index to column letter
 */
export function indexToColumnLetter(index: number): string {
  let letter = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Build A1 notation from components
 */
export function buildA1Notation(
  sheetName: string | undefined,
  startCol: number,
  startRow: number,
  endCol?: number,
  endRow?: number
): string {
  const startCell = `${indexToColumnLetter(startCol)}${startRow + 1}`;
  const endCell =
    endCol !== undefined && endRow !== undefined
      ? `:${indexToColumnLetter(endCol - 1)}${endRow}`
      : '';

  const range = `${startCell}${endCell}`;

  if (sheetName) {
    const quotedName = /[^a-zA-Z0-9_]/.test(sheetName) ? `'${sheetName}'` : sheetName;
    return `${quotedName}!${range}`;
  }

  return range;
}

// ============================================================================
// GRID RANGE HELPERS
// ============================================================================

export interface GridRangeInput {
  sheetId: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

/**
 * Build internal GridRangeInput
 */
export function buildGridRangeInput(
  sheetId: number,
  startRowIndex?: number,
  endRowIndex?: number,
  startColumnIndex?: number,
  endColumnIndex?: number
): GridRangeInput {
  // Defensive: convert NaN to undefined to prevent validation errors
  // NaN can occur if A1 notation parsing fails or receives unexpected input
  const sanitize = (val?: number): number | undefined =>
    val !== undefined && !Number.isNaN(val) ? val : undefined;

  return {
    sheetId: Number.isNaN(sheetId) ? 0 : sheetId,
    startRowIndex: sanitize(startRowIndex),
    endRowIndex: sanitize(endRowIndex),
    startColumnIndex: sanitize(startColumnIndex),
    endColumnIndex: sanitize(endColumnIndex),
  };
}

/**
 * Build Google Sheets GridRange
 */
export function toGridRange(input: GridRangeInput): sheets_v4.Schema$GridRange {
  return {
    sheetId: input.sheetId,
    startRowIndex: input.startRowIndex,
    endRowIndex: input.endRowIndex,
    startColumnIndex: input.startColumnIndex,
    endColumnIndex: input.endColumnIndex,
  };
}

/**
 * Estimate cell count from a GridRange
 *
 * Accounts for:
 * - Sparse matrices (empty cells don't count toward payload)
 * - Merged cells (count as single cell for bandwidth estimation)
 * - Actual data size if available
 *
 * @param range - GridRange to estimate
 * @param options - Optional estimation parameters
 * @returns Estimated cell count (conservative for bandwidth planning)
 */
export function estimateCellCount(
  range: sheets_v4.Schema$GridRange,
  options?: {
    /** Actual row data for sparsity detection */
    values?: unknown[][];
    /** Merged cell ranges for deduplication */
    merges?: sheets_v4.Schema$GridRange[];
    /** Sparsity factor (0-1, default 0.7 for typical sheets) */
    sparsityFactor?: number;
  }
): number {
  const rows = (range.endRowIndex ?? 0) - (range.startRowIndex ?? 0);
  const cols = (range.endColumnIndex ?? 0) - (range.startColumnIndex ?? 0);
  const rawCellCount = Math.max(0, rows * cols);

  // If we have actual data, count non-empty cells
  if (options?.values) {
    let nonEmptyCells = 0;
    for (const row of options.values) {
      if (Array.isArray(row)) {
        nonEmptyCells += row.filter(
          (cell) => cell !== null && cell !== undefined && cell !== ''
        ).length;
      }
    }
    return nonEmptyCells;
  }

  // If we have merge information, subtract merged cells
  if (options?.merges && options.merges.length > 0) {
    let mergedCellCount = 0;
    for (const merge of options.merges) {
      const mergeRows = (merge.endRowIndex ?? 0) - (merge.startRowIndex ?? 0);
      const mergeCols = (merge.endColumnIndex ?? 0) - (merge.startColumnIndex ?? 0);
      // Merged cells count as 1 for the top-left, 0 for the rest
      mergedCellCount += Math.max(0, mergeRows * mergeCols - 1);
    }
    return Math.max(0, rawCellCount - mergedCellCount);
  }

  // Apply sparsity factor for more realistic estimates
  // Typical spreadsheets are 60-80% sparse (empty cells)
  const sparsityFactor = options?.sparsityFactor ?? 0.7;
  return Math.ceil(rawCellCount * sparsityFactor);
}

// ============================================================================
// SPREADSHEET ID EXTRACTION
// ============================================================================

/**
 * Extract spreadsheet ID from URL or return as-is if already an ID
 */
export function extractSpreadsheetId(urlOrId: string): string {
  // Already an ID (no slashes)
  if (!urlOrId.includes('/')) {
    return urlOrId;
  }

  // Extract from URL: https://docs.google.com/spreadsheets/d/{ID}/edit
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) {
    return match[1]!;
  }

  throw new ValidationError(
    `Cannot extract spreadsheet ID from: ${urlOrId}`,
    'spreadsheetId',
    'https://docs.google.com/spreadsheets/d/...'
  );
}

// ============================================================================
// CHIP RUNS (Smart Chips API - June 2025)
// ============================================================================

/**
 * Chip type extracted from chipRuns API response
 *
 * Note: Drive chips are implemented as rich_link chips with Drive URIs.
 * The API doesn't have a separate driveItemProperties.
 */
export type ChipType = 'person' | 'drive' | 'rich_link' | 'unknown';

/**
 * Person chip display format
 */
export type PersonChipDisplayFormat = 'DEFAULT' | 'LAST_NAME_COMMA_FIRST_NAME' | 'EMAIL';

/**
 * Parsed chip information
 */
export interface ParsedChip {
  type: ChipType;
  cell: string;
  email?: string;
  fileId?: string;
  uri?: string;
  displayText?: string;
}

/**
 * Build a person chip using the chipRuns API
 *
 * @param email - Email address of the person
 * @param displayFormat - How to display the chip (DEFAULT, FULL, NAME_ONLY)
 * @returns CellData with chipRuns for person chip
 *
 * @see https://developers.google.com/workspace/sheets/api/guides/chips
 */
export function buildPersonChip(
  email: string,
  displayFormat: PersonChipDisplayFormat = 'DEFAULT'
): sheets_v4.Schema$CellData {
  return {
    userEnteredValue: {
      stringValue: `@${email}`, // @ symbol prefix for person chip
    },
    chipRuns: [
      {
        chip: {
          personProperties: {
            email,
            displayFormat,
          },
        },
      },
    ],
  };
}

/**
 * Build a Drive file chip using the chipRuns API
 *
 * Note: Drive chips are implemented as richLinkProperties with a Drive URI.
 * The API doesn't have a separate driveItemProperties.
 *
 * @param fileId - Google Drive file ID
 * @param displayText - Optional custom display text (defaults to file title from API)
 * @returns CellData with chipRuns for drive chip
 *
 * @see https://developers.google.com/workspace/sheets/api/guides/chips
 */
export function buildDriveChip(fileId: string, displayText?: string): sheets_v4.Schema$CellData {
  const driveUri = `https://drive.google.com/file/d/${fileId}/view`;

  // Validate URI length (Google API limit: 2000 bytes)
  if (new TextEncoder().encode(driveUri).length > 2000) {
    throw new ValidationError(
      'Drive URI exceeds 2000 bytes limit',
      'fileId',
      'valid-drive-file-id'
    );
  }

  const defaultDisplay = `Drive File: ${fileId.slice(0, 8)}...`;
  return {
    userEnteredValue: {
      stringValue: `@${displayText ?? defaultDisplay}`, // @ prefix required per Google Sheets API
    },
    chipRuns: [
      {
        chip: {
          richLinkProperties: {
            uri: driveUri,
          },
        },
      },
    ],
  };
}

/**
 * Build a rich link chip using the chipRuns API
 *
 * @param uri - URL for the rich link
 * @param displayText - Optional custom display text (defaults to hostname)
 * @returns CellData with chipRuns for rich link chip
 *
 * @see https://developers.google.com/workspace/sheets/api/guides/chips
 */
export function buildRichLinkChip(uri: string, displayText?: string): sheets_v4.Schema$CellData {
  // Validate URI length (Google API limit: 2000 bytes)
  if (new TextEncoder().encode(uri).length > 2000) {
    throw new ValidationError('URI exceeds 2000 bytes limit', 'uri', 'https://docs.google.com/...');
  }

  // Accept both Google Drive and Google Docs URLs (Sheets, Docs, Slides, Forms)
  if (!uri.startsWith('https://drive.google.com/') && !uri.startsWith('https://docs.google.com/')) {
    throw new ValidationError(
      'Only Google Drive and Google Docs links can be written as rich link chips',
      'uri',
      'https://docs.google.com/...'
    );
  }

  const hostname = displayText ?? new URL(uri).hostname;
  return {
    userEnteredValue: {
      stringValue: `@${hostname}`, // @ prefix required per Google Sheets API
    },
    chipRuns: [
      {
        chip: {
          richLinkProperties: {
            uri,
          },
        },
      },
    ],
  };
}

/**
 * Parse chip information from a cell's chipRuns
 *
 * Note: Drive chips are detected by checking if richLinkProperties.uri
 * contains a Drive URL pattern.
 *
 * @param cell - CellData from Google Sheets API response
 * @param cellA1 - A1 notation of the cell (e.g., "A1", "Sheet1!B2")
 * @returns ParsedChip with type and properties, or null if no chip
 *
 * @see https://developers.google.com/workspace/sheets/api/guides/chips
 */
export function parseChipRuns(cell: sheets_v4.Schema$CellData, cellA1: string): ParsedChip | null {
  const chipRuns = cell.chipRuns;
  if (!chipRuns || chipRuns.length === 0) {
    return null;
  }

  const displayText = cell.formattedValue ?? cell.userEnteredValue?.stringValue ?? '';

  // Get the first chip (cells typically have one chip)
  const chipRun = chipRuns[0];
  const chip = chipRun?.chip;

  if (!chip) {
    return null;
  }

  // Person chip
  if (chip.personProperties) {
    return {
      type: 'person',
      cell: cellA1,
      email: chip.personProperties.email ?? undefined,
      displayText,
    };
  }

  // Rich link chip (includes Drive files, YouTube, Maps, etc.)
  if (chip.richLinkProperties) {
    const uri = chip.richLinkProperties.uri ?? '';

    // Detect Drive file chip by URI pattern
    if (uri.includes('drive.google.com')) {
      const fileIdMatch = uri.match(/\/d\/([^/]+)/);
      const fileId = fileIdMatch?.[1];
      return {
        type: 'drive',
        cell: cellA1,
        fileId,
        uri,
        displayText,
      };
    }

    // Other rich link
    return {
      type: 'rich_link',
      cell: cellA1,
      uri,
      displayText,
    };
  }

  // Unknown chip type
  return {
    type: 'unknown',
    cell: cellA1,
    displayText,
  };
}

/**
 * Filter chips by type
 *
 * @param chips - Array of parsed chips
 * @param chipType - Type to filter by ('all' returns all chips)
 * @returns Filtered array of chips
 */
export function filterChipsByType(chips: ParsedChip[], chipType: 'all' | ChipType): ParsedChip[] {
  if (chipType === 'all') {
    return chips;
  }
  return chips.filter((chip) => chip.type === chipType);
}
