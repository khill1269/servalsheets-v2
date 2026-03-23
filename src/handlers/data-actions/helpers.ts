/**
 * Shared helper functions for the data-actions submodules.
 * All functions take a DataHandlerAccess object (`ha`) in place of `this`.
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import {
  buildA1Notation,
  buildGridRangeInput,
  parseA1Notation,
  parseCellReference,
  type GridRangeInput,
} from '../../utils/google-sheets-helpers.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import {
  validateValuesPayload,
  validateValuesBatchPayload,
  type PayloadSizeResult,
} from '../../utils/payload-validator.js';
import type { ValuesArray, RangeInput } from '../../schemas/index.js';
import type { DataResponse } from '../../schemas/data.js';
import type { ResponseMeta } from '../../schemas/index.js';
import {
  type DataHandlerAccess,
  type ResponseFormat,
  DEFAULT_READ_PAGE_SIZE,
  MAX_CELLS_PER_REQUEST,
} from './internal.js';

// ─── Range helpers ────────────────────────────────────────────────────────────

export async function resolveRangeToA1(
  ha: DataHandlerAccess,
  spreadsheetId: string,
  range: RangeInput | string
): Promise<string> {
  const rangeInput = typeof range === 'string' ? { a1: range } : range;
  const resolved = await ha.context.rangeResolver.resolve(spreadsheetId, rangeInput);
  return resolved.a1Notation;
}

export async function cellToGridRange(
  ha: DataHandlerAccess,
  spreadsheetId: string,
  cell: string
): Promise<GridRangeInput> {
  const parsed = parseCellReference(cell);
  const sheetId = await ha.getSheetId(spreadsheetId, parsed.sheetName, ha.api);
  return buildGridRangeInput(sheetId, parsed.row, parsed.row + 1, parsed.col, parsed.col + 1);
}

export async function a1ToGridRange(
  ha: DataHandlerAccess,
  spreadsheetId: string,
  a1: string
): Promise<GridRangeInput> {
  const parsed = parseA1Notation(a1);
  const sheetId = await ha.getSheetId(spreadsheetId, parsed.sheetName, ha.api);
  return buildGridRangeInput(
    sheetId,
    parsed.startRow,
    parsed.endRow,
    parsed.startCol,
    parsed.endCol
  );
}

/** Convert 0-based row/col to A1 cell reference (e.g. 0,0 → "A1") */
export function buildCellRef(rowIndex: number, colIndex: number): string {
  let col = '';
  let c = colIndex;
  do {
    col = String.fromCharCode(65 + (c % 26)) + col;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${col}${rowIndex + 1}`;
}

// ─── Payload / formula helpers ────────────────────────────────────────────────

export function estimateCellsFromGridRange(range: {
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}): number {
  if (
    range.startRowIndex === undefined ||
    range.endRowIndex === undefined ||
    range.startColumnIndex === undefined ||
    range.endColumnIndex === undefined
  ) {
    return 0;
  }
  const rows = Math.max(range.endRowIndex - range.startRowIndex, 0);
  const columns = Math.max(range.endColumnIndex - range.startColumnIndex, 0);
  return rows * columns;
}

export function escapeFormulaString(value: string): string {
  return value.replace(/"/g, '""');
}

export function buildPayloadWarnings(
  ha: DataHandlerAccess,
  action: string,
  validation: {
    level: 'none' | 'warning' | 'critical' | 'exceeded';
    message: string;
    suggestions?: string[];
  }
): string[] | undefined {
  if (validation.level === 'none') {
    return undefined;
  }

  if (validation.level !== 'exceeded') {
    ha.context.metrics?.recordPayloadWarning({
      level: validation.level,
      tool: ha.toolName,
      action,
    });
  }

  const warnings = [validation.message];
  if (validation.suggestions && validation.suggestions.length > 0) {
    warnings.push(...validation.suggestions);
  }
  return warnings;
}

export function payloadTooLargeError(
  ha: DataHandlerAccess,
  action: string,
  validation: {
    message: string;
    sizeMB: string;
    suggestions?: string[];
    estimatedSplitCount?: number;
  }
): DataResponse {
  ha.context.metrics?.recordPayloadWarning({
    level: 'exceeded',
    tool: ha.toolName,
    action,
  });

  return ha.makeError({
    code: ErrorCodes.PAYLOAD_TOO_LARGE,
    message: validation.message,
    retryable: false,
    suggestedFix: validation.suggestions?.join('; ') || 'Split request into smaller batches',
    details: {
      payloadSizeMB: validation.sizeMB,
      limitMB: 9,
      estimatedSplitCount: validation.estimatedSplitCount,
    },
  });
}

export function validateValuesPayloadIfEnabled(
  ha: DataHandlerAccess,
  values: ValuesArray,
  range?: string
): PayloadSizeResult {
  if (!ha.featureFlags.enablePayloadValidation) {
    return {
      sizeBytes: 0,
      sizeMB: '0.00',
      withinLimits: true,
      level: 'none',
      message: 'Payload validation disabled',
    };
  }
  return validateValuesPayload(values, range);
}

export function checkFormulaInjection(values: unknown[][]): string | null {
  const DANGEROUS_PATTERN =
    /^[=+\-@].*(?:IMPORTDATA|IMPORTRANGE|IMPORTFEED|IMPORTHTML|IMPORTXML|GOOGLEFINANCE|QUERY)\s*\(/i;
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === 'string' && DANGEROUS_PATTERN.test(cell)) {
        const colLetter = String.fromCharCode(65 + (c % 26));
        return `row ${r + 1}, col ${colLetter} (${cell.slice(0, 40)}...)`;
      }
    }
  }
  return null;
}

export function validateValuesBatchPayloadIfEnabled(
  ha: DataHandlerAccess,
  data: Array<{ values: ValuesArray }>
): PayloadSizeResult {
  if (!ha.featureFlags.enablePayloadValidation) {
    return {
      sizeBytes: 0,
      sizeMB: '0.00',
      withinLimits: true,
      level: 'none',
      message: 'Payload validation disabled',
    };
  }
  return validateValuesBatchPayload(data, {
    spreadsheetId: ha.currentSpreadsheetId,
    operationType: 'values.batchUpdate',
  });
}

// ─── Cursor / pagination helpers ──────────────────────────────────────────────

export function decodeCursor(ha: DataHandlerAccess, cursor?: string): number | null {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const offset = Number.parseInt(decoded, 10);
    return Number.isFinite(offset) ? offset : null;
  } catch (error) {
    ha.context.logger?.warn?.('Failed to decode pagination cursor', {
      error: error instanceof Error ? error.message : String(error),
      cursor,
    });
    return null;
  }
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64');
}

export function encodeMultiRangeCursor(state: {
  rangeIndex: number;
  offsetInRange: number;
  pageSize: number;
}): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

export function decodeMultiRangeCursor(
  ha: DataHandlerAccess,
  cursor?: string
): { rangeIndex: number; offsetInRange: number; pageSize: number } | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const state = JSON.parse(decoded);
    if (
      typeof state.rangeIndex !== 'number' ||
      typeof state.offsetInRange !== 'number' ||
      typeof state.pageSize !== 'number'
    ) {
      return null;
    }
    return state;
  } catch (error) {
    ha.context.logger?.warn?.('Failed to decode multi-range cursor', {
      error: error instanceof Error ? error.message : String(error),
      cursor,
    });
    return null;
  }
}

// ─── Response-format helpers ──────────────────────────────────────────────────

export function getResponseFormatLimits(
  responseFormat: ResponseFormat
): { maxRows: number; maxCols: number } | null {
  if (responseFormat === 'preview') {
    return { maxRows: 25, maxCols: 10 };
  }
  if (responseFormat === 'compact') {
    return { maxRows: 200, maxCols: 30 };
  }
  return null;
}

export function getResponseFormatItemLimit(responseFormat: ResponseFormat): number | null {
  if (responseFormat === 'preview') {
    return 25;
  }
  if (responseFormat === 'compact') {
    return 200;
  }
  return null;
}

export function shapeValuesByResponseFormat(
  values: ValuesArray,
  responseFormat: ResponseFormat
): {
  values: ValuesArray;
  originalRowCount: number;
  originalColumnCount: number;
  returnedRowCount: number;
  returnedColumnCount: number;
  truncated: boolean;
} {
  const originalRowCount = values.length;
  const originalColumnCount = values.reduce(
    (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
    0
  );
  const limits = getResponseFormatLimits(responseFormat);

  if (!limits) {
    return {
      values,
      originalRowCount,
      originalColumnCount,
      returnedRowCount: originalRowCount,
      returnedColumnCount: originalColumnCount,
      truncated: false,
    };
  }

  const shapedValues = values.slice(0, limits.maxRows).map((row) => row.slice(0, limits.maxCols));
  const returnedColumnCount = shapedValues.reduce((max, row) => Math.max(max, row.length), 0);
  const truncated = originalRowCount > limits.maxRows || originalColumnCount > limits.maxCols;

  return {
    values: shapedValues,
    originalRowCount,
    originalColumnCount,
    returnedRowCount: shapedValues.length,
    returnedColumnCount,
    truncated,
  };
}

export function applyReadResponseFormat(
  responseData: Record<string, unknown>,
  responseFormat: ResponseFormat
): Record<string, unknown> {
  const rawValues = Array.isArray(responseData['values'])
    ? (responseData['values'] as ValuesArray)
    : [];
  const shaped = shapeValuesByResponseFormat(rawValues, responseFormat);
  const formatted: Record<string, unknown> = {
    ...responseData,
    values: shaped.values,
    rowCount: shaped.originalRowCount,
    columnCount: shaped.originalColumnCount,
    returnedRowCount: shaped.returnedRowCount,
    returnedColumnCount: shaped.returnedColumnCount,
    responseFormat: responseFormat,
  };

  if (shaped.truncated) {
    formatted['truncated'] = true;
    formatted['_responseFormatHint'] =
      `response_format="${responseFormat}" returned ${shaped.returnedRowCount}x${shaped.returnedColumnCount} ` +
      `of ${shaped.originalRowCount}x${shaped.originalColumnCount}. Use response_format:"full" for complete data.`;
  }

  return formatted;
}

export function applyBatchReadResponseFormat(
  responseData: Record<string, unknown>,
  responseFormat: ResponseFormat
): Record<string, unknown> {
  const rawValueRanges = responseData['valueRanges'];
  if (!Array.isArray(rawValueRanges)) {
    return { ...responseData, responseFormat: responseFormat };
  }

  let truncatedRanges = 0;
  const formattedRanges = rawValueRanges.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const values = Array.isArray(item['values']) ? (item['values'] as ValuesArray) : [];
    const shaped = shapeValuesByResponseFormat(values, responseFormat);

    if (shaped.truncated) {
      truncatedRanges++;
    }

    return {
      ...item,
      values: shaped.values,
    };
  });

  const formatted: Record<string, unknown> = {
    ...responseData,
    valueRanges: formattedRanges,
    responseFormat: responseFormat,
  };

  if (truncatedRanges > 0) {
    formatted['truncated'] = true;
    formatted['_responseFormatHint'] =
      `response_format="${responseFormat}" truncated ${truncatedRanges} range(s). ` +
      'Use response_format:"full" for complete values.';
  }

  return formatted;
}

export function shapeListByResponseFormat<T>(
  items: T[],
  responseFormat: ResponseFormat
): {
  items: T[];
  originalCount: number;
  returnedCount: number;
  truncated: boolean;
} {
  const originalCount = items.length;
  const limit = getResponseFormatItemLimit(responseFormat);
  if (!limit) {
    return {
      items,
      originalCount,
      returnedCount: originalCount,
      truncated: false,
    };
  }
  const shapedItems = items.slice(0, limit);
  return {
    items: shapedItems,
    originalCount,
    returnedCount: shapedItems.length,
    truncated: originalCount > limit,
  };
}

export function buildResponseFormatMeta(
  ha: DataHandlerAccess,
  action: string,
  responseData: Record<string, unknown>
): ResponseMeta {
  const baseMeta = ha.generateMeta(action, responseData, responseData);
  if (responseData['truncated'] !== true) {
    return baseMeta;
  }

  return {
    ...baseMeta,
    truncated: true,
    continuationHint:
      typeof responseData['_responseFormatHint'] === 'string'
        ? responseData['_responseFormatHint']
        : 'Use response_format:"full" to retrieve complete data.',
  };
}

// ─── Pagination plan helpers ──────────────────────────────────────────────────

export function buildPaginationPlan(
  ha: DataHandlerAccess,
  options: {
    range: string;
    cursor?: string;
    pageSize?: number;
    chunkSize?: number;
    streaming?: boolean;
  }
):
  | {
      range: string;
      hasMore: boolean;
      nextCursor?: string;
      totalRows: number;
    }
  | { error: DataResponse }
  | undefined {
  const { range, cursor, pageSize, chunkSize, streaming } = options;
  const wantsPagination = Boolean(cursor || pageSize || streaming);

  let parsed;
  try {
    parsed = parseA1Notation(range);
  } catch (error) {
    if (wantsPagination) {
      return {
        error: ha.makeError({
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Pagination is not supported for this range format',
          retryable: false,
          suggestedFix:
            'Check the parameter format and ensure all required parameters are provided',
          details: {
            range,
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
      };
    }
    return undefined; // spill detection fallback
  }

  const totalRows = Math.max(parsed.endRow - parsed.startRow, 0);
  const totalColumns = Math.max(parsed.endCol - parsed.startCol, 1);
  const totalCells = totalRows * totalColumns;
  const autoPaginate = totalCells > MAX_CELLS_PER_REQUEST;
  if (!wantsPagination && !autoPaginate) {
    return undefined;
  }

  const maxRowsPerPage = Math.max(1, Math.floor(MAX_CELLS_PER_REQUEST / totalColumns));
  const effectivePageSize = Math.min(
    pageSize ?? chunkSize ?? DEFAULT_READ_PAGE_SIZE,
    maxRowsPerPage
  );
  const offset = decodeCursor(ha, cursor);
  if (offset === null || offset < 0 || offset >= totalRows) {
    return {
      error: ha.makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Invalid pagination cursor',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
        details: { cursor },
      }),
    };
  }

  const pageStart = parsed.startRow + offset;
  const pageEnd = Math.min(pageStart + effectivePageSize, parsed.endRow);
  const pageRange = buildA1Notation(
    parsed.sheetName,
    parsed.startCol,
    pageStart,
    parsed.endCol,
    pageEnd
  );
  const hasMore = pageEnd < parsed.endRow;
  const nextCursor = hasMore ? encodeCursor(pageEnd - parsed.startRow) : undefined;

  return {
    range: pageRange,
    hasMore,
    nextCursor,
    totalRows,
  };
}

export async function buildMultiRangePaginationPlan(
  ha: DataHandlerAccess,
  options: {
    spreadsheetId: string;
    ranges: RangeInput[];
    cursor?: string;
    pageSize?: number;
  }
): Promise<
  | {
      rangesToFetch: RangeInput[];
      rangeIndices: number[];
      hasMore: boolean;
      nextCursor?: string;
      totalRanges: number;
    }
  | { error: DataResponse }
> {
  const { ranges, cursor, pageSize = 5 } = options;

  const state = decodeMultiRangeCursor(ha, cursor) || {
    rangeIndex: 0,
    offsetInRange: 0,
    pageSize,
  };

  if (state.rangeIndex < 0 || state.rangeIndex >= ranges.length) {
    return {
      error: ha.makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Invalid pagination cursor: range index out of bounds',
        retryable: false,
        suggestedFix: "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
        details: { cursor, rangeIndex: state.rangeIndex, totalRanges: ranges.length },
      }),
    };
  }

  const rangesToFetch: RangeInput[] = [];
  const rangeIndices: number[] = [];
  let currentRangeIndex = state.rangeIndex;
  let remainingPageSize = state.pageSize;

  while (currentRangeIndex < ranges.length && remainingPageSize > 0) {
    rangesToFetch.push(ranges[currentRangeIndex]!);
    rangeIndices.push(currentRangeIndex);
    remainingPageSize--;
    currentRangeIndex++;
  }

  const hasMore = currentRangeIndex < ranges.length;
  const nextCursor = hasMore
    ? encodeMultiRangeCursor({
        rangeIndex: currentRangeIndex,
        offsetInRange: 0,
        pageSize: state.pageSize,
      })
    : undefined;

  return {
    rangesToFetch,
    rangeIndices,
    hasMore,
    nextCursor,
    totalRanges: ranges.length,
  };
}

// ─── Row data builder ─────────────────────────────────────────────────────────

export function buildRowData(
  values: ValuesArray,
  valueInputOption: string
): sheets_v4.Schema$RowData[] {
  return values.map((rowValues: unknown[]) => ({
    values: rowValues.map((cellValue: unknown) => {
      const isFormula = typeof cellValue === 'string' && cellValue.startsWith('=');

      if (valueInputOption === 'USER_ENTERED' || valueInputOption === 'RAW') {
        if (isFormula) {
          return { userEnteredValue: { formulaValue: cellValue as string } };
        }
        if (typeof cellValue === 'number') {
          return { userEnteredValue: { numberValue: cellValue } };
        }
        if (typeof cellValue === 'boolean') {
          return { userEnteredValue: { boolValue: cellValue } };
        }
        return { userEnteredValue: { stringValue: String(cellValue) } };
      }

      return { userEnteredValue: { stringValue: String(cellValue) } };
    }),
  }));
}

// ─── Destructive confirmation helper ─────────────────────────────────────────

export async function requestDestructiveConfirmation(
  ha: DataHandlerAccess,
  action: string,
  description: string,
  estimatedCells: number,
  threshold: number = 100
): Promise<{ proceed: boolean; reason?: string }> {
  if (estimatedCells <= threshold) {
    return { proceed: true };
  }

  if (!ha.context.elicitationServer) {
    return { proceed: true };
  }

  try {
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      action,
      description
    );

    if (!confirmation.confirmed) {
      return { proceed: false, reason: confirmation.reason || 'User cancelled the operation' };
    }

    return { proceed: true };
  } catch (err) {
    ha.context.logger?.warn('Elicitation failed, proceeding with operation', {
      action,
      error: err instanceof Error ? err.message : String(err),
    });
    return { proceed: true };
  }
}
