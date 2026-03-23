/**
 * FormatHandlerAccess — interface used by all format-actions submodule functions.
 *
 * Submodule standalone functions receive a `FormatHandlerAccess` object instead of `this`,
 * which exposes the protected BaseHandler capabilities through public `_delegate` wrappers
 * defined on FormatHandler.
 */

import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { FormatResponse } from '../../schemas/index.js';
import type { ResponseMeta } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import type { GridRangeInput } from '../../utils/google-sheets-helpers.js';

// ─── Shared constants ──────────────────────────────────────────────────────────

/** ISSUE-179: Preset color palette — single source of truth for all apply_preset colors */
export const PRESET_COLORS = {
  headerBg: { red: 0.2, green: 0.4, blue: 0.6 },
  headerText: { red: 1, green: 1, blue: 1 },
  altRowFirst: { red: 1, green: 1, blue: 1 },
  altRowSecond: { red: 0.95, green: 0.95, blue: 0.95 },
  totalRowBg: { red: 0.9, green: 0.9, blue: 0.9 },
  totalRowBorder: { red: 0, green: 0, blue: 0 },
  positiveHighlight: { red: 0.85, green: 0.95, blue: 0.85 },
  negativeHighlight: { red: 0.95, green: 0.85, blue: 0.85 },
} as const;

export const ELICITABLE_RULE_PRESETS = [
  'highlight_duplicates',
  'highlight_blanks',
  'highlight_errors',
  'color_scale_green_red',
  'data_bars',
  'top_10_percent',
  'bottom_10_percent',
] as const;

export type ElicitableRulePreset = (typeof ELICITABLE_RULE_PRESETS)[number];

export function isElicitableRulePreset(value: unknown): value is ElicitableRulePreset {
  return (
    typeof value === 'string' && (ELICITABLE_RULE_PRESETS as readonly string[]).includes(value)
  );
}

// ─── Condition type ────────────────────────────────────────────────────────────

export type ConditionType =
  | 'NUMBER_GREATER'
  | 'NUMBER_GREATER_THAN_EQ'
  | 'NUMBER_LESS'
  | 'NUMBER_LESS_THAN_EQ'
  | 'NUMBER_EQ'
  | 'NUMBER_NOT_EQ'
  | 'NUMBER_BETWEEN'
  | 'NUMBER_NOT_BETWEEN'
  | 'TEXT_CONTAINS'
  | 'TEXT_NOT_CONTAINS'
  | 'TEXT_STARTS_WITH'
  | 'TEXT_ENDS_WITH'
  | 'TEXT_EQ'
  | 'TEXT_IS_EMAIL'
  | 'TEXT_IS_URL'
  | 'DATE_EQ'
  | 'DATE_BEFORE'
  | 'DATE_AFTER'
  | 'DATE_ON_OR_BEFORE'
  | 'DATE_ON_OR_AFTER'
  | 'DATE_BETWEEN'
  | 'DATE_NOT_BETWEEN'
  | 'DATE_IS_VALID'
  | 'ONE_OF_RANGE'
  | 'ONE_OF_LIST'
  | 'BLANK'
  | 'NOT_BLANK'
  | 'CUSTOM_FORMULA'
  | 'BOOLEAN';

// ─── FormatHandlerAccess ───────────────────────────────────────────────────────

export type FormatHandlerAccess = {
  makeError: (e: ErrorDetail) => FormatResponse;
  makeSuccess: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean,
    meta?: ResponseMeta
  ) => FormatResponse;
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
  /** Resolve range to A1 notation via BaseHandler.resolveRange */
  resolveRange: (spreadsheetId: string, range: unknown) => Promise<string>;
  /** Convert A1 notation to GridRangeInput (uses getSheetId internally) */
  a1ToGridRange: (spreadsheetId: string, a1: string) => Promise<GridRangeInput>;
  /** Resolve a range object (including namedRange, grid) to GridRangeInput */
  resolveGridRange: (
    spreadsheetId: string,
    sheetId: number,
    range: unknown
  ) => Promise<GridRangeInput>;
  /** Resolve a range object to GridRangeInput (no sheetId param) */
  resolveRangeInput: (spreadsheetId: string, range: unknown) => Promise<GridRangeInput>;
  /** exactCellCount using sparsityFactor: 1 */
  exactCellCount: (range: sheets_v4.Schema$GridRange) => number;
  context: HandlerContext;
  api: sheets_v4.Sheets;
  toolName: string;
  currentSpreadsheetId: string | undefined;
};
