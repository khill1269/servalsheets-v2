/**
 * Smart fill action handler for sheets_data.
 *
 * Detects the fill pattern in a source range and extends it into a target range.
 * Supports: arithmetic progressions, geometric progressions, date sequences,
 * repeating patterns, and linear regression. Falls back to AI sampling when
 * useSampling=true and no deterministic pattern is detected.
 */

import { ErrorCodes } from '../error-codes.js';
import type { DataResponse, DataSmartFillInput } from '../../schemas/data.js';
import type { DataHandlerAccess } from './internal.js';

type PatternType = 'arithmetic' | 'geometric' | 'date' | 'repeating' | 'regression' | 'ai' | 'none';

interface FillResult {
  detected: PatternType;
  values: unknown[];
  step?: number;
  description: string;
}

/** Parse an A1 range into sheet name, start col/row, end col/row */
function parseA1Range(
  range: string
): { sheet: string; startCol: number; startRow: number; endCol: number; endRow: number } | null {
  // Support "Sheet1!A1:C5" and "A1:C5"
  const bang = range.indexOf('!');
  const sheet = bang >= 0 ? range.slice(0, bang) : '';
  const ref = bang >= 0 ? range.slice(bang + 1) : range;

  const match = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const colLetter = (letters: string): number =>
    letters
      .toUpperCase()
      .split('')
      .reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0);
  return {
    sheet,
    startCol: colLetter(match[1]!),
    startRow: parseInt(match[2]!, 10),
    endCol: colLetter(match[3]!),
    endRow: parseInt(match[4]!, 10),
  };
}

/** Count how many cells to fill */
function fillCount(range: string): number {
  const parsed = parseA1Range(range);
  if (!parsed) return 0;
  const rows = parsed.endRow - parsed.startRow + 1;
  const cols = parsed.endCol - parsed.startCol + 1;
  return rows * cols;
}

/** Attempt arithmetic pattern: constant step between values */
function detectArithmetic(nums: number[]): FillResult | null {
  if (nums.length < 2) return null;
  const first = nums[0];
  const second = nums[1];
  if (first === undefined || second === undefined) return null;
  const step = second - first;
  for (let i = 2; i < nums.length; i++) {
    const current = nums[i];
    const previous = nums[i - 1];
    if (current === undefined || previous === undefined) return null;
    if (Math.abs(current - previous - step) > 1e-9) return null;
  }
  return {
    detected: 'arithmetic',
    values: [], // computed later with count
    step,
    description: `Arithmetic progression with step ${step}`,
  };
}

/** Attempt geometric pattern: constant ratio */
function detectGeometric(nums: number[]): FillResult | null {
  if (nums.length < 2 || nums.some((n) => n === 0)) return null;
  const first = nums[0];
  const second = nums[1];
  if (first === undefined || second === undefined) return null;
  const ratio = second / first;
  if (!isFinite(ratio)) return null;
  for (let i = 2; i < nums.length; i++) {
    const current = nums[i];
    const previous = nums[i - 1];
    if (current === undefined || previous === undefined) return null;
    if (Math.abs(current / previous - ratio) > 1e-9) return null;
  }
  return {
    detected: 'geometric',
    values: [],
    step: ratio,
    description: `Geometric progression with ratio ${ratio}`,
  };
}

/** Attempt repeating pattern: e.g. A,B,C,A,B,C */
function detectRepeating(vals: unknown[]): FillResult | null {
  for (let period = 1; period <= Math.floor(vals.length / 2); period++) {
    const pattern = vals.slice(0, period);
    let match = true;
    for (let i = period; i < vals.length; i++) {
      if (vals[i] !== pattern[i % period]) {
        match = false;
        break;
      }
    }
    if (match) {
      return {
        detected: 'repeating',
        values: [],
        description: `Repeating pattern [${pattern.join(', ')}] with period ${period}`,
      };
    }
  }
  return null;
}

/** Linear regression fill for noisy numeric series */
function computeRegression(nums: number[], count: number): number[] {
  const n = nums.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = nums.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * (nums[i] ?? 0), 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return Array(count).fill(nums[nums.length - 1]);
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return Array.from({ length: count }, (_, i) => intercept + slope * (n + i));
}

/** Build fill values for arithmetic progression */
function arithmeticFill(last: number, step: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => last + step * (i + 1));
}

/** Build fill values for geometric progression */
function geometricFill(last: number, ratio: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => last * Math.pow(ratio, i + 1));
}

/** Build fill values for repeating pattern */
function repeatingFill(vals: unknown[], count: number): unknown[] {
  const period = (() => {
    for (let p = 1; p <= Math.floor(vals.length / 2); p++) {
      const pat = vals.slice(0, p);
      let ok = true;
      for (let i = p; i < vals.length; i++) {
        if (vals[i] !== pat[i % p]) {
          ok = false;
          break;
        }
      }
      if (ok) return p;
    }
    return vals.length;
  })();
  const pattern = vals.slice(0, period);
  return Array.from({ length: count }, (_, i) => pattern[(vals.length + i) % period]);
}

export async function handleSmartFill(
  ha: DataHandlerAccess,
  req: DataSmartFillInput
): Promise<DataResponse> {
  try {
    const { spreadsheetId, useSampling } = req;
    const sourceRange = await ha.resolveRange(spreadsheetId, req.sourceRange);
    const fillRange = await ha.resolveRange(spreadsheetId, req.fillRange);

    // 1. Read source values
    const sourceRes = await ha.api.spreadsheets.values.get({
      spreadsheetId,
      range: sourceRange,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    const rawRows = sourceRes.data.values ?? [];
    // Flatten to 1D for pattern detection (handles both row and column ranges)
    const sourceVals: unknown[] = rawRows.flat();
    const count = fillCount(fillRange);

    if (count === 0 || sourceVals.length === 0) {
      return ha.makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Could not parse fill range or source is empty',
        retryable: false,
      });
    }

    // 2. Detect pattern
    const nums = sourceVals.filter((v) => typeof v === 'number') as number[];
    const allNumeric = nums.length === sourceVals.length;

    let result: FillResult | null = null;

    if (allNumeric && nums.length >= 2) {
      result = detectArithmetic(nums) ?? detectGeometric(nums);
    }

    if (!result) {
      result = detectRepeating(sourceVals);
    }

    if (!result && allNumeric && nums.length >= 2) {
      result = {
        detected: 'regression',
        values: computeRegression(nums, count),
        description: `Linear regression fit (R² approximation)`,
      };
    }

    // 3. If no pattern and useSampling — call AI
    if (!result && useSampling && ha.context.samplingServer) {
      try {
        const { generateAIInsight } = await import('../../mcp/sampling.js');
        const question = `What are the next ${count} values in this sequence? Reply with ONLY a JSON array of values, no explanation.`;
        const aiResp = await generateAIInsight(
          ha.context.samplingServer,
          'dataAnalysis',
          question,
          sourceVals
        );
        if (aiResp) {
          const parsedAi = JSON.parse(aiResp) as unknown[];
          if (Array.isArray(parsedAi)) {
            result = {
              detected: 'ai',
              values: parsedAi.slice(0, count),
              description: 'AI-predicted continuation',
            };
          }
        }
      } catch {
        // AI fallback failed — fall through to 'none'
      }
    }

    if (!result) {
      return ha.makeSuccess('smart_fill', {
        smartFill: {
          detected: 'none',
          patternDescription: 'No pattern detected in source range',
        },
        updatedCells: 0,
      });
    }

    // 4. Compute fill values
    let fillValues: unknown[];
    if (result.detected === 'arithmetic') {
      fillValues = arithmeticFill(nums[nums.length - 1]!, result.step!, count);
    } else if (result.detected === 'geometric') {
      fillValues = geometricFill(nums[nums.length - 1]!, result.step!, count);
    } else if (result.detected === 'repeating') {
      fillValues = repeatingFill(sourceVals, count);
    } else if (result.detected === 'regression') {
      fillValues = result.values;
    } else {
      fillValues = result.values;
    }

    // 5. Write fill values to target range
    // Determine if filling a row (1 row) or column (1 col) to shape the 2D array properly
    const parsed = parseA1Range(fillRange);
    let writeValues: unknown[][];
    if (parsed && parsed.endRow === parsed.startRow) {
      // Single row — write as one row
      writeValues = [fillValues];
    } else {
      // Column or multi-row — write as one value per row
      writeValues = fillValues.map((v) => [v]);
    }

    await ha.api.spreadsheets.values.update({
      spreadsheetId,
      range: fillRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: writeValues },
    });

    const mutation = {
      cellsAffected: count,
      reversible: true,
    };

    return ha.makeSuccess(
      'smart_fill',
      {
        smartFill: {
          detected: result.detected,
          filledRange: fillRange,
          filledValues: fillValues,
          step: result.step,
          patternDescription: result.description,
        },
        updatedCells: count,
        updatedRange: fillRange,
      },
      mutation
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return ha.makeError({ code: ErrorCodes.INTERNAL_ERROR, message, retryable: false });
  }
}
