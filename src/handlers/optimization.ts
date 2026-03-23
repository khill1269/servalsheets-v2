/**
 * Lightweight handler-side utilities kept for compatibility with the
 * optimization test suite and small hot-path helpers.
 */

type RangeParseResult = {
  sheet?: string;
  startCol: string;
  startRow: number;
  endCol?: string;
  endRow?: number;
};

type ErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

type SuccessResponse<T extends Record<string, unknown>> = {
  success: true;
  action: string;
} & T;

const COLUMN_INDEX_CACHE = new Map<string, number>();
const A1_RANGE_RE = /^(?:(.+)!)?([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/;

export function fastCacheKey(prefix: string, ...parts: Array<string | number | undefined>): string {
  return [prefix, ...parts.filter((part) => part !== undefined).map(String)].join(':');
}

export function spreadsheetCacheKey(
  prefix: string,
  spreadsheetId: string,
  range?: string,
  extra?: string
): string {
  return fastCacheKey(prefix, spreadsheetId, range, extra);
}

export function countCells(values: readonly unknown[][]): number {
  return values.reduce((total, row) => total + row.length, 0);
}

export function countRows(values: readonly unknown[][]): number {
  return values.length;
}

export function countColumns(values: readonly unknown[][]): number {
  return values[0]?.length ?? 0;
}

export function truncateValues<T>(
  values: T[][],
  maxRows: number,
  maxCells: number
): {
  values: T[][];
  truncated: boolean;
  originalRows?: number;
  originalCells?: number;
} {
  const originalRows = countRows(values);
  const originalCells = countCells(values);

  if (originalRows <= maxRows && originalCells <= maxCells) {
    return {
      values,
      truncated: false,
    };
  }

  let truncatedValues = values.slice(0, maxRows);
  if (countCells(truncatedValues) > maxCells) {
    const next: T[][] = [];
    let runningCells = 0;
    for (const row of truncatedValues) {
      if (runningCells + row.length > maxCells) {
        break;
      }
      next.push(row);
      runningCells += row.length;
    }
    truncatedValues = next;
  }

  return {
    values: truncatedValues,
    truncated: true,
    originalRows,
    originalCells,
  };
}

export function hasRequiredParams(input: Record<string, unknown>, ...required: string[]): boolean {
  return required.every((key) => {
    const value = input[key];
    return value !== undefined && value !== null && value !== '';
  });
}

export function getSpreadsheetId(input: Record<string, unknown>): string | undefined {
  return typeof input['spreadsheetId'] === 'string' ? input['spreadsheetId'] : undefined;
}

export function getAction(input: Record<string, unknown>): string | undefined {
  return typeof input['action'] === 'string' ? input['action'] : undefined;
}

export function fastSuccess<T extends Record<string, unknown>>(
  action: string,
  payload: T
): SuccessResponse<T> {
  return {
    success: true,
    action,
    ...payload,
  };
}

export function fastError(code: string, message: string, retryable = false): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      retryable,
    },
  };
}

export function fastParseA1Range(range: string): RangeParseResult | null {
  const match = range.match(A1_RANGE_RE);
  if (!match) {
    return null;
  }

  return {
    sheet: match[1] ?? undefined,
    startCol: match[2]!.toUpperCase(),
    startRow: Number(match[3]),
    endCol: match[4]?.toUpperCase(),
    endRow: match[5] ? Number(match[5]) : undefined,
  };
}

export function columnLetterToIndex(letter: string): number {
  const upper = letter.toUpperCase();
  const cached = COLUMN_INDEX_CACHE.get(upper);
  if (cached !== undefined) {
    return cached;
  }

  let index = 0;
  for (const char of upper) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }

  const zeroBased = index - 1;
  COLUMN_INDEX_CACHE.set(upper, zeroBased);
  return zeroBased;
}

export function estimateRangeCells(range: string): number {
  const parsed = fastParseA1Range(range);
  if (!parsed) {
    return 0;
  }

  if (!parsed.endCol || !parsed.endRow) {
    return 1;
  }

  const columnCount = columnLetterToIndex(parsed.endCol) - columnLetterToIndex(parsed.startCol) + 1;
  const rowCount = parsed.endRow - parsed.startRow + 1;
  return columnCount * rowCount;
}

function stableStringify(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = value[key];
        return acc;
      }, {})
  );
}

export class LazyContextTracker<T extends Record<string, unknown>> {
  private lastFingerprint?: string;

  constructor(private readonly onChange: (params: T) => void) {}

  track(params: T): void {
    const fingerprint = stableStringify(params);
    if (fingerprint === this.lastFingerprint) {
      return;
    }
    this.lastFingerprint = fingerprint;
    this.onChange(params);
  }

  reset(): void {
    this.lastFingerprint = undefined;
  }
}

export async function batchAsync<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  batchSize: number
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, offset) => worker(item, start + offset))
    );
    results.push(...batchResults);
  }
  return results;
}

export function createActionDispatcher<
  TInput extends { action: string },
  TResult,
  THandlers extends Record<string, (input: TInput) => Promise<TResult>>,
>(handlers: THandlers) {
  return async (input: TInput): Promise<TResult> => {
    const handler = handlers[input.action];
    if (!handler) {
      throw new Error(`Unknown action: ${input.action}`);
    }
    return handler(input);
  };
}
