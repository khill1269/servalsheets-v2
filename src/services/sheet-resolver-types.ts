import type { sheets_v4 } from 'googleapis';

/**
 * Sheet reference - can be either name or ID.
 */
export interface SheetReference {
  sheetName?: string;
  sheetId?: number;
}

/**
 * Resolved sheet information.
 */
export interface ResolvedSheet {
  sheetId: number;
  title: string;
  index: number;
  hidden: boolean;
  gridProperties?: {
    rowCount: number;
    columnCount: number;
    frozenRowCount?: number;
    frozenColumnCount?: number;
  };
}

/**
 * Sheet resolution result with confidence.
 */
export interface SheetResolutionResult {
  sheet: ResolvedSheet;
  method: 'exact_name' | 'exact_id' | 'fuzzy_name' | 'index';
  confidence: number;
  alternatives?: Array<{ sheet: ResolvedSheet; similarity: number }>;
}

/**
 * Sheet resolver options.
 */
export interface SheetResolverOptions {
  sheetsApi: sheets_v4.Sheets;
  cacheTtlMs?: number;
  enableFuzzyMatch?: boolean;
  fuzzyThreshold?: number;
}
