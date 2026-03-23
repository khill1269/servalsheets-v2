/**
 * Lightweight Data Quality Scanner
 *
 * Checks cell data for quality issues in <30ms.
 * Non-blocking: all checks are wrapped in individual try/catch.
 * Returns up to 5 warnings, ordered by severity (warning before info).
 */

import type { CellValue } from '../schemas/shared.js';

export interface QualityWarning {
  type:
    | 'empty_required_cells'
    | 'mixed_types'
    | 'duplicate_rows'
    | 'outliers'
    | 'inconsistent_formats';
  column?: string;
  detail: string;
  fix: string;
  fixAction?: {
    tool: string;
    action: string;
    params: Record<string, unknown>;
  };
  /** Alternative strategies the LLM can choose from (first is default) */
  alternativeStrategies?: string[];
  severity: 'info' | 'warning';
}

type QualityScanContext = {
  tool: string;
  action: string;
  range: string;
};

// Regex patterns for date format detection
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const MDY_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const DMY_DATE_RE = /^\d{1,2}-\d{1,2}-\d{2,4}$/;

function isDateLike(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return ISO_DATE_RE.test(value) || MDY_DATE_RE.test(value) || DMY_DATE_RE.test(value);
}

function getDateFormat(value: string): 'iso' | 'mdy' | 'dmy' | null {
  if (ISO_DATE_RE.test(value)) return 'iso';
  if (MDY_DATE_RE.test(value)) return 'mdy';
  if (DMY_DATE_RE.test(value)) return 'dmy';
  return null;
}

function getColumnLetter(colIndex: number): string {
  let letter = '';
  let n = colIndex;
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

function getColumnName(values: CellValue[][], colIndex: number): string {
  const header = values[0]?.[colIndex];
  if (header !== null && header !== undefined && header !== '') {
    return String(header);
  }
  return getColumnLetter(colIndex);
}

function buildFixAction(
  warning: QualityWarning,
  context: QualityScanContext
): QualityWarning['fixAction'] | undefined {
  if (!context.range) {
    return undefined;
  }

  switch (warning.type) {
    case 'empty_required_cells':
      return {
        tool: 'sheets_fix',
        action: 'fill_missing',
        params: {
          action: 'fill_missing',
          range: context.range,
          strategy: 'forward',
        },
      };
    case 'mixed_types':
    case 'inconsistent_formats':
      return {
        tool: 'sheets_fix',
        action: 'standardize_formats',
        params: {
          action: 'standardize_formats',
          range: context.range,
        },
      };
    case 'duplicate_rows':
      return {
        tool: 'sheets_fix',
        action: 'clean',
        params: {
          action: 'clean',
          range: context.range,
          rules: ['remove_duplicates'],
          mode: 'preview',
        },
      };
    case 'outliers':
      return {
        tool: 'sheets_fix',
        action: 'detect_anomalies',
        params: {
          action: 'detect_anomalies',
          range: context.range,
        },
      };
    default:
      return undefined;
  }
}

function getAlternativeStrategies(type: QualityWarning['type']): string[] | undefined {
  switch (type) {
    case 'empty_required_cells':
      return ['forward', 'backward', 'mean', 'median', 'mode', 'constant'];
    case 'mixed_types':
      return ['number', 'text', 'date'];
    case 'inconsistent_formats':
      return ['iso (YYYY-MM-DD)', 'mdy (MM/DD/YYYY)', 'dmy (DD-MM-YYYY)'];
    case 'duplicate_rows':
      return ['keep_first', 'keep_last', 'remove_all'];
    case 'outliers':
      return ['iqr', 'zscore'];
    default:
      return undefined;
  }
}

function attachFixAction(warning: QualityWarning, context: QualityScanContext): QualityWarning {
  const fixAction = buildFixAction(warning, context);
  const alternativeStrategies = getAlternativeStrategies(warning.type);
  return {
    ...warning,
    ...(fixAction ? { fixAction } : {}),
    ...(alternativeStrategies ? { alternativeStrategies } : {}),
  };
}

/**
 * Warn if >20% of cells in a non-header column are null/empty.
 * Skips entirely-empty columns.
 */
export function detectEmptyRequiredCells(values: CellValue[][]): QualityWarning[] {
  if (values.length < 2) return [];

  const warnings: QualityWarning[] = [];
  const numCols = Math.max(...values.map((r) => r.length));

  for (let c = 0; c < numCols; c++) {
    const dataRows = values.slice(1); // skip header
    if (dataRows.length === 0) continue;

    const nonEmptyTotal = dataRows.filter(
      (r) => r[c] !== null && r[c] !== undefined && r[c] !== ''
    ).length;

    // Skip entirely-empty columns
    if (nonEmptyTotal === 0) continue;

    const emptyCount = dataRows.filter(
      (r) => r[c] === null || r[c] === undefined || r[c] === ''
    ).length;
    const emptyRatio = emptyCount / dataRows.length;

    if (emptyRatio > 0.2) {
      const colName = getColumnName(values, c);
      warnings.push({
        type: 'empty_required_cells',
        column: colName,
        detail: `Column '${colName}' has ${emptyCount} of ${dataRows.length} cells empty (${Math.round(emptyRatio * 100)}%)`,
        fix: 'sheets_fix action:"fill_missing"',
        severity: 'warning',
      });
    }
  }

  return warnings;
}

/**
 * Warn if a column contains both string values and number values (>2 of each).
 * Skips date-like strings.
 */
export function detectMixedTypes(values: CellValue[][]): QualityWarning[] {
  if (values.length < 2) return [];

  const warnings: QualityWarning[] = [];
  const numCols = Math.max(...values.map((r) => r.length));

  for (let c = 0; c < numCols; c++) {
    const dataRows = values.slice(1);
    let stringCount = 0;
    let numberCount = 0;

    for (const row of dataRows) {
      const cell = row[c];
      if (cell === null || cell === undefined || cell === '') continue;
      if (typeof cell === 'number') {
        numberCount++;
      } else if (typeof cell === 'string' && !isDateLike(cell)) {
        // Don't count date strings as "text" for mixed-type purposes
        if (isNaN(Number(cell))) {
          stringCount++;
        } else {
          numberCount++;
        }
      }
    }

    if (stringCount > 2 && numberCount > 2) {
      const colName = getColumnName(values, c);
      warnings.push({
        type: 'mixed_types',
        column: colName,
        detail: `Column '${colName}' has ${stringCount} text values mixed with ${numberCount} numbers`,
        fix: 'sheets_fix action:"standardize_formats"',
        severity: 'warning',
      });
    }
  }

  return warnings;
}

/**
 * Warn if any exact duplicate rows exist (compares stringified rows).
 */
export function detectDuplicateRows(values: CellValue[][]): QualityWarning[] {
  if (values.length < 2) return [];

  const seen = new Map<string, number>();
  let dupeCount = 0;

  for (let r = 1; r < values.length; r++) {
    const key = JSON.stringify(values[r]);
    const prev = seen.get(key);
    if (prev !== undefined) {
      dupeCount++;
    } else {
      seen.set(key, r);
    }
  }

  if (dupeCount === 0) return [];

  return [
    {
      type: 'duplicate_rows',
      detail: `Found ${dupeCount} duplicate row${dupeCount === 1 ? '' : 's'} in the data`,
      fix: 'sheets_fix action:"clean" rules:["remove_duplicates"]',
      severity: 'warning',
    },
  ];
}

/**
 * Flag values outside Q1 - 3*IQR or Q3 + 3*IQR.
 * Only runs when >= 5 numeric values in a column.
 */
export function detectOutliers(values: CellValue[][]): QualityWarning[] {
  if (values.length < 2) return [];

  const warnings: QualityWarning[] = [];
  const numCols = Math.max(...values.map((r) => r.length));

  for (let c = 0; c < numCols; c++) {
    const nums: number[] = [];

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (!row) continue;
      const cell = row[c];
      if (typeof cell === 'number' && isFinite(cell)) {
        nums.push(cell);
      } else if (typeof cell === 'string' && !isNaN(Number(cell)) && cell.trim() !== '') {
        nums.push(Number(cell));
      }
    }

    if (nums.length < 5) continue;

    const sorted = [...nums].sort((a, b) => a - b);
    const q1Idx = Math.floor(sorted.length * 0.25);
    const q3Idx = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Idx] ?? sorted[0] ?? 0;
    const q3 = sorted[q3Idx] ?? sorted[sorted.length - 1] ?? 0;
    const iqr = q3 - q1;

    const lowerBound = q1 - 3 * iqr;
    const upperBound = q3 + 3 * iqr;

    const outliers = nums.filter((n) => n < lowerBound || n > upperBound);

    if (outliers.length > 0) {
      const colName = getColumnName(values, c);
      warnings.push({
        type: 'outliers',
        column: colName,
        detail: `Column '${colName}' has ${outliers.length} statistical outlier${outliers.length === 1 ? '' : 's'} (outside 3×IQR bounds)`,
        fix: 'sheets_fix action:"detect_anomalies"',
        severity: 'info',
      });
    }
  }

  return warnings;
}

/**
 * Detect date-like strings in a column where multiple different date formats are present.
 */
export function detectInconsistentFormats(values: CellValue[][]): QualityWarning[] {
  if (values.length < 2) return [];

  const warnings: QualityWarning[] = [];
  const numCols = Math.max(...values.map((r) => r.length));

  for (let c = 0; c < numCols; c++) {
    const formatsSeen = new Set<string>();

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (!row) continue;
      const cell = row[c];
      if (typeof cell !== 'string') continue;
      const fmt = getDateFormat(cell);
      if (fmt) {
        formatsSeen.add(fmt);
      }
    }

    if (formatsSeen.size >= 2) {
      const colName = getColumnName(values, c);
      warnings.push({
        type: 'inconsistent_formats',
        column: colName,
        detail: `Column '${colName}' has ${formatsSeen.size} different date formats (${[...formatsSeen].join(', ')})`,
        fix: 'sheets_fix action:"standardize_formats"',
        severity: 'info',
      });
    }
  }

  return warnings;
}

/**
 * Synchronous version of scanResponseQuality.
 * All 5 underlying checkers are synchronous; this wrapper exposes them
 * without requiring an async context.
 */
export function scanResponseQualitySync(
  values: CellValue[][],
  context: QualityScanContext
): QualityWarning[] {
  const allWarnings: QualityWarning[] = [];
  const checkers: Array<() => QualityWarning[]> = [
    () => detectEmptyRequiredCells(values),
    () => detectMixedTypes(values),
    () => detectDuplicateRows(values),
    () => detectOutliers(values),
    () => detectInconsistentFormats(values),
  ];
  for (const checker of checkers) {
    try {
      allWarnings.push(...checker());
    } catch {
      // Non-blocking
    }
  }
  allWarnings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1));
  return allWarnings.slice(0, 5).map((warning) => attachFixAction(warning, context));
}

/**
 * Run all 5 quality checks on a 2D cell array.
 * Returns up to 5 warnings, ordered by severity (warnings before info).
 * Each check is individually wrapped — one failure won't block others.
 */
export async function scanResponseQuality(
  values: CellValue[][],
  context: QualityScanContext
): Promise<QualityWarning[]> {
  const allWarnings: QualityWarning[] = [];

  const checkers: Array<() => QualityWarning[]> = [
    () => detectEmptyRequiredCells(values),
    () => detectMixedTypes(values),
    () => detectDuplicateRows(values),
    () => detectOutliers(values),
    () => detectInconsistentFormats(values),
  ];

  for (const checker of checkers) {
    try {
      const results = checker();
      allWarnings.push(...results);
    } catch {
      // Non-blocking: individual checker failure does not propagate
    }
  }

  // Sort: warnings before info
  allWarnings.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'warning' ? -1 : 1;
  });

  return allWarnings.slice(0, 5).map((warning) => attachFixAction(warning, context));
}
