/**
 * ServalSheets - Formula Parser Worker
 *
 * Worker thread for CPU-intensive formula parsing operations.
 * Offloads regex-heavy parsing from the main thread.
 *
 * @module workers/formula-parser-worker
 */

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
 * Cell reference types
 */
type ReferenceType = 'cell' | 'range' | 'column' | 'row';

/**
 * Parsed cell reference
 */
interface CellReference {
  type: ReferenceType;
  raw: string;
  sheet?: string;
  start: string;
  end?: string;
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
interface ParsedFormula {
  formula: string;
  references: CellReference[];
  functions: string[];
  namedRanges: string[];
}

/**
 * Worker task input
 */
interface FormulaParseTask {
  formula: string;
}

/**
 * Parse formula in worker thread
 *
 * @param task - Task with formula to parse
 * @returns Parsed formula with references and functions
 */
export function execute(task: FormulaParseTask): ParsedFormula {
  const { formula } = task;

  // Remove leading = if present
  const cleanFormula = formula.startsWith('=') ? formula.slice(1) : formula;

  const references: CellReference[] = [];
  const functions: string[] = [];
  const namedRanges: string[] = [];

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

  return {
    formula: cleanFormula,
    references,
    functions,
    namedRanges,
  };
}
