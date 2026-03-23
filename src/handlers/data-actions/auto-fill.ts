/**
 * Auto-fill action handler for sheets_data (S3-B).
 *
 * Fills a target range by extending a pattern detected in a source range.
 * Supports: arithmetic (linear) progressions, date sequences, and repeating
 * (cyclic) patterns. No AI sampling required — entirely deterministic.
 */

import { ErrorCodes } from '../error-codes.js';
import type { DataResponse, DataAutoFillInput } from '../../schemas/data.js';
import type { DataHandlerAccess } from './internal.js';
import { extractRangeA1 } from '../../utils/range-helpers.js';

type FillStrategy = 'detect' | 'linear' | 'repeat' | 'date';
type DetectedPattern = 'linear' | 'repeat' | 'date' | 'unknown';

/** Parse an A1 range string into row/column bounds. */
function parseA1Range(
  range: string
): { sheet: string; startCol: number; startRow: number; endCol: number; endRow: number } | null {
  const bang = range.indexOf('!');
  const sheet = bang >= 0 ? range.slice(0, bang) : '';
  const ref = bang >= 0 ? range.slice(bang + 1) : range;

  const match = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;

  const colLetterToNum = (letters: string): number =>
    letters
      .toUpperCase()
      .split('')
      .reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0);

  return {
    sheet,
    startCol: colLetterToNum(match[1]!),
    startRow: parseInt(match[2]!, 10),
    endCol: colLetterToNum(match[3]!),
    endRow: parseInt(match[4]!, 10),
  };
}

/** Count cells in a range. */
function cellCount(range: string): number {
  const parsed = parseA1Range(range);
  if (!parsed) return 0;
  return (parsed.endRow - parsed.startRow + 1) * (parsed.endCol - parsed.startCol + 1);
}

/** Flatten a 2D grid into a 1D list of raw values. */
function flatten(grid: unknown[][]): unknown[] {
  return grid.flat();
}

/** Attempt to detect arithmetic (linear) pattern in a number array. */
function tryLinear(values: number[]): { detected: true; step: number } | { detected: false } {
  if (values.length < 2) return { detected: false };
  const step = values[1]! - values[0]!;
  for (let i = 2; i < values.length; i++) {
    if (Math.abs(values[i]! - values[i - 1]! - step) > 1e-9) {
      return { detected: false };
    }
  }
  return { detected: true, step };
}

/** Attempt to detect a date progression in string values. */
function tryDate(
  rawValues: unknown[]
): { detected: true; stepMs: number; dates: Date[] } | { detected: false } {
  const dates = rawValues.map((v) => {
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  });
  if (dates.some((d) => d === null)) return { detected: false };
  const validDates = dates as Date[];
  if (validDates.length < 2) return { detected: false };

  const steps: number[] = [];
  for (let i = 1; i < validDates.length; i++) {
    steps.push(validDates[i]!.getTime() - validDates[i - 1]!.getTime());
  }
  const stepMs = steps[0]!;
  if (steps.every((s) => s === stepMs)) {
    return { detected: true, stepMs, dates: validDates };
  }
  return { detected: false };
}

/**
 * Compute fill values for the target range given the source values and strategy.
 *
 * Returns a 2D array (rows × cols) ready for sheets API.
 */
function computeFill(
  sourceGrid: unknown[][],
  fillRange: string,
  strategy: FillStrategy
): { values: unknown[][]; pattern: DetectedPattern } {
  const parsed = parseA1Range(fillRange);
  if (!parsed) return { values: [], pattern: 'unknown' };

  const fillRows = parsed.endRow - parsed.startRow + 1;
  const fillCols = parsed.endCol - parsed.startCol + 1;
  const totalFill = fillRows * fillCols;

  const sourceFlat = flatten(sourceGrid);

  // ── Repeat strategy ────────────────────────────────────────────────────────
  if (strategy === 'repeat') {
    const filled: unknown[] = [];
    for (let i = 0; i < totalFill; i++) {
      filled.push(sourceFlat[i % sourceFlat.length]);
    }
    // Reshape into fillCols-wide rows
    return {
      values: reshapeIntoGrid(filled, fillRows, fillCols),
      pattern: 'repeat',
    };
  }

  // ── Date strategy ──────────────────────────────────────────────────────────
  if (strategy === 'date') {
    const dateResult = tryDate(sourceFlat);
    if (dateResult.detected) {
      const lastDate = dateResult.dates[dateResult.dates.length - 1]!;
      const filled: unknown[] = [];
      for (let i = 1; i <= totalFill; i++) {
        const d = new Date(lastDate.getTime() + dateResult.stepMs * i);
        filled.push(d.toISOString().split('T')[0]); // YYYY-MM-DD
      }
      return { values: reshapeIntoGrid(filled, fillRows, fillCols), pattern: 'date' };
    }
    // Fall back to repeat if dates can't be parsed
    const filled: unknown[] = [];
    for (let i = 0; i < totalFill; i++) {
      filled.push(sourceFlat[i % sourceFlat.length]);
    }
    return { values: reshapeIntoGrid(filled, fillRows, fillCols), pattern: 'repeat' };
  }

  // ── Linear strategy (and detect → try linear first) ───────────────────────
  const nums = sourceFlat.map((v) => Number(v));
  const allNumeric = nums.every((n) => !isNaN(n));

  if (allNumeric) {
    const linear = tryLinear(nums);
    if (linear.detected) {
      const lastNum = nums[nums.length - 1]!;
      const filled: unknown[] = [];
      for (let i = 1; i <= totalFill; i++) {
        filled.push(lastNum + linear.step * i);
      }
      return { values: reshapeIntoGrid(filled, fillRows, fillCols), pattern: 'linear' };
    }
  }

  // ── detect → try date ──────────────────────────────────────────────────────
  if (strategy === 'detect') {
    const dateResult = tryDate(sourceFlat);
    if (dateResult.detected) {
      const lastDate = dateResult.dates[dateResult.dates.length - 1]!;
      const filled: unknown[] = [];
      for (let i = 1; i <= totalFill; i++) {
        const d = new Date(lastDate.getTime() + dateResult.stepMs * i);
        filled.push(d.toISOString().split('T')[0]);
      }
      return { values: reshapeIntoGrid(filled, fillRows, fillCols), pattern: 'date' };
    }
  }

  // ── Fall back to repeat ────────────────────────────────────────────────────
  const filled: unknown[] = [];
  for (let i = 0; i < totalFill; i++) {
    filled.push(sourceFlat[i % sourceFlat.length]);
  }
  return { values: reshapeIntoGrid(filled, fillRows, fillCols), pattern: 'repeat' };
}

function reshapeIntoGrid(flat: unknown[], rows: number, cols: number): unknown[][] {
  const grid: unknown[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(flat.slice(r * cols, r * cols + cols));
  }
  return grid;
}

/**
 * Handle the auto_fill action.
 *
 * 1. Read source range values.
 * 2. Compute fill values based on strategy.
 * 3. Write fill values to fillRange.
 */
export async function handleAutoFill(
  ha: DataHandlerAccess,
  req: DataAutoFillInput
): Promise<DataResponse> {
  const { spreadsheetId, strategy = 'detect' } = req;
  const sourceRange = extractRangeA1(req.sourceRange, 'sourceRange');
  const fillRange = extractRangeA1(req.fillRange, 'fillRange');

  // 1. Read source range
  let sourceGrid: unknown[][];
  try {
    const response = await ha.api.spreadsheets.values.get({
      spreadsheetId,
      range: sourceRange,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    sourceGrid = (response.data.values ?? []) as unknown[][];
  } catch (err) {
    return ha.makeError({
      code: ErrorCodes.INTERNAL_ERROR,
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    });
  }

  if (sourceGrid.length === 0 || sourceGrid.flat().length === 0) {
    return ha.makeError({
      code: ErrorCodes.NO_DATA,
      message: `Source range "${sourceRange}" is empty. Cannot detect a pattern to fill from.`,
      retryable: false,
    });
  }

  // 2. Compute fill values
  const { values: fillValues, pattern } = computeFill(sourceGrid, fillRange, strategy);

  if (fillValues.length === 0) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Could not parse fill range "${fillRange}". Use A1 notation like Sheet1!A4:A20.`,
      retryable: false,
    });
  }

  const total = cellCount(fillRange);

  // BUG-18 fix: Respect safety.dryRun — return preview without writing.
  if ((req as Record<string, unknown> & { safety?: { dryRun?: boolean } })['safety']?.dryRun) {
    return ha.makeSuccess('auto_fill', {
      cellsFilled: 0,
      previewCells: total,
      detectedPattern: pattern,
      fillRange,
      sourceRange,
      strategy,
      dryRun: true,
      previewValues: fillValues.slice(0, 5), // Show first 5 rows as preview
    });
  }

  // 3. Write to fillRange
  try {
    await ha.api.spreadsheets.values.update({
      spreadsheetId,
      range: fillRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: fillValues },
    });
  } catch (err) {
    return ha.makeError({
      code: ErrorCodes.INTERNAL_ERROR,
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    });
  }

  return ha.makeSuccess('auto_fill', {
    cellsFilled: total,
    detectedPattern: pattern,
    fillRange,
    sourceRange,
    strategy,
  });
}
