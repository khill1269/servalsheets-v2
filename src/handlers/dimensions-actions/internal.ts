/**
 * DimensionsHandlerAccess — interface used by all dimensions-actions submodule functions.
 *
 * Submodule standalone functions receive a `DimensionsHandlerAccess` object instead of `this`,
 * which exposes the protected BaseHandler capabilities through public `_delegate` wrappers
 * defined on DimensionsHandler.
 */

import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { DimensionsResponse } from '../../schemas/index.js';
import type { ResponseMeta } from '../../schemas/index.js';
import type { ErrorDetail, SafetyOptions } from '../../schemas/shared.js';
import type { GridRangeInput } from '../../utils/google-sheets-helpers.js';
import type { RangeInput } from '../../schemas/shared.js';
import type { SafetyContext, SafetyWarning } from '../../utils/safety-helpers.js';

export type DimensionsHandlerAccess = {
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: unknown,
    dryRun?: boolean,
    meta?: ResponseMeta
  ) => DimensionsResponse;
  error: (e: ErrorDetail) => DimensionsResponse;
  notFoundError: (resourceType: string, resourceId: string | number) => DimensionsResponse;
  generateMeta: (
    action: string,
    input: Record<string, unknown>,
    result?: Record<string, unknown>,
    options?: { cellsAffected?: number; apiCallsMade?: number; duration?: number }
  ) => ResponseMeta;
  getSafetyWarnings: (safetyContext: SafetyContext, safety?: SafetyOptions) => SafetyWarning[];
  formatWarnings: (warnings: SafetyWarning[]) => string[];
  createSafetySnapshot: (safetyContext: SafetyContext, safety?: SafetyOptions) => Promise<unknown>;
  snapshotInfo: (snapshot: unknown) => unknown;
  rangeToGridRange: (
    spreadsheetId: string,
    range: RangeInput,
    api: sheets_v4.Sheets
  ) => Promise<GridRangeInput>;
  gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => GridRangeInput;
  getSheetId: (spreadsheetId: string, sheetName: string, api: sheets_v4.Sheets) => Promise<number>;
  sendProgress: (current: number, total: number, message?: string) => void;
  context: HandlerContext;
  sheetsApi: sheets_v4.Sheets;
};
