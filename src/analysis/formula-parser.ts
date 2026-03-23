/**
 * ServalSheets - Formula Parser
 *
 * Parses Google Sheets formulas to extract:
 * - Cell references (A1, B2, Sheet1!C3)
 * - Range references (A1:B5, Sheet1!A1:B5)
 * - Named ranges
 * - Function calls
 *
 * Supports:
 * - Single cell refs: A1, $A$1, A$1, $A1
 * - Range refs: A1:B5, $A$1:$B$5
 * - Cross-sheet refs: Sheet1!A1, 'Sheet Name'!A1:B5
 * - Row/column refs: A:A, 1:1, A:C, 1:5
 *
 * @category Analysis
 */

import { logger } from '../utils/logger.js';
import { getWorkerPool } from '../services/worker-pool.js';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { memoizeWithStats } from '../utils/memoization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Cell reference types
 */
export type ReferenceType = 'cell' | 'range' | 'column' | 'row';

/**
 * Parsed cell reference
 */
export interface CellReference {
  /** Reference type */
  type: ReferenceType;
  /** Full reference string (e.g., "Sheet1!A1", "A1:B5") */
  raw: string;
  /** Sheet name (if cross-sheet reference) */
  sheet?: string;
  /** Start cell (A1 notation) */
  start: string;
  /** End cell for ranges (A1 notation) */
  end?: string;
  /** Whether reference is absolute ($A$1) */
  absolute: {
    startRow: boolean;
    startCol: boolean;
    endRow?: boolean;
    endCol?: boolean;
  };
}

/**
 * Parsed formula
 */
export interface ParsedFormula {
  /** Original formula */
  formula: string;
  /** All cell references found */
  references: CellReference[];
  /** Function names used */
  functions: string[];
  /** Named ranges referenced */
  namedRanges: string[];
}

/**
 * Regex patterns for formula parsing
 */
const PATTERNS = {
  // Single cell: A1, $A$1, A$1, $A1
  CELL: /\$?[A-Z]{1,3}\$?\d{1,7}/g,

  // Range: A1:B5, $A$1:$B$5
  RANGE: /\$?[A-Z]{1,3}\$?\d{1,7}:\$?[A-Z]{1,3}\$?\d{1,7}/g,

  // Column reference: A:A, A:C, $A:$C
  COLUMN: /\$?[A-Z]{1,3}:\$?[A-Z]{1,3}/g,

  // Row reference: 1:1, 1:5, $1:$5
  ROW: /\$?\d{1,7}:\$?\d{1,7}/g,

  // Sheet reference: Sheet1!, 'Sheet Name'!
  SHEET: /(?:'[^']*'|[A-Za-z0-9_]+)!/g,

  // Function calls: SUM(, IF(, VLOOKUP(
  FUNCTION: /\b[A-Z_][A-Z0-9_.]*\s*\(/gi,
};

/**
 * Internal implementation of formula parsing (non-memoized)
 * Used by memoized wrapper to do the actual parsing work
 */
function parseFormulaInternal(formula: string): ParsedFormula {
  // Remove leading = if present
  const cleanFormula = formula.startsWith('=') ? formula.slice(1) : formula;

  const references: CellReference[] = [];
  const functions: string[] = [];
  const namedRanges: string[] = [];

  try {
    // Extract functions
    const functionMatches = cleanFormula.matchAll(PATTERNS.FUNCTION);
    for (const match of functionMatches) {
      const funcName = match[0].replace(/\s*\($/, '').toUpperCase();
      if (!functions.includes(funcName)) {
        functions.push(funcName);
      }
    }

    // Extract sheet references first to handle cross-sheet refs
    const sheetRefs: Array<{ sheet: string; start: number; end: number }> = [];
    const sheetMatches = cleanFormula.matchAll(PATTERNS.SHEET);
    for (const match of sheetMatches) {
      const sheetRef = match[0].slice(0, -1); // Remove trailing !
      const sheet = sheetRef.startsWith("'")
        ? sheetRef.slice(1, -1) // Remove quotes
        : sheetRef;

      sheetRefs.push({
        sheet,
        start: match.index || 0,
        end: (match.index || 0) + match[0].length,
      });
    }

    // Helper to find sheet for a reference position
    const findSheet = (pos: number): string | undefined => {
      for (const ref of sheetRefs) {
        if (pos > ref.start && pos < ref.end + 100) {
          // Allow 100 chars after sheet ref
          return ref.sheet;
        }
      }
      return undefined; // cursor not within any sheet ref
    };

    // Extract ranges (must be before cells to avoid partial matches)
    const rangeMatches = cleanFormula.matchAll(PATTERNS.RANGE);
    for (const match of rangeMatches) {
      const [start, end] = match[0].split(':');
      const sheet = findSheet(match.index || 0);

      references.push({
        type: 'range',
        raw: sheet ? `${sheet}!${match[0]}` : match[0],
        sheet,
        start: start!,
        end: end!,
        absolute: {
          startRow: start!.includes('$') && start!.lastIndexOf('$') > 0,
          startCol: start!.startsWith('$'),
          endRow: end!.includes('$') && end!.lastIndexOf('$') > 0,
          endCol: end!.startsWith('$'),
        },
      });
    }

    // Extract column references
    const colMatches = cleanFormula.matchAll(PATTERNS.COLUMN);
    for (const match of colMatches) {
      const [start, end] = match[0].split(':');
      const sheet = findSheet(match.index || 0);

      references.push({
        type: 'column',
        raw: sheet ? `${sheet}!${match[0]}` : match[0],
        sheet,
        start: start!,
        end: end!,
        absolute: {
          startRow: false,
          startCol: start!.startsWith('$'),
          endRow: false,
          endCol: end!.startsWith('$'),
        },
      });
    }

    // Extract row references
    const rowMatches = cleanFormula.matchAll(PATTERNS.ROW);
    for (const match of rowMatches) {
      // Skip if this looks like a range (has letters)
      if (/[A-Z]/.test(match[0])) continue;

      const [start, end] = match[0].split(':');
      const sheet = findSheet(match.index || 0);

      references.push({
        type: 'row',
        raw: sheet ? `${sheet}!${match[0]}` : match[0],
        sheet,
        start: start!,
        end: end!,
        absolute: {
          startRow: start!.startsWith('$'),
          startCol: false,
          endRow: end!.startsWith('$'),
          endCol: false,
        },
      });
    }

    // Extract single cell references (excluding those already in ranges)
    const cellMatches = cleanFormula.matchAll(PATTERNS.CELL);
    const rangeStrings = references.map((r) => r.raw);

    for (const match of cellMatches) {
      const cellRef = match[0];

      // Skip if part of a range already extracted
      const inRange = rangeStrings.some((rangeStr) => rangeStr.includes(cellRef));
      if (inRange) continue;

      const sheet = findSheet(match.index || 0);

      references.push({
        type: 'cell',
        raw: sheet ? `${sheet}!${cellRef}` : cellRef,
        sheet,
        start: cellRef,
        absolute: {
          startRow: cellRef.includes('$') && cellRef.lastIndexOf('$') > 0,
          startCol: cellRef.startsWith('$'),
        },
      });
    }

    logger.debug('Formula parsed', {
      formula: cleanFormula,
      referenceCount: references.length,
      functionCount: functions.length,
    });
  } catch (error) {
    logger.error('Formula parsing failed', {
      formula: cleanFormula,
      error,
    });
  }

  return {
    formula: cleanFormula,
    references,
    functions,
    namedRanges,
  };
}

/**
 * Memoized formula parser with cache statistics
 * Cache size: 500 formulas with 1 hour TTL
 */
const memoizedParseFormula = memoizeWithStats(parseFormulaInternal, {
  maxSize: 500,
  ttl: 3600000, // 1 hour
});

/**
 * Extract all cell references from a formula
 *
 * Memoized for performance - repeated parses of the same formula string
 * are served from cache. Cache supports up to 500 unique formulas with 1 hour TTL.
 *
 * @param formula - Google Sheets formula (with or without leading =)
 * @returns Parsed formula with all references extracted
 */
export function parseFormula(formula: string): ParsedFormula {
  return memoizedParseFormula(formula);
}

/**
 * Parse formula using worker thread (async, non-blocking)
 *
 * Offloads regex-heavy parsing to worker thread to prevent event loop blocking.
 * Falls back to synchronous parsing if worker pool not available.
 *
 * @param formula - Google Sheets formula
 * @returns Parsed formula with references and functions
 *
 * @example
 * ```typescript
 * // Parse in worker thread (non-blocking)
 * const parsed = await parseFormulaAsync('=SUM(A1:B10)');
 * ```
 */
export async function parseFormulaAsync(formula: string): Promise<ParsedFormula> {
  try {
    const pool = getWorkerPool();

    // Register worker script if not already registered
    const workerScriptPath = resolve(__dirname, '../workers/formula-parser-worker.js');
    pool.registerWorker('parse-formula', workerScriptPath);

    // Execute in worker thread
    return await pool.execute<{ formula: string }, ParsedFormula>('parse-formula', { formula });
  } catch (error) {
    // Fall back to synchronous parsing on error
    logger.warn('Worker pool unavailable, using synchronous formula parsing', { error });
    return parseFormula(formula);
  }
}

/**
 * Normalize cell reference to standard form
 *
 * Removes $ signs for absolute references and normalizes sheet names.
 *
 * @param ref - Cell reference string
 * @returns Normalized reference
 */
export function normalizeReference(ref: string): string {
  // Remove $ signs
  let normalized = ref.replace(/\$/g, '');

  // Normalize sheet name (remove quotes if present)
  if (normalized.includes('!')) {
    const [sheetPart, cellPart] = normalized.split('!');
    const sheet = sheetPart!.replace(/'/g, '');
    normalized = `${sheet}!${cellPart}`;
  }

  return normalized;
}
