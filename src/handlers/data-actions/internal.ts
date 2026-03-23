/**
 * DataHandlerAccess — interface used by all data-actions submodule functions.
 *
 * Submodule standalone functions receive a `DataHandlerAccess` object instead of `this`,
 * which exposes the protected BaseHandler capabilities through public `_delegate` wrappers
 * defined on SheetsDataHandler.
 */

import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { DataResponse } from '../../schemas/data.js';
import type { ResponseMeta } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';

// Re-export constants so submodules can import from here
export const DEFAULT_READ_PAGE_SIZE = 1000;
// Heuristic safety limit to keep read payloads small and latency predictable.
export const MAX_CELLS_PER_REQUEST = 10_000;
// Fix 2.3: Auto-chunk large batch operations to prevent timeouts (e.g., 29-range batch → 3 chunks of 10)
export const MAX_BATCH_RANGES = 50;

export type ResponseFormat = 'full' | 'compact' | 'preview';

export type DataFeatureFlags = {
  enableDataFilterBatch: boolean;
  enableTableAppends: boolean;
  enablePayloadValidation: boolean;
};

export type DataHandlerAccess = {
  makeError: (e: ErrorDetail) => DataResponse;
  makeSuccess: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean,
    meta?: ResponseMeta
  ) => DataResponse;
  generateMeta: (
    action: string,
    input: Record<string, unknown>,
    result?: Record<string, unknown>,
    options?: { cellsAffected?: number; apiCallsMade?: number; duration?: number }
  ) => ResponseMeta;
  getSheetId: (
    spreadsheetId: string,
    sheetName?: string,
    api?: sheets_v4.Sheets
  ) => Promise<number>;
  resolveRange: (spreadsheetId: string, range: unknown) => Promise<string>;
  deduplicatedApiCall: <T>(key: string, call: () => Promise<T>) => Promise<T>;
  recordAccessAndPrefetch: (params: {
    spreadsheetId: string;
    sheetId?: number;
    range?: string;
    action?: 'read' | 'write' | 'open';
  }) => void;
  sendProgress: (completed: number, total: number, message?: string) => Promise<void>;
  withCircuitBreaker: <T>(operation: string, fn: () => Promise<T>) => Promise<T>;
  columnToLetter: (index: number) => string;
  context: HandlerContext;
  api: sheets_v4.Sheets;
  featureFlags: DataFeatureFlags;
  toolName: string;
  currentSpreadsheetId: string | undefined;
};
